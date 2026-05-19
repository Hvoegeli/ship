#!/usr/bin/env node
/**
 * Cat 1 — Type Safety baseline (AST-accurate, reproducible).
 *
 * Uses the TypeScript Compiler API (no extra deps) to count, per package:
 *   - explicit `any`      (AnyKeyword tokens: `: any`, `as any`, `any[]`, `<any>`, `Array<any>`)
 *   - type assertions     (`expr as T` + `<T>expr`, EXCLUDING `as const`)
 *   - non-null assertions (`expr!`)
 *   - @ts-ignore / @ts-expect-error / @ts-nocheck (comment scan)
 *
 * Scopes reported: (A) non-test src/ [primary baseline we improve],
 *                   (B) all incl tests [completeness].
 * Writes raw output to docs/audit/raw/cat1-<phase>.txt   (phase arg: before|after, default before)
 *
 * Run UNCHANGED in Phase 2 for the "after" measurement.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = join(import.meta.dirname, '..', '..');
const PHASE = process.argv[2] || 'before';
const PKGS = ['api', 'web', 'shared'];

const isTest = (f) => /\.(test|spec)\.[cm]?tsx?$/.test(f) || f.includes('/__tests__/');

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === 'build') continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.[cm]?tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

function countFile(file) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file, src, ts.ScriptTarget.Latest, true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const c = { any: 0, as: 0, nonnull: 0, tsignore: 0 };
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) c.any++;
    if (ts.isAsExpression(node)) {
      const t = node.type;
      const isConst = t && ts.isTypeReferenceNode(t) && t.typeName &&
        t.typeName.escapedText === 'const';
      if (!isConst) c.as++;
    }
    if (ts.isTypeAssertionExpression && ts.isTypeAssertionExpression(node)) c.as++; // <T>expr
    if (ts.isNonNullExpression(node)) c.nonnull++;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const m = src.match(/@ts-(ignore|expect-error|nocheck)/g);
  c.tsignore = m ? m.length : 0;
  return c;
}

function blank() { return { any: 0, as: 0, nonnull: 0, tsignore: 0, files: 0 }; }
function add(t, c) { t.any += c.any; t.as += c.as; t.nonnull += c.nonnull; t.tsignore += c.tsignore; t.files++; }

const perPkg = {};
const perFile = [];
for (const pkg of PKGS) {
  const base = join(ROOT, pkg, 'src');
  let files = [];
  try { files = walk(base); } catch { continue; }
  perPkg[pkg] = { A: blank(), B: blank() };
  for (const f of files) {
    const c = countFile(f);
    add(perPkg[pkg].B, c);
    if (!isTest(f)) {
      add(perPkg[pkg].A, c);
      perFile.push({ rel: relative(ROOT, f), ...c, total: c.any + c.as + c.nonnull + c.tsignore });
    }
  }
}

const totalA = blank(), totalB = blank();
for (const p of PKGS) {
  if (!perPkg[p]) continue;
  for (const k of ['any', 'as', 'nonnull', 'tsignore', 'files']) {
    totalA[k] += perPkg[p].A[k];
    totalB[k] += perPkg[p].B[k];
  }
}
perFile.sort((a, b) => b.total - a.total);

let sha = 'unknown';
try { sha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); } catch {}

const lines = [];
const L = (s = '') => lines.push(s);
const row = (name, x) =>
  L(`${name.padEnd(7)} | ${String(x.files).padStart(5)} | ${String(x.any).padStart(3)} | ${String(x.as).padStart(3)} | ${String(x.nonnull).padStart(10)} | ${x.tsignore}`);

L(`# Cat 1 Type Safety — ${PHASE}`);
L(`commit: ${sha}`);
L(`date: ${new Date().toISOString()}`);
L(`tool: TypeScript Compiler API ${ts.version} (AST count, not regex)`);
L(`strict mode: ENABLED (root tsconfig: strict, noUncheckedIndexedAccess, noImplicitReturns, noFallthroughCasesInSwitch)`);
L(`note: noImplicitAny on (via strict) -> implicit-any is a compile error; explicit-any is the measurable surface.`);
L(`no linter configured in repo (no ESLint / @typescript-eslint) -> compiler API is the reproducible instrument.`);
L('');
L('## Scope A - non-test src/ (PRIMARY baseline; the 25% target applies here)');
L('pkg     | files |  any |  as | nonnull(!) | @ts-ignore');
for (const p of PKGS) if (perPkg[p]) row(p, perPkg[p].A);
row('TOTAL', totalA);
const grandA = totalA.any + totalA.as + totalA.nonnull + totalA.tsignore;
L(`GRAND TOTAL violations (A) = ${grandA}   | 25% reduction target = ${Math.ceil(grandA * 0.25)}`);
L('');
L('## Scope B - all incl tests (completeness)');
L('pkg     | files |  any |  as | nonnull(!) | @ts-ignore');
for (const p of PKGS) if (perPkg[p]) row(p, perPkg[p].B);
row('TOTAL', totalB);
L('');
L('## Top 10 violation-dense files (scope A)');
for (const f of perFile.slice(0, 10))
  L(`${String(f.total).padStart(4)}  ${f.rel}  (any=${f.any} as=${f.as} !=${f.nonnull} tsig=${f.tsignore})`);

const out = lines.join('\n') + '\n';
const dest = join(ROOT, 'docs', 'audit', 'raw', `cat1-${PHASE}.txt`);
writeFileSync(dest, out);
console.log(out);
console.log(`written: ${relative(ROOT, dest)}`);
