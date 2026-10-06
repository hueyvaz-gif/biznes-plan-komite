// İqtisadi təhlilin göstərmə məntiqi (static/econ-core.js) — node --test tests/js/econ.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const C = require(path.join(__dirname, '..', '..', 'static', 'econ-core.js'));

const F = (status, severity, extra) => ({ id: status + (severity || ''), status, severity: severity || null, ...extra });
const fmtDate = (iso) => 'T(' + iso + ')';
const fmtAz = (v, d) => Number(v).toFixed(d);

test('status nişanı mətnlə: bayraq ciddiliyi, aydınlıq sualı, tətbiq edilmir', () => {
  assert.deepEqual(C.findingBadge(F('flag', 'yuksek')), { cls: 's-fail', label: 'Bayraq · yüksək' });
  assert.deepEqual(C.findingBadge(F('flag', 'orta')), { cls: 's-warn', label: 'Bayraq · orta' });
  assert.equal(C.findingBadge(F('info', null, { question: 'Sual?' })).label, 'Aydınlıq sualı');
  assert.equal(C.findingBadge(F('info')).label, 'Məlumat');
  assert.equal(C.findingBadge(F('na')).label, 'Tətbiq edilmir');
  assert.equal(C.findingBadge(F('skip')).label, 'Yoxlanıla bilmədi');
  assert.equal(C.findingBadge(F('ok')).cls, 's-ok');
  assert.deepEqual(['yuksek', 'orta', 'asagi', null].map(C.severityCls), ['s-fail', 's-warn', 's-skip', 's-skip']);
});

test('sıralama: bayraqlar ciddiliyə görə əvvəl, sonra məlumat, uyğun, tətbiq edilmir, yoxlanılmayan', () => {
  const list = [F('skip'), F('ok'), F('flag', 'asagi'), F('na'), F('info'), F('flag', 'yuksek'), F('flag', 'orta')];
  assert.deepEqual(C.sortFindings(list).map((f) => f.id),
    ['flagyuksek', 'flagorta', 'flagasagi', 'info', 'ok', 'na', 'skip']);
  assert.equal(list[0].id, 'skip');                                   // giriş dəyişmir
});

test('süzgəclər: "Bayraqlar və suallar" sualı olan məlumatı da göstərir; saylar süzgəclə eynidir', () => {
  const list = [F('flag', 'orta'), F('info', null, { question: 'q' }), F('info'), F('ok'), F('skip')];
  assert.deepEqual(C.filterFindings(list, 'flag').map((f) => f.status), ['flag', 'info']);
  assert.equal(C.filterFindings(list, 'hamisi').length, 5);
  assert.equal(C.filterFindings(list, 'naməlum').length, 2);          // naməlum süzgəc → birinci
  const counts = Object.fromEntries(C.findingFilterCounts(list).map((c) => [c.id, c.count]));
  assert.deepEqual(counts, { flag: 2, hamisi: 5, ok: 1, skip: 1 });
  for (const [id, n] of Object.entries(counts)) assert.equal(C.filterFindings(list, id).length, n);
});

test('mənbə mətni: sənəd (qısa cədvəl adı), kodun hesabı, benchmark (məzənnə ilə), əlavə sənəd', () => {
  assert.equal(C.sourceText({ kind: 'sened', title: 'Cədvəl 7.7. 1 ton məhsulun qiyməti və dəyişən maya dəyəri, manat/ton',
    location: 'T20', quote: 'Orta çəkili | Xammal: 487' }), 'Sənəddə: Cədvəl 7.7 (T20) — “Orta çəkili | Xammal: 487”');
  assert.equal(C.sourceText({ kind: 'sened', title: '8.1. Əsas fərziyyələr', location: 'S36', quote: null }),
    'Sənəddə: 8.1. Əsas fərziyyələr (S36)');
  assert.equal(C.sourceText({ kind: 'hesab', formula: 'a / b' }), 'Kodun hesabı: a / b');
  assert.equal(C.sourceText({ kind: 'benchmark', name: 'M', date: '2026-09',
    converted: { currency: 'USD', rate: 1.7, source: 'AMB', date: '06.10.2026' } }),
  'Benchmark: M, 2026-09 (USD→AZN: 1.7, AMB 06.10.2026)');
  assert.equal(C.sourceText({ kind: 'elave', file_name: 'teklif.pdf', quote: 'Məbləğ: 1' }),
    'Əlavə sənəd: teklif.pdf — “Məbləğ: 1”');
  assert.equal(C.sourceText(null), '');
  assert.equal(C.shortTitle('x'.repeat(80)).length, 60);
  assert.equal(C.shortTitle('Cədvəl Ə.1. Əsas fərziyyələr.'), 'Cədvəl Ə.1');
});

test('göstəricilər: heç nə yoxlanılmayıbsa "0/0" yox, "—"; alt mətn yalnız real saylardan', () => {
  const counts = { daxili: { ok: 10, flag: 5, skip: 0, na: 1 }, realliq: { ok: 0, flag: 0, skip: 12 },
    hessasliq: { negative: 4, total: 5, skip: 0 } };
  const [d, r, h] = C.tiles(counts);
  assert.equal(d.value, '10/15');
  assert.equal(d.sub, '5 bayraq · 1 tətbiq edilmir');
  assert.equal(r.value, '—');
  assert.equal(r.unit, 'yoxlanılmayıb');
  assert.equal(r.sub, '12 yoxlanıla bilməz');
  assert.equal(h.value, '4');
  assert.equal(h.sub, '5 ssenari hesablanıb');
  assert.equal(C.tiles({ ...counts, daxili: { ok: 3, flag: 0, skip: 0, na: 0 } })[0].sub, 'hamısı uyğun');
});

test('Nəticə tabındakı sətir və tab nişanları eyni məlumatdan', () => {
  assert.deepEqual(C.summaryLine(null), { hidden: true });
  assert.deepEqual(C.summaryLine({ state: 'yoxdur' }), { hidden: true });
  assert.equal(C.summaryLine({ state: 'isleyir' }).text, 'hesablanır…');
  assert.equal(C.summaryLine({ state: 'xeta' }).text, 'aparılmadı — yenidən başladın.');
  const d = { state: 'tamamlandi', open_questions: 9,
    result: { risk: { level: 'yuksek' }, findings: [F('flag', 'orta'), F('flag', 'yuksek'), F('ok'), F('info')] } };
  assert.deepEqual(C.summaryLine(d), { hidden: false, text: null, risk: { label: 'yüksək risk', tone: 'fail' }, open: 9 });
  assert.deepEqual(C.tabCounts(d), { flags: 2, open: 9 });
  assert.deepEqual(C.tabCounts(null), { flags: 0, open: 0 });
});

test('sorğu yalnız nəsə hesablananda davam edir', () => {
  assert.equal(C.isBusy({ state: 'isleyir' }), true);
  assert.equal(C.isBusy({ state: 'tamamlandi', evidence: [{ analysis: { state: 'isleyir' } }] }), true);
  assert.equal(C.isBusy({ state: 'tamamlandi', evidence: [{ analysis: { state: 'tamamlandi' } }] }), false);
  assert.equal(C.isBusy(null), false);
});

test('vəziyyət mətni', () => {
  assert.equal(C.stateText({ state: 'tamamlandi', result: { ran_at: 'X' } }, fmtDate), 'Hesablandı: T(X)');
  assert.equal(C.stateText({ state: 'xeta', error: 'E' }, fmtDate), 'İqtisadi təhlil aparılmadı: E');
  assert.equal(C.stateText({ state: 'yoxdur', error: 'Demo' }, fmtDate), 'Demo');
  assert.equal(C.stateText({ state: 'gozleyir' }, fmtDate), 'İqtisadi təhlil hələ aparılmayıb.');
});

test('tornado: yalnız hesablanan ssenarilər, |ΔNPV|-yə görə sıra, ən böyüyü yarım en', () => {
  const rows = C.tornado([
    { status: 'ok', title: 'A', delta: -100, negative: true },
    { status: 'skip', title: 'B' },
    { status: 'ok', title: 'C', delta: 50, negative: false },
    { status: 'ok', title: 'D', delta: -200, negative: true },
  ]);
  assert.deepEqual(rows.map((r) => [r.title, r.direction, r.widthPct]), [['D', 'down', 50], ['A', 'down', 25], ['C', 'up', 12.5]]);
  assert.deepEqual(C.tornado([]), []);
});

test('suallar: süzgəc sayları, boş vəziyyət mətni, sənədin suala bağlanması', () => {
  const qs = [{ id: 'a', status: 'aciq' }, { id: 'b', status: 'aciq' }, { id: 'c', status: 'qebul' }];
  const statuses = { aciq: 'Açıq', qebul: 'Qəbul edildi', redd: 'Rədd edildi' };
  assert.deepEqual(C.questionFilters(qs, statuses).map((f) => [f.id, f.count]),
    [['hamisi', 3], ['aciq', 2], ['qebul', 1], ['redd', 0]]);
  assert.deepEqual(C.filterQuestions(qs, 'aciq').map((q) => q.id), ['a', 'b']);
  assert.equal(C.filterQuestions(qs, 'hamisi').length, 3);
  assert.equal(C.emptyQuestionsText({ state: 'tamamlandi' }, 0), 'Sual yoxdur.');
  assert.equal(C.emptyQuestionsText({ state: 'tamamlandi' }, 3), 'Bu süzgəcdə sual yoxdur.');
  assert.equal(C.emptyQuestionsText(null, 0), 'İqtisadi təhlil aparılmayıb.');
  const ev = [{ id: 1, question_id: 'a' }, { id: 2, doc_type: 'excel_model' }, { id: 3, doc_type: 'bank_arayisi' }];
  assert.deepEqual(C.evidenceFor({ id: 'a' }, 'excel_model', ev).map((e) => e.id), [1, 2]);
});

test('"Ayrıca təqdim ediləcək sənədlər": gözlənilir / ✓ və yoxlamanın nəticəsi', () => {
  assert.deepEqual(C.docRequirementStatus([], 'LT3'), { ok: false, text: 'Gözlənilir' });
  const ev = (analysis) => [{ req_code: 'LT3', file_name: 'plan.png', analysis }];
  assert.equal(C.docRequirementStatus(ev({ state: 'isleyir' }), 'LT3').text, '✓ plan.png (yoxlanılır)');
  assert.equal(C.docRequirementStatus(ev({ error: 'x' }), 'LT3').text, '✓ plan.png (yoxlanılmadı)');
  assert.equal(C.docRequirementStatus(ev({ checks: [{ status: 'flag' }] }), 'LT3').text, '✓ plan.png (fərq var)');
  assert.equal(C.docRequirementStatus(ev({ kind: 'sekil' }), 'LT3').text, '✓ plan.png (yoxlandı)');
  assert.equal(C.docRequirementStatus(ev({}), 'LT4').ok, false);
});

test('sənəd analizinin nişanları və Excel xülasəsi', () => {
  assert.deepEqual(C.excelBadge({ status: 'fail' }), { cls: 's-fail', label: 'Fərq' });
  assert.deepEqual(C.excelBadge({ status: 'warn' }), { cls: 's-warn', label: 'Kiçik fərq' });
  assert.equal(C.excelBadge({ status: 'skip', note: 'modeldə tapılmadı' }).label, 'modeldə tapılmadı');
  assert.equal(C.checkBadge({ status: 'info' }).label, 'Qeyd');
  assert.equal(C.excelMeta({ hardcode_pct: 88.9, formula_cells: 1, error_count: 1 }, fmtAz),
    'sabit (hardcode) xanalar: 89% · 1 düstur · 1 xəta xanası');
  assert.equal(C.excelMeta({ hardcode_pct: null, formula_cells: 0, error_count: 0 }, fmtAz), '0 düstur');
});

test('"əvvəl/sonra" tarixçəsi: yükləmə, silmə, dəyişiklik yoxdursa', () => {
  const up = C.historyEntry({ at: 'A', trigger: { file_name: 'm.xlsx' }, risk_before: 'orta', risk_after: 'yuksek',
    changes: [{ title: 'Excel', before: null, after: { status: 'flag', severity: 'orta' } },
      { title: 'Gəlir', before: { status: 'ok' }, after: null }] }, fmtDate);
  assert.equal(up.head, 'T(A) — yükləndi: m.xlsx · risk: orta → yüksək');
  assert.deepEqual(up.lines, ['Excel: yox idi → bayraq (orta)', 'Gəlir: uyğun → çıxarıldı']);
  const del = C.historyEntry({ at: 'B', trigger: { kind: 'sened_silindi', file_name: 'm.xlsx' }, changes: [] }, fmtDate);
  assert.equal(del.head, 'T(B) — silindi: m.xlsx · risk: — → —');
  assert.deepEqual(del.lines, ['Tapıntılar dəyişmədi.']);
  assert.equal(C.historyEntry({ at: 'C', trigger: { kind: 'test' } }, fmtDate).head, 'T(C) — yenidən hesab · risk: — → —');
  assert.equal(C.statusWord({ status: 'na' }), 'tətbiq edilmir');
});

test('DOM id təhlükəsizdir', () => {
  assert.equal(C.domId('q-', 'c1b49c3a9ba6:hessasliq'), 'q-c1b49c3a9ba6-hessasliq');
  assert.equal(C.domId('ef-', 'realliq:qaz_tarifi'), 'ef-realliq-qaz_tarifi');
});

test('cavab forması: sənəd tələb olunmayan sualda "Yazılı cavab"; sualsız tapıntıda heç nə', () => {
  assert.equal(C.answerForm({ question: 'Diskont?', documents: [] }), 'yazili');
  assert.equal(C.answerForm({ question: 'Güzəşt?', documents: ['guzest_senedi'] }), 'sened');
  assert.equal(C.answerForm({ question: null, documents: [] }), null);
  assert.equal(C.answerForm({ text: 'Komitənin sualı', documents: [] }), 'yazili');           // sual obyekti
  assert.equal(C.answerForm({ text: 'Sual', documents: ['excel_model'] }), 'sened');
  assert.equal(C.WRITTEN_ANSWER, 'Yazılı cavab — sənəd tələb olunmur');
});

test('həssaslıq bloku: maketdəki başlıq, alt cümlə, mln formatı və sıfır həddi', () => {
  const sens = { base: { npv: 1944880, irr: 11.78 }, scenarios: [
    { id: 'price_-10', status: 'ok', npv: -18877735, delta: -20822615, irr: null, negative: true, threshold: { value: -0.934, kind: 'change' } },
    { id: 'raw_+10', status: 'ok', npv: -13017331, delta: -14962212, irr: 3.1, negative: true, threshold: { value: 1.2999, kind: 'change' } },
    { id: 'capex_+15', status: 'ok', npv: -267160, delta: -2212041, irr: 9.8, negative: true, threshold: { value: 13.19, kind: 'change' } },
    { id: 'delay_1y', status: 'ok', npv: 427443, delta: -1517438, irr: 10.3, negative: false, threshold: null },
    { id: 'capacity_80', status: 'ok', npv: -2302602, delta: -4247483, irr: 7.8, negative: true, threshold: { value: 88.4, kind: 'level' } },
  ] };
  const v = C.sensitivityView(sens, { status: 'flag', severity: 'yuksek' });
  assert.deepEqual(v.badge, { label: 'Yüksək risk · Həssaslıq', tone: 'fail' });
  assert.equal(v.title, 'Layihə qiymət və xammal dəyişikliyinə çox həssasdır');
  assert.equal(v.subtitle, 'Satış qiyməti cəmi 0,9% düşsə və ya xammal 1,3% bahalaşsa, NPV sıfıra enir.');
  assert.deepEqual(v.rows.map((r) => [r.title, r.npv, r.delta, r.irr, r.threshold]), [
    ['Baza', '1,94 mln', '—', '11,8%', '—'],
    ['Satış qiyməti −10%', '−18,88 mln', '−20,82 mln', '—', '−0,9%'],
    ['Xammal +10%', '−13,02 mln', '−14,96 mln', '3,1%', '+1,3%'],
    ['Gücdən istifadə 80%', '−2,30 mln', '−4,25 mln', '7,8%', '~88%'],
    ['Capex +15%', '−0,27 mln', '−2,21 mln', '9,8%', '+13%'],
    ['1 il gecikmə', '0,43 mln', '−1,52 mln', '10,3%', '—'],
  ]);
});

test('həssaslıq başlığı: həssas amil yoxdursa, mənfi ssenari yoxdursa, baza mənfidirsə; nişan', () => {
  const s = (id, npv, threshold) => ({ id, status: 'ok', npv, delta: npv - 100, negative: npv < 0, threshold });
  assert.equal(C.sensitivityView({ base: { npv: 100 }, scenarios: [s('capex_+15', -5, { value: 9, kind: 'change' })] }).title,
    'Layihə bəzi ssenarilərdə NPV-ni itirir');
  assert.equal(C.sensitivityView({ base: { npv: 100 }, scenarios: [s('capex_+15', 5, { value: 30, kind: 'change' })] }).title,
    'Layihə yoxlanılan ssenarilərdə müsbət NPV saxlayır');
  assert.equal(C.sensitivityView({ base: { npv: -5 }, scenarios: [] }).title, 'Baza ssenaridə NPV artıq mənfidir');
  const one = C.sensitivityView({ base: { npv: 100 }, scenarios: [s('raw_+10', -5, { value: 2.04, kind: 'change' })] });
  assert.equal(one.subtitle, 'Xammal cəmi 2,0% bahalaşsa, NPV sıfıra enir.');
  assert.deepEqual(C.sensitivityBadge({ status: 'flag', severity: 'orta' }), { label: 'Orta risk · Həssaslıq', tone: 'warn' });
  assert.equal(C.sensitivityBadge({ status: 'ok' }).tone, 'ok');
  assert.equal(C.sensitivityBadge(null), null);
  assert.equal(C.mln(1234567, true), '+1,23 mln');
  assert.equal(C.thresholdText(null), '—');
  assert.equal(C.thresholdText({ value: -12.4, kind: 'change' }), '−12%');
});

test('needsAction: tab nişanı və "Bayraqlar və suallar" eyni say; xülasə tapıntısı sayılmır', () => {
  const list = [F('flag', 'yuksek', { summary: true }), F('flag', 'orta'), F('info', 'asagi', { question: 'S?' }), F('info', 'asagi'), F('ok')];
  const d = { result: { findings: list }, open_questions: 0 };
  const chip = C.findingFilterCounts(list).find((x) => x.id === 'flag').count;
  assert.equal(C.tabCounts(d).flags, 2);
  assert.equal(chip, 2);
  assert.equal(C.filterFindings(list, 'flag').some((f) => f.summary), false);
});
