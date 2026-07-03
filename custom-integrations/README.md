# custom-integrations

The integration layer that turns career-ops into a one-stop job-search platform.
career-ops (this repo root) stays the **engine**; everything that bolts other tools
onto it lives **here**, in a folder you own 100%.

## The golden rule

**Your code depends on the vendored tools; the vendored tools never depend on your code.**

- Never hand-edit anything under `vendor/` (they are git submodules — edits break sync).
- All glue lives in `custom-integrations/` — nothing about the integration touches career-ops core files, so `node update-system.mjs` (career-ops upstream sync) stays conflict-free.
- All inter-tool communication goes through the **canonical schema** (`shared-schema/resume.schema.json`). No tool reaches into another tool's internals.

## Layout

```
custom-integrations/
├── shared-schema/
│   └── resume.schema.json        # Canonical contract (JSON Resume aligned) — the spine
├── cv-to-resume/
│   └── cv-to-jsonresume.mjs       # cv.md + config/profile.yml → canonical JSON Resume
├── scripts/
│   ├── sync-upstream.sh           # git submodule update --remote for all vendored tools
│   └── run-pipeline.sh            # cv/JD → canonical JSON → RR import instructions
├── output/                        # Generated artifacts (gitignored)
└── vendor/
    └── reactive-resume/           # git submodule → karangupta8/reactive-resume-fork (RR v5)
```

## The flow

```
JD ──► career-ops tailors CV content ──► cv-to-jsonresume.mjs ──► canonical JSON Resume
                                                                        │
                                                     Reactive Resume "Import → JSON Resume"
                                                                        │
                                              pick a template in RR ──► export polished PDF
```

career-ops **produces** the canonical JSON; Reactive Resume **consumes** it. RR's JSON
Resume importer (`vendor/reactive-resume/packages/import/src/json-resume.tsx`) validates
strictly, so the adapter emits ISO-8601 dates (or omits them) and only valid emails/urls.

## Usage

**Base CV → canonical JSON:**
```bash
node custom-integrations/cv-to-resume/cv-to-jsonresume.mjs --pretty
# → custom-integrations/output/resume.canonical.json
```

**JD-tailored CV → canonical JSON** (agent writes a tailored CV markdown first, same
section structure as `cv.md`):
```bash
node custom-integrations/cv-to-resume/cv-to-jsonresume.mjs \
  --cv output/cv-karan-acme.tailored.md \
  --job "Senior AI Engineer @ Acme" --pretty
```

**Full pipeline helper:**
```bash
bash custom-integrations/scripts/run-pipeline.sh --job "Senior AI Engineer @ Acme"
```

**Render in Reactive Resume:**
1. Start RR: `docker compose -f custom-integrations/vendor/reactive-resume/compose.yml up -d`
2. In RR: Dashboard → Create Resume → **Import** → **JSON Resume** → upload `output/resume.canonical.json`
3. Choose a template in the editor → **Export → PDF**

> Windows: run the `.sh` scripts through Git Bash (`bash custom-integrations/scripts/…`).

## First clone / after pulling

The vendored tools are submodules, so:
```bash
git submodule update --init --recursive        # after cloning this repo
bash custom-integrations/scripts/sync-upstream.sh   # to pull upstream tool updates
```

## Adding another tool later

1. `git submodule add <git-url> custom-integrations/vendor/<name>`
2. Write one adapter under `custom-integrations/<name>-to-resume/` (or `resume-to-<name>/`)
   that maps to/from `shared-schema/resume.schema.json`.
3. Add a `git submodule update --remote` line for it in `scripts/sync-upstream.sh`.

Only the adapter is real work — the canonical schema is the fixed contract everything
negotiates through.
