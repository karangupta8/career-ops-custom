// @ts-check
/**
 * plugins.local/naukri/index.mjs
 *
 * Naukri.com provider — India's #1 job portal.
 * Hits the public search JSON API used by the Naukri website itself.
 * No auth, no API key required.
 *
 * How it works:
 *   Naukri exposes a public REST endpoint at /jobapi/v3/search that powers
 *   their job search page. It returns structured JSON including title, company,
 *   location, and a job detail URL. We page through results up to maxPages.
 *
 * portals.yml entry fields:
 *   provider: naukri          (required — routes to this plugin)
 *   searchKeywords: string    (space-separated, e.g. "AI Engineer LLM")
 *   searchLocation: string    (e.g. "Bengaluru", "" for all India)
 *   pageSize: number          (default: 20, max: 50)
 *   maxPages: number          (default: 3)
 *
 * If the API shape changes, adjust parseNaukriItem() below.
 * Run `node scan.mjs --company "Naukri — AI Engineer India"` to test.
 */

const BASE_URL = 'https://www.naukri.com';
const SEARCH_PATH = '/jobapi/v3/search';
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 3;

/**
 * Build the Naukri search URL.
 * @param {{ keyword: string, location: string, pageSize: number, pageNo: number }} params
 */
function buildUrl(params) {
  const url = new URL(`${BASE_URL}${SEARCH_PATH}`);
  url.searchParams.set('noOfResults', String(params.pageSize));
  url.searchParams.set('urlType', 'search_by_key_loc');
  url.searchParams.set('searchType', 'adv');
  url.searchParams.set('src', 'directsearch');
  url.searchParams.set('pageNo', String(params.pageNo));
  if (params.keyword) url.searchParams.set('keyword', params.keyword);
  if (params.location) url.searchParams.set('location', params.location);
  return url.href;
}

/**
 * Parse one Naukri API result item into the canonical Job shape.
 * Naukri returns objects shaped roughly like:
 * {
 *   jobId: "...",
 *   title: "Senior AI Engineer",
 *   companyName: "Acme Corp",
 *   location: "Bengaluru",
 *   jdURL: "/job-listings/senior-ai-engineer-...",
 *   createdDate: "08 Jul 2026"
 * }
 *
 * @param {any} item
 * @returns {{ title: string, url: string, company: string, location: string } | null}
 */
function parseNaukriItem(item) {
  if (!item || typeof item !== 'object') return null;

  const title = (item.title || '').trim();
  if (!title) return null;

  // Build absolute URL from jdURL (relative) or jobURL (absolute variant)
  let url = '';
  const raw = item.jdURL || item.jobURL || '';
  if (raw.startsWith('http')) {
    url = raw;
  } else if (raw.startsWith('/')) {
    url = `${BASE_URL}${raw}`;
  }
  if (!url) return null;

  // Validate it resolves back to naukri.com
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('naukri.com')) return null;
  } catch {
    return null;
  }

  const company = (item.companyName || '').trim();
  const location = (item.location || item.placeholderLabel || '').trim();

  return { title, url, company, location };
}

/** @type {import('../../plugins/_types.js').Plugin} */
export default {
  provider: {
    id: 'naukri',

    detect(_entry) {
      // Naukri is a job board aggregator — auto-detection not supported.
      // Use `provider: naukri` explicitly in portals.yml.
      return null;
    },

    async fetch(entry, ctx) {
      const keyword = (entry.searchKeywords || '').trim();
      const location = (entry.searchLocation || '').trim();
      const pageSize = Math.min(Number(entry.pageSize) || DEFAULT_PAGE_SIZE, 50);
      const maxPages = Number(entry.maxPages) || DEFAULT_MAX_PAGES;

      const allJobs = [];

      for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        const searchUrl = buildUrl({ keyword, location, pageSize, pageNo });

        let json;
        try {
          // ctx.fetch is the engine's guarded fetch, pinned to allowedHosts.
          // We pass extra headers that Naukri's API requires.
          const res = await ctx.fetch(searchUrl, {
            headers: {
              'Appid': '109',
              'systemid': '109',
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (compatible; career-ops/1.0)',
            },
          });
          if (!res.ok) {
            if (pageNo === 1) throw new Error(`Naukri API returned ${res.status} ${res.statusText}`);
            console.warn(`naukri: page ${pageNo} returned ${res.status} — stopping`);
            break;
          }
          json = await res.json();
        } catch (err) {
          if (pageNo === 1) throw err;
          console.warn(`naukri: page ${pageNo} fetch failed — ${err.message}`);
          break;
        }

        // Response shape: { jobDetails: [...] } or { noOfResults: n, jobDetails: [...] }
        const items = Array.isArray(json?.jobDetails) ? json.jobDetails : [];
        if (items.length === 0) break;

        for (const item of items) {
          const job = parseNaukriItem(item);
          if (job) allJobs.push(job);
        }

        if (items.length < pageSize) break; // last page

        // Polite delay between pages
        await new Promise(r => setTimeout(r, 300));
      }

      return allJobs;
    },
  },
};
