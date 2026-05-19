#!/usr/bin/env node
/**
 * Cat 7 — Lighthouse accessibility scores (reproducible).
 *
 * Complements cat7-a11y.mjs (axe). The PRD Cat-7 deliverable explicitly asks
 * for a per-page Lighthouse accessibility SCORE; this produces exactly that.
 *
 * Repro prerequisite (tooling only, not app code): `npx lighthouse` (v13.x,
 * fetched/cached by npx). Uses headless Chrome via chrome-launcher inside the
 * Lighthouse CLI. Authenticated pages are reached by passing the session
 * cookie as an extra request header (same csrf+login flow as cat4/cat6).
 *
 * Pages = the SAME 6 as cat6/cat7-a11y. `login` is run UNAUTHENTICATED.
 * Fixed knobs (identical for Phase-2 "after"): only-categories=accessibility,
 * headless, formFactor=desktop. Raw -> docs/audit/raw/cat7-lighthouse-<phase>.txt
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dirname, '..', '..');
const PHASE = process.argv[2] || 'before';
const WEB = 'http://localhost:5173';
const PG = 'ship-postgres-1';
const sh = (c) => execSync(c, {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, NPM_CONFIG_UPDATE_NOTIFIER: 'false', NO_UPDATE_NOTIFIER: '1' },
});
// Lighthouse JSON is one object; npx/npm may append notices. Slice first '{'
// to the LAST '}' so trailing non-JSON (npm notice) can't break the parse.
const parseLH = (out) => JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));

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

const dir = mkdtempSync(join(tmpdir(), 'lh-'));
const hdrFile = join(dir, 'hdr.json');
writeFileSync(hdrFile, JSON.stringify({ Cookie: authCookie }));

const results = {};
for (const [key, url, authed] of PAGES) {
  const args = [
    JSON.stringify(url),
    '--only-categories=accessibility',
    '--output=json', '--output-path=stdout', '--quiet',
    '--chrome-flags="--headless=new --no-sandbox --disable-gpu"',
    '--max-wait-for-load=90000',
    '--form-factor=desktop', '--screenEmulation.disabled',
  ];
  if (authed) args.push(`--extra-headers=${hdrFile}`);
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = sh(`npx --yes lighthouse@13 ${args.join(' ')}`);
      const json = parseLH(out);
      const score = Math.round((json.categories?.accessibility?.score ?? 0) * 100);
      const fails = Object.values(json.audits || {})
        .filter((a) => a.scoreDisplayMode === 'binary' && a.score === 0 && a.id)
        .map((a) => a.id);
      results[key] = { score, fails: fails.slice(0, 8), nFails: fails.length };
      lastErr = '';
      break;
    } catch (e) {
      lastErr = String(e.message).slice(0, 160);
    }
  }
  if (lastErr) results[key] = { score: null, err: lastErr };
}

let sha = 'unknown';
try { sha = sh(`git -C ${ROOT} rev-parse HEAD`).trim(); } catch {}
const scored = Object.values(results).filter((r) => r.score != null).map((r) => r.score);
const worst = scored.length ? Math.min(...scored) : null;
const L = [];
const P = (s = '') => L.push(s);
P(`# Cat 7 Lighthouse Accessibility — ${PHASE}`);
P(`commit: ${sha}`);
P(`date: ${new Date().toISOString()}`);
P(`condition: 577+ docs / 328 issues / 31 users; web :5173 (dev, StrictMode ON)`);
P(`tool: npx lighthouse@13 --only-categories=accessibility --form-factor=desktop (headless)`);
P('');
P('page          | a11y score | failed audits (top)');
for (const [key] of PAGES) {
  const r = results[key];
  if (r.score == null) { P(`${key.padEnd(13)} |    ERROR   | ${r.err}`); continue; }
  P(`${key.padEnd(13)} | ${String(r.score).padStart(9)}  | ${r.nFails} (${r.fails.join(', ')})`);
}
P('');
P(`Lowest-scoring page = ${worst ?? 'n/a'} (PRD Improvement Target: +10 on the lowest page).`);
P('Notes: dev build (StrictMode). Lighthouse a11y is automated-only (~ same');
P('coverage class as axe) — cross-read with cat7-a11y.mjs (axe severities).');

const out = L.join('\n') + '\n';
const dest = join(ROOT, 'docs', 'audit', 'raw', `cat7-lighthouse-${PHASE}.txt`);
writeFileSync(dest, out);
console.log(out);
console.log(`written: ${relative(ROOT, dest)}`);
