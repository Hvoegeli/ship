#!/usr/bin/env node
/**
 * Cat 2 — Bundle Size baseline (reproducible, zero extra deps).
 *
 * Assumes `web/dist` was produced by:
 *   cd web && VITE_API_URL= npx vite build --sourcemap
 * (--sourcemap is a CLI flag only; no committed config/lockfile change.)
 *
 * Reports: total shipped JS+CSS (raw + gzip), #chunks, largest chunk,
 * top dependencies (attributed by parsing .map sourcesContent bytes),
 * and declared-but-unused web/ dependencies (import scan of web/src).
 *
 * Raw -> docs/audit/raw/cat2-<phase>.txt   (phase arg: before|after)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..', '..');
const PHASE = process.argv[2] || 'before';
const DIST = join(ROOT, 'web', 'dist');
const ASSETS = join(DIST, 'assets');

const files = readdirSync(ASSETS).map((f) => ({ f, p: join(ASSETS, f) }));
const js = files.filter((x) => x.f.endsWith('.js'));
const css = files.filter((x) => x.f.endsWith('.css'));

const sz = (p) => statSync(p).size;
const gz = (p) => gzipSync(readFileSync(p)).length;

const jsRaw = js.reduce((s, x) => s + sz(x.p), 0);
const jsGz = js.reduce((s, x) => s + gz(x.p), 0);
const cssRaw = css.reduce((s, x) => s + sz(x.p), 0);
const cssGz = css.reduce((s, x) => s + gz(x.p), 0);
const chunks = js
  .map((x) => ({ name: x.f, raw: sz(x.p), gz: gz(x.p) }))
  .sort((a, b) => b.raw - a.raw);
const largest = chunks[0];

// Attribute bytes to deps via the largest chunk's sourcemap (sourcesContent proxy).
const mapFile = join(ASSETS, largest.name + '.map');
const pkgBytes = {};
let mappedTotal = 0;
try {
  const map = JSON.parse(readFileSync(mapFile, 'utf8'));
  const srcs = map.sources || [];
  const contents = map.sourcesContent || [];
  srcs.forEach((s, i) => {
    const len = (contents[i] || '').length;
    mappedTotal += len;
    // pnpm nests as .../node_modules/.pnpm/<pkg>@ver/node_modules/<realpkg>/...
    // Take the package after the LAST node_modules/ (handles @scope).
    const idx = s.lastIndexOf('node_modules/');
    let key;
    if (idx === -1) {
      key = '(app source)';
    } else {
      const rest = s.slice(idx + 'node_modules/'.length).split('/');
      key = rest[0] === '.pnpm'
        ? '(unresolved .pnpm)'
        : rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
    }
    pkgBytes[key] = (pkgBytes[key] || 0) + len;
  });
} catch (e) {
  pkgBytes['(sourcemap parse failed)'] = 0;
}
const topDeps = Object.entries(pkgBytes)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12);

// Declared-but-unused web/ dependencies (import scan).
const webPkg = JSON.parse(readFileSync(join(ROOT, 'web', 'package.json'), 'utf8'));
const deps = Object.keys(webPkg.dependencies || {});
function walkSrc(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkSrc(p, acc);
    else if (/\.[cm]?[jt]sx?$/.test(e)) acc.push(p);
  }
  return acc;
}
const srcText = walkSrc(join(ROOT, 'web', 'src'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
const viteCfg = (() => { try { return readFileSync(join(ROOT, 'web', 'vite.config.ts'), 'utf8'); } catch { return ''; } })();
const unused = deps.filter((d) => {
  const re = new RegExp(`(from\\s+['"]${d}(/|['"])|require\\(['"]${d}(/|['"])|import\\(['"]${d}(/|['"])|import\\s+['"]${d}['"])`);
  return !re.test(srcText) && !re.test(viteCfg);
});

let sha = 'unknown';
try { sha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); } catch {}
const kb = (n) => (n / 1024).toFixed(1) + ' kB';

const L = [];
const p = (s = '') => L.push(s);
p(`# Cat 2 Bundle Size — ${PHASE}`);
p(`commit: ${sha}`);
p(`date: ${new Date().toISOString()}`);
p(`build: cd web && VITE_API_URL= npx vite build --sourcemap   (CLI flag only)`);
p(`measure: shipped assets only (.js/.css; .map excluded — not browser-loaded)`);
p('');
p(`Total shipped bundle (JS+CSS) : ${kb(jsRaw + cssRaw)} raw  /  ${kb(jsGz + cssGz)} gzip`);
p(`  JS  : ${kb(jsRaw)} raw / ${kb(jsGz)} gzip   across ${js.length} chunks`);
p(`  CSS : ${kb(cssRaw)} raw / ${kb(cssGz)} gzip   across ${css.length} files`);
p(`Largest chunk : ${largest.name}  ${kb(largest.raw)} raw / ${kb(largest.gz)} gzip`);
p(`  -> ${((largest.raw / jsRaw) * 100).toFixed(1)}% of all JS is in ONE chunk`);
p('');
p('Top 8 chunks:');
chunks.slice(0, 8).forEach((c) => p(`  ${kb(c.raw).padStart(11)} raw / ${kb(c.gz).padStart(9)} gz  ${c.name}`));
p('');
p(`Top dependencies in largest chunk (by sourcemap sourcesContent bytes; proxy, mappedTotal=${(mappedTotal/1024).toFixed(0)}kB of source):`);
topDeps.forEach(([k, v]) => p(`  ${(100 * v / mappedTotal).toFixed(1).padStart(5)}%  ${(v/1024).toFixed(1).padStart(9)} kB src  ${k}`));
p('');
p(`Declared web/ deps: ${deps.length}.  Candidate UNUSED (no import found in web/src or vite.config) — verify before removal:`);
p('  ' + (unused.length ? unused.join(', ') : '(none detected)'));
p('');
p('Notes: dep attribution uses sourcesContent length (source bytes) as a proxy for');
p('minified contribution (source-map-explorer-style mapping accuracy not required for ranking).');

const out = L.join('\n') + '\n';
const dest = join(ROOT, 'docs', 'audit', 'raw', `cat2-${PHASE}.txt`);
writeFileSync(dest, out);
console.log(out);
console.log(`written: ${relative(ROOT, dest)}`);
