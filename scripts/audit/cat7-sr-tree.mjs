#!/usr/bin/env node
/**
 * Cat 7 SR-tree — Accessibility-tree proxy (Decision Q3 = C).
 *
 * What this is and isn't.  A screen reader (VoiceOver, NVDA, JAWS) reads
 * the browser's *accessibility tree*: a parallel structure exposing role,
 * accessible name, level, value, etc.  We snapshot that exact tree per page
 * (Playwright's `accessibility.snapshot`) and check what an SR user would
 * encounter: landmarks to jump between, heading outline, interactive
 * elements named vs unnamed, dialogs, live regions for dynamic updates,
 * plus the first N things the user would land on by Tab.  This is a *proxy*,
 * not a substitute for a manual VoiceOver pass (see Q3-B notes).
 *
 * Condition of record: SNAPSHOT-PINNED (scripts/audit/snapshot/ship_dev.condition.dump,
 * restore via scripts/audit/db-restore.sh).  Counts read LIVE from the DB.
 *
 * Six pages — identical to cat7-a11y.mjs and cat7-lighthouse.mjs for
 * apples-to-apples comparison across the three Cat-7 instruments.
 *
 * Fixed knobs (identical for Phase-2 "after"):  SETTLE=2500ms  TAB_PEEK=15
 * Raw -> docs/audit/raw/cat7-sr-<phase>.txt   (phase arg: before|after)
 */
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const PHASE = process.argv[2] || 'before';
const WEB = 'http://localhost:5173';
const PG = 'ship-postgres-1';
const SETTLE = 2500;
const TAB_PEEK = 15;
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const docId = sh(`docker exec ${PG} psql -U ship -d ship_dev -tAc "SELECT id FROM documents WHERE document_type='wiki' ORDER BY created_at LIMIT 1"`).trim();
const COND = sh(`docker exec ${PG} psql -U ship -d ship_dev -tAc "SELECT 'documents='||(SELECT count(*) FROM documents)||' issues='||(SELECT count(*) FROM documents WHERE document_type='issue')||' sprints='||(SELECT count(*) FROM documents WHERE document_type='sprint')||' users='||(SELECT count(*) FROM users)"`).trim();

const PAGES = [
  ['login',         `${WEB}/login`],
  ['main_docs',     `${WEB}/docs`],
  ['view_document', `${WEB}/documents/${docId}`],
  ['issues',        `${WEB}/issues`],
  ['my_week',       `${WEB}/my-week`],
  ['team_dir',      `${WEB}/team/directory`],
];

const LANDMARK_ROLES = new Set([
  'banner', 'navigation', 'main', 'contentinfo', 'complementary', 'search', 'form', 'region',
]);
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'slider', 'spinbutton', 'searchbox',
]);

// CDP returns nodes shaped like `{ role: { value }, name: { value }, properties: [{name, value:{value}}], ignored }`.
// Normalize to `{ role, name, level, ignored }` to match the rest of the file.
function normalizeCdpNode(n) {
  const role = n.role?.value || '';
  const name = n.name?.value || '';
  let level = 0;
  for (const p of n.properties || []) {
    if (p.name === 'level') level = Number(p.value?.value) || 0;
  }
  return { role, name, level, ignored: !!n.ignored };
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
// /login is scanned UNAUTHENTICATED in a clean context (PublicRoute would
// redirect an authed session away — same pattern as cat7-a11y.mjs).
const anon = await browser.newContext();

const csrf = (await (await ctx.request.get(`${WEB}/api/csrf-token`)).json()).token;
const loginRes = await ctx.request.post(`${WEB}/api/auth/login`, {
  headers: { 'x-csrf-token': csrf },
  data: { email: 'dev@ship.local', password: 'admin123' },
});
if (!(await loginRes.json()).success) throw new Error('login failed');

const results = {};
for (const [key, url] of PAGES) {
  const page = await (key === 'login' ? anon : ctx).newPage();
  const r = {
    err: '',
    landmarks: [],
    headings: [],
    headingSkips: [],
    interactives: 0,
    unnamed: [],
    dialogs: 0,
    liveRegions: 0,
    firstTab: [],
  };
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(SETTLE);

    // Use CDP directly — `page.accessibility.snapshot` was removed in recent
    // Playwright.  `Accessibility.getFullAXTree` returns the same tree the
    // browser hands to VoiceOver/NVDA, so this is the most faithful proxy.
    const client = await page.context().newCDPSession(page);
    await client.send('Accessibility.enable');
    const { nodes: cdpNodes } = await client.send('Accessibility.getFullAXTree');
    await client.detach().catch(() => {});
    const flat = cdpNodes.map(normalizeCdpNode).filter((n) => !n.ignored && n.role);

    // Landmarks — the regions SR users jump between (banner / nav / main / etc).
    r.landmarks = flat
      .filter((n) => LANDMARK_ROLES.has(n.role))
      .map((n) => ({ role: n.role, name: (n.name || '').slice(0, 40) }));

    // Heading outline — SR users navigate by heading; level skips disorient.
    const headings = flat.filter((n) => n.role === 'heading');
    r.headings = headings.map((h) => ({ level: h.level || 0, name: (h.name || '').slice(0, 60) }));
    const levels = headings.map((h) => h.level || 0).filter(Boolean);
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] > levels[i - 1] + 1) r.headingSkips.push(`h${levels[i - 1]}->h${levels[i]}`);
    }

    // Interactives + unnamed — an unnamed button/link is a black hole to SR users.
    const interactives = flat.filter((n) => INTERACTIVE_ROLES.has(n.role));
    r.interactives = interactives.length;
    r.unnamed = interactives
      .filter((n) => !(n.name && n.name.trim()))
      .slice(0, 8)
      .map((n) => n.role);

    // Dialogs in the tree (modal regions).
    r.dialogs = flat.filter((n) => n.role === 'dialog' || n.role === 'alertdialog').length;

    // Live regions — DOM query (aria-live + role=alert/status/log) because
    // tree node `live` is not always surfaced cross-version.
    r.liveRegions = await page.evaluate(
      () => document.querySelectorAll('[aria-live], [role="alert"], [role="status"], [role="log"]').length,
    );

    // First N Tab landings — proxy for "what does the SR announce first?".
    for (let i = 0; i < TAB_PEEK; i++) {
      await page.keyboard.press('Tab');
      const desc = await page.evaluate(() => {
        const e = document.activeElement;
        if (!e || e === document.body || e === document.documentElement) return null;
        const role = e.getAttribute('role') || e.tagName.toLowerCase();
        const text = (e.getAttribute('aria-label')
          || e.innerText
          || e.getAttribute('alt')
          || e.getAttribute('title')
          || e.getAttribute('placeholder')
          || '(unnamed)');
        return `${role}: ${String(text).trim().replace(/\s+/g, ' ').slice(0, 60)}`;
      });
      if (desc) r.firstTab.push(desc);
    }
  } catch (e) {
    r.err = String(e.message).slice(0, 160);
  }
  results[key] = r;
  await page.close();
}
await browser.close();

let sha = 'unknown';
try { sha = sh(`git -C ${ROOT} rev-parse HEAD`).trim(); } catch {}
const L = [];
const P = (s = '') => L.push(s);
P(`# Cat 7 SR-tree proxy — ${PHASE}`);
P(`commit: ${sha}`);
P(`date: ${new Date().toISOString()}`);
P(`condition: ${COND} — snapshot-pinned (scripts/audit/db-restore.sh); web :5173 (dev, StrictMode ON)`);
P(`method: Playwright a11y-tree snapshot per page; same 6 pages as cat7-a11y.mjs / cat7-lighthouse.mjs`);
P(`knobs: settle=${SETTLE}ms tab_peek=${TAB_PEEK}`);
P(`note: proxy only — manual VoiceOver pass (Q3-B) records announcement flow.`);
P('');
P('## Landmarks per page (jumps an SR user can take: banner/nav/main/contentinfo/…)');
P('page          | landmarks');
for (const [key] of PAGES) {
  const r = results[key];
  if (r.err) { P(`${key.padEnd(13)} | ERROR: ${r.err}`); continue; }
  const list = r.landmarks.map((l) => `${l.role}${l.name ? ':' + l.name : ''}`).join(' / ') || '(none)';
  P(`${key.padEnd(13)} | ${list}`);
}
P('');
P('## Heading outline + skip flags (SR users outline a page by headings)');
for (const [key] of PAGES) {
  const r = results[key];
  if (r.err) continue;
  P(`- ${key}: ${r.headings.length} heading(s); level-skips=${r.headingSkips.length ? r.headingSkips.join(',') : 'none'}`);
  r.headings.slice(0, 10).forEach((h) => P(`    h${h.level}  ${h.name}`));
}
P('');
P('## Interactives: total vs unnamed (unnamed = black hole to an SR user)');
P('page          | total | unnamed | example roles');
for (const [key] of PAGES) {
  const r = results[key];
  if (r.err) continue;
  P(`${key.padEnd(13)} | ${String(r.interactives).padStart(5)} | ${String(r.unnamed.length).padStart(7)} | ${r.unnamed.join(',') || '(none)'}`);
}
P('');
P('## Dialog + live-region presence');
P('page          | dialogs(role=dialog) | liveRegions(aria-live/alert/status/log)');
for (const [key] of PAGES) {
  const r = results[key];
  if (r.err) continue;
  P(`${key.padEnd(13)} | ${String(r.dialogs).padStart(19)} | ${String(r.liveRegions).padStart(38)}`);
}
P('');
P(`## First ${TAB_PEEK} announcements via Tab (what the SR lands on first)`);
for (const [key] of PAGES) {
  const r = results[key];
  if (r.err) continue;
  P(`- ${key}:`);
  r.firstTab.forEach((s, i) => P(`    ${String(i + 1).padStart(2)}. ${s}`));
}
P('');
P('Notes: dev build (StrictMode). Tree snapshot is the same data structure');
P('a screen reader uses; manual VoiceOver pass (Q3-B) records announcement flow.');

const out = L.join('\n') + '\n';
const dest = join(ROOT, 'docs', 'audit', 'raw', `cat7-sr-${PHASE}.txt`);
writeFileSync(dest, out);
console.log(out);
console.log(`written: ${relative(ROOT, dest)}`);
