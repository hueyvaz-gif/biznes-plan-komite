// Yoxlama gedişatı modeli (Faza 9): mərhələlər, qruplar, canlı lent, vaxt, xəta mətni.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, clock, duration, elapsedSeconds, etaText, feedItems, groupStates, humanError, lastAttempt, stageStates } from '../../static/run-model.js';

const STEPS = ['ingest', 'load_previous', 'finance', 'compliance', 'decide_status', 'compare_previous', 'write_summary', 'save'].map((id) => ({ id }));
const GROUPS = [{ id: 'xulase', title: '1. Xülasə', items: 1 }, { id: 'tesvir', title: '3. Təsvir', items: 7 }];

test('mərhələlər serverin current_step-inə görə; xəta olduğu mərhələdə', () => {
  assert.equal(STAGES.length, 5);
  assert.deepEqual(stageStates({ run_state: 'isleyir', current_step: 'finance' }, STEPS), ['done', 'active', 'todo', 'todo', 'todo']);
  assert.deepEqual(stageStates({ run_state: 'isleyir', current_step: 'compare_previous' }, STEPS), ['done', 'done', 'done', 'active', 'todo']);
  assert.deepEqual(stageStates({ run_state: 'xeta', current_step: 'compliance' }, STEPS), ['done', 'done', 'error', 'todo', 'todo']);
  assert.deepEqual(stageStates({ run_state: 'tamamlandi', current_step: null }, STEPS), ['done', 'done', 'done', 'done', 'done']);
  // Hələ addım yoxdur (növbədə) — birinci mərhələ aktiv görünür
  assert.deepEqual(stageStates({ run_state: 'gozleyir', current_step: null }, STEPS), ['active', 'todo', 'todo', 'todo', 'todo']);
});

test('yalnız son cəhdin hadisələri', () => {
  const ev = [{ attempt: 1, ts: 1 }, { attempt: 2, ts: 5 }, { attempt: 2, ts: 6 }];
  assert.deepEqual(lastAttempt(ev).map((e) => e.ts), [5, 6]);
});

test('qruplar: alət çağırışı → active, nəticə → done; uyğunluq bitəndə hamısı done', () => {
  const ev = [
    { attempt: 1, ts: 10, agent: 'uygunluq', grp: 'xulase|1. Xülasə', kind: 'tool', status: 'ok' },
    { attempt: 1, ts: 11, agent: 'uygunluq', grp: 'xulase|1. Xülasə', kind: 'result', status: 'ok', summary: '1 bənd' },
    { attempt: 1, ts: 12, agent: 'uygunluq', grp: 'tesvir|3. Təsvir', kind: 'llm', status: 'ok' },
  ];
  const running = { run_state: 'isleyir', current_step: 'compliance', result: { finance: {} } };
  assert.deepEqual(groupStates(GROUPS, ev, running).map((g) => g.state), ['done', 'active']);
  const done = { ...running, result: { finance: {}, compliance: { items: [] } } };
  assert.deepEqual(groupStates(GROUPS, ev, done).map((g) => g.state), ['done', 'done']);
});

test('canlı lent: maliyyə tapıntıları, qrup nəticələri, tələb problemləri; sıra sabitdir', () => {
  const seen = new Map();
  const ev = [{ attempt: 1, ts: 11, agent: 'uygunluq', grp: 'xulase|1. Xülasə', kind: 'result', status: 'ok', summary: '1 bənd qiymətləndirildi' }];
  const check = { result: { finance: { checks: [
    { id: 'inv', title: 'İnvestisiyanın cəmi', status: 'ok' },
    { id: 'npv', title: 'Xalis cari dəyər (NPV)', status: 'warn' },
    { id: 'x', title: 'Yoxlanılmayan', status: 'skip' },
  ] } } };
  const first = feedItems(check, ev, { groups: GROUPS, seen });
  assert.deepEqual(first.map((i) => [i.tone, i.text]), [
    ['ok', 'İnvestisiyanın cəmi uyğundur'], ['warn', 'Xalis cari dəyər (NPV): kiçik fərq var'], ['ok', '1. Xülasə — yoxlanıldı'],
  ]);
  check.result.compliance = { items: [
    { req_id: 'TS2', status: 'natamam', text: 'Rekvizitlər' }, { req_id: 'TS3', status: 'var' },
    { req_id: 'TS4', status: 'yoxdur', text: 'Paylar' }, { req_id: 'E1', status: 'yoxdur', origin: 'elave' },
  ] };
  const second = feedItems(check, ev, { groups: GROUPS, seen, requirements: { TS2: { topic: 'Şirkətin rekvizitləri' } } });
  // Əvvəlki elementlər yerindədir, yenilər sonda; əlavə tələb lentə düşmür
  assert.deepEqual(second.slice(0, 3).map((i) => i.key), first.map((i) => i.key));
  assert.deepEqual(second.slice(3).map((i) => [i.tone, i.text]), [
    ['warn', 'TS2: şirkətin rekvizitləri natamamdır'], ['fail', 'TS4: paylar cavabsızdır'],
  ]);
  const many = { result: { compliance: { items: Array.from({ length: 15 }, (_, i) => ({ req_id: 'R' + i, status: 'natamam', text: 'X' })) } } };
  const capped = feedItems(many, [], { maxProblems: 12 });
  assert.equal(capped.length, 13);
  assert.equal(capped.at(-1).text, 'Daha 3 tələb üzrə qeyd — hesabatda');
});

test('vaxt: keçən vaxt son cəhddən; təxmini qalan vaxt yalnız median varsa', () => {
  assert.equal(elapsedSeconds([{ attempt: 1, ts: 100 }, { attempt: 2, ts: 500 }], 560, 0), 60);
  assert.equal(elapsedSeconds([], 560, 540), 20);
  assert.equal(etaText(null, 30), null);
  assert.equal(etaText(100, 20), 'Təxminən 1 dəq 20 san qalıb');
  assert.equal(etaText(100, 90), 'Az qalıb');
  assert.equal(etaText(100, 140), 'Adi haldan uzun çəkir — server işləyir');
  assert.equal(duration(42), '40 san');
  assert.equal(duration(120), '2 dəq');
  assert.equal(clock(65), '1:05');
});

test('xəta mətni insan dilində; texniki mətn ayrıca qalır', () => {
  const credit = humanError("APIStatusError: Error code: 400 - {'message': 'Your credit balance is too low to access the Anthropic API.'}");
  assert.equal(credit.reason, 'Model xidmətinin balansı bitib');
  assert.match(credit.technical, /credit balance/);
  assert.equal(humanError('RateLimitError: Error code: 429').reason, 'Model xidməti hazırda çox sorğu alır');
  assert.equal(humanError('APITimeoutError: Request timed out.').reason, 'Model xidməti vaxtında cavab vermədi');
  assert.equal(humanError('AuthenticationError: invalid x-api-key').reason, 'Model xidmətinin açarı etibarsızdır');
  assert.equal(humanError('KeyError: foo').reason, 'Gözlənilməz xəta baş verdi');
});
