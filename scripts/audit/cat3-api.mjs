#!/usr/bin/env node
/**
 * Cat 3 — API Response Time baseline (reproducible, dependency-free).
 *
 * Condition of record: seed-augment.sql applied (577 docs / 328 issues / 31 users).
 * P1 rule: hit the API on :3000 DIRECTLY (never the Vite :5173 proxy).
 * Postgres statement logging MUST be off (reset after cat4) or latency is skewed.
 *
 * Method: authenticate (csrf+login), then for each of 5 key endpoints, at
 * concurrency 10/25/50: WARMUP requests (discarded) then a FIXED request
 * budget with exactly N in-flight; record per-request latency; report
 * P50/P95/P99/avg/max, throughput (req/s), and error count.
 *
 * NOTE: API has a global rate limiter (apiLimiter): 1000 req/min dev,
 * 100 req/min prod. To measure true server latency (not 429s), each cell
 * budget is small and we SLEEP 62s between endpoints so every endpoint runs
 * in a fresh 60s window. The limiter itself is reported as a Cat-3 finding.
 *
 * Fixed knobs (identical for Phase-2 "after"): WARMUP=10 BUDGET=120 GAP=62s
 * Raw -> docs/audit/raw/cat3-<phase>.txt   (phase arg: before|after)
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT = join(import.meta.dirname, '..', '..');
const PHASE = process.argv[2] || 'before';
const API = 'http://localhost:3000';
const PG = 'ship-postgres-1';
const WARMUP = 10;
const BUDGET = 120;
const GAP_MS = 62_000; // > rate-limit window (60s) so each endpoint runs fresh
const CONCURRENCIES = [10, 25, 50];
const sh = (c) => execSync(c, { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- auth (capture session cookie) ---
const csrfRes = await fetch(`${API}/api/csrf-token`);
const csrfCookie = (csrfRes.headers.getSetCookie?.() || []).join('; ');
const csrf = (await csrfRes.json()).token;
const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, Cookie: csrfCookie },
  body: JSON.stringify({ email: 'dev@ship.local', password: 'admin123' }),
});
const cookie = ((loginRes.headers.getSetCookie?.() || []).join('; ')) || csrfCookie;
if (!(await loginRes.json()).success) throw new Error('login failed');

const docId = sh(`docker exec ${PG} psql -U ship -d ship_dev -tAc "SELECT id FROM documents WHERE document_type='wiki' ORDER BY created_at LIMIT 1"`).trim();

const ENDPOINTS = [
  ['main_page',     `/api/documents?document_type=wiki`],
  ['view_document', `/api/documents/${docId}`],
  ['list_issues',   `/api/issues`],
  ['sprint_board',  `/api/weeks`],
  ['search',        `/api/search/mentions?q=load`],
];

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)].toFixed(2);
};

async function loadTest(path, concurrency) {
  const url = API + path;
  const headers = { Cookie: cookie };
  // warmup (discarded)
  for (let i = 0; i < WARMUP; i++) { try { const r = await fetch(url, { headers }); await r.arrayBuffer(); } catch {} }
  const lat = [];
  let issued = 0, errors = 0;
  const t0 = performance.now();
  const worker = async () => {
    while (true) {
      const i = issued++;
      if (i >= BUDGET) break;
      const s = performance.now();
      try {
        const r = await fetch(url, { headers });
        await r.arrayBuffer();
        if (!r.ok) errors++;
      } catch { errors++; }
      lat.push(performance.now() - s);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const wall = (performance.now() - t0) / 1000;
  return {
    p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99),
    avg: +(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(2),
    max: +Math.max(...lat).toFixed(2),
    rps: +(BUDGET / wall).toFixed(1), errors, n: lat.length,
  };
}

let sha = 'unknown';
try { sha = sh(`git -C ${ROOT} rev-parse HEAD`).trim(); } catch {}
const L = [];
const P = (s = '') => L.push(s);
P(`# Cat 3 API Response Time — ${PHASE}`);
P(`commit: ${sha}`);
P(`date: ${new Date().toISOString()}`);
P(`condition: 577 docs / 328 issues / 35 sprints / 31 users; API :3000 direct (no proxy)`);
P(`knobs: warmup=${WARMUP} budget=${BUDGET} req/cell; concurrency ${CONCURRENCIES.join('/')}`);
P(`pg statement logging: OFF (reset after cat4)`);
P('');
for (let ei = 0; ei < ENDPOINTS.length; ei++) {
  const [name, path] = ENDPOINTS[ei];
  if (ei > 0) { process.stderr.write(`  (sleeping ${GAP_MS / 1000}s for fresh rate-limit window before ${name})\n`); await sleep(GAP_MS); }
  P(`## ${name}   ${path}`);
  P('conc | P50ms | P95ms | P99ms | avg | max | req/s | errors');
  for (const c of CONCURRENCIES) {
    const r = await loadTest(path, c);
    const flag = r.errors > 0 ? `  <-- ${r.errors} errors (likely rate-limit; invalid cell)` : '';
    P(`${String(c).padStart(4)} | ${String(r.p50).padStart(5)} | ${String(r.p95).padStart(5)} | ${String(r.p99).padStart(5)} | ${String(r.avg).padStart(5)} | ${String(r.max).padStart(6)} | ${String(r.rps).padStart(6)} | ${r.errors}${flag}`);
  }
  P('');
}
const out = L.join('\n') + '\n';
const dest = join(ROOT, 'docs', 'audit', 'raw', `cat3-${PHASE}.txt`);
writeFileSync(dest, out);
console.log(out);
console.log(`written: ${relative(ROOT, dest)}`);
