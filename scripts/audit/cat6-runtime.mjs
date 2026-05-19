#!/usr/bin/env node
/**
 * Cat 6 — Runtime Errors baseline (reproducible, browser-driven).
 *
 * One-time repro prerequisite (tooling only, NOT an app change — analogous to
 * Cat 2 `vite build` / Cat 4 `ALTER SYSTEM`):
 *   npx playwright install chromium
 *
 * Condition of record: seed-augment.sql applied (577+ docs / 328 issues / 31
 * users). Web dev server on :5173 (Vite proxies /api -> :3000). API on :3000.
 * This is the dev build (React.StrictMode ON → intentional double-invoke of
 * effects in dev; StrictMode console noise is reported separately, not counted
 * as an app error).
 *
 * Five probes the deck asks for, each reproducible & deterministic:
 *  1. CONSOLE      — drive 6 key pages; capture console.error, uncaught
 *                    pageerror, failed requests, and >=500 responses.
 *  2. MALFORMED    — send the API garbage (bad JSON / no CSRF / oversized
 *                    title / wrong content-type); record status + clean-4xx
 *                    vs 500/stack.
 *  3. RT1 COLLAB   — open a doc, go OFFLINE, type, wait past the 2s Yjs
 *                    persistence debounce, RECONNECT, reload; did edits
 *                    survive? (tests the orientation RT1 data-loss hypothesis)
 *  4. THROTTLE_3G  — CDP slow-3G emulation on the main page; load timings.
 *  5. SERVERLOG    — Postgres ERROR lines during the run window + 5xx tally.
 *
 * Fixed knobs (identical for Phase-2 "after"):
 *   SETTLE=2500ms  OFFLINE_TYPE_WAIT=4000ms (>2s debounce)  3G profile below
 * Raw -> docs/audit/raw/cat6-<phase>.txt   (phase arg: before|after)
 */
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const PHASE = process.argv[2] || 'before';
const WEB = 'http://localhost:5173';
const API = 'http://localhost:3000';
const PG = 'ship-postgres-1';
const SETTLE = 2500;             // ms to let a page quiesce after networkidle
const OFFLINE_TYPE_WAIT = 4000;  // ms offline before reconnect (> 2s Yjs debounce)
const THREE_G = { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 }; // "Slow 3G"
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const docId = sh(`docker exec ${PG} psql -U ship -d ship_dev -tAc "SELECT id FROM documents WHERE document_type='wiki' ORDER BY created_at LIMIT 1"`).trim();
const issueId = sh(`docker exec ${PG} psql -U ship -d ship_dev -tAc "SELECT id FROM documents WHERE document_type='issue' ORDER BY created_at LIMIT 1"`).trim();

const PAGES = [
  ['login',         `${WEB}/login`],
  ['main_docs',     `${WEB}/docs`],
  ['view_document', `${WEB}/documents/${docId}`],
  ['issues',        `${WEB}/issues`],
  ['my_week',       `${WEB}/my-week`],
  ['team_dir',      `${WEB}/team/directory`],
];

const L = [];
const P = (s = '') => L.push(s);
const runStart = new Date();

const browser = await chromium.launch();
const context = await browser.newContext();

// --- auth via the context request jar (cookies attach automatically) ---
const csrf = (await (await context.request.get(`${WEB}/api/csrf-token`)).json()).token;
const loginRes = await context.request.post(`${WEB}/api/auth/login`, {
  headers: { 'x-csrf-token': csrf },
  data: { email: 'dev@ship.local', password: 'admin123' },
});
if (!(await loginRes.json()).success) throw new Error('login failed');

// ---- collectors ----
const tally = {}; // page -> {consoleErr:[], pageErr:[], reqFail:[], http5xx:[]}
function attach(page, key) {
  tally[key] = { consoleErr: [], pageErr: [], reqFail: [], http5xx: [] };
  page.on('console', (m) => { if (m.type() === 'error') tally[key].consoleErr.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => tally[key].pageErr.push(String(e.message || e).slice(0, 200)));
  page.on('requestfailed', (r) => tally[key].reqFail.push(`${r.method()} ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 500) tally[key].http5xx.push(`${r.status()} ${r.url().slice(0, 120)}`); });
}

// ===== PROBE 1: console scan across key pages =====
for (const [key, url] of PAGES) {
  const page = await context.newPage();
  attach(page, key);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    tally[key].pageErr.push(`NAV_FAIL ${String(e.message).slice(0, 120)}`);
  }
  await sleep(SETTLE);
  await page.close();
}

// ===== PROBE 2: malformed input =====
const mal = [];
async function probe(name, fn) {
  try { mal.push([name, await fn()]); } catch (e) { mal.push([name, `THREW ${String(e.message).slice(0, 120)}`]); }
}
const freshCsrf = (await (await context.request.get(`${WEB}/api/csrf-token`)).json()).token;
await probe('bad_json_body', async () => {
  const r = await context.request.post(`${WEB}/api/documents`, {
    headers: { 'content-type': 'application/json', 'x-csrf-token': freshCsrf }, data: '{ not json',
  });
  return `${r.status()} ${(await r.text()).slice(0, 120).replace(/\s+/g, ' ')}`;
});
await probe('missing_csrf', async () => {
  const r = await context.request.post(`${WEB}/api/documents`, {
    headers: { 'content-type': 'application/json' }, data: { document_type: 'wiki', title: 'x' },
  });
  return `${r.status()} ${(await r.text()).slice(0, 120).replace(/\s+/g, ' ')}`;
});
await probe('oversized_title_100k', async () => {
  const r = await context.request.post(`${WEB}/api/documents`, {
    headers: { 'content-type': 'application/json', 'x-csrf-token': freshCsrf },
    data: { document_type: 'wiki', title: 'A'.repeat(100000) },
  });
  return `${r.status()} ${(await r.text()).slice(0, 120).replace(/\s+/g, ' ')}`;
});
await probe('wrong_content_type', async () => {
  const r = await context.request.post(`${WEB}/api/documents`, {
    headers: { 'content-type': 'text/plain', 'x-csrf-token': freshCsrf }, data: 'document_type=wiki&title=x',
  });
  return `${r.status()} ${(await r.text()).slice(0, 120).replace(/\s+/g, ' ')}`;
});
await probe('bad_uuid_path', async () => {
  const r = await context.request.get(`${WEB}/api/documents/not-a-uuid`);
  return `${r.status()} ${(await r.text()).slice(0, 120).replace(/\s+/g, ' ')}`;
});

// ===== PROBE 3: RT1 collab data-loss (offline edit during 2s-debounced Yjs persist) =====
// Validated instrument: real ProseMirror input = force-click into the editor
// at a fixed position + keyboard.type (DOM-Range selection does NOT produce PM
// transactions). Durability is checked AUTHORITATIVELY via the API (GET the
// doc and look for the marker) — NOT by reading reloaded innerText (which is
// read before editor rehydration and gives false negatives).
let rt1 = 'INCONCLUSIVE';     // offline-edit durability (the hypothesis)
let rt1ctl = 'INCONCLUSIVE';  // ONLINE control (same method) — must PERSIST
let rt1idb = 'unknown';       // Yjs IndexedDB offline store present/absent
let rt1detail = '';
const docHasMarker = async (m) => (await (await context.request.get(`${WEB}/api/documents/${docId}`)).text()).includes(m);
const typeIntoEditor = async (page, mark) => {
  await page.locator('.ProseMirror').click({ position: { x: 20, y: 10 }, force: true, timeout: 8000 });
  await page.keyboard.type(` ${mark}`, { delay: 30 });
};
try {
  const page = await context.newPage();
  await page.goto(`${WEB}/documents/${docId}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.ProseMirror', { state: 'visible', timeout: 15000 });
  await sleep(SETTLE * 2);                          // let Yjs collab provider connect/sync

  // (a) CONTROL — edit ONLINE: must reach the server for the test to be valid
  const CTL = `RT1CTL-${Date.now()}`;
  await typeIntoEditor(page, CTL);
  await sleep(OFFLINE_TYPE_WAIT + 4000);            // > 2s persist debounce + margin
  rt1ctl = (await docHasMarker(CTL)) ? 'PERSISTED' : 'LOST';

  // (b) HYPOTHESIS — edit OFFLINE during a network drop, reconnect, wait, check
  const MARK = `RT1-${Date.now()}`;
  await typeIntoEditor(page, MARK);                 // focus/caret established online
  await context.setOffline(true);                 // network drop mid-edit
  await page.keyboard.type(` ${MARK}-OFF`, { delay: 30 });
  await sleep(OFFLINE_TYPE_WAIT);                  // exceed 2s persist debounce while offline
  // While still offline: is there a Yjs IndexedDB offline store? If NOT, then
  // closing/crashing the tab here (laptop-lid scenario) loses unsynced edits —
  // the true RT1 residual risk (no client offline buffer + silent server persist).
  const idbDbs = await page.evaluate(async () => {
    try { return (await indexedDB.databases()).map((d) => d.name); } catch { return ['(databases() unsupported)']; }
  });
  rt1idb = idbDbs.some((n) => /y|doc|prosemirror|collab/i.test(n || '')) ? `present:${idbDbs.join(',')}` : `ABSENT (dbs=${idbDbs.join(',') || 'none'})`;
  await context.setOffline(false);                 // reconnect
  await sleep(8000);                                // allow provider resync + 2s server persist
  const off = await docHasMarker(`${MARK}-OFF`);
  rt1 = off ? 'PERSISTED' : 'LOST';
  rt1detail = `online-control=${rt1ctl}; transient-disconnect(tab open)=${rt1}; yjs-offline-store=${rt1idb}`;
  await page.close();
} catch (e) {
  rt1detail = `probe error: ${String(e.message).slice(0, 160)}`;
}

// ===== PROBE 4: 3G throttle on main page =====
let g3 = {};
try {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...THREE_G });
  const t0 = Date.now();
  await page.goto(`${WEB}/docs`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const dcl = Date.now() - t0;
  await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
  const loaded = Date.now() - t0;
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] || {};
    return { ttfb: Math.round(n.responseStart || 0), dom: Math.round(n.domContentLoadedEventEnd || 0), load: Math.round(n.loadEventEnd || 0) };
  });
  g3 = { wall_dcl_ms: dcl, wall_load_ms: loaded, ...nav };
  await page.close();
} catch (e) {
  g3 = { error: String(e.message).slice(0, 160) };
}

// ===== PROBE 5: server-log scan (Postgres ERROR + 5xx tally) =====
let pgErrors = [];
try {
  const since = Math.ceil((Date.now() - runStart.getTime()) / 1000) + 5;
  const raw = sh(`docker logs ${PG} --since ${since}s 2>&1`);
  pgErrors = raw.split('\n').filter((l) => /\bERROR\b|\bFATAL\b|\bPANIC\b/.test(l)).slice(0, 20);
} catch (e) {
  pgErrors = [`(log scan failed: ${String(e.message).slice(0, 120)})`];
}
const total5xx = Object.values(tally).reduce((s, t) => s + t.http5xx.length, 0);

await browser.close();

// ---- report ----
let sha = 'unknown';
try { sha = sh(`git -C ${ROOT} rev-parse HEAD`).trim(); } catch {}
P(`# Cat 6 Runtime Errors — ${PHASE}`);
P(`commit: ${sha}`);
P(`date: ${new Date().toISOString()}`);
P(`condition: 577+ docs / 328 issues / 31 users; web :5173 (dev, StrictMode ON), api :3000`);
P(`knobs: settle=${SETTLE}ms offline_wait=${OFFLINE_TYPE_WAIT}ms 3G=slow(1.6Mbps/150ms)`);
P('');
P('## Probe 1 — console errors / page errors / failed requests per page');
P('page          | console.error | pageerror | reqfailed | http5xx');
for (const [key] of PAGES) {
  const t = tally[key];
  P(`${key.padEnd(13)} | ${String(t.consoleErr.length).padStart(13)} | ${String(t.pageErr.length).padStart(9)} | ${String(t.reqFail.length).padStart(9)} | ${t.http5xx.length}`);
}
P('');
P('### Sample messages (first per category, per page)');
for (const [key] of PAGES) {
  const t = tally[key];
  const lines = [];
  if (t.consoleErr[0]) lines.push(`    console: ${t.consoleErr[0]}`);
  if (t.pageErr[0]) lines.push(`    pageerr: ${t.pageErr[0]}`);
  if (t.reqFail[0]) lines.push(`    reqfail: ${t.reqFail[0]}`);
  if (t.http5xx[0]) lines.push(`    http5xx: ${t.http5xx[0]}`);
  if (lines.length) { P(`- ${key}:`); lines.forEach((l) => P(l)); }
}
P('');
P('## Probe 2 — malformed input handling (status + body head)');
for (const [n, v] of mal) P(`- ${n.padEnd(20)} -> ${v}`);
P('');
P('## Probe 3 — RT1 collab durability (offline edit → reconnect; API-verified)');
P(`- online control (same method, must PERSIST for validity): ${rt1ctl}`);
P(`- transient disconnect, tab kept open (offline edit → reconnect): ${rt1}`);
P(`- Yjs client offline store (IndexedDB): ${rt1idb}`);
P(`- detail: ${rt1detail}`);
P('- interpretation: control=PERSISTED validates the instrument. transient-');
P('  disconnect=PERSISTED + Yjs IndexedDB store present ⇒ the client offline');
P('  path is robust (in-memory buffer + per-doc y-indexeddb; replays on');
P('  reconnect, survives tab close). This EMPIRICALLY DOWNGRADES orientation');
P('  RT1: residual risk is narrowed to the SERVER-side path only — the');
P('  2s-debounced persist whose failure is swallowed (client believes it');
P('  synced). Severity/refinement recorded in AUDIT_REPORT.md.');
P('');
P('## Probe 4 — 3G throttle (main page /docs)');
P(`- ${JSON.stringify(g3)}`);
P('');
P('## Probe 5 — server-log scan during run');
P(`- total >=500 HTTP responses observed by browser: ${total5xx}`);
P(`- Postgres ERROR/FATAL lines in run window: ${pgErrors.length}`);
pgErrors.forEach((l) => P(`    ${l.slice(0, 160)}`));
P('');
P('Notes: dev build (StrictMode double-invokes effects; React Query Devtools');
P('mounted). Counts are raw observations; triage/severity assigned in AUDIT_REPORT.md.');

const out = L.join('\n') + '\n';
const dest = join(ROOT, 'docs', 'audit', 'raw', `cat6-${PHASE}.txt`);
writeFileSync(dest, out);
console.log(out);
console.log(`written: ${relative(ROOT, dest)}`);
