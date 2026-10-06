// CSS dizayn sistemi auditi: tokenlərdən kənar dəyərləri sayır, hədəf aşılarsa exit 1 (CI üçün).
//
//   node scripts/css-audit.mjs            — static/*.css (tokens.css xaric) və static/ui/*.css
//   node scripts/css-audit.mjs --verbose  — hər pozuntunu sətri ilə göstərir
//
// Qaydalar (tokens.css-dəki şkalalar):
//   font-size      — yalnız var(--fs-*), inherit; pt yalnız @media print daxilində     → pozuntu 0, pillə ≤ 8
//   border-radius  — yalnız 0 və var(--r-*)                                             → pozuntu 0, dəyər ≤ 4
//   box-shadow     — bulanıq kölgə yalnız var(--e-*) ilə; sərhəd halqası (blur 0) və inset zolaq icazəlidir
//   z-index        — yalnız var(--z-*) (calc daxilində də), 0, auto
//   rəng           — hex / rgb() / hsl() literal yoxdur (mask-image istisna: alfa maskasıdır, rəng deyil)
//   !important     — @media print xaricində yalnız [hidden], .sr-only və reduced-motion qaydalarında
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../static/', import.meta.url));
const VERBOSE = process.argv.includes('--verbose');

const files = [
  ...readdirSync(ROOT).filter((f) => f.endsWith('.css') && f !== 'tokens.css').map((f) => join(ROOT, f)),
  ...(existsSync(join(ROOT, 'ui')) ? readdirSync(join(ROOT, 'ui')).filter((f) => f.endsWith('.css')).map((f) => join(ROOT, 'ui', f)) : []),
];

/** Şərhləri sətir sayını saxlayaraq silir. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Hər bəyannamə: {prop, value, line, selector, atRules[]}. Sadə mötərizə izləyicisi. */
function declarations(css) {
  const out = [];
  const stack = [];          // {kind: 'at'|'rule', text}
  let buf = '';
  let line = 1;
  let startLine = 1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\n') line++;
    if (ch === '{') {
      const head = buf.trim();
      stack.push({ kind: head.startsWith('@') ? 'at' : 'rule', text: head });
      buf = ''; startLine = line;
    } else if (ch === ';' || ch === '}') {
      const text = buf.trim();
      if (text && stack.length && stack[stack.length - 1].kind === 'rule') {
        const idx = text.indexOf(':');
        if (idx > 0) {
          const rules = stack.filter((s) => s.kind === 'rule');
          out.push({
            prop: text.slice(0, idx).trim().toLowerCase(), value: text.slice(idx + 1).trim(), line: startLine,
            selector: rules.length ? rules[rules.length - 1].text : '',
            atRules: stack.filter((s) => s.kind === 'at').map((s) => s.text),
          });
        }
      }
      if (ch === '}') stack.pop();
      buf = ''; startLine = line;
    } else {
      if (!buf.trim()) startLine = line;
      buf += ch;
    }
  }
  return out;
}

function splitTop(value) {
  const parts = []; let depth = 0; let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

const issues = { 'font-size': [], 'border-radius': [], 'box-shadow': [], 'z-index': [], color: [], '!important': [] };
const fsTokens = new Set(); const rTokens = new Set();

for (const file of files) {
  const name = file.slice(ROOT.length - 'static/'.length).replace(/\\/g, '/');
  for (const d of declarations(stripComments(readFileSync(file, 'utf8')))) {
    const where = `${name}:${d.line}  ${d.selector.slice(0, 50)} { ${d.prop}: ${d.value.slice(0, 70)} }`;
    const print = d.atRules.some((a) => /@media\s+print/.test(a));
    const value = d.value.replace(/\s*!important$/, '');

    if (d.value.endsWith('!important') && !print) {
      const ok = /\[hidden\]|\.sr-only/.test(d.selector) || d.atRules.some((a) => /prefers-reduced-motion/.test(a));
      if (!ok) issues['!important'].push(where);
    }
    if (d.prop === 'font-size' || d.prop === 'font') {
      for (const m of value.matchAll(/var\((--fs-[\w-]+)\)/g)) fsTokens.add(m[1]);
      const raw = d.prop === 'font-size'
        ? !/^(var\(--fs-[\w-]+\)|inherit)$/.test(value) && !(print && /^[\d.]+pt$/.test(value))
        : /(^|\s)[\d.]+(px|em|rem)(\s|\/)/.test(value + ' ') && !(print && /pt/.test(value));
      if (raw) issues['font-size'].push(where);
    }
    if (/^border(-[a-z]+)?-radius$/.test(d.prop)) {
      for (const t of value.split(/\s+/)) {
        const m = t.match(/^var\((--r-[\w-]+)\)$/);
        if (m) rTokens.add(m[1]); else if (t !== '0' && t !== 'inherit') issues['border-radius'].push(where);
      }
    }
    if (d.prop === 'box-shadow') {
      for (const p of splitTop(value)) {
        if (/^(none|var\(--(e-[\w-]+|focus)\))$/.test(p) || p.startsWith('inset')) continue;
        const nums = p.replace(/\b(var|color-mix|rgb)\([^)]*\)+/g, '').trim().split(/\s+/);
        if (nums.length >= 3 && parseFloat(nums[2]) === 0) continue;   // halqa: blur 0
        issues['box-shadow'].push(where);
      }
    }
    if (d.prop === 'z-index' && !/^(0|auto|var\(--z-[\w-]+\)|calc\(var\(--z-[\w-]+\)\s*[-+]\s*\d+\))$/.test(value)) {
      issues['z-index'].push(where);
    }
    if (!/mask-image/.test(d.prop) && !d.prop.startsWith('--')) {
      const literal = value.match(/#[0-9a-f]{3,8}\b/i) || value.match(/\b(rgba?|hsla?)\((?!var\()/i);
      if (literal) issues.color.push(where);
    }
  }
}

// Kölgə şkalası: tokens.css-də bulanıq kölgə tokenlərinin sayı (--e-0 halqadır).
const tokens = readFileSync(join(ROOT, 'tokens.css'), 'utf8');
const blurred = (v) => splitTop(v).some((p) => parseFloat((p.replace(/^inset\s+/, '').split(/\s+/)[2] || '0')) > 0);
const elevation = new Set([...tokens.matchAll(/(--e-[\w-]+)\s*:\s*([^;]+);/g)]
  .filter(([, , v]) => blurred(v)).map(([, k]) => k));

const limits = [
  ['font-size pillələri', fsTokens.size, 8], ['radius dəyərləri', rTokens.size, 4], ['kölgə səviyyələri', elevation.size, 4],
];
let fail = false;
console.log(`CSS auditi — ${files.length} fayl\n`);
for (const [k, list] of Object.entries(issues)) {
  const bad = list.length > 0;
  fail ||= bad;
  console.log(`${bad ? '✗' : '✓'} ${k.padEnd(14)} tokenlərdən kənar: ${list.length}`);
  if (bad && VERBOSE) list.forEach((w) => console.log('    ' + w));
  else if (bad) list.slice(0, 5).forEach((w) => console.log('    ' + w));
}
for (const [label, n, max] of limits) {
  fail ||= n > max;
  console.log(`${n > max ? '✗' : '✓'} ${label.padEnd(22)} ${n} (hədəf ≤ ${max})`);
}
process.exit(fail ? 1 : 0);
