#!/usr/bin/env node
/**
 * Cat 7 — Accessibility baseline (reproducible, browser-driven).
 *
 * Repro prerequisites (tooling only, NOT app code — same class as Cat 6):
 *   - `@axe-core/playwright` is already a repo devDependency (resolves at ROOT)
 *   - `npx playwright install chromium` (one-time; already installed for Cat 6)
 *
 * Condition of record: seed-augment.sql applied (577+ docs / 328 issues / 31
 * users). Web dev server :5173 (Vite proxies /api -> :3000). Dev build
 * (React.StrictMode ON) — same condition as Cat 6 so before/after compare.
 *
 * Four probes the deck asks for, each reproducible & deterministic, run across
 * the SAME 6 key pages Cat 6 used:
 *  1. AXE      — axe-core WCAG 2.1 A+AA scan; per-page counts by impact,
 *                top rule ids + node counts; aggregate distinct-rule and
 *                total-instance totals.
 *  2. CONTRAST — the `color-contrast` rule isolated (directly tests the
 *                README "Section 508 / WCAG 2.1 AA" claim).
 *  3. KEYBOARD — Tab through a bounded budget; how many distinct interactive
 *                elements actually receive focus vs how many exist; trap flag.
 *  4. BASICS   — <html lang>, <title>, single <h1>, main/nav landmarks,
 *                <img> alt coverage %.
 *
 * Fixed knobs (identical for Phase-2 "after"):
 *   SETTLE=2500ms  TAB_BUDGET=60
 * Raw -> docs/audit/raw/cat7-<phase>.txt   (phase arg: before|after)
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const PHASE = process.argv[2] || 'before';
const WEB = 'http://localhost:5173';
const PG = 'ship-postgres-1';
const SETTLE = 2500;
const TAB_BUDGET = 60;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const docId = sh(`docker exec ${PG} psql -U ship -d ship_dev -tAc "SELECT id FROM documents WHERE document_type='wiki' ORDER BY created_at LIMIT 1"`).trim();

const PAGES = [
  ['login',         `${WEB}/login`],
  ['main_docs',     `${WEB}/docs`],
  ['view_document', `${WEB}/documents/${docId}`],
  ['issues',        `${WEB}/issues`],
  ['my_week',       `${WEB}/my-week`],
  ['team_dir',      `${WEB}/team/directory`],
];

const browser = await chromium.launch();
const context = await browser.newContext();           // authenticated context
// `login` is scanned UNAUTHENTICATED in its own clean context, otherwise
// PublicRoute redirects an authed session away and we'd never see /login.
const anon = await browser.newContext();

// --- auth via the context request jar (cookies attach automatically) ---
const csrf = (await (await context.request.get(`${WEB}/api/csrf-token`)).json()).token;
const loginRes = await context.request.post(`${WEB}/api/auth/login`, {
  headers: { 'x-csrf-token': csrf },
  data: { email: 'dev@ship.local', password: 'admin123' },
});
if (!(await loginRes.json()).success) throw new Error('login failed');

const results = {};
for (const [key, url] of PAGES) {
  const page = await (key === 'login' ? anon : context).newPage();
  const r = { axe: null, contrast: 0, contrastSamples: [], kb: {}, basics: {}, err: '' };
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(SETTLE);

    // ---- Probe 1+2: axe ----
    const a = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0, null: 0 };
    const rules = [];
    for (const v of a.violations) {
      const imp = v.impact || 'null';
      byImpact[imp] = (byImpact[imp] || 0) + v.nodes.length;
      rules.push([v.id, v.impact, v.nodes.length]);
      if (v.id === 'color-contrast') {
        r.contrast += v.nodes.length;
        r.contrastSamples = v.nodes.slice(0, 3).map((n) => (n.target || []).join(' ').slice(0, 80));
      }
    }
    rules.sort((x, y) => y[2] - x[2]);
    r.axe = {
      distinctRules: a.violations.length,
      totalNodes: rules.reduce((s, x) => s + x[2], 0),
      byImpact,
      top: rules.slice(0, 6),
      passes: a.passes.length,
    };

    // ---- Probe 3: keyboard reachability ----
    const interactive = await page.evaluate(() =>
      document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"]').length);
    // Reliable identity: stamp the focused element with a unique sequential
    // data attribute the first time it is focused; count distinct stamps.
    // (Coarse string signatures collapse same-class/no-id elements -> false low.)
    await page.evaluate(() => { window.__a11yNext = 1; });
    const seen = new Set();
    let lastId = -1;
    let stuck = 0;
    for (let i = 0; i < TAB_BUDGET; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => {
        const e = document.activeElement;
        if (!e || e === document.body || e === document.documentElement) return -1;
        if (!e.dataset.a11yId) e.dataset.a11yId = String(window.__a11yNext++);
        return Number(e.dataset.a11yId);
      });
      if (id >= 0) seen.add(id);
      if (id >= 0 && id === lastId) stuck++; else stuck = 0;
      lastId = id;
      if (stuck >= 5) break; // focus dead-end / trap
    }
    r.kb = { interactiveEls: interactive, focusableReached: seen.size, tabBudget: TAB_BUDGET, trapSuspected: stuck >= 5 };

    // ---- Probe 4: document basics ----
    r.basics = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')];
      const withAlt = imgs.filter((i) => i.hasAttribute('alt')).length;
      return {
        htmlLang: document.documentElement.getAttribute('lang') || '(none)',
        title: (document.title || '(none)').slice(0, 50),
        h1Count: document.querySelectorAll('h1').length,
        mainLandmark: !!document.querySelector('main,[role="main"]'),
        navLandmark: !!document.querySelector('nav,[role="navigation"]'),
        imgs: imgs.length,
        imgAltPct: imgs.length ? Math.round((100 * withAlt) / imgs.length) : 100,
      };
    });
  } catch (e) {
    r.err = String(e.message).slice(0, 160);
  }
  results[key] = r;
  await page.close();
}
await browser.close();

// ---- aggregate ----
const agg = { critical: 0, serious: 0, moderate: 0, minor: 0 };
const ruleUnion = new Set();
let totalContrast = 0;
for (const k of Object.keys(results)) {
  const ax = results[k].axe;
  if (!ax) continue;
  for (const imp of ['critical', 'serious', 'moderate', 'minor']) agg[imp] += ax.byImpact[imp] || 0;
  ax.top.forEach(([id]) => ruleUnion.add(id));
  totalContrast += results[k].contrast;
}

let sha = 'unknown';
try { sha = sh(`git -C ${ROOT} rev-parse HEAD`).trim(); } catch {}
const L = [];
const P = (s = '') => L.push(s);
P(`# Cat 7 Accessibility — ${PHASE}`);
P(`commit: ${sha}`);
P(`date: ${new Date().toISOString()}`);
P(`condition: 577+ docs / 328 issues / 31 users; web :5173 (dev, StrictMode ON)`);
P(`knobs: settle=${SETTLE}ms tab_budget=${TAB_BUDGET}; axe tags=${TAGS.join('+')}`);
P('');
P('## Probe 1 — axe-core WCAG 2.1 A+AA violations per page (by node instances)');
P('page          | critical | serious | moderate | minor | distinct | passes');
for (const [key] of PAGES) {
  const ax = results[key].axe;
  if (!ax) { P(`${key.padEnd(13)} | ERROR: ${results[key].err}`); continue; }
  const b = ax.byImpact;
  P(`${key.padEnd(13)} | ${String(b.critical).padStart(8)} | ${String(b.serious).padStart(7)} | ${String(b.moderate).padStart(8)} | ${String(b.minor).padStart(5)} | ${String(ax.distinctRules).padStart(8)} | ${ax.passes}`);
}
P('');
P(`AGGREGATE node instances — critical=${agg.critical} serious=${agg.serious} moderate=${agg.moderate} minor=${agg.minor}`);
P(`Critical+Serious total = ${agg.critical + agg.serious}; distinct rule ids across pages = ${ruleUnion.size} (${[...ruleUnion].join(', ')})`);
P('');
P('### Top violation rules per page (id, impact, nodes)');
for (const [key] of PAGES) {
  const ax = results[key].axe;
  if (!ax) continue;
  P(`- ${key}:`);
  ax.top.forEach(([id, imp, n]) => P(`    ${String(n).padStart(3)}x  [${imp}]  ${id}`));
}
P('');
P('## Probe 2 — color-contrast (directly tests README 508/WCAG-AA claim)');
P(`- total color-contrast violating nodes across pages: ${totalContrast}`);
for (const [key] of PAGES) {
  const r = results[key];
  if (r.contrast) P(`- ${key}: ${r.contrast} nodes; e.g. ${r.contrastSamples.join(' | ')}`);
}
P('');
P('## Probe 3 — keyboard reachability (Tab budget = ' + TAB_BUDGET + ')');
P('page          | interactiveEls | focusableReached | trapSuspected');
for (const [key] of PAGES) {
  const kb = results[key].kb;
  if (!kb || kb.interactiveEls == null) { P(`${key.padEnd(13)} | (n/a)`); continue; }
  P(`${key.padEnd(13)} | ${String(kb.interactiveEls).padStart(14)} | ${String(kb.focusableReached).padStart(16)} | ${kb.trapSuspected}`);
}
P('');
P('## Probe 4 — document/landmark basics');
P('page          | lang | h1 | main | nav | imgs | imgAlt%  | title');
for (const [key] of PAGES) {
  const b = results[key].basics;
  if (!b || !b.title) { P(`${key.padEnd(13)} | (n/a)`); continue; }
  P(`${key.padEnd(13)} | ${String(b.htmlLang).padStart(4)} | ${String(b.h1Count).padStart(2)} | ${String(b.mainLandmark).padStart(4)} | ${String(b.navLandmark).padStart(3)} | ${String(b.imgs).padStart(4)} | ${String(b.imgAltPct + '%').padStart(7)} | ${b.title}`);
}
P('');
P('Notes: dev build (StrictMode). axe scans the rendered SPA after networkidle');
P('+ settle. Counts are node instances (a single rule can flag many nodes).');
P('Triage/severity + the README-claim verdict are recorded in AUDIT_REPORT.md.');

const out = L.join('\n') + '\n';
const dest = join(ROOT, 'docs', 'audit', 'raw', `cat7-${PHASE}.txt`);
writeFileSync(dest, out);
console.log(out);
console.log(`written: ${relative(ROOT, dest)}`);
