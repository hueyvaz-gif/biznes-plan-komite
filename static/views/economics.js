/* İqtisadi təhlil və "Suallar və sənədlər" tabları (keçmiş static/economics.js). */
import { api } from '../core/api.js';
import { $, announce, badge, el, formatAz, formatDate, icon } from '../core/dom.js';
import { state } from '../core/state.js';
import { layoutTabs, selectTab, setTabCount } from '../shell/tabs.js';

(function () {
  'use strict';

  const E = { check: null, data: null, timer: null, filter: 'flag', qFilter: 'hamisi', editing: null };

  const C = window.EconCore;
  const toBadge = (b) => badge(b.cls, b.label);

  const docs = () => ((state.meta && state.meta.economics) || {}).documents || {};
  const qStatuses = () => ((state.meta && state.meta.economics) || {}).question_statuses || {};

  function statusBadge(f) { return toBadge(C.findingBadge(f)); }

  /* ── Yükləmə və sorğu ─────────────────────────────────────────────────── */

  async function load(check) {
    if (check) {
      if (!E.check || E.check.id !== check.id) { E.data = null; E.filter = 'flag'; E.qFilter = 'hamisi'; }
      E.check = check;
    }
    clearTimeout(E.timer);
    if (!E.check || E.check.run_state !== 'tamamlandi') { render(); return; }
    const id = E.check.id;
    try {
      const data = await api.get('/api/checks/' + encodeURIComponent(id) + '/economics');
      if (!E.check || E.check.id !== id) return;                       // başqa yoxlamaya keçilib
      E.data = data;
    } catch (err) {
      E.data = { state: 'yoxdur', error: state.demo ? 'Demo rejimində iqtisadi təhlil göstərilmir.' : err.message,
        questions: [], evidence: [], history: [] };
    }
    render();
    if (C.isBusy(E.data)) E.timer = setTimeout(() => load(), 2000);
  }

  async function patch(path, body) {
    const response = await fetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      let detail = 'Server xətası (' + response.status + ').';
      try { detail = (await response.json()).detail || detail; } catch (_) { /* JSON deyil */ }
      throw new Error(detail);
    }
    return response.json();
  }

  async function runEconomics(fresh) {
    try {
      await api.post('/api/checks/' + encodeURIComponent(E.check.id) + '/economics' + (fresh === true ? '?fresh=1' : ''));
      announce('İqtisadi təhlil başladı.');
    } catch (err) { announce(err.message); setStatus('econ-state', err.message); return; }
    load();
  }

  async function upload(file, opts) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    if (opts.question_id) form.append('question_id', opts.question_id);
    if (opts.doc_type) form.append('doc_type', opts.doc_type);
    if (opts.req_code) form.append('req_code', opts.req_code);
    setStatus('ev-status', '“' + file.name + '” yüklənir…');
    try {
      await api.post('/api/checks/' + encodeURIComponent(E.check.id) + '/evidence', form);
      setStatus('ev-status', '“' + file.name + '” yükləndi — yoxlanılır.');
      announce('Sənəd yükləndi: ' + file.name);
    } catch (err) {
      setStatus('ev-status', err.message);
      announce(err.message);
      return;
    }
    load();
  }

  function pickAndUpload(opts) {
    const input = el('input');
    input.type = 'file';
    input.accept = '.xlsx,.xlsm,.pdf,.docx,.jpg,.jpeg,.png';
    input.addEventListener('change', () => upload(input.files[0], opts));
    input.click();
  }

  function setStatus(id, text) { const n = $(id); if (n) n.textContent = text || ''; }

  /* ── Göstərmə ──────────────────────────────────────────────────────────── */

  function render() {
    const d = E.data;
    // Hero (shell/hero.js) və digər dinləyicilər üçün: iqtisadi məlumat yeniləndi.
    document.dispatchEvent(new CustomEvent('econ:data', { detail: d }));
    renderSummaryLine(d);
    renderTabCounts(d);
    renderHead(d);
    renderTiles(d);
    renderFindings(d);
    renderSensitivity(d);
    renderRejected(d);
    renderQuestions(d);
    renderEvidence(d);
    renderHistory(d);
    renderDocRequirements(d);
  }

  function renderSummaryLine(d) {
    const line = $('sum-econ');
    if (!line) return;
    line.replaceChildren();
    const s = C.summaryLine(d);
    line.hidden = s.hidden;
    if (s.hidden) return;
    line.append(el('span', 'overview__toplabel', 'İqtisadi təhlil: '));
    if (s.risk) {
      line.append(el('strong', 'econrisk econrisk--' + s.risk.tone, s.risk.label),
        document.createTextNode(' · ' + s.open + ' açıq sual'));
    } else line.append(document.createTextNode(s.text));
    const go = el('a', 'report__link', 'Ətraflı');
    go.href = '#panel-iqtisadi';
    go.addEventListener('click', (e) => { e.preventDefault(); selectTab('panel-iqtisadi', true); });
    line.append(document.createTextNode(' · '), go);
  }

  function renderTabCounts(d) {
    const { flags, open } = C.tabCounts(d);
    const done = !!(d && d.result);
    const level = done && d.result.risk ? d.result.risk.level : null;
    setTabCount('count-iqtisadi', flags, { tone: level === 'yuksek' ? 'fail' : 'warn', title: flags + ' tapıntı diqqət tələb edir',
      complete: done, doneTitle: 'Diqqət tələb edən tapıntı yoxdur' });
    setTabCount('count-suallar', open, { tone: 'warn', title: open + ' açıq sual', complete: done && (d.questions || []).length > 0,
      doneTitle: 'Bütün suallar bağlanıb' });
    if (typeof layoutTabs === 'function') layoutTabs();
  }

  function renderHead(d) {
    const risk = $('econ-risk');
    const stateLine = $('econ-state');
    const run = $('econ-run');
    if (!risk) return;
    risk.replaceChildren();
    run.hidden = !d || d.state === 'yoxdur' || state.demo;
    run.disabled = d && d.state === 'isleyir';
    $('econ-run-label').textContent = d && d.result ? 'Yenidən hesabla' : 'İqtisadi təhlili başlat';
    run.title = d && d.result ? 'Qaydalar saxlanmış yerlərlə yenidən hesablanır (model çağırılmır)' : '';
    const fresh = $('econ-fresh');
    fresh.hidden = run.hidden || !(d && d.result);
    fresh.disabled = run.disabled;
    const notes = $('econ-notes');
    notes.hidden = !(d && d.result && d.result.notes);
    notes.textContent = d && d.result && d.result.notes ? 'Qeyd: ' + d.result.notes : '';
    stateLine.textContent = C.stateText(d, formatDate);
    if (!d || d.state === 'yoxdur') return;
    if (d.result) {
      const r = C.RISK[d.result.risk.level] || C.RISK.orta;
      const pill = el('span', 'statuspill statuspill--' + r.tone);
      const dot = el('span', 'statuspill__dot');
      dot.setAttribute('aria-hidden', 'true');
      pill.append(dot, el('span', null, 'Risk səviyyəsi: ' + r.label));
      risk.append(pill, el('span', 'econhead__why', (d.result.risk.reasons || []).join('; ')));
    }
  }

  function tile(title, value, unit, sub, hint) {
    const box = el('div', 'stat stat--static');
    box.title = hint || '';
    const v = el('span', 'stat__value', value);
    v.append(el('span', 'stat__unit', ' ' + unit));
    box.append(el('span', 'stat__title', title), v, el('span', 'stat__sub', sub));
    return box;
  }

  function renderTiles(d) {
    const host = $('econ-tiles');
    if (!host) return;
    host.replaceChildren();
    if (!d || !d.result) return;
    host.append(...C.tiles(d.result.counts).map((t) => tile(t.title, t.value, t.unit, t.sub, t.hint)));
  }

  function numbersTable(numbers) {
    const wrap = el('div', 'tablewrap');
    const table = el('table', 'table table--compact enums');
    const body = el('tbody');
    numbers.forEach((n) => {
      const tr = el('tr');
      const th = el('th', null, n.label);
      th.scope = 'row';
      const src = el('td', 'enums__src enums__src--' + ((n.source || {}).kind || ''), C.sourceText(n.source));
      tr.append(th, el('td', 'num', n.text || ''), src);
      body.append(tr);
    });
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  function questionFor(f) {
    return ((E.data && E.data.questions) || []).find((q) => q.finding_id === f.id);
  }

  function docStatus(docType, list) {
    const li = el('li');
    li.append(el('span', null, docs()[docType] || docType), document.createTextNode(' — '));
    if (list && list.length) li.append(el('span', 'docok', '✓ ' + list.map((x) => x.file_name).join(', ')));
    else li.append(el('span', 'docwait', 'Gözlənilir'));
    return li;
  }

  function findingItem(f) {
    const li = el('li', 'efinding efinding--' + f.status + (f.severity ? ' efinding--' + f.severity : ''));
    li.id = C.domId('ef-', f.id);
    const head = el('div', 'efinding__head');
    head.append(statusBadge(f), el('h3', 'efinding__title', f.title), el('span', 'fix__code', C.GROUP[f.group] || f.group));
    li.append(head);
    const body = el('dl', 'fix__body');
    const row = (label, value) => {
      if (!value) return;
      const wrap = el('div', 'fix__row');
      const dd = el('dd');
      if (typeof value === 'string') dd.textContent = value; else dd.append(value);
      wrap.append(el('dt', null, label), dd);
      body.append(wrap);
    };
    row('Nə tapıldı', f.result);
    row('Düstur', f.formula);
    if (f.numbers && f.numbers.length) row('Rəqəmlər', numbersTable(f.numbers));
    const q = questionFor(f);
    if (f.question) {
      const box = el('div');
      box.append(el('p', 'efinding__q', q ? q.text : f.question));
      if (q) {
        const go = el('button', 'fix__inline', 'Suallar tabında: ' + (qStatuses()[q.status] || q.status));
        go.type = 'button';
        go.addEventListener('click', () => { selectTab('panel-suallar', true); focusQuestion(q.id); });
        box.append(go);
      }
      row('Sual', box);
    }
    if (C.answerForm(f) === 'sened') {
      const list = el('ul', 'efinding__docs');
      f.documents.forEach((dt) => list.append(docStatus(dt, (f.documents_status || {})[dt])));
      row('Tələb olunan sənəd', list);
    } else if (C.answerForm(f) === 'yazili') {
      row('Cavab', el('span', 'answer--written', C.WRITTEN_ANSWER));
    }
    li.append(body);
    if (f.documents && f.documents.length && !state.demo) {
      const b = el('button', 'btn btn--small');
      b.type = 'button';
      b.append(icon('upload'), el('span', null, 'Sənəd yüklə'));
      b.setAttribute('aria-label', 'Sənəd yüklə: ' + f.title);
      b.addEventListener('click', () => pickAndUpload({ question_id: q && q.id, doc_type: f.documents[0] }));
      li.append(b);
    }
    return li;
  }

  function renderFindings(d) {
    const host = $('econ-findings');
    const chips = $('econ-filters');
    if (!host) return;
    host.replaceChildren();
    chips.replaceChildren();
    if (!d || !d.result) return;
    C.findingFilterCounts(d.result.findings).forEach(({ id, label, count }) => {
      const b = el('button', 'chip' + (E.filter === id ? ' is-on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', E.filter === id ? 'true' : 'false');
      b.append(document.createTextNode(label + ' '), el('span', 'chip__count', String(count)));
      b.addEventListener('click', () => { E.filter = id; renderFindings(E.data); });
      chips.append(b);
    });
    const shown = C.filterFindings(d.result.findings, E.filter);
    host.append(...shown.map(findingItem));
    if (!shown.length) host.append(el('li', 'empty', 'Bu süzgəcdə tapıntı yoxdur.'));
  }

  function renderSensitivity(d) {
    const sec = $('econ-sens');
    if (!sec) return;
    const sens = d && d.result && d.result.sensitivity;
    const rows = (sens && sens.scenarios) || [];
    sec.hidden = !rows.length;
    if (!rows.length) return;
    const aggregate = d.result.findings.find((f) => f.id === 'hessasliq');
    const view = C.sensitivityView(sens, aggregate);

    const badgeBox = $('econ-sens-badge');
    badgeBox.replaceChildren();
    badgeBox.hidden = !view.badge;
    if (view.badge) {
      badgeBox.className = 'sens__badge sens__badge--' + view.badge.tone;
      badgeBox.append(icon(view.badge.tone === 'ok' ? 'check' : 'alert'), el('span', null, view.badge.label));
    }
    $('econ-sens-title').textContent = view.title;
    const lead = $('econ-sens-lead');
    lead.textContent = view.subtitle;
    lead.hidden = !view.subtitle;

    $('econ-sens-body').replaceChildren(...view.rows.map((r) => {
      const tr = el('tr', r.base ? 'sens__base' : r.negative ? 'sens__neg' : null);
      const th = el('th', null, r.title);
      th.scope = 'row';
      if (r.formula) th.title = r.formula;
      if (r.reason) {
        const td = el('td', null, r.reason);
        td.colSpan = 4;
        tr.append(th, td);
        return tr;
      }
      const npvCell = el('td', 'num', r.npv);
      if (r.negative) npvCell.append(el('span', 'sr-only', ' (mənfi)'));
      tr.append(th, npvCell, el('td', 'num', r.delta), el('td', 'num', r.irr), el('td', 'num', r.threshold));
      return tr;
    }));

    // Tornado: ΔNPV — mərkəzdən sola (azalma) və sağa (artım); rəqəm mətnlə də yazılır.
    $('econ-tornado').replaceChildren(...C.tornado(rows).map((s) => {
      const r = el('div', 'tornado__row');
      const track = el('div', 'tornado__track');
      const bar = el('span', 'tornado__bar is-' + s.direction + (s.negative ? ' is-negative' : ''));
      bar.style.width = s.widthPct + '%';
      track.append(bar);
      track.setAttribute('aria-hidden', 'true');
      r.append(el('span', 'tornado__label', s.title), track,
        el('span', 'tornado__value', C.mln(s.delta, true)));
      return r;
    }));

    // "Necə hesablanıb" — hər ssenarinin düsturu, sıfır həddinin mənası və sadələşdirmə (həqiqi metod).
    $('econ-sens-method').replaceChildren(
      el('li', null, 'Baza — planın öz pul axını (FCFF) ilə kodun hesabı; diskont dərəcəsi planda göstərilən.'),
      ...rows.map((s) => el('li', null, (view.rows.find((x) => x.id === s.id) || {}).title + ': ' + s.formula + '.')),
      el('li', null, 'Sıfır həddi: qiymət, xammal və capex üçün — baza NPV / təsir olunan axının cari dəyəri; '
        + 'gücdən istifadə üçün — NPV-nin sıfıra endiyi istifadə səviyyəsi (praktiki gücün faizi); gecikmə üçün hədd yoxdur.'));
    $('econ-sens-note').textContent = sens.assumption || '';
  }

  function renderRejected(d) {
    const box = $('econ-rejected');
    if (!box) return;
    const list = (d && d.result && d.result.rejected) || [];
    box.hidden = !list.length;
    $('econ-rejected-title').textContent = 'Təsdiqlənməyən yerlər: ' + list.length + ' (istifadə olunmayıb)';
    $('econ-rejected-list').replaceChildren(...list.map((r) => el('li', null, r.label + ' — ' + r.reason)));
  }

  /* ── Suallar ─────────────────────────────────────────────────────────── */

  function focusQuestion(id) {
    const node = document.getElementById(C.domId('q-', id));
    if (node) { node.scrollIntoView({ block: 'start' }); node.focus({ preventScroll: true }); }
  }

  function questionItem(q, index) {
    const li = el('li', 'q q--' + q.status + (q.stale ? ' is-stale' : ''));
    li.id = C.domId('q-', q.id);
    li.tabIndex = -1;
    const head = el('div', 'q__head');
    head.append(el('span', 'q__no', (index + 1) + '.'),
      el('span', 'tag', q.origin === 'qayda' ? 'Qayda' : 'Komitə'));
    if (q.severity) head.append(badge(C.severityCls(q.severity), C.SEVERITY[q.severity]));
    if (q.edited) head.append(el('span', 'tag', 'redaktə edilib'));
    if (q.stale) head.append(el('span', 'tag', 'qayda artıq bayraq vermir'));
    li.append(head);

    if (E.editing === q.id) {
      const area = el('textarea', 'q__edit');
      area.value = q.text;
      area.rows = 4;
      area.setAttribute('aria-label', 'Sualın mətni');
      const save = el('button', 'btn btn--primary btn--small', 'Saxla');
      save.type = 'button';
      save.addEventListener('click', async () => {
        try { await patch('/api/questions/' + encodeURIComponent(q.id), { text: area.value }); E.editing = null; load(); }
        catch (err) { announce(err.message); }
      });
      const cancel = el('button', 'btn btn--small', 'Ləğv et');
      cancel.type = 'button';
      cancel.addEventListener('click', () => { E.editing = null; renderQuestions(E.data); });
      li.append(area, el('div', 'row'));
      li.lastChild.append(save, cancel);
      setTimeout(() => area.focus(), 0);
    } else {
      li.append(el('p', 'q__text', q.text));
    }

    if (C.answerForm(q) === 'sened') {
      const list = el('ul', 'efinding__docs');
      q.documents.forEach((dt) => list.append(docStatus(dt, C.evidenceFor(q, dt, E.data.evidence))));
      li.append(list);
    } else {
      li.append(el('p', 'answer--written', C.WRITTEN_ANSWER));
    }

    const ctrl = el('div', 'q__ctrl');
    const label = el('label', 'q__label', 'Status');
    const select = el('select');
    select.id = 'qs-' + li.id;
    label.htmlFor = select.id;
    Object.entries(qStatuses()).forEach(([value, text]) => {
      const o = el('option', null, text);
      o.value = value;
      if (value === q.status) o.selected = true;
      select.append(o);
    });
    select.disabled = !!state.demo;
    select.addEventListener('change', async () => {
      try { await patch('/api/questions/' + encodeURIComponent(q.id), { status: select.value }); announce('Status yeniləndi.'); load(); }
      catch (err) { announce(err.message); }
    });
    ctrl.append(label, select);
    if (q.status === 'qebul' || q.status === 'redd') {
      const who = el('input');
      who.placeholder = 'Qərar verən komitə üzvü';
      who.value = q.decided_by || '';
      who.setAttribute('aria-label', 'Qərar verən komitə üzvü');
      const note = el('input');
      note.placeholder = 'Qeyd';
      note.value = q.note || '';
      note.setAttribute('aria-label', 'Qərarın qeydi');
      const save = el('button', 'btn btn--small', 'Qərarı saxla');
      save.type = 'button';
      save.addEventListener('click', async () => {
        try { await patch('/api/questions/' + encodeURIComponent(q.id), { decided_by: who.value, note: note.value }); announce('Qərar saxlanıldı.'); load(); }
        catch (err) { announce(err.message); }
      });
      ctrl.append(who, note, save);
    }
    li.append(ctrl);

    if (!state.demo) {
      const actions = el('div', 'q__actions');
      const edit = el('button', 'btn btn--small', 'Redaktə et');
      edit.type = 'button';
      edit.addEventListener('click', () => { E.editing = q.id; renderQuestions(E.data); });
      const up = el('button', 'btn btn--small');
      up.type = 'button';
      up.append(icon('upload'), el('span', null, 'Sənəd yüklə'));
      up.addEventListener('click', () => pickAndUpload({ question_id: q.id, doc_type: q.documents[0] }));
      actions.append(edit, up);
      if (q.origin === 'komite') {
        const del = el('button', 'btn btn--small btn--danger', 'Sil');
        del.type = 'button';
        del.addEventListener('click', async () => {
          try { await api.del('/api/questions/' + encodeURIComponent(q.id)); announce('Sual silindi.'); load(); }
          catch (err) { announce(err.message); }
        });
        actions.append(del);
      }
      li.append(actions);
    }
    return li;
  }

  function renderQuestions(d) {
    const list = $('q-list');
    if (!list) return;
    const qs = (d && d.questions) || [];
    const chips = $('q-filters');
    chips.replaceChildren();
    C.questionFilters(qs, qStatuses()).forEach(({ id, label, count }) => {
      const b = el('button', 'chip' + (E.qFilter === id ? ' is-on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', E.qFilter === id ? 'true' : 'false');
      b.append(document.createTextNode(label + ' '), el('span', 'chip__count', String(count)));
      b.addEventListener('click', () => { E.qFilter = id; renderQuestions(E.data); });
      chips.append(b);
    });
    const shown = C.filterQuestions(qs, E.qFilter);
    list.replaceChildren(...shown.map(questionItem));
    const empty = $('q-empty');
    empty.hidden = shown.length > 0;
    empty.textContent = C.emptyQuestionsText(d, qs.length);
    const letter = $('q-letter');
    if (E.check) letter.href = '/api/checks/' + encodeURIComponent(E.check.id) + '/questions/letter.docx';
    letter.hidden = !!state.demo || !qs.length;
    $('q-add-btn').hidden = !!state.demo || !d || d.state === 'yoxdur';
    const docBox = $('q-add-docs');
    if (!docBox.children.length) {
      Object.entries(docs()).forEach(([id, text]) => {
        const lab = el('label', 'check');
        const box = el('input');
        box.type = 'checkbox';
        box.value = id;
        lab.append(box, document.createTextNode(' ' + text));
        docBox.append(lab);
      });
    }
  }

  /* ── Əlavə sənədlər ───────────────────────────────────────────────────── */

  function analysisView(e) {
    const a = e.analysis || {};
    const box = el('div', 'ev__analysis');
    if (a.state === 'isleyir') { box.append(el('p', null, 'Yoxlanılır…')); return box; }
    if (a.error) { box.append(el('p', 'ev__error', 'Yoxlanılmadı: ' + a.error)); return box; }
    if (e.kind === 'sekil') { box.append(el('p', null, 'Şəkil təqdim edilib — məzmun qiymətləndirilmir.')); return box; }
    if (e.kind === 'excel') {
      box.append(el('p', null, C.excelMeta(a, formatAz)));
      const table = el('table', 'table table--compact');
      const cap = el('caption', 'sr-only', 'Plan ↔ Excel modeli');
      const thead = el('thead');
      const hr = el('tr');
      ['Göstərici', 'Planda', 'Modeldə', 'Xana', 'Nəticə'].forEach((t) => { const th = el('th', null, t); th.scope = 'col'; hr.append(th); });
      thead.append(hr);
      const body = el('tbody');
      (a.diffs || []).forEach((dfx) => {
        const tr = el('tr');
        const v = (x) => (x === null || x === undefined ? '—' : formatAz(x, Math.abs(x) < 100 ? 2 : 0));
        const res = el('td');
        res.append(toBadge(C.excelBadge(dfx)));
        tr.append(el('th', null, dfx.label), el('td', 'num', v(dfx.plan)), el('td', 'num', v(dfx.model)), el('td', null, dfx.where || '—'), res);
        body.append(tr);
      });
      table.append(cap, thead, body);
      const wrap = el('div', 'tablewrap');
      wrap.append(table);
      box.append(wrap);
      if (a.errors && a.errors.length) box.append(el('p', 'ev__error', 'Xətalar: ' + a.errors.slice(0, 8).map((x) => x.sheet + '!' + x.cell + ' ' + x.value).join(', ')));
      return box;
    }
    const checks = el('ul', 'ev__checks');
    (a.checks || []).forEach((c) => {
      const li = el('li');
      li.append(toBadge(C.checkBadge(c)), document.createTextNode(' ' + c.title + ': ' + c.detail));
      checks.append(li);
    });
    if ((a.rejected || []).length) checks.append(el('li', null, 'Sitatı təsdiqlənməyən fakt(lar) istifadə olunmadı: ' + a.rejected.map((r) => r.key).join(', ')));
    box.append(checks);
    return box;
  }

  function renderEvidence(d) {
    const list = $('ev-list');
    if (!list) return;
    const items = (d && d.evidence) || [];
    const hint = $('ev-hint');
    hint.textContent = 'Formatlar: XLSX, PDF, DOCX, JPG, PNG; ən çoxu ' + (((state.meta || {}).economics || {}).evidence_max_mb || 15)
      + ' MB. Sənəd yüklənəndən sonra əlaqəli tapıntılar yenidən hesablanır.';
    const select = $('ev-doc-type');
    if (!select.children.length) {
      const blank = el('option', null, '— avtomatik —');
      blank.value = '';
      select.append(blank, ...Object.entries(docs()).map(([id, text]) => { const o = el('option', null, text); o.value = id; return o; }));
    }
    const req = $('ev-req');
    const reqDocs = (state.report && state.report.documents) || [];
    req.replaceChildren(el('option', null, '— ümumi plan —'), ...reqDocs.map((x) => { const o = el('option', null, x.code + ' — ' + x.text); o.value = x.code; return o; }));
    req.firstChild.value = '';
    $('ev-form').hidden = !!state.demo || !d || d.state === 'yoxdur';
    list.replaceChildren(...items.map((e) => {
      const li = el('li', 'ev');
      const head = el('div', 'ev__head');
      head.append(icon('file'), el('strong', null, e.file_name), el('span', 'tag', C.KIND[e.kind] || e.kind));
      if (e.doc_type) head.append(el('span', 'tag', docs()[e.doc_type] || e.doc_type));
      if (e.req_code) head.append(el('span', 'fix__code', e.req_code));
      if (e.question_id) {
        const q = (d.questions || []).find((x) => x.id === e.question_id);
        if (q) head.append(el('span', 'ev__q', 'Sual: ' + q.text.slice(0, 80) + (q.text.length > 80 ? '…' : '')));
      }
      if (!state.demo) {
        const del = el('button', 'btn btn--small btn--danger', 'Sil');
        del.type = 'button';
        del.setAttribute('aria-label', 'Sənədi sil: ' + e.file_name);
        del.addEventListener('click', async () => {
          try { await api.del('/api/evidence/' + encodeURIComponent(e.id)); announce('Sənəd silindi.'); load(); }
          catch (err) { announce(err.message); }
        });
        head.append(del);
      }
      li.append(head, analysisView(e));
      return li;
    }));
  }

  function renderDocRequirements(d) {
    document.querySelectorAll('.docreq__status[data-code]').forEach((node) => {
      const st = C.docRequirementStatus(d && d.evidence, node.dataset.code);
      node.className = 'docreq__status ' + (st.ok ? 'docok' : 'docwait');
      node.textContent = st.text;
    });
  }

  function renderHistory(d) {
    const sec = $('econ-history');
    if (!sec) return;
    const hist = (d && d.history) || [];
    sec.hidden = !hist.length;
    $('econ-history-list').replaceChildren(...hist.slice().reverse().map((h) => {
      const li = el('li');
      const entry = C.historyEntry(h, formatDate);
      const ul = el('ul');
      ul.append(...entry.lines.map((line) => el('li', null, line)));
      li.append(el('p', 'ehistory__head', entry.head), ul);
      return li;
    }));
  }

  function prepareForPrint() {
    const has = !!(E.data && E.data.result);
    const p1 = $('panel-iqtisadi');
    const p2 = $('panel-suallar');
    if (p1) p1.classList.toggle('print-skip', !has);
    if (p2) p2.classList.toggle('print-skip', !(E.data && (E.data.questions || []).length));
  }

  /* ── Hadisələr ─────────────────────────────────────────────────────────── */

  function wire() {
    const run = $('econ-run');
    if (!run) return;
    run.addEventListener('click', () => runEconomics(false));
    $('econ-fresh').addEventListener('click', () => runEconomics(true));
    $('ev-file').addEventListener('change', (e) => {
      upload(e.target.files[0], { doc_type: $('ev-doc-type').value, req_code: $('ev-req').value });
      e.target.value = '';
    });
    $('q-add-btn').addEventListener('click', () => { $('q-add').hidden = false; $('q-add-text').focus(); });
    $('q-add-cancel').addEventListener('click', () => { $('q-add').hidden = true; $('q-add-btn').focus(); });
    $('q-add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const documents = [...document.querySelectorAll('#q-add-docs input:checked')].map((x) => x.value);
      try {
        await api.post('/api/checks/' + encodeURIComponent(E.check.id) + '/questions', { text: $('q-add-text').value, documents });
        $('q-add-text').value = '';
        document.querySelectorAll('#q-add-docs input').forEach((x) => { x.checked = false; });
        $('q-add').hidden = true;
        announce('Sual əlavə olundu.');
        load();
      } catch (err) { announce(err.message); setStatus('q-empty', err.message); $('q-empty').hidden = false; }
    });
    $('q-print').addEventListener('click', () => { selectTab('panel-suallar', false); window.print(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  window.Econ = { load, prepareForPrint };
})();
