#!/usr/bin/env node
/**
 * Cat 8 — Security probe (reproducible, dependency-free, single command).
 *
 *   node scripts/audit/cat8-security.mjs before|after
 *
 * Actively exercises the RUNNING app (API :3000) across an OWASP-aligned battery
 * and parses the dependency tree for known CVEs. Every check is a structured
 * finding { id, area, severity, status, detail } so the report doubles as a
 * before/after diff. Design borrows the findings/severity/report schema and the
 * auth-probe shape from our agentforge LLM-red-team tool (reused at the design
 * level only — this is bespoke HTTP/dependency probing, not LLM attacks).
 *
 * Areas: (A) AuthN/Z enforcement, (B) session-cookie hardening, (C) CSRF,
 * (D) injection (SQLi/path), (E) error verbosity / info disclosure,
 * (F) security headers + CSP, (G) rate limiting, (H) dependency CVEs.
 *
 * Severity: critical > high > medium > low > info. status: PASS | FAIL | WARN.
 * Condition: snapshot-pinned (scripts/audit/db-restore.sh) for any DB-touching
 * probe. Raw -> docs/audit/raw/cat8-<phase>.{txt,json}
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const PHASE = process.argv[2] || 'before';
const API = 'http://localhost:3000';
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

const findings = [];
const add = (id, area, severity, status, detail) => findings.push({ id, area, severity, status, detail });

// ---- auth (csrf + session cookie), mirrors the other catN harnesses ----
async function authedCookie() {
  const csrfRes = await fetch(`${API}/api/csrf-token`);
  const csrfCookie = (csrfRes.headers.getSetCookie?.() || []).join('; ');
  const csrf = (await csrfRes.json()).token;
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, Cookie: csrfCookie },
    body: JSON.stringify({ email: 'dev@ship.local', password: 'admin123' }),
  });
  const setCookies = loginRes.headers.getSetCookie?.() || [];
  const cookie = (setCookies.join('; ')) || csrfCookie;
  return { cookie, csrf, setCookies, ok: (await loginRes.json()).success === true };
}

async function run() {
  // ---------- (A) AuthN/Z enforcement: protected routes reject no-session ----------
  for (const path of ['/api/documents', '/api/issues', '/api/dashboard/my-work']) {
    const r = await fetch(`${API}${path}`); // no cookie
    add(
      `A:${path}`, 'authz', 'high',
      r.status === 401 ? 'PASS' : 'FAIL',
      `unauthenticated GET ${path} -> ${r.status} (expect 401)`
    );
  }

  const { cookie, csrf, setCookies, ok } = await authedCookie();
  if (!ok) { add('A:login', 'authz', 'info', 'WARN', 'login failed — DB seeded? remaining probes need a session'); }

  // ---------- (B) session-cookie hardening ----------
  const sessionCookieLine = setCookies.find((c) => c.startsWith('session_id=')) || '';
  add('B:httponly', 'session', 'high', /httponly/i.test(sessionCookieLine) ? 'PASS' : 'FAIL',
    `session cookie HttpOnly: ${/httponly/i.test(sessionCookieLine)}`);
  add('B:samesite', 'session', 'medium', /samesite=strict/i.test(sessionCookieLine) ? 'PASS' : 'WARN',
    `session cookie SameSite=Strict: ${/samesite=strict/i.test(sessionCookieLine)} (Secure flag is prod-only by design)`);

  // ---------- (C) CSRF enforcement on state-changing request ----------
  const noCsrf = await fetch(`${API}/api/documents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 'csrf-probe' }),
  });
  add('C:csrf', 'csrf', 'high', noCsrf.status === 403 ? 'PASS' : 'FAIL',
    `POST without CSRF token -> ${noCsrf.status} (expect 403)`);

  // ---------- (D) injection ----------
  // SQLi attempt via a filter param — parameterized queries should treat it as data (200/empty or 4xx), never 500.
  const sqli = await fetch(`${API}/api/issues?state=${encodeURIComponent("' OR '1'='1")}`, { headers: { Cookie: cookie } });
  add('D:sqli', 'injection', 'critical', sqli.status < 500 ? 'PASS' : 'FAIL',
    `SQLi-style filter -> ${sqli.status} (expect <500; parameterized)`);
  // Path-param type confusion (bad uuid) must not 500 or leak a driver error.
  const badId = await fetch(`${API}/api/documents/not-a-uuid`, { headers: { Cookie: cookie } });
  add('D:badid', 'injection', 'medium', badId.status === 400 || badId.status === 404 ? 'PASS' : 'FAIL',
    `bad-uuid path -> ${badId.status} (expect 400/404, not 500)`);

  // ---------- (E) error verbosity / info disclosure ----------
  const badJson = await fetch(`${API}/api/documents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, Cookie: cookie }, body: '{bad',
  });
  const badJsonBody = await badJson.text();
  const leaksHtml = badJsonBody.includes('<!DOCTYPE') || /at\s+\w+.*\(.*:\d+:\d+\)/.test(badJsonBody);
  add('E:stack', 'infodisclosure', 'medium', leaksHtml ? 'FAIL' : 'PASS',
    `malformed body -> ${badJson.status}; HTML/stack leaked: ${leaksHtml}`);

  // ---------- (F) security headers + CSP ----------
  const h = (await fetch(`${API}/health`)).headers;
  add('F:hsts', 'headers', 'low', h.get('strict-transport-security') ? 'PASS' : 'WARN',
    `Strict-Transport-Security: ${h.get('strict-transport-security') || 'absent'}`);
  add('F:nosniff', 'headers', 'low', h.get('x-content-type-options') === 'nosniff' ? 'PASS' : 'WARN',
    `X-Content-Type-Options: ${h.get('x-content-type-options') || 'absent'}`);
  const csp = h.get('content-security-policy') || '';
  const scriptUnsafeInline = /script-src[^;]*'unsafe-inline'/.test(csp);
  add('F:csp', 'headers', 'medium', csp ? (scriptUnsafeInline ? 'WARN' : 'PASS') : 'FAIL',
    `CSP present: ${!!csp}; script-src 'unsafe-inline': ${scriptUnsafeInline}`);

  // ---------- (G) rate limiting present (apiLimiter is mounted on /api/) ----------
  const rl = (await fetch(`${API}/api/csrf-token`)).headers;
  const hasRl = !!(rl.get('ratelimit-limit') || rl.get('x-ratelimit-limit') || rl.get('ratelimit-policy'));
  add('G:ratelimit', 'availability', 'low', hasRl ? 'PASS' : 'WARN',
    `RateLimit headers present: ${hasRl}`);

  // ---------- (H) dependency CVEs ----------
  let audit = { critical: 0, high: 0, moderate: 0, low: 0 };
  try {
    // pnpm audit --json emits a single (pretty-printed) JSON object whose
    // metadata.vulnerabilities holds the severity tallies.
    const raw = sh('pnpm audit --json 2>/dev/null || true');
    const start = raw.indexOf('{');
    const obj = start >= 0 ? JSON.parse(raw.slice(start)) : {};
    const v = obj?.metadata?.vulnerabilities || {};
    audit = { critical: v.critical || 0, high: v.high || 0, moderate: v.moderate || 0, low: v.low || 0 };
  } catch { /* audit best-effort */ }
  add('H:cve-critical', 'dependencies', 'critical', audit.critical === 0 ? 'PASS' : 'FAIL', `critical CVEs: ${audit.critical}`);
  add('H:cve-high', 'dependencies', 'high', audit.high === 0 ? 'PASS' : 'WARN', `high CVEs: ${audit.high}`);
  add('H:cve-moderate', 'dependencies', 'medium', 'WARN', `moderate CVEs: ${audit.moderate}`);

  // ---------- report ----------
  const counts = findings.reduce((a, f) => { a[f.status] = (a[f.status] || 0) + 1; return a; }, {});
  const fails = findings.filter((f) => f.status === 'FAIL');
  const warns = findings.filter((f) => f.status === 'WARN');

  const lines = [];
  lines.push(`# Cat 8 Security Probe — ${PHASE}`);
  try { lines.push(`commit: ${sh('git rev-parse HEAD').trim()}`); } catch { /* */ }
  lines.push(`date: ${new Date().toISOString()}`);
  lines.push(`target: ${API} (snapshot-pinned where DB-touching; scripts/audit/db-restore.sh)`);
  lines.push(`summary: PASS=${counts.PASS || 0} WARN=${counts.WARN || 0} FAIL=${counts.FAIL || 0} (total ${findings.length})`);
  lines.push(`dependency CVEs: critical=${audit.critical} high=${audit.high} moderate=${audit.moderate} low=${audit.low}`);
  lines.push('');
  lines.push('## Findings');
  lines.push('id | area | severity | status | detail');
  for (const f of findings) lines.push(`${f.id} | ${f.area} | ${f.severity} | ${f.status} | ${f.detail}`);
  if (fails.length) { lines.push(''); lines.push('## FAIL (action required)'); for (const f of fails) lines.push(`- [${f.severity}] ${f.id}: ${f.detail}`); }
  if (warns.length) { lines.push(''); lines.push('## WARN (review)'); for (const f of warns) lines.push(`- [${f.severity}] ${f.id}: ${f.detail}`); }
  lines.push('');

  const txt = join(ROOT, 'docs', 'audit', 'raw', `cat8-${PHASE}.txt`);
  const jsonPath = join(ROOT, 'docs', 'audit', 'raw', `cat8-${PHASE}.json`);
  writeFileSync(txt, lines.join('\n'));
  writeFileSync(jsonPath, JSON.stringify({ phase: PHASE, summary: counts, audit, findings }, null, 2));
  console.log(lines.join('\n'));
  console.log(`\nwrote ${relative(ROOT, txt)} + ${relative(ROOT, jsonPath)}`);
}

run().catch((e) => { console.error('probe error:', e); process.exit(1); });
