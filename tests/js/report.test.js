// Hesabatın məzmunu (qısa nəticə, düzəliş siyahısı, saylar) — node --test tests/js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const R = require(path.join(__dirname, '..', '..', 'static', 'report.js'));

const fmt = { value: (_c, v) => String(v), money: (v) => v + ' manat' };
const META = {
  requirements: {
    TS2: { topic: 'Şirkətin rekvizitləri', action: 'Şirkətin VÖEN-ini, hüquqi ünvanını və təsis tarixini əlavə edin.' },
    IP2: { topic: 'Kredit və ödəniş qrafiki', action: 'Kreditin mənbəyini və ödəniş qrafikini əlavə edin.' },
    LT2: { topic: 'HS (XİF MN) kodları', action: 'HS kodlarını əlavə edin.' },
    SW1: { topic: 'SWOT təhlili', action: 'SWOT təhlili əlavə edin.' },
  },
};
const sec = (title) => ({ id: 'S1', title, table_id: null });

test('saylar: hamısı yalnız hər bənd cavablandırılıb və ya tətbiq edilmir olanda tamdır', () => {
  const c = R.reqCounts([{ status: 'var' }, { status: 'tetbiq_edilmir' }, { status: 'sened' }]);
  assert.deepEqual([c.total, c.evaluated, c.answered, c.notApplicable, c.document, c.notChecked], [3, 2, 1, 1, 1, 0]);
  assert.equal(c.complete, false);                                   // ayrıca sənəd yoxlanılmayıb
  assert.equal(R.reqCounts([{ status: 'var' }, { status: 'tetbiq_edilmir' }]).complete, true);
});

test('versiya ziddiyyəti: sübutlu saxlanan status əsasdır, tarixçə yalnız detalda', () => {
  const resolved = R.resolveCarried({ status: 'var', quote: 'SWOT cədvəli', carried_from: { version: 1, status_now: 'natamam' } });
  assert.equal(resolved.status, 'var');
  assert.equal(resolved.conflict.resolved, true);
  const open = R.resolveCarried({ status: 'natamam', quote: null, carried_from: { version: 1, status_now: 'var' } });
  assert.equal(open.status, 'natamam');
  assert.equal(open.conflict.resolved, false);
  assert.equal(R.resolveCarried({ status: 'var' }).conflict, null);
});

test('həll olunmuş ziddiyyət düzəliş yaratmır, həll olunmamış — bir "dəqiqləşdirin" bəndi', () => {
  const result = { compliance: { items: [
    { req_id: 'LT2', status: 'var', quote: 'q', sections: [sec('3.2')], carried_from: { version: 1, status_now: 'natamam' } },
    { req_id: 'SW1', status: 'natamam', quote: null, missing: 'Qismən.', sections: [sec('9.1')],
      carried_from: { version: 1, status_now: 'var' } },
  ] } };
  const { fixes } = R.buildReport(result, META, fmt);
  assert.deepEqual(fixes.map((f) => f.code), ['SW1']);
  assert.ok(fixes.every((f) => !/modelin yeni/i.test(f.missing + f.action)));
});

test('eyni çatışmazlıq: natamam tələb və boş yer BİR düzəlişdir', () => {
  const result = {
    compliance: { items: [{ req_id: 'TS2', status: 'natamam', missing: 'VÖEN, hüquqi ünvan doldurulmayıb [MƏLUMAT LAZIMDIR].',
      text: 'Təsis tarixi, VÖEN və hüquqi ünvan göstərilib.', sections: [sec('2. Təşəbbüskar')] }] },
    ingest: { placeholders: [
      { text: '[MƏLUMAT LAZIMDIR: VÖEN, hüquqi ünvan, qeydiyyat tarixi]', section_title: '2. Təşəbbüskar' },
      { text: '[MƏLUMAT LAZIMDIR: yataqxananın yer sayı]', section_title: '6. Təşkilati plan' },
    ] },
  };
  const { fixes } = R.buildReport(result, META, fmt);
  assert.equal(fixes.length, 2);
  const ts2 = fixes.find((f) => f.code === 'TS2');
  assert.equal(ts2.topic, 'Şirkətin rekvizitləri');
  assert.equal(ts2.action, 'Plana əlavə edin: VÖEN, hüquqi ünvan.');       // tövsiyə tapıntıdan qurulur
  assert.deepEqual(ts2.holes, [0]);                                          // kart hansı boş yeri birləşdirdiyini bilir
  assert.equal(ts2.missing, 'VÖEN, hüquqi ünvan doldurulmayıb.');           // xam qeyd çıxarılıb
  assert.match(ts2.related[0].text, /VÖEN, hüquqi ünvan, qeydiyyat tarixi/);
  const other = fixes.find((f) => f.kind === 'bosyer');
  assert.match(other.missing, /yataqxananın yer sayı/);
  assert.ok(!/\[/.test(other.missing));
  assert.equal(other.action, 'Plana əlavə edin: yataqxananın yer sayı.');   // "real məlumatı yazın" yox
  assert.deepEqual(other.holes, [1]);
});

test('tətbiq edilməyən tələb düzəliş deyil; ayrıca sənəd və texniki boşluq ayrıca qeyd olunur', () => {
  const result = { compliance: { items: [
    { req_id: 'IP2', status: 'tetbiq_edilmir', quote: 'Bank krediti cəlb edilmir', condition: { text: 'Kredit varsa' } },
    { req_id: 'LT3', status: 'sened', text: 'Excel' },
    { req_id: 'YI1', status: 'skip', technical: true, group_title: '4. Yer' },
  ] } };
  const r = R.buildReport(result, META, fmt);
  assert.equal(r.fixes.length, 0);
  assert.deepEqual(r.notApplicable.map((n) => [n.code, n.quote]), [['IP2', 'Bank krediti cəlb edilmir']]);
  assert.deepEqual(r.documents.map((d) => d.code), ['LT3']);
  assert.deepEqual(r.unchecked.map((u) => u.code), ['YI1']);
});

test('maliyyə: dəqiqləşdirmə tapıntı və tapşırıq kimi ayrılır; kritik uyğunsuzluq birinci gəlir', () => {
  const result = {
    finance: { checks: [
      { id: 'menbeler_cemi', title: 'Maliyyələşmə mənbələrinin cəmi', status: 'warn', critical: true, claimed: 1, computed: 2,
        clarify: '“Başlanğıc” sütununun cəmi investisiyaya bərabərdir. İnvestisiyanı hansı məbləğin maliyyələşdirdiyini dəqiqləşdirin.' },
      { id: 'npv', title: 'NPV', status: 'fail', critical: true, claimed: 100, computed: 90 },
      { id: 'irr', title: 'IRR', status: 'ok', critical: true },
    ], not_found: [] },
  };
  const { fixes } = R.buildReport(result, META, fmt);
  assert.deepEqual(fixes.map((f) => [f.ref.id, f.severity]), [['npv', 'kritik'], ['menbeler_cemi', 'deqiqlesdir']]);
  assert.equal(fixes[0].missing, 'Planda 100, yenidən hesablanmış dəyər 90.');
  assert.equal(fixes[1].action, 'İnvestisiyanı hansı məbləğin maliyyələşdirdiyini dəqiqləşdirin.');
  assert.deepEqual(R.financeRows(result).map((r) => r.label), ['Dəqiqləşdirmə', 'Uyğunsuz', 'Uyğun']);
});

test('nəticə bloku: rəqəmlər siyahı ilə eyni mənbədən; model mətni istifadə olunmur', () => {
  const result = {
    summary: { headline: 'MODEL', key_findings: ['MODEL TAPINTISI'], open_questions: ['Təqdim edilə bilərmi?'] },
    finance: { checks: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'warn'].map((st, i) => ({ id: 'c' + i, title: 'C' + i, status: st,
      clarify: st === 'warn' ? 'Fərq var. Dəqiqləşdirin.' : null })) },
    compliance: { items: [
      ...Array.from({ length: 34 }, (_, i) => ({ req_id: 'A' + i, status: 'var' })),
      ...Array.from({ length: 9 }, (_, i) => ({ req_id: 'B' + i, status: 'natamam', missing: 'x', text: 'Mövzu ' + i,
        sections: [sec('B' + i)] })),
      { req_id: 'IP2', status: 'tetbiq_edilmir' },
      ...Array.from({ length: 3 }, (_, i) => ({ req_id: 'D' + i, status: 'sened' })),
    ] },
    ingest: { placeholders: [{ text: '[MƏLUMAT LAZIMDIR: yataqxana]', section_title: 'Z' }] },
    reasons: { verdict: 'duzelis', reasons: [{ code: 'teleb_natamam', severity: 'duzelis', text: 'Tələb qismən cavablanıb', items: [] }] },
  };
  const report = R.buildReport(result, META, fmt);
  const o = R.buildOverview({ verdict: 'duzelis' }, result, report, 'Düzəliş lazımdır');
  const cards = report.fixes;
  const n = (sev) => cards.filter((f) => f.severity === sev).length;
  assert.equal(o.headline, 'Düzəliş lazımdır — ' + (n('kritik') + n('duzelis')) + ' düzəliş, ' + n('deqiqlesdir') + ' dəqiqləşdirmə');
  assert.equal(o.headline, 'Düzəliş lazımdır — 10 düzəliş, 1 dəqiqləşdirmə');
  assert.equal(o.blocking.critical, false);
  const tile = Object.fromEntries(o.tiles.map((t) => [t.id, t]));
  assert.equal(tile.maliyye.value, '6/7');
  assert.equal(tile.maliyye.sub, '1 dəqiqləşdirmə');
  assert.equal(tile.teleb.value, '34/44');
  assert.equal(tile.teleb.sub, '9 natamam · 1 tətbiq edilmir · 3 ayrıca sənəd');
  assert.match(tile.teleb.hint, /^47 standart tələb: 44-i/);               // 44 və 47 açıq izah olunur
  assert.equal(tile.bosyer.value, '1');
  assert.equal(tile.bosyer.sub, '1-i ayrıca kartda');
  assert.deepEqual(o.top.map((t) => t.anchor), cards.slice(0, 3).map((f) => f.anchor));
  assert.match(o.composition, /9 tələb bəndi → 9 kart/);
  const all = JSON.stringify(o);
  assert.ok(!/MODEL|bilərmi|əsasən/.test(all));
});

test('bloklayan problem statusu müəyyən edən qaydanın öz səbəblərindən gəlir', () => {
  const result = { reasons: { reasons: [{ severity: 'kritik', text: 'Tələb planda ümumiyyətlə cavablanmayıb', items: ['SW1'] }] } };
  const o = R.buildOverview({ verdict: 'hazir_deyil' }, result, { fixes: [] }, 'Hazır deyil');
  assert.equal(o.blocking.critical, true);
  assert.match(o.blocking.text, /tələb planda ümumiyyətlə cavablanmayıb \(SW1\)/);
});

test('eyni cədvələ aid, mövzusu üst-üstə düşən tələblər bir kartdadır; fərqli mövzu ayrı qalır', () => {
  const t35 = [{ id: 'S12', title: '3.5. Avadanlıqlar', table_id: 'T8' }];
  const meta = { requirements: {
    LT6: { topic: 'Avadanlıq və təchizatçılar', action: 'Şablon A.' },
    IP6: { topic: 'Avadanlıq siyahısı', action: 'Şablon B.' },
    YI3: { topic: 'İnfrastrukturun təmin olunması', action: 'Şablon C.' },
  } };
  const result = { compliance: { items: [
    { req_id: 'LT6', status: 'natamam', text: 'a', missing: 'Təchizatçı şirkətin adı göstərilməyib.', sections: t35 },
    { req_id: 'IP6', status: 'natamam', text: 'b', missing: 'Adlar var, lakin marka adları göstərilməyib.', sections: t35 },
    { req_id: 'YI3', status: 'natamam', text: 'c', missing: 'Qoşulma şərtləri göstərilməyib.', sections: t35 },
  ] } };
  const { fixes } = R.buildReport(result, meta, fmt);
  assert.deepEqual(fixes.map((f) => f.codes.map((c) => c.code)), [['LT6', 'IP6'], ['YI3']]);
  assert.equal(fixes[0].action, 'Plana əlavə edin: təchizatçı şirkətin adı; marka adları.');
  assert.match(fixes[0].codes[1].title, /^IP6 — Avadanlıq siyahısı/);
});

test('çatışmazlıq tapşırıq kimi yox, çatışmazlıq kimi; tapıntıda sahə yoxdursa şablon', () => {
  assert.equal(R.asShortfall('Niyyət məktublarının CFG adına yenilənməsi.'), 'Niyyət məktubları CFG adına yenilənməyib.');
  assert.equal(R.asShortfall('Sahə boş qalıb.'), 'Sahə boş qalıb.');
  assert.equal(R.actionFor('Niyyət məktublarının CFG adına yenilənməsi.', 'Şablon.'),
    'Niyyət məktublarının CFG adına yenilənməsini təmin edin.');
  assert.equal(R.actionFor('Ofis binasının sahəsi boş qalıb.', 'Şablon.'), 'Plana əlavə edin: ofis binasının sahəsi.');
  assert.equal(R.actionFor('Müstəqil bazar araşdırması tələb olunur.', 'Şablon.'), 'Şablon.');
});

test('rəqəmdən sonra şəkilçi oxunuşa uyğundur', () => {
  assert.deepEqual([1, 2, 3, 6, 9, 10, 20, 40, 60, 100].map(R.poss),
    ['1-i', '2-si', '3-ü', '6-sı', '9-u', '10-u', '20-si', '40-ı', '60-ı', '100-ü']);
  assert.deepEqual([1, 6, 9, 10, 20].map(R.loc), ['1-də', '6-da', '9-da', '10-da', '20-də']);
});

test('xam boş yer qeydi oxunaqlı olur', () => {
  assert.deepEqual(R.placeholderText('[MƏLUMAT LAZIMDIR: təchizatçının adı]'), { what: 'təchizatçının adı', kind: 'melumat' });
  assert.equal(R.placeholderText('[yenilənməli]').kind, 'yenile');
  assert.equal(R.cleanMissing('Sahə [MƏLUMAT LAZIMDIR: sahə] kimi boş qalıb — 4.3-də də qeyd olunur ki, bu [MƏLUMAT LAZIMDIR].'),
    'Sahə boş qalıb.');
});
