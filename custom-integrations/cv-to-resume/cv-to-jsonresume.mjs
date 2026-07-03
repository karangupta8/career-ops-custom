#!/usr/bin/env node

/**
 * cv-to-jsonresume.mjs — career-ops → canonical JSON Resume adapter
 *
 * Reads the career-ops source of truth (cv.md + config/profile.yml) and emits a
 * JSON Resume document that Reactive Resume (v5) imports natively via its
 * "JSON Resume" importer (custom-integrations/vendor/reactive-resume →
 * packages/import/src/json-resume.tsx).
 *
 * This is the platform seam: career-ops PRODUCES this canonical shape; Reactive
 * Resume CONSUMES it. Nothing here reaches into RR's internals — it only writes
 * a file RR knows how to read.
 *
 * Hard requirements enforced to satisfy RR's Zod import validation:
 *   - Dates are ISO 8601 (YYYY | YYYY-MM | YYYY-MM-DD) or OMITTED. RR's regex
 *     rejects "07/2024" and even "" — so "Present" endDates are dropped, not blanked.
 *   - email / url fields are emitted only when syntactically valid; otherwise omitted.
 *
 * Usage:
 *   node custom-integrations/cv-to-resume/cv-to-jsonresume.mjs \
 *     [--cv <path>] [--out <path>] [--job "<title @ company>"] [--pretty]
 *
 * Defaults: --cv <root>/cv.md   --out <root>/data/resume.canonical.json
 *
 * The tailored-per-JD flow: the career-ops agent writes a JD-tailored CV markdown
 * (same section structure as cv.md), then runs this with --cv <that file> --job "…".
 */

import { load as yamlLoad } from 'js-yaml';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..'); // custom-integrations/cv-to-resume → repo root

// ── validation helpers ──────────────────────────────────────────────────────

const isEmail = (s) => typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const isUrl = (s) => typeof s === 'string' && /^https?:\/\/\S+$/i.test(s.trim());

/**
 * Normalize a single date token to ISO 8601 (YYYY | YYYY-MM | YYYY-MM-DD),
 * or return null when it is open-ended ("Present") or unparseable — callers
 * must OMIT the field on null, never emit an empty string (RR rejects "").
 */
function toIso(token) {
  const t = (token || '').trim();
  if (!t || /present|current|now|ongoing|date/i.test(t)) return null;
  let m;
  if ((m = t.match(/^(\d{1,2})\/(\d{4})$/))) return `${m[2]}-${m[1].padStart(2, '0')}`;      // 07/2024
  if ((m = t.match(/^(\d{4})[-/](\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2, '0')}`;     // 2024-07 / 2024/7
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return t;                                    // full ISO
  if ((m = t.match(/^(\d{4})$/))) return m[1];                                                 // 2024
  return null;
}

/** Split a "start – end" range on en/em dash or spaced hyphen → { startDate, endDate }. */
function parseDateRange(raw) {
  const s = (raw || '').trim();
  if (!s) return {};
  const parts = s.split(/\s*[–—]\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  const out = {};
  const start = toIso(parts[0]);
  const end = parts.length > 1 ? toIso(parts[1]) : null;
  if (start) out.startDate = start;
  if (end) out.endDate = end;
  return out;
}

/** Split a "Left — Right" heading on a spaced dash. */
function splitHeading(heading) {
  const parts = heading.split(/\s+[—–-]\s+/);
  if (parts.length >= 2) {
    return { left: parts[0].trim(), right: parts.slice(1).join(' - ').trim() };
  }
  return { left: heading.trim(), right: '' };
}

const stripMd = (s) => s.replace(/\*\*/g, '').replace(/^[*_]+|[*_]+$/g, '').trim();

// ── markdown parsing ────────────────────────────────────────────────────────

/** Break cv.md into an H1/label plus H2 sections; H3 entries stay in section bodies. */
function parseCvStructure(md) {
  const lines = md.split(/\r?\n/);
  let h1 = '';
  let label = '';
  const sections = [];
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h1m = line.match(/^#\s+(.+?)\s*$/);
    const h2m = line.match(/^##\s+(.+?)\s*$/);
    if (h1m) {
      h1 = stripMd(h1m[1]);
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (!t) continue;
        if (t.startsWith('#') || t.startsWith('-') || t === '---') break;
        label = stripMd(t);
        break;
      }
      continue;
    }
    if (h2m) {
      cur = { title: stripMd(h2m[1]), key: sectionKey(h2m[1]), body: [] };
      sections.push(cur);
      continue;
    }
    if (cur) cur.body.push(line);
  }
  return { h1, label, sections };
}

function sectionKey(title) {
  const t = title.toLowerCase().replace(/[*_`#&]/g, '').trim();
  if (/summary|about|profile/.test(t)) return 'summary';
  if (/experience|employment|work history/.test(t)) return 'work';
  if (/project/.test(t)) return 'projects';
  if (/education/.test(t)) return 'education';
  if (/certification|certificate|license/.test(t)) return 'certificates';
  if (/skill|competenc|technolog/.test(t)) return 'skills';
  if (/achievement|award|honou?r/.test(t)) return 'awards';
  if (/language/.test(t)) return 'languages';
  if (/interest|hobb/.test(t)) return 'interests';
  return t;
}

/** Split a section body into H3 entries: { heading, lines[] }. */
function splitEntries(bodyLines) {
  const entries = [];
  let cur = null;
  for (const line of bodyLines) {
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      cur = { heading: h3[1].trim(), lines: [] };
      entries.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  return entries;
}

const bulletsOf = (lines) =>
  lines
    .map((l) => l.match(/^\s*[-*]\s+(.+)$/))
    .filter(Boolean)
    .map((m) => stripMd(m[1]));

const paragraphsOf = (lines) =>
  lines
    .filter((l) => l.trim() && l.trim() !== '---' && !/^\s*[-*]\s+/.test(l) && !/^\*.*\*$/.test(l.trim()))
    .map((l) => stripMd(l));

/** First italic "*…*" line in an entry (the "dates | location" meta line). */
function metaLine(lines) {
  for (const l of lines) {
    const m = l.trim().match(/^\*(.+)\*$/);
    if (m) return m[1].trim();
  }
  return '';
}

function parseWork(bodyLines) {
  return splitEntries(bodyLines).map((e) => {
    const { left: position, right: company } = splitHeading(e.heading);
    const meta = metaLine(e.lines);
    const [datePart, locPart] = meta.split('|').map((s) => (s || '').trim());
    const item = { name: company || position, position };
    Object.assign(item, parseDateRange(datePart));
    if (locPart) item.location = locPart;
    const highlights = bulletsOf(e.lines);
    if (highlights.length) item.highlights = highlights;
    return item;
  });
}

function parseProjects(bodyLines) {
  return splitEntries(bodyLines).map((e) => {
    let heading = e.heading;
    let dateRange = '';
    const ym = heading.match(/\*\(([^)]+)\)\*\s*$/) || heading.match(/\(([^)]+)\)\s*$/);
    if (ym) {
      dateRange = ym[1];
      heading = heading.replace(/\*?\([^)]+\)\*?\s*$/, '').trim();
    }
    const { left: name, right: tagline } = splitHeading(heading);
    const highlights = bulletsOf(e.lines);
    const paras = paragraphsOf(e.lines);
    const description = [tagline, ...paras].filter(Boolean).join(' ').trim();
    const item = { name };
    if (description) item.description = description;
    if (highlights.length) item.highlights = highlights;
    Object.assign(item, parseDateRange(dateRange));
    return item;
  });
}

function parseEducation(bodyLines) {
  // Format: "### <Degree>" then italic meta "<Institution, location> | <dates>".
  return splitEntries(bodyLines).map((e) => {
    const degree = e.heading.trim();
    const meta = metaLine(e.lines);
    const [instPart, datePart] = meta.split('|').map((s) => (s || '').trim());
    const item = {};
    item.institution = instPart || degree;
    if (instPart) item.studyType = degree; // degree only meaningful when institution is separate
    Object.assign(item, parseDateRange(datePart));
    const courses = bulletsOf(e.lines);
    if (courses.length) item.courses = courses;
    return item;
  });
}

/** "Label: a, b, c" grouped skills — handles both "- **Label:** …" and bold-paragraph "**Label:** …". */
function parseSkills(bodyLines) {
  const items = [];
  for (const raw of bodyLines) {
    const line = raw.replace(/^\s*[-*]\s+/, '').trim();
    if (!line || line === '---') continue;
    const m = stripMd(line).match(/^([^:]{2,40}):\s*(.+)$/);
    if (m) {
      items.push({ name: m[1].trim(), keywords: m[2].split(/[,;]/).map((s) => s.trim()).filter(Boolean) });
    } else {
      const kws = stripMd(line).split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
      if (kws.length > 1) items.push({ name: 'Skills', keywords: kws });
      else if (kws.length === 1) items.push({ name: kws[0] });
    }
  }
  return items;
}

/** "- **Award (year)** — summary" → JSON Resume awards. */
function parseAwards(bodyLines) {
  return bulletsOf(bodyLines).map((b) => {
    const m = b.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    const title = (m ? m[1] : b).trim();
    const item = { title };
    if (m) item.summary = m[2].trim();
    const y = title.match(/\((\d{4})\)/) || title.match(/\b(19|20)\d{2}\b/);
    if (y) item.date = y[1].length === 4 ? y[1] : y[0];
    return item;
  });
}

/** Pipe/comma separated language list → JSON Resume languages. */
function parseLanguages(bodyLines) {
  const text = paragraphsOf(bodyLines).join(' | ');
  return text
    .split(/[|,;]/)
    .map((s) => stripMd(s).trim())
    .filter(Boolean)
    .map((language) => ({ language }));
}

/** Pipe-grouped interest phrases → JSON Resume interests (first token = name, rest = keywords). */
function parseInterests(bodyLines) {
  const text = paragraphsOf(bodyLines).join(' | ');
  return text
    .split('|')
    .map((s) => stripMd(s).trim())
    .filter(Boolean)
    .map((group) => {
      const parts = group.split(',').map((s) => s.trim()).filter(Boolean);
      const item = { name: parts[0] };
      if (parts.length > 1) item.keywords = parts.slice(1);
      return item;
    });
}

function parseCertificates(bodyLines) {
  const out = [];
  for (const b of bulletsOf(bodyLines)) {
    const m = b.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    if (m) out.push({ name: m[1].trim(), issuer: m[2].trim() });
    else out.push({ name: b });
  }
  for (const e of splitEntries(bodyLines)) {
    const { left, right } = splitHeading(e.heading);
    out.push({ name: left, ...(right ? { issuer: right } : {}) });
  }
  return out;
}

// ── basics from profile.yml ─────────────────────────────────────────────────

function usernameFromUrl(url) {
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean);
    return p[p.length - 1] || '';
  } catch {
    return '';
  }
}

function buildBasics(profile, label, summary) {
  const c = (profile && profile.candidate) || {};
  const narrative = (profile && profile.narrative) || {};
  const basics = {
    name: c.full_name || '',
    label: label || narrative.headline || '',
    summary: summary || narrative.exit_story || '',
  };
  if (isEmail(c.email)) basics.email = c.email.trim();
  if (c.phone) basics.phone = String(c.phone).trim();
  if (isUrl(c.portfolio_url)) basics.url = c.portfolio_url.trim();

  if (c.location) basics.location = { city: c.location, region: '', countryCode: '' };

  const profiles = [];
  const add = (network, url) => {
    if (isUrl(url)) profiles.push({ network, username: usernameFromUrl(url), url: url.trim() });
  };
  add('LinkedIn', c.linkedin);
  add('GitHub', c.github);
  add('Twitter', c.twitter);
  if (profiles.length) basics.profiles = profiles;

  return basics;
}

// ── main ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    cv: join(ROOT, 'cv.md'),
    out: join(ROOT, 'custom-integrations', 'output', 'resume.canonical.json'),
    job: '',
    pretty: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cv') args.cv = resolve(argv[++i]);
    else if (a === '--out') args.out = resolve(argv[++i]);
    else if (a === '--job') args.job = argv[++i] || '';
    else if (a === '--pretty') args.pretty = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node cv-to-jsonresume.mjs [--cv <path>] [--out <path>] [--job "<title>"] [--pretty]');
    return;
  }

  if (!existsSync(args.cv)) {
    console.error(`❌ CV markdown not found: ${args.cv}`);
    process.exit(1);
  }
  const md = readFileSync(args.cv, 'utf-8');

  let profile = {};
  const profilePath = join(ROOT, 'config', 'profile.yml');
  if (existsSync(profilePath)) {
    try {
      profile = yamlLoad(readFileSync(profilePath, 'utf-8')) || {};
    } catch (err) {
      console.error(`⚠️  Could not parse config/profile.yml (${err.message}); using cv.md contact block only.`);
    }
  }

  const { label, sections } = parseCvStructure(md);
  const byKey = (k) => sections.find((s) => s.key === k);
  const summarySection = byKey('summary');
  const summary = summarySection ? paragraphsOf(summarySection.body).join(' ').trim() : '';

  const resume = { $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json' };
  resume.basics = buildBasics(profile, label, summary);

  const work = byKey('work') ? parseWork(byKey('work').body) : [];
  const projects = byKey('projects') ? parseProjects(byKey('projects').body) : [];
  const education = byKey('education') ? parseEducation(byKey('education').body) : [];
  const skills = byKey('skills') ? parseSkills(byKey('skills').body) : [];
  const certificates = byKey('certificates') ? parseCertificates(byKey('certificates').body) : [];
  const awards = byKey('awards') ? parseAwards(byKey('awards').body) : [];
  const languages = byKey('languages') ? parseLanguages(byKey('languages').body) : [];
  const interests = byKey('interests') ? parseInterests(byKey('interests').body) : [];

  if (work.length) resume.work = work;
  if (education.length) resume.education = education;
  if (skills.length) resume.skills = skills;
  if (projects.length) resume.projects = projects;
  if (certificates.length) resume.certificates = certificates;
  if (awards.length) resume.awards = awards;
  if (languages.length) resume.languages = languages;
  if (interests.length) resume.interests = interests;

  // Provenance (RR's meta is a looseObject → extra keys pass; `canonical` must be
  // a URL if set, so we don't overload it with a format tag).
  resume.meta = {
    version: 'jsonresume@1.0.0',
    generatedBy: 'career-ops cv-to-jsonresume',
    generatedAt: new Date().toISOString(),
    source: args.cv.split(/[\\/]/).pop(),
    tailoredForJob: args.job || '',
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(resume, null, args.pretty ? 2 : 0));

  console.log(`✅ Canonical resume written: ${args.out}`);
  console.log(
    `   basics${resume.work ? `, work×${work.length}` : ''}` +
      `${resume.projects ? `, projects×${projects.length}` : ''}` +
      `${resume.education ? `, education×${education.length}` : ''}` +
      `${resume.skills ? `, skills×${skills.length}` : ''}` +
      `${resume.certificates ? `, certificates×${certificates.length}` : ''}` +
      `${resume.awards ? `, awards×${awards.length}` : ''}` +
      `${resume.languages ? `, languages×${languages.length}` : ''}` +
      `${resume.interests ? `, interests×${interests.length}` : ''}`,
  );
  if (args.job) console.log(`   tailored for: ${args.job}`);
  console.log(`   → Import in Reactive Resume: Dashboard → Create → Import → JSON Resume (.json)`);
}

main();
