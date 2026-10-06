/* İqtisadi təhlilin göstərmə məntiqi — DOM-suz, təmiz funksiyalar (static/economics.js işlədir).
 *
 * Heç nə hesablamır: serverin qayda nəticəsini mətnə, sıraya və süzgəcə çevirir.
 * Brauzerdə `window.EconCore`, Node-da `module.exports` (testlər: tests/js/econ.test.js).
 */
(function (root) {
  'use strict';

  const RISK = {
    asagi: { label: 'aşağı', tone: 'ok' }, orta: { label: 'orta', tone: 'warn' }, yuksek: { label: 'yüksək', tone: 'fail' },
  };
  const SEVERITY = { yuksek: 'yüksək', orta: 'orta', asagi: 'aşağı' };
  const ORDER = { flag: 0, info: 1, ok: 2, na: 3, skip: 4 };
  const SEV_ORDER = { yuksek: 0, orta: 1, asagi: 2 };
  const GROUP = { daxili: 'Daxili uyğunluq', realliq: 'Reallıq', hessasliq: 'Həssaslıq', sened: 'Əlavə sənəd' };
  const KIND = { excel: 'Excel', pdf: 'PDF', docx: 'DOCX', sekil: 'Şəkil' };
  const STATUS_WORD = { ok: 'uyğun', skip: 'yoxlanılmadı', info: 'məlumat', na: 'tətbiq edilmir' };

  /** Tapıntının nişanı — status MƏTNLƏ (yalnız rəng deyil). */
  function findingBadge(f) {
    if (f.status === 'flag') return { cls: f.severity === 'yuksek' ? 's-fail' : 's-warn', label: 'Bayraq · ' + (SEVERITY[f.severity] || '') };
    if (f.status === 'ok') return { cls: 's-ok', label: 'Uyğun' };
    if (f.status === 'info') return { cls: 's-skip', label: f.question ? 'Aydınlıq sualı' : 'Məlumat' };
    if (f.status === 'na') return { cls: 's-skip', label: 'Tətbiq edilmir' };
    return { cls: 's-skip', label: 'Yoxlanıla bilmədi' };
  }

  function severityCls(severity) {
    return severity === 'yuksek' ? 's-fail' : severity === 'orta' ? 's-warn' : 's-skip';
  }

  /** Bayraqlar əvvəl (ciddiliyə görə), sonra məlumat, uyğun, tətbiq edilmir, yoxlanılmayan. */
  function sortFindings(list) {
    const sev = (s) => (s in SEV_ORDER ? SEV_ORDER[s] : 3);
    return (list || []).slice().sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (sev(a.severity) - sev(b.severity)));
  }

  /** Diqqət tələb edən tapıntı — tab nişanı və "Bayraqlar və suallar" EYNİ qaydanı işlədir.
   *  Ümumi həssaslıq tapıntısı (summary) xülasədir: sayılmır, ssenarilərin hər biri ayrıca sayılır. */
  function needsAction(f) {
    return !f.summary && (f.status === 'flag' || (f.status === 'info' && !!f.question));
  }

  const FINDING_FILTERS = [
    { id: 'flag', label: 'Bayraqlar və suallar', test: needsAction },
    { id: 'hamisi', label: 'Hamısı', test: () => true },
    { id: 'ok', label: 'Uyğun', test: (f) => f.status === 'ok' },
    { id: 'skip', label: 'Yoxlanıla bilmədi', test: (f) => f.status === 'skip' },
  ];

  function filterFindings(list, id) {
    const filter = FINDING_FILTERS.find((f) => f.id === id) || FINDING_FILTERS[0];
    return sortFindings(list).filter(filter.test);
  }

  function findingFilterCounts(list) {
    return FINDING_FILTERS.map((f) => ({ id: f.id, label: f.label, count: (list || []).filter(f.test).length }));
  }

  /** "Cədvəl 7.7. 1 ton məhsulun …" → "Cədvəl 7.7"; uzun bölmə adı qısaldılır. */
  function shortTitle(title) {
    if (!title) return '';
    const m = title.match(/^Cədvəl\s+[\dƏə.]+[a-z]?/i);
    if (m) return m[0].replace(/\.$/, '');
    return title.length > 60 ? title.slice(0, 59) + '…' : title;
  }

  /** Rəqəmin mənbəyi — sənəd (yer + sitat), kodun hesabı, benchmark və ya əlavə sənəd. */
  function sourceText(s) {
    if (!s) return '';
    if (s.kind === 'hesab') return 'Kodun hesabı: ' + s.formula;
    if (s.kind === 'benchmark') {
      const c = s.converted;
      const conv = c ? ' (' + (c.currency || 'USD') + '→AZN: ' + c.rate + ', ' + (c.source || 'AMB') + (c.date ? ' ' + c.date : '') + ')' : '';
      return 'Benchmark: ' + (s.name || '') + ', ' + (s.date || '') + conv;
    }
    if (s.kind === 'elave') return 'Əlavə sənəd: ' + s.file_name + (s.quote ? ' — “' + s.quote + '”' : '');
    const where = [shortTitle(s.title), s.location && '(' + s.location + ')'].filter(Boolean).join(' ');
    return 'Sənəddə: ' + where + (s.quote ? ' — “' + s.quote + '”' : '');
  }

  /** "10/15" — heç nə yoxlanılmayıbsa "—" (0/0 yox). */
  function ratio(g) {
    return g.ok + g.flag ? g.ok + '/' + (g.ok + g.flag) : '—';
  }

  function tiles(counts) {
    const part = (n, text) => (n ? n + ' ' + text : '');
    const d = counts.daxili;
    const r = counts.realliq;
    const h = counts.hessasliq;
    return [
      { title: 'Daxili uyğunluq', value: ratio(d), unit: d.ok + d.flag ? 'uyğun' : '',
        sub: [part(d.flag, 'diqqət tələb edir'), part(d.skip, 'yoxlanıla bilmədi'), part(d.na, 'tətbiq edilmir')].filter(Boolean).join(' · ') || 'hamısı uyğun',
        hint: 'Planın öz rəqəmləri arasında yoxlanılan qaydalar' },
      { title: 'Reallıq', value: ratio(r), unit: r.ok + r.flag ? 'uyğun' : 'yoxlanılmayıb',
        sub: [part(r.flag, 'diapazondan kənar'), part(r.skip, 'yoxlanıla bilməz')].filter(Boolean).join(' · ') || '—',
        hint: 'Benchmark yalnız mənbəsi və tarixi göstərilibsə istifadə olunur' },
      { title: 'Həssaslıq', value: String(h.negative), unit: 'ssenaridə NPV < 0',
        sub: h.total + ' ssenari hesablanıb' + (h.skip ? ' · ' + h.skip + ' yoxlanıla bilmədi' : ''),
        hint: 'Kodun hesabı: dəyişdirilmiş pul axını ilə NPV' },
    ];
  }

  /** Nəticə tabındakı sətir: {hidden, text, risk: {label, tone} | null, open}. */
  function summaryLine(d) {
    if (!d || d.state === 'yoxdur') return { hidden: true };
    if (d.state === 'isleyir') return { hidden: false, text: 'hesablanır…', risk: null };
    if (d.state === 'xeta') return { hidden: false, text: 'aparılmadı — yenidən başladın.', risk: null };
    if (!d.result) return { hidden: false, text: 'aparılmayıb.', risk: null };
    const r = RISK[d.result.risk.level] || RISK.orta;
    return { hidden: false, text: null, risk: { label: r.label + ' risk', tone: r.tone }, open: d.open_questions || 0 };
  }

  function tabCounts(d) {
    return {
      flags: d && d.result ? d.result.findings.filter(needsAction).length : 0,
      open: d ? d.open_questions || 0 : 0,
    };
  }

  /** Hələ nəsə hesablanırmı (təhlil və ya sənədin analizi) — bəli isə sorğu davam edir. */
  function isBusy(d) {
    return !!d && (d.state === 'isleyir' || (d.evidence || []).some((e) => (e.analysis || {}).state === 'isleyir'));
  }

  function stateText(d, formatDate) {
    if (!d || d.state === 'yoxdur') return (d && d.error) || '';
    if (d.state === 'isleyir') return 'Hesablanır — sənəddən yerlər tapılır və qaydalar tətbiq olunur…';
    if (d.state === 'xeta') return 'İqtisadi təhlil aparılmadı: ' + (d.error || '');
    return d.result ? 'Hesablandı: ' + formatDate(d.result.ran_at) : 'İqtisadi təhlil hələ aparılmayıb.';
  }

  /** Tornado: ΔNPV-yə görə azalan sıra; zolağın eni — ən böyük dəyişməyə nisbətən (yarım en = 50%). */
  function tornado(scenarios) {
    const ok = (scenarios || []).filter((s) => s.status === 'ok');
    const max = Math.max(1, ...ok.map((s) => Math.abs(s.delta)));
    return ok.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).map((s) => ({
      id: s.id, title: SCENARIO_SHORT[s.id] || s.title, delta: s.delta, negative: !!s.negative,
      direction: s.delta < 0 ? 'down' : 'up', widthPct: Math.abs(s.delta) / max * 50,
    }));
  }

  /* ── Həssaslıq bloku ───────────────────────────────────────────────── */

  /** Sıfır həddi bu faizdən kiçikdirsə — amil "çox həssas" sayılır (başlıqda adı çəkilir). */
  const SENSITIVE_PCT = 5;
  const SCENARIO_SHORT = {
    'price_-10': 'Satış qiyməti −10%', 'raw_+10': 'Xammal +10%', 'capacity_80': 'Gücdən istifadə 80%',
    'capex_+15': 'Capex +15%', delay_1y: '1 il gecikmə',
  };
  /** Həssas amilin adı və cümləsi ("satış qiyməti cəmi 0,9% düşsə"). */
  const FACTOR = {
    'price_-10': { name: 'qiymət', phrase: (x, only) => 'satış qiyməti ' + (only ? 'cəmi ' : '') + x + ' düşsə' },
    'raw_+10': { name: 'xammal', phrase: (x, only) => 'xammal ' + (only ? 'cəmi ' : '') + x + ' bahalaşsa' },
    'capex_+15': { name: 'investisiya', phrase: (x, only) => 'investisiya ' + (only ? 'cəmi ' : '') + x + ' artsa' },
  };

  function decimal(value, digits) {
    return Math.abs(value).toFixed(digits).replace('.', ',');
  }

  /** "1,94 mln", "−18,88 mln" (minus — tipoqrafik işarə). */
  function mln(value, signed) {
    if (value === null || value === undefined) return '—';
    const sign = value < 0 ? '−' : signed && value > 0 ? '+' : '';
    return sign + decimal(value / 1e6, 2) + ' mln';
  }

  function pct(value, digits) {
    if (value === null || value === undefined) return '—';
    return (value < 0 ? '−' : '') + decimal(value, digits === undefined ? 1 : digits) + '%';
  }

  /** Sıfır həddi: dəyişmə ("−0,9%", "+13%") və ya səviyyə ("~88%"); hədd yoxdursa "—". */
  function thresholdText(t) {
    if (!t) return '—';
    // Dəqiqlik həddin ölçüsünə görə: < 1% — 2 onluq ("−0,97%"), < 10% — 1 onluq, əks halda tam.
    if (t.kind === 'level') return decimal(t.value, 1) + '%';
    const a = Math.abs(t.value);
    const digits = a < 1 ? 2 : a < 10 ? 1 : 0;
    return (t.value < 0 ? '−' : '+') + decimal(t.value, digits) + '%';
  }

  function sensitivityBadge(aggregate) {
    if (!aggregate) return null;
    if (aggregate.status === 'flag') {
      return aggregate.severity === 'yuksek' ? { label: 'Yüksək risk · Həssaslıq', tone: 'fail' }
        : { label: 'Orta risk · Həssaslıq', tone: 'warn' };
    }
    if (aggregate.status === 'ok') return { label: 'Aşağı risk · Həssaslıq', tone: 'ok' };
    return null;
  }

  /**
   * Həssaslıq blokunun görüntüsü — yalnız serverin rəqəmlərindən:
   * {badge, title, subtitle, rows: [{id, title, npv, delta, irr, threshold, negative, base, reason}]}.
   */
  function sensitivityView(sens, aggregate) {
    const scenarios = (sens && sens.scenarios) || [];
    const base = sens && sens.base;
    const ok = scenarios.filter((s) => s.status === 'ok');
    const sensitive = ok.filter((s) => FACTOR[s.id] && s.threshold && s.threshold.kind === 'change'
      && Math.abs(s.threshold.value) <= SENSITIVE_PCT)
      .sort((a, b) => Math.abs(a.threshold.value) - Math.abs(b.threshold.value));
    let title;
    let subtitle = '';
    if (base && base.npv <= 0) {
      title = 'Baza ssenaridə NPV artıq mənfidir';
    } else if (sensitive.length) {
      title = 'Layihə ' + sensitive.map((s) => FACTOR[s.id].name).join(' və ') + ' dəyişikliyinə çox həssasdır';
      const parts = sensitive.map((s, i) => FACTOR[s.id].phrase(decimal(s.threshold.value, 1) + '%', i === 0));
      subtitle = parts.join(' və ya ') + ', NPV sıfıra enir.';
      subtitle = subtitle.charAt(0).toUpperCase() + subtitle.slice(1);
    } else if (ok.some((s) => s.negative)) {
      title = 'Layihə bəzi ssenarilərdə NPV-ni itirir';
      subtitle = 'NPV mənfi olan ssenarilər: ' + ok.filter((s) => s.negative).map((s) => SCENARIO_SHORT[s.id] || s.title).join(', ') + '.';
    } else {
      title = 'Layihə yoxlanılan ssenarilərdə müsbət NPV saxlayır';
    }
    const rows = [];
    if (base) rows.push({ id: 'base', title: 'Baza', npv: mln(base.npv), delta: '—', irr: pct(base.irr), threshold: '—', base: true });
    ok.slice().sort((a, b) => a.delta - b.delta).forEach((s) => rows.push({
      id: s.id, title: SCENARIO_SHORT[s.id] || s.title, npv: mln(s.npv), delta: mln(s.delta, true),
      irr: pct(s.irr), threshold: thresholdText(s.threshold), negative: !!s.negative, formula: s.formula,
    }));
    scenarios.filter((s) => s.status !== 'ok').forEach((s) => rows.push({
      id: s.id, title: SCENARIO_SHORT[s.id] || s.title, reason: s.reason,
    }));
    return { badge: sensitivityBadge(aggregate), title, subtitle, rows };
  }

  /* ── Suallar ───────────────────────────────────────────────────────── */

  function questionFilters(questions, statuses) {
    const qs = questions || [];
    return [{ id: 'hamisi', label: 'Hamısı', count: qs.length },
      ...Object.entries(statuses || {}).map(([id, label]) => ({ id, label, count: qs.filter((q) => q.status === id).length }))];
  }

  function filterQuestions(questions, id) {
    return (questions || []).filter((q) => id === 'hamisi' || q.status === id);
  }

  function emptyQuestionsText(d, total) {
    if (!d || d.state === 'yoxdur') return (d && d.error) || 'İqtisadi təhlil aparılmayıb.';
    return total ? 'Bu süzgəcdə sual yoxdur.' : 'Sual yoxdur.';
  }

  /** Sualın tələb etdiyi sənəd üçün yüklənmiş fayllar: suala bağlı və ya həmin növdən. */
  function evidenceFor(question, docType, evidence) {
    return (evidence || []).filter((e) => e.question_id === question.id || e.doc_type === docType);
  }

  /** "Ayrıca təqdim ediləcək sənədlər" sətri: yüklənibsə ✓ və yoxlamanın nəticəsi, yoxdursa "Gözlənilir". */
  function docRequirementStatus(evidence, code) {
    const found = (evidence || []).filter((e) => e.req_code === code);
    if (!found.length) return { ok: false, text: 'Gözlənilir' };
    const a = found[found.length - 1].analysis || {};
    const result = a.state === 'isleyir' ? 'yoxlanılır' : a.error ? 'yoxlanılmadı'
      : (a.checks || []).some((c) => c.status === 'flag') ? 'fərq var' : 'yoxlandı';
    return { ok: true, text: '✓ ' + found.map((e) => e.file_name).join(', ') + ' (' + result + ')' };
  }

  /* ── Sənəd analizi ─────────────────────────────────────────────────── */

  function excelBadge(diff) {
    if (diff.status === 'ok') return { cls: 's-ok', label: 'Uyğun' };
    if (diff.status === 'skip') return { cls: 's-skip', label: diff.note || 'Yoxdur' };
    return diff.status === 'fail' ? { cls: 's-fail', label: 'Fərq' } : { cls: 's-warn', label: 'Kiçik fərq' };
  }

  function excelMeta(a, formatAz) {
    const meta = [];
    if (a.hardcode_pct !== null && a.hardcode_pct !== undefined) meta.push('sabit (hardcode) xanalar: ' + formatAz(a.hardcode_pct, 0) + '%');
    meta.push(a.formula_cells + ' düstur');
    if (a.error_count) meta.push(a.error_count + ' xəta xanası');
    return meta.join(' · ');
  }

  function checkBadge(c) {
    if (c.status === 'ok') return { cls: 's-ok', label: 'Uyğun' };
    return c.status === 'flag' ? { cls: 's-fail', label: 'Fərq' } : { cls: 's-skip', label: 'Qeyd' };
  }

  /* ── Tarixçə ("əvvəl/sonra") ───────────────────────────────────────── */

  function statusWord(x) {
    if (!x) return 'yox idi';
    if (x.status === 'flag') return 'diqqət tələb edir (' + (SEVERITY[x.severity] || '').toLocaleLowerCase('az') + ')';
    return STATUS_WORD[x.status] || x.status;
  }

  function historyEntry(h, formatDate) {
    const trig = h.trigger || {};
    const what = trig.kind === 'sened_silindi' ? 'silindi: ' : trig.file_name ? 'yükləndi: ' : '';
    const risk = (level) => (RISK[level] || {}).label || '—';
    const changes = h.changes || [];
    return {
      head: formatDate(h.at) + ' — ' + what + (trig.file_name || 'yenidən hesab') + ' · risk: '
        + risk(h.risk_before) + ' → ' + risk(h.risk_after),
      lines: changes.length ? changes.map((c) => c.title + ': ' + statusWord(c.before) + ' → '
        + (c.after ? statusWord(c.after) : 'çıxarıldı')) : ['Tapıntılar dəyişmədi.'],
    };
  }

  const WRITTEN_ANSWER = 'Yazılı cavab — sənəd tələb olunmur';

  /** Sualın cavab forması: sənəd tələb olunursa — sənədlər; yoxdursa — yazılı cavab. */
  function answerForm(item) {
    if (!item || !item.question && item.text === undefined) return null;     // sualsız tapıntı
    return (item.documents || []).length ? 'sened' : 'yazili';
  }

  /** DOM id üçün təhlükəsiz hissə ("c1b4:dscr" → "c1b4-dscr"). */
  function domId(prefix, id) { return prefix + String(id).replace(/[^a-zA-Z0-9_-]/g, '-'); }

  const api = {
    RISK, SEVERITY, GROUP, KIND, FINDING_FILTERS, findingBadge, severityCls, sortFindings, filterFindings,
    findingFilterCounts, shortTitle, sourceText, ratio, tiles, summaryLine, tabCounts, isBusy, stateText, tornado,
    questionFilters, filterQuestions, emptyQuestionsText, evidenceFor, docRequirementStatus, excelBadge, excelMeta,
    checkBadge, statusWord, historyEntry, domId, WRITTEN_ANSWER, answerForm, SENSITIVE_PCT, mln, pct, thresholdText,
    sensitivityBadge, sensitivityView, needsAction,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EconCore = api;
})(this);
