#!/usr/bin/env node
/**
 * Cat 7 — Lighthouse accessibility scores (reproducible, 3-run median).
 *
 * Complements cat7-a11y.mjs (axe). The PRD Cat-7 deliverable explicitly asks
 * for a per-page Lighthouse accessibility SCORE; this produces exactly that,
 * following the ShipShape Lighthouse Audit Guide:
 *   - run each page 3x, report the MEDIAN (scores fluctuate run-to-run)
 *   - persist the real Lighthouse JSON + HTML reports as committed evidence
 *     under reports/a11y/<phase>/<page>.report.{json,html}
 *   - headless (clean profile, no extensions); Lighthouse's own throttling
 *     only (no layered browser throttling); auth via session cookie; the
 *     login page is run UNAUTHENTICATED. Same 6 pages as cat6/cat7-a11y so
 *     all three tools compare apples-to-apples.
 *
 * Repro prerequisite (tooling only): `npx lighthouse@13` (fetched/cached).
 * Fixed knobs (identical for Phase-2 "after"): RUNS=3, median, desktop,
 * screenEmulation disabled. Raw -> docs/audit/raw/cat7-lighthouse-<phase>.txt
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dirname, '..', '..');
const PHASE = process.argv[2] || 'before';
const WEB = 'http://localhost:5173';
const PG = 'ship-postgres-1';
const RUNS = 3;
const sh = (c) => execSync(c, {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, NPM_CONFIG_UPDATE_NOTIFIER: 'false', NO_UPDATE_NOTIFIER: '1' },
});

// --- auth: capture the session cookie via csrf + login ---
const csrfRes = await fetch(`${WEB}/api/csrf-token`);
const csrfCookie = (csrfRes.headers.getSetCookie?.() || []).join('; ');
const csrf = (await csrfRes.json()).token;
const loginRes = await fetch(`${WEB}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, Cookie: csrfCookie },
  body: JSON.stringify({ email: 'dev@ship.local', password: 'admin123' }),
});
if (!(await loginRes.json()).success) throw new Error('login failed');
const authCookie = ((loginRes.headers.getSetCookie?.() || []).join('; ')) || csrfCookie;

const docId = sh(`docker exec ${PG} psql -U ship -d ship_dev -tAc "SELECT id FROM documents WHERE document_type='wiki' ORDER BY created_at LIMIT 1"`).trim();

const PAGES = [
  ['login',         `${WEB}/login`,                 false],
  ['main_docs',     `${WEB}/docs`,                  true],
  ['view_document', `${WEB}/documents/${docId}`,    true],
  ['issues',        `${WEB}/issues`,                true],
  ['my_week',       `${WEB}/my-week`,               true],
  ['team_dir',      `${WEB}/team/directory`,        true],
];

const tmp = mkdtempSync(join(tmpdir(), 'lh-'));
const hdrFile = join(tmp, 'hdr.json');
writeFileSync(hdrFile, JSON.stringify({ Cookie: authCookie }));
const evidenceDir = join(ROOT, 'reports', 'a11y', PHASE);
mkdirSync(evidenceDir, { recursive: true });

const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const results = {};
for (const [key, url, authed] of PAGES) {
  const runs = [];
  for (let r = 0; r < RUNS; r++) {
    const base = join(tmp, `${key}-${r}`);
    const args = [
      JSON.stringify(url),
      '--only-categories=accessibility',
      '--output=json', '--output=html', `--output-path=${base}`,
      '--quiet',
      '--chrome-flags="--headless=new --no-sandbox --disable-gpu"',
      '--max-wait-for-load=90000',
      '--form-factor=desktop', '--screenEmulation.disabled',
    ];
    if (authed) args.push(`--extra-headers=${hdrFile}`);
    try {
      sh(`npx --yes lighthouse@13 ${args.join(' ')}`);
      const json = JSON.parse(readFileSync(`${base}.report.json`, 'utf8'));
      const score = Math.round((json.categories?.accessibility?.score ?? 0) * 100);
      const fails = Object.values(json.audits || {})
        .filter((a) => a.scoreDisplayMode === 'binary' && a.score === 0 && a.id)
        .map((a) => a.id);
      runs.push({ score, fails, jsonPath: `${base}.report.json`, htmlPath: `${base}.report.html` });
    } catch (e) {
      runs.push({ score: null, err: String(e.message).slice(0, 140) });
    }
  }
  const scored = runs.filter((x) => x.score != null);
  if (!scored.length) { results[key] = { scores: [], median: null, err: runs[0]?.err || 'all runs failed' }; continue; }
  const scores = scored.map((x) => x.score);
  const med = median(scores);
  // canonical evidence = the run whose score equals the median
  const pick = scored.find((x) => x.score === med) || scored[0];
  copyFileSync(pick.jsonPath, join(evidenceDir, `${key}.report.json`));
  copyFileSync(pick.htmlPath, join(evidenceDir, `${key}.report.html`));
  results[key] = { scores, median: med, fails: pick.fails.slice(0, 8), nFails: pick.fails.length };
}

let sha = 'unknown';
try { sha = sh(`git -C ${ROOT} rev-parse HEAD`).trim(); } catch {}
const meds = Object.values(results).filter((r) => r.median != null).map((r) => r.median);
const worst = meds.length ? Math.min(...meds) : null;
const L = [];
const P = (s = '') => L.push(s);
P(`# Cat 7 Lighthouse Accessibility — ${PHASE}`);
P(`commit: ${sha}`);
P(`date: ${new Date().toISOString()}`);
P(`condition: 577+ docs / 328 issues / 31 users; web :5173 (dev, StrictMode ON)`);
P(`tool: npx lighthouse@13 --only-categories=accessibility --form-factor=desktop (headless, clean profile)`);
P(`method: ${RUNS} runs/page, MEDIAN reported (per ShipShape Lighthouse guide); full`);
P(`        JSON+HTML reports committed to reports/a11y/${PHASE}/<page>.report.{json,html}`);
P('');
P('page          | runs (3)        | MEDIAN | failed audits (top)');
for (const [key] of PAGES) {
  const r = results[key];
  if (r.median == null) { P(`${key.padEnd(13)} | ERROR: ${r.err}`); continue; }
  P(`${key.padEnd(13)} | ${r.scores.join(' / ').padEnd(15)} | ${String(r.median).padStart(6)} | ${r.nFails} (${r.fails.join(', ')})`);
}
P('');
P(`Lowest median = ${worst ?? 'n/a'} (PRD Improvement Target: +10 on the lowest page).`);
P('Notes: dev build (StrictMode). Lighthouse a11y is automated-only (~ subset of');
P('axe) — a FLOOR not a ceiling; keyboard/screen-reader still required (see');
P('cat7-a11y.mjs keyboard probe). Reports in reports/a11y/ are the before/after evidence.');

const out = L.join('\n') + '\n';
const dest = join(ROOT, 'docs', 'audit', 'raw', `cat7-lighthouse-${PHASE}.txt`);
writeFileSync(dest, out);
console.log(out);
console.log(`written: ${relative(ROOT, dest)}  + reports/a11y/${PHASE}/*.report.{json,html}`);
