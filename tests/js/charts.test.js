// Qrafik köməkçiləri: node --test tests/js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { niceTicks, formatShort, formatFull, percent } =
  require(path.join(__dirname, '..', '..', 'static', 'charts.js'));

test('bölgülər sıfırı və bütün aralığı əhatə edir', () => {
  const ticks = niceTicks(-13481000, 14129627, 4);
  assert.ok(ticks[0] <= -13481000);
  assert.ok(ticks[ticks.length - 1] >= 14129627);
  assert.ok(ticks.includes(0), 'sıfır xətti olmalıdır');
  const steps = ticks.slice(1).map((t, i) => t - ticks[i]);
  assert.ok(steps.every((s) => s === steps[0]), 'addım bərabərdir');
});

test('eyni dəyərli aralıq', () => {
  assert.ok(niceTicks(5, 5, 4).length >= 2);
});

test('qısa və tam yazılış Azərbaycan formatındadır', () => {
  assert.equal(formatShort(-13481000), '−13,5 mln');
  assert.equal(formatShort(68811), '69 min');
  assert.equal(formatFull(-1496452), '−1 496 452');
  assert.equal(percent(0.45848), '45,8%');
  assert.equal(percent(null), '—');
});
