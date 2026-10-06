// static/format.js — node --test tests/js/format.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../../static/format.js';

const S = F.NBSP;
const M = F.MINUS;

test('fmtNumber: mərtəbələr bölünməz boşluqla, onluq vergül, mənfi U+2212', () => {
  assert.equal(F.fmtNumber(1944881), `1${S}944${S}881`);
  assert.equal(F.fmtNumber(-1944881), `${M}1${S}944${S}881`);
  assert.equal(F.fmtNumber(1234.567, { decimals: 2 }), `1${S}234,57`);
  assert.equal(F.fmtNumber(5, { signed: true }), '+5');
  assert.ok(!F.fmtNumber(-5).includes('-'), 'defis işlənmir');
});

test('sıfır və yuvarlaqlaşmış sıfır işarəsizdir', () => {
  assert.equal(F.fmtNumber(0), '0');
  assert.equal(F.fmtNumber(0, { signed: true }), '0');
  assert.equal(F.fmtNumber(-0.04, { decimals: 1 }), '0,0');
  assert.equal(F.fmtNumber(-0), '0');
});

test('boş dəyərlər "—"', () => {
  for (const v of [null, undefined, '', NaN, 'abc', Infinity]) {
    assert.equal(F.fmtNumber(v), '—');
    assert.equal(F.fmtMoney(v), '—');
    assert.equal(F.fmtPct(v), '—');
    assert.equal(F.fmtYears(v), '—');
  }
});

test('fmtMoney: uzun və kompakt forma, ₼', () => {
  assert.equal(F.fmtMoney(1944881), `1${S}944${S}881${S}₼`);
  assert.equal(F.fmtMoney(1944881, { compact: true }), `1,94${S}mln${S}₼`);
  assert.equal(F.fmtMoney(-18.9e6, { compact: true }), `${M}18,9${S}mln${S}₼`);
  assert.equal(F.fmtMoney(1.2e6, { compact: true, signed: true }), `+1,2${S}mln${S}₼`);
  assert.equal(F.fmtMoney(2e6, { compact: true }), `2,0${S}mln${S}₼`);
  assert.equal(F.fmtMoney(3.5e9, { compact: true }), `3,5${S}mlrd${S}₼`);
  assert.equal(F.fmtMoney(950000, { compact: true }), `950${S}000${S}₼`, '1 mln-dan kiçik tam yazılır');
  assert.equal(F.fmtMoney(1944881, { currency: false }), `1${S}944${S}881`);
});

test('moneyLabel: ekran oxuyucu üçün sözlə', () => {
  assert.equal(F.moneyLabel(-1944881, { compact: true }), `mənfi 1,94${S}mln manat`);
  assert.equal(F.moneyLabel(null), 'məlumat yoxdur');
});

test('fmtPct: pay və faiz bəndləri', () => {
  assert.equal(F.fmtPct(0.1178), '11,8%');
  assert.equal(F.fmtPct(11.78, { points: true, decimals: 2 }), '11,78%');
  assert.equal(F.fmtPct(-0.009), `${M}0,9%`);
  assert.equal(F.fmtPct(0.025, { signed: true }), '+2,5%');
  assert.equal(F.fmtPct(0), '0,0%');
});

test('fmtYears', () => {
  assert.equal(F.fmtYears(7.44), `7,4${S}il`);
});

test('fmtDelta: abs, pct, ton', () => {
  assert.deepEqual(F.fmtDelta(100, 120), { abs: 20, pct: 0.2, tone: 'positive' });
  assert.deepEqual(F.fmtDelta(100, 80), { abs: -20, pct: -0.2, tone: 'negative' });
  assert.equal(F.fmtDelta(14, 8, { higherIsBetter: false }).tone, 'positive', 'boş yer azalıb — yaxşıdır');
  assert.equal(F.fmtDelta(0, 5).pct, null);
  assert.equal(F.fmtDelta(5, 5).tone, 'neutral');
  assert.equal(F.fmtDelta(5, 5.5, { epsilon: 1 }).tone, 'neutral');
  assert.deepEqual(F.fmtDelta(null, 5), { abs: null, pct: null, tone: 'neutral' });
});

test('toneOf', () => {
  assert.equal(F.toneOf(-1), 'negative');
  assert.equal(F.toneOf(1), 'positive');
  assert.equal(F.toneOf(0), 'neutral');
  assert.equal(F.toneOf(null), 'neutral');
});

test('fmtSize', () => {
  assert.equal(F.fmtSize(812), `812${S}B`);
  assert.equal(F.fmtSize(1536), `1,5${S}KB`);
  assert.equal(F.fmtSize(3.4 * 1024 * 1024), `3,4${S}MB`);
});

test('fmtDate və fmtRelative', () => {
  const iso = new Date(2026, 9, 5, 21, 59).toISOString();
  assert.equal(F.fmtDate(iso), '05.10.2026 21:59');
  assert.equal(F.fmtDate(iso, { time: false }), '05.10.2026');
  assert.equal(F.fmtDate(''), '');
  assert.equal(F.fmtRelative(iso, new Date(2026, 9, 6, 10, 0)), 'dünən 21:59');
  assert.equal(F.fmtRelative(iso, new Date(2026, 9, 5, 23, 0)), 'bu gün 21:59');
  assert.equal(F.fmtRelative(iso, new Date(2026, 9, 5, 22, 11)), '12 dəq əvvəl');
  assert.equal(F.fmtRelative(iso, new Date(2026, 9, 5, 21, 59, 30)), 'indicə');
  assert.equal(F.fmtRelative(iso, new Date(2026, 9, 9)), '05.10.2026 21:59');
});

test('Intl az-AZ əsasdır, əl ilə toFixed yoxdur', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../static/format.js', import.meta.url), 'utf8');
  assert.ok(src.includes("Intl.NumberFormat('az-AZ'"));
  assert.ok(!src.includes('toFixed'));
});
