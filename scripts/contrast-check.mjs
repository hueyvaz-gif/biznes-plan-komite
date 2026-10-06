// WCAG AA kontrast yoxlaması: static/tokens.css-dəki mətn tokenləri öz fonları üzərində ≥ 4,5:1.
// İstifadə: node scripts/contrast-check.mjs   (xəta olarsa exit 1)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../static/tokens.css', import.meta.url)), 'utf8');

function block(re) {
  const m = css.match(re);
  if (!m) throw new Error('blok tapılmadı: ' + re);
  const vars = {};
  for (const [, k, v] of m[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) vars[k] = v;
  return vars;
}
const light = block(/^:root\s*\{([\s\S]*?)^\}/m);
const dark = { ...light, ...block(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/) };

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const PAIRS = [
  ...['--ink', '--ink-soft', '--ink-faint', '--accent'].flatMap((fg) =>
    ['--bg', '--surface', '--surface-2', '--side-bg', '--sage'].map((bg) => [fg, bg])),
  ...['success', 'warning', 'danger', 'info', 'neutral'].flatMap((t) =>
    [[`--${t}-fg`, `--${t}-bg`], [`--${t}-fg`, '--surface'], [`--${t}-fg`, '--bg']]),
  ['--on-accent', '--accent'], ['--on-accent', '--accent-hover'], ['--inverse-fg', '--inverse-bg'],
  ['--inverse-accent', '--inverse-bg'], ['--ink', '--highlight'],
];

let failed = 0;
for (const [name, vars] of [['açıq', light], ['tünd', dark]]) {
  for (const [fg, bg] of PAIRS) {
    const r = ratio(vars[fg], vars[bg]);
    if (r < 4.5) { failed++; console.log(`✗ ${name}: ${fg} (${vars[fg]}) / ${bg} (${vars[bg]}) = ${r.toFixed(2)}`); }
  }
}
console.log(failed ? `${failed} cüt AA-dan aşağıdır` : `✓ ${PAIRS.length * 2} cütün hamısı ≥ 4,5:1`);
process.exit(failed ? 1 : 0);
