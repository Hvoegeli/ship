#!/usr/bin/env node
/**
 * Cat 4 — Database Query Efficiency baseline (reproducible).
 *
 * Pre-req (one-time, reversible): on the Docker Postgres
 *   ALTER SYSTEM SET log_statement='all';
 *   ALTER SYSTEM SET log_min_duration_statement=0;
 *   ALTER SYSTEM SET log_line_prefix='%m [%p] ';  SELECT pg_reload_conf();
 * Condition of record: scripts/audit/seed-augment.sql applied (577 docs/31 users).
 *
 * Method: authenticate (csrf+login, cookie jar), then run 5 user flows, each
 * bracketed by a marker query `SELECT 'AUDIT_MARK_<flow>'`. Pull the container
 * log, identify PIDs that ran a marker (= our psql/admin connections) and
 * EXCLUDE them, so only API connection-pool statements are counted. Per flow:
 * total queries, slowest (ms), and N+1 (same normalized shape repeated).
 *
 * Raw -> docs/audit/raw/cat4-<phase>.txt   (phase arg: before|after)
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dirname, '..', '..');
const PHASE = process.argv[2] || 'before';
const API = 'http://localhost:3000';
const PG = 'ship-postgres-1';
const JAR = join(tmpdir(), 'ship-audit-cat4.jar');
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const psql = (q) => sh(`docker exec ${PG} psql -U ship -d ship_dev -tAc ${JSON.stringify(q)}`);

// --- auth ---
sh(`rm -f ${JAR}`);
const csrf = JSON.parse(sh(`curl -s -c ${JAR} ${API}/api/csrf-token`)).token;
const login = JSON.parse(sh(
  `curl -s -b ${JAR} -c ${JAR} -X POST ${API}/api/auth/login ` +
  `-H "Content-Type: application/json" -H "x-csrf-token: ${csrf}" ` +
  `-d '{"email":"dev@ship.local","password":"admin123"}'`));
if (!login.success) throw new Error('login failed: ' + JSON.stringify(login));

// flow targets from current seed
const docId = psql(`SELECT id FROM documents WHERE document_type='wiki' ORDER BY created_at LIMIT 1`).trim();
// Condition of record read LIVE from the DB (snapshot-pinned; db-restore.sh).
const COND = psql(`SELECT 'documents='||(SELECT count(*) FROM documents)||' issues='||(SELECT count(*) FROM documents WHERE document_type='issue')||' sprints='||(SELECT count(*) FROM documents WHERE document_type='sprint')||' users='||(SELECT count(*) FROM users)`).trim();

const FLOWS = [
  ['main_page',    `/api/documents?document_type=wiki`],
  ['view_document', `/api/documents/${docId}`],
  ['list_issues',  `/api/issues`],
  ['sprint_board', `/api/weeks`],
  ['search',       `/api/search/mentions?q=load`],
];

const RUN = `RUN_${Date.now()}`;
psql(`SELECT 'AUDIT_MARK_${RUN}_GLOBALSTART'`);
const meta = {};
for (const [name, path] of FLOWS) {
  psql(`SELECT 'AUDIT_MARK_${RUN}_${name}'`);
  const code = sh(`curl -s -b ${JAR} -o /dev/null -w "%{http_code} %{size_download}" "${API}${path}"`);
  meta[name] = { path, http: code };
}
psql(`SELECT 'AUDIT_MARK_${RUN}_GLOBALEND'`);

// --- pull + parse log ---
// Postgres (log_statement=all + log_min_duration_statement=0) emits, per stmt:
//   <ts> [pid] LOG:  statement: <SQL...>       (or "execute <name>: <SQL>"), possibly multi-line
//   <ts> [pid] DETAIL:  parameters: ...        (optional)
//   <ts> [pid] LOG:  duration: N ms            (timing; NO sql appended)
// Build multi-line entries (continuation lines lack the "<ts> [pid] LEVEL:" prefix).
const raw = sh(`docker logs ${PG} --since 300s 2>&1`);
const PRE = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+ \w+) \[(\d+)\] (\w+):\s+([\s\S]*)$/;
const entries = [];
for (const ln of raw.split('\n')) {
  const m = ln.match(PRE);
  if (m) entries.push({ ts: m[1], pid: m[2], level: m[3], msg: m[4], t: Date.parse(m[1].replace(/ \w+$/, '')) });
  else if (entries.length) entries[entries.length - 1].msg += '\n' + ln; // continuation
}

const markerPids = new Set();
const markerEvents = [];
for (const e of entries) {
  const mm = e.msg.match(new RegExp(`AUDIT_MARK_${RUN}_(\\w+)`));
  if (mm) { markerPids.add(e.pid); markerEvents.push({ name: mm[1], t: e.t }); }
}
const startT = markerEvents.find((e) => e.name === 'GLOBALSTART')?.t ?? 0;
const flowBounds = FLOWS.map(([n], i) => {
  const s = markerEvents.find((e) => e.name === n)?.t;
  const nextName = i + 1 < FLOWS.length ? FLOWS[i + 1][0] : 'GLOBALEND';
  const e = markerEvents.find((ev) => ev.name === nextName)?.t;
  return { name: n, s, e };
});
const norm = (sql) => sql
  .replace(/\$\d+/g, '?').replace(/'[^']*'/g, '?').replace(/\b\d+\b/g, '?')
  .replace(/\s+/g, ' ').trim().slice(0, 90);
const flowAt = (t) => flowBounds.find((b) => b.s != null && t >= b.s && (b.e == null || t < b.e));

const result = {};
for (const fb of flowBounds) result[fb.name] = { n: 0, slowest: 0, slowSql: '', shapes: {} };
const lastSqlByPid = {};
for (const e of entries) {
  if (markerPids.has(e.pid) || e.t < startT) continue;   // skip psql/admin + pre-start
  let sm = e.msg.match(/^statement:\s+([\s\S]*)$/) || e.msg.match(/^execute[^:]*:\s+([\s\S]*)$/);
  if (sm) { lastSqlByPid[e.pid] = sm[1].replace(/\s+/g, ' ').trim(); continue; }
  const dm = e.msg.match(/^duration:\s+([\d.]+) ms\s*$/);
  if (!dm) continue;                                       // one count per executed stmt
  const fb = flowAt(e.t);
  if (!fb) continue;
  const ms = parseFloat(dm[1]);
  const sql = lastSqlByPid[e.pid] || '(unknown)';
  const r = result[fb.name];
  r.n++;
  if (ms > r.slowest) { r.slowest = ms; r.slowSql = sql.slice(0, 200); }
  const k = norm(sql);
  r.shapes[k] = (r.shapes[k] || 0) + 1;
}

let sha = 'unknown';
try { sha = sh(`git -C ${ROOT} rev-parse HEAD`).trim(); } catch {}
const L = [];
const P = (s = '') => L.push(s);
P(`# Cat 4 DB Query Efficiency — ${PHASE}`);
P(`commit: ${sha}`);
P(`date: ${new Date().toISOString()}`);
P(`condition: ${COND} — snapshot-pinned (scripts/audit/db-restore.sh)`);
P(`method: marker-bracketed flows; API pool PIDs only (psql/admin PIDs excluded)`);
P('');
P('flow          | http        | queries | slowest(ms) | N+1?');
for (const fb of flowBounds) {
  const r = result[fb.name];
  const top = Object.entries(r.shapes).sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const np1 = top[1] >= 10 ? `YES x${top[1]}` : top[1] >= 5 ? `maybe x${top[1]}` : 'no';
  P(`${fb.name.padEnd(13)} | ${String(meta[fb.name]?.http).padEnd(11)} | ${String(r.n).padStart(7)} | ${String(r.slowest).padStart(11)} | ${np1}`);
}
P('');
P('## Slowest statement per flow');
for (const fb of flowBounds) { const r = result[fb.name]; P(`- ${fb.name}: ${r.slowest}ms  ${r.slowSql.replace(/\s+/g,' ')}`); }
P('');
P('## Most-repeated query shape per flow (N+1 evidence)');
for (const fb of flowBounds) {
  const r = result[fb.name];
  const top = Object.entries(r.shapes).sort((a, b) => b[1] - a[1]).slice(0, 2);
  P(`- ${fb.name}:`);
  for (const [shape, cnt] of top) P(`    x${cnt}  ${shape}`);
}

const out = L.join('\n') + '\n';
const dest = join(ROOT, 'docs', 'audit', 'raw', `cat4-${PHASE}.txt`);
writeFileSync(dest, out);
console.log(out);
console.log(`written: ${relative(ROOT, dest)}`);
