// static/econ-calc.js ↔ app/economics/scenario.py: eyni vektorlar (tests/fixtures/econ_vectors.json), fərq ≤ 1 manat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../../static/econ-calc.js';

const data = JSON.parse(readFileSync(new URL('../fixtures/econ_vectors.json', import.meta.url), 'utf8'));

test('fixture-də vektor var', () => {
  assert.ok(data.vectors.length >= 20);
});

for (const v of data.vectors) {
  test(`${v.model} ${JSON.stringify(v.params)}: NPV, IRR və pul axını Python ilə eyni (±1 ₼)`, () => {
    const got = E.evaluate(data.models[v.model], v.params);
    assert.ok(Math.abs(got.npv - v.npv) <= 1, `NPV ${got.npv} ≠ ${v.npv}`);
    assert.equal(got.flows.length, v.flows.length);
    got.flows.forEach((f, i) => assert.ok(Math.abs(f - v.flows[i]) <= 1, `il ${i}: ${f} ≠ ${v.flows[i]}`));
    if (v.irr === null) assert.equal(got.irr, null);
    else assert.ok(Math.abs(got.irr - v.irr) < 1e-6, `IRR ${got.irr} ≠ ${v.irr}`);
  });
}

for (const t of data.thresholds) {
  test(`${t.model} sıfır həddi (${t.kind}) Python ilə eyni`, () => {
    const got = E.zeroThreshold(data.models[t.model], t.kind);
    if (t.value === null) assert.equal(got, null);
    else assert.ok(Math.abs(got.value - t.value) < 1e-6, `${got && got.value} ≠ ${t.value}`);
  });
}

test('parametrsiz ssenari planın FCFF-ini dəyişmir', () => {
  const m = data.models.real;
  assert.deepEqual(E.flowsFor(m), m.flows);
});

test('ciddilik qaydası: < 5 yüksək, 5–15 orta, > 15 aşağı', () => {
  assert.equal(E.severityFor(0.97), 'yuksek');
  assert.equal(E.severityFor(12.5), 'orta');
  assert.equal(E.severityFor(18.7), 'asagi');
  assert.equal(E.marginOf({ value: 87.5, kind: 'level' }), 12.5);
});

test('performans: 1 ssenari hesabı < 1ms (slider kadrı 16ms-dən çox az)', () => {
  const m = data.models.real;
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) E.evaluate(m, { price: -0.05 + i / 10000, raw: 0.02, capex: 0.1, utilization: 0.9 });
  const per = (performance.now() - t0) / 200;
  assert.ok(per < 1, `${per.toFixed(3)} ms`);
});
