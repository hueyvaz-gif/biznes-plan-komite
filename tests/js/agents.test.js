// Agent paneli: cəhdlər, zaman xətti, xülasə — node --test tests/js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Agents = require(path.join(__dirname, '..', '..', 'static', 'agents.js'));

const ev = (id, attempt, ts, agent, kind, name, extra = {}) =>
  ({ id, attempt, ts, agent, kind, name, status: 'ok', duration_ms: 1000, grp: null, ...extra });

const EVENTS = [
  ev(1, 1, 100, 'qraf', 'node', 'ingest'),
  ev(2, 1, 101, 'maliyye', 'tool', 'list_tables', { summary: '34 cədvəl' }),
  ev(3, 1, 102, 'maliyye', 'llm', 'LLM çağırışı'),
  ev(4, 1, 104, 'uygunluq', 'tool', 'list_sections', { grp: 'swot|9. SWOT' }),
  ev(5, 1, 104, 'uygunluq', 'tool', 'list_sections', { grp: 'bazar|5. Bazar' }),
  ev(6, 1, 104, 'uygunluq', 'tool', 'get_section', { grp: 'bazar|5. Bazar', status: 'alət xətası' }),
  ev(7, 1, 103, 'qraf', 'node', 'compliance', { status: 'xeta', duration_ms: 2000 }),
  ev(8, 2, 200, 'uygunluq', 'result', 'nəticə hazır', { grp: 'swot|9. SWOT', duration_ms: null }),
  ev(9, 2, 199, 'qraf', 'node', 'compliance'),
  ev(10, 2, 202, 'qraf', 'node', 'save', { duration_ms: 10 }),
];

test('cəhdlər: dayandı (uyğunluq) və davam etdi', () => {
  const list = Agents.attempts(EVENTS);
  assert.equal(list.length, 2);
  assert.equal(list[0].status, 'dayandı');
  assert.equal(list[0].failedAt, 'Uyğunluq eksperti');
  assert.equal(list[1].status, 'davam etdi və tamamlandı');
  assert.equal(list[1].resumed, true);
});

test('zaman xətti: uyğunluq qrupları ayrı alt-sətirlərdir və paralel görünür', () => {
  const line = Agents.timeline(EVENTS, 1);
  const groups = line.rows.filter((r) => r.level === 1);
  assert.deepEqual(groups.map((r) => r.label).sort(), ['5. Bazar', '9. SWOT']);
  const lefts = groups.map((r) => r.bars[0].left);
  assert.equal(lefts[0], lefts[1], 'iki qrup eyni anda başlayıb');
  assert.ok(line.rows.every((r) => r.bars.every((b) => b.left >= 0 && b.left + b.width <= 1.0001)));
});

test('2-ci cəhddə maliyyə sətri boşdur (yenidən işləməyib)', () => {
  const line = Agents.timeline(EVENTS, 2);
  const finance = line.rows.find((r) => r.key === 'maliyye');
  assert.equal(finance.empty, true);
  assert.equal(finance.bars.length, 0);
});

test('xülasə: LLM, alət, alət xətası', () => {
  const s = Agents.stats(EVENTS);
  assert.equal(s.llm, 1);
  assert.equal(s.tools, 4);
  assert.equal(s.toolErrors, 1);
  assert.equal(s.attempts, 2);
});

test('təsvir və müddət', () => {
  assert.equal(Agents.describe(EVENTS[1]), 'list_tables() → 34 cədvəl');
  assert.equal(Agents.seconds(1530), '1,5 s');
  assert.equal(Agents.seconds(40), '40 ms');
});

test('qrupun nəticə nişanı batch-in sonunda yox, qrupun öz bitmə anındadır', () => {
  const events = [
    ev(1, 1, 100, 'uygunluq', 'llm', 'LLM', { grp: 'a|A', duration_ms: 1000 }),   // 100..101
    ev(2, 1, 100, 'uygunluq', 'llm', 'LLM', { grp: 'b|B', duration_ms: 5000 }),   // 100..105
    ev(3, 1, 105, 'uygunluq', 'result', 'nəticə hazır', { grp: 'a|A' }),
    ev(4, 1, 105, 'uygunluq', 'result', 'nəticə hazır', { grp: 'b|B' }),
  ];
  const rows = Agents.timeline(events, 1).rows.filter((r) => r.level === 1);
  const marker = (label) => rows.find((r) => r.label === label).bars.find((b) => b.event.kind === 'result');
  assert.ok(Math.abs(marker('A').left - 0.2) < 1e-9, 'A 101-də bitib (5 saniyənin 1/5-i)');
  assert.ok(Math.abs(marker('B').left - 1) < 1e-9);
});
