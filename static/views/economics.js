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
    // Baner, göstəricilər, risk radarı və tapıntılar — views/econ-panel.js ('econ:data' hadisəsi ilə).
    renderRejected(d);
    // Suallar — views/questions-panel.js ('econ:data').
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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  // upload: Nəticə tabındakı "Ayrıca sənədlər" də buradan yükləyir (req_code ilə).
  window.Econ = { load, prepareForPrint, upload, focusQuestion };
})();
