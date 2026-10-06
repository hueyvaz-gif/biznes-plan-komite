/* Suallar və sənədlər tabı (Faza 7): status pipeline → siyahı / lövhə (kanban) → sual kartları.
 *   • status dəyişikliyi optimistic: UI dərhal yenilənir, backend xəta qaytarsa geri qayıdır (toast);
 *   • kanban: sürükləmə (drag & drop) və klaviatura (kartı seç, → / ← ilə növbəti / əvvəlki status);
 *   • sənəd yükləmə: kartın üzərinə sürüklə → yükləmə faizi (XHR) → "Yoxlanılır…" → nəticə inline;
 *     sənəd yüklənəndə açıq sual avtomatik "Cavablandı" olur (backend), qərarı komitə üzvü verir;
 *   • redaktə: Esc ləğv edir, Ctrl+Enter saxlayır; komitə sualının silinməsi "Geri al" ilə;
 *   • məktub: A4 önizləmə (backend-in .docx mətni ilə eyni), sualları seçmək, .docx və çap.
 * Məlumat 'econ:data' hadisəsindən (views/economics.js). */
import { api } from '../core/api.js';
import { $ } from '../core/dom.js';
import { state } from '../core/state.js';
import { el, nextId } from '../ui/el.js';
import { icon } from '../ui/icons.js';
import { Badge, SeverityBadge, Segmented } from '../ui/badge.js';
import { EmptyState } from '../ui/card.js';
import { toast } from '../ui/overlay.js';
import { reducedMotion } from '../ui/motion.js';
import { fmtNumber } from '../format.js';
import { docStatus } from './summary-panel.js';

const ORDER = ['aciq', 'cavab_gozlenilir', 'cavablandi', 'qebul', 'redd'];
const CLOSED = new Set(['qebul', 'redd']);
const SEV = { yuksek: 'high', orta: 'medium', asagi: 'low' };
const TONE = { aciq: 'warning', cavab_gozlenilir: 'info', cavablandi: 'info', qebul: 'success', redd: 'danger' };

let dragging = null;                 // kanban: sürüklənən sualın id-si (dataTransfer brauzerdən asılıdır)
const S = { data: null, filter: null, view: 'list', editing: null, uploads: new Map(), pendingDelete: new Set(), overrides: new Map() };
const labels = () => ((state.meta && state.meta.economics) || {}).question_statuses || {};
const docNames = () => ((state.meta && state.meta.economics) || {}).documents || {};
const C = () => window.EconCore;
try { S.view = localStorage.getItem('q-view') || 'list'; } catch (_) { /* yox */ }

/** Serverdəki suallar + optimistic dəyişikliklər (hələ təsdiqlənməmiş status) − silinməkdə olanlar. */
function questions() {
  return ((S.data && S.data.questions) || []).filter((q) => !S.pendingDelete.has(q.id))
    .map((q) => (S.overrides.has(q.id) ? { ...q, status: S.overrides.get(q.id) } : q));
}

export function wireQuestions() {
  document.addEventListener('econ:data', (e) => { S.data = e.detail; render(); });
  $('q-add-btn')?.addEventListener('click', () => { $('q-add').hidden = false; $('q-add-text').focus(); });
  $('q-add-cancel')?.addEventListener('click', () => { $('q-add').hidden = true; $('q-add-btn').focus(); });
  $('q-add')?.addEventListener('submit', addQuestion);
  $('q-add-text')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); $('q-add-cancel').click(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('q-add').requestSubmit(); }
  });
  $('q-letter-btn')?.addEventListener('click', openLetter);
  $('q-print')?.addEventListener('click', () => window.print());
}

function render() {
  const host = $('q-view');
  if (!host) return;
  const d = S.data;
  const qs = questions();
  renderLead(qs);
  renderPipeline(qs);
  renderToolbar(d, qs);
  if (!qs.length) {
    host.replaceChildren(EmptyState({ icon: 'help', compact: true, title: 'Sual yoxdur', text: C().emptyQuestionsText(d, 0) }));
    return;
  }
  const shown = S.filter ? qs.filter((q) => q.status === S.filter) : qs;
  host.replaceChildren(S.view === 'board' ? board(qs) : list(shown, qs));
}

/* ── Baş hissə: cümlə, pipeline, progress ───────────────────────────────── */
function renderLead(qs) {
  const closed = qs.filter((q) => CLOSED.has(q.status)).length;
  const waitingDocs = qs.filter((q) => !CLOSED.has(q.status)).reduce((n, q) => n + q.documents.filter((dt) => !evidenceOf(q, dt).length).length, 0);
  $('q-lead').textContent = qs.length
    ? `${qs.length} sualdan ${Report.poss(closed)} bağlanıb.` + (waitingDocs ? ` ${waitingDocs} sənəd gözlənilir.` : ' Tələb olunan bütün sənədlər yüklənib.')
    : 'Bu yoxlama üçün sual yoxdur.';
  const bar = $('q-progress');
  bar.style.setProperty('--p', qs.length ? String(closed / qs.length) : '0');
  bar.setAttribute('aria-valuenow', String(closed));
  bar.setAttribute('aria-valuemax', String(qs.length));
  bar.setAttribute('aria-valuetext', `${qs.length} sualdan ${closed} bağlanıb`);
}
function renderPipeline(qs) {
  const host = $('q-pipeline');
  const count = (s) => qs.filter((q) => q.status === s).length;
  const step = (s) => el('button', {
    type: 'button', class: ['qpipe__step', `qpipe__step--${s}`, S.filter === s && 'is-active', !count(s) && 'is-zero'],
    'aria-pressed': String(S.filter === s), on: { click: () => { S.filter = S.filter === s ? null : s; render(); } },
  }, el('span', { class: 'qpipe__n', text: fmtNumber(count(s)) }), el('span', { class: 'qpipe__l', text: labels()[s] || s }));
  host.replaceChildren(
    step('aciq'), el('span', { class: 'qpipe__arrow', 'aria-hidden': 'true' }, icon('chevronRight', { size: 'sm' })),
    step('cavab_gozlenilir'), el('span', { class: 'qpipe__arrow', 'aria-hidden': 'true' }, icon('chevronRight', { size: 'sm' })),
    step('cavablandi'), el('span', { class: 'qpipe__arrow', 'aria-hidden': 'true' }, icon('chevronRight', { size: 'sm' })),
    el('span', { class: 'qpipe__end' }, step('qebul'), step('redd')));
}
function renderToolbar(d, qs) {
  const seg = $('q-viewswitch');
  if (!seg.firstChild) {
    seg.append(Segmented({ label: 'Görünüş', size: 'sm', value: S.view,
      options: [{ value: 'list', label: 'Siyahı', icon: 'fileText' }, { value: 'board', label: 'Lövhə', icon: 'table' }],
      onChange: (v) => { S.view = v; try { localStorage.setItem('q-view', v); } catch (_) { /* yox */ } render(); } }));
  }
  $('q-add-btn').hidden = !!state.demo || !d || d.state === 'yoxdur';
  $('q-letter-btn').hidden = !!state.demo || !qs.length;
  const docBox = $('q-add-docs');
  if (!docBox.children.length) {
    Object.entries(docNames()).forEach(([id, text]) => docBox.append(el('label', { class: 'qadd__doc' }, el('input', { type: 'checkbox', value: id }), ' ' + text)));
  }
}

/* ── Siyahı ─────────────────────────────────────────────────────────────── */
function list(shown, all) {
  if (!shown.length) return EmptyState({ icon: 'check', compact: true, title: `“${labels()[S.filter]}” statusunda sual yoxdur`,
    action: { label: 'Süzgəci götür', onClick: () => { S.filter = null; render(); } } });
  return el('ol', { class: 'qlist2' }, shown.map((q) => card(q, all.indexOf(q))));
}

/** Göstərişdə defis-minus → U+2212 (saxlanmış mətnə toxunulmur). */
const minus = (t) => String(t || '').replace(/(^|[\s(:])-(?=\d)/g, '$1−');

function evidenceOf(q, dt) { return C().evidenceFor(q, dt, (S.data && S.data.evidence) || []); }

function card(q, index) {
  const id = C().domId('q-', q.id);
  const li = el('li', { class: ['qc', `qc--${q.status}`, q.stale && 'is-stale'], id, tabIndex: -1, dataset: { status: q.status } });
  const head = el('div', { class: 'qc__head' },
    el('span', { class: 'qc__no', text: `${index + 1}` }),
    q.severity ? SeverityBadge(SEV[q.severity] || 'medium', { size: 'sm' }) : null,
    el('span', { class: 'qc__src', text: q.origin === 'qayda' ? 'Qayda' : 'Komitə üzvü' }),
    q.edited ? el('span', { class: 'qc__tag', text: 'redaktə edilib' }) : null,
    q.stale ? el('span', { class: 'qc__tag qc__tag--stale', text: 'qayda artıq tələb etmir' }) : null,
    Badge(labels()[q.status] || q.status, { tone: TONE[q.status] || 'neutral', size: 'sm' }));
  li.append(head, S.editing === q.id ? editor(q) : el('p', { class: 'qc__text', text: minus(q.text) }));
  li.append(docsBlock(q));
  // Status: segmented control (5 vəziyyət); qəbul / rədd — qərar verən və qeyd.
  if (!state.demo) {
    const seg = Segmented({ label: `Sualın statusu: ${index + 1}`, size: 'sm', value: q.status,
      options: ORDER.map((s) => ({ value: s, label: labels()[s] || s, tone: { qebul: 'success', redd: 'danger', cavablandi: 'success' }[s] })),
      onChange: (v) => setStatus(q, v) });
    const foot = el('div', { class: 'qc__foot' }, seg);
    if (CLOSED.has(q.status)) foot.append(decision(q));
    const actions = el('div', { class: 'qc__actions' },
      el('button', { type: 'button', class: 'btn btn--small', on: { click: () => { S.editing = q.id; render(); } } }, 'Redaktə et'),
      q.origin === 'komite' ? el('button', { type: 'button', class: 'btn btn--small btn--danger', on: { click: () => removeQuestion(q) } }, icon('trash', { size: 'sm' }), 'Sil') : null);
    foot.append(actions);
    li.append(foot);
    dropTarget(li, q);
  }
  return li;
}

function editor(q) {
  const area = el('textarea', { class: 'qc__edit', rows: 4, 'aria-label': 'Sualın mətni', value: q.text });
  area.value = q.text;
  const save = async () => {
    const text = area.value.trim();
    if (!text || text === q.text) { S.editing = null; render(); return; }
    try { await patch(q.id, { text }); S.editing = null; toast({ message: 'Sual yeniləndi', tone: 'success' }); window.Econ.load(); }
    catch (err) { toast({ message: err.message, tone: 'danger' }); }
  };
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); S.editing = null; render(); document.getElementById(C().domId('q-', q.id))?.focus(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  });
  setTimeout(() => { area.focus(); area.setSelectionRange(area.value.length, area.value.length); }, 0);
  return el('div', { class: 'qc__editor' }, area,
    el('div', { class: 'qc__editbar' },
      el('button', { type: 'button', class: 'btn btn--primary btn--small', on: { click: save } }, 'Saxla'),
      el('button', { type: 'button', class: 'btn btn--small', on: { click: () => { S.editing = null; render(); } } }, 'Ləğv et'),
      el('span', { class: 'qc__hint', text: 'Ctrl+Enter — saxla · Esc — ləğv et' })));
}

function decision(q) {
  const who = el('input', { class: 'qc__input', placeholder: 'Qərar verən komitə üzvü', 'aria-label': 'Qərar verən komitə üzvü', value: q.decided_by || '' });
  const note = el('input', { class: 'qc__input', placeholder: 'Qeyd', 'aria-label': 'Qərarın qeydi', value: q.note || '' });
  const save = async () => {
    if (who.value === (q.decided_by || '') && note.value === (q.note || '')) return;
    try { await patch(q.id, { decided_by: who.value, note: note.value }); toast({ message: 'Qərar saxlanıldı', tone: 'success' }); }
    catch (err) { toast({ message: err.message, tone: 'danger' }); }
  };
  who.addEventListener('change', save);
  note.addEventListener('change', save);
  return el('div', { class: 'qc__decision' }, who, note);
}

/** Tələb olunan sənədlər: ad, status, yüklənmiş fayl və yoxlama nəticəsi; yükləmə zamanı faiz. */
function docsBlock(q) {
  const up = S.uploads.get(q.id);
  if (C().answerForm(q) !== 'sened') return el('p', { class: 'qc__written' }, icon('fileText', { size: 'sm' }), C().WRITTEN_ANSWER);
  const items = q.documents.map((dt) => {
    const found = evidenceOf(q, dt);
    const st = docStatus(found);
    return el('li', { class: ['qdoc', `qdoc--${st.state}`, `qdoc--${st.tone}`] },
      icon(st.state === 'done' ? (st.tone === 'success' ? 'check' : 'alert') : st.state === 'busy' ? 'refresh' : 'circle', { size: 'sm' }),
      el('span', { class: 'qdoc__name', text: docNames()[dt] || dt }),
      el('span', { class: 'qdoc__st', text: st.state === 'wait' ? 'Gözlənilir' : st.text }));
  });
  const block = el('div', { class: 'qc__docs' }, el('ul', { class: 'qdocs' }, items));
  if (up) {
    block.append(el('div', { class: 'qup', role: 'status' },
      el('span', { class: 'qup__label', text: up.done ? `${up.name}: yoxlanılır…` : `${up.name}: yüklənir ${Math.round(up.pct)}%` }),
      el('span', { class: ['qup__bar', up.done && 'is-indeterminate'], style: { '--p': String(up.pct / 100) } })));
  } else if (!state.demo) {
    const input = el('input', { type: 'file', class: 'sr-only', tabIndex: -1, 'aria-hidden': 'true', accept: '.xlsx,.xlsm,.pdf,.docx,.jpg,.jpeg,.png' });
    input.addEventListener('change', () => upload(q, input.files[0]));
    block.append(el('p', { class: 'qc__drophint' }, icon('upload', { size: 'sm' }), 'Faylı kartın üzərinə sürükləyin və ya ',
      el('button', { type: 'button', class: 'efc__pick', text: 'seçin', on: { click: () => input.click() } }), input));
  }
  return block;
}

function dropTarget(node, q) {
  if (C().answerForm(q) !== 'sened') return;
  let depth = 0;
  node.addEventListener('dragenter', (e) => { if (!e.dataTransfer.types.includes('Files')) return; depth++; node.classList.add('is-drop'); });
  node.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  node.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) node.classList.remove('is-drop'); });
  node.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault(); depth = 0; node.classList.remove('is-drop');
    upload(q, e.dataTransfer.files[0]);
  });
}

/** Yükləmə (XHR — faiz göstərmək üçün). Sonra iqtisadi məlumat yenilənir: analiz bitənə qədər "Yoxlanılır…". */
function upload(q, file) {
  if (!file || !state.check) return;
  const form = new FormData();
  form.append('file', file);
  form.append('question_id', q.id);
  if (q.documents[0]) form.append('doc_type', q.documents[0]);
  const entry = { name: file.name, pct: 0, done: false };
  S.uploads.set(q.id, entry);
  render();
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/checks/' + encodeURIComponent(state.check.id) + '/evidence');
  xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) { entry.pct = (e.loaded / e.total) * 100; render(); } });
  xhr.addEventListener('load', () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      entry.pct = 100; entry.done = true;
      toast({ message: `“${file.name}” yükləndi — yoxlanılır`, tone: 'success' });
      waitAnalysis(q.id);
    } else {
      S.uploads.delete(q.id);
      let msg = 'Fayl yüklənmədi.';
      try { msg = JSON.parse(xhr.responseText).detail || msg; } catch (_) { /* JSON deyil */ }
      toast({ message: msg, tone: 'danger' });
    }
    render();
  });
  xhr.addEventListener('error', () => { S.uploads.delete(q.id); toast({ message: 'Şəbəkə xətası — fayl yüklənmədi', tone: 'danger' }); render(); });
  xhr.send(form);
}
/** economics.js analiz bitənə qədər özü sorğulayır; burada yalnız "yoxlanılır" vəziyyəti təmizlənir. */
function waitAnalysis(qid) {
  window.Econ.load();
  const done = () => {
    const ev = ((S.data && S.data.evidence) || []).filter((e) => e.question_id === qid);
    if (ev.length && ev.every((e) => (e.analysis || {}).state !== 'isleyir')) {
      S.uploads.delete(qid);
      document.removeEventListener('econ:data', done);
      render();
      const node = document.getElementById(C().domId('q-', qid));
      if (node && !reducedMotion()) { node.classList.remove('is-flash'); void node.offsetWidth; node.classList.add('is-flash'); }
    }
  };
  document.addEventListener('econ:data', done);
}

/* ── Status: optimistic ─────────────────────────────────────────────────── */
async function patch(qid, body) {
  const r = await fetch('/api/questions/' + encodeURIComponent(qid), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) {
    let detail = 'Server xətası (' + r.status + ').';
    try { detail = (await r.json()).detail || detail; } catch (_) { /* JSON deyil */ }
    throw new Error(detail);
  }
  return r.json();
}
async function setStatus(q, status) {
  if (q.status === status) return;
  S.overrides.set(q.id, status);
  render();
  announce(`Status: ${labels()[status] || status}`);
  try {
    await patch(q.id, { status });
    S.overrides.delete(q.id);
    window.Econ.load();
  } catch (err) {
    S.overrides.delete(q.id);
    render();
    toast({ message: `Status saxlanmadı: ${err.message}`, tone: 'danger' });
  }
}
function announce(text) { const live = $('live'); if (live) live.textContent = text; }

async function removeQuestion(q) {
  S.pendingDelete.add(q.id);
  render();
  let undone = false;
  toast({ message: 'Sual silindi', tone: 'info', duration: 5000, action: { label: 'Geri al', onClick: () => { undone = true; S.pendingDelete.delete(q.id); render(); } } });
  setTimeout(async () => {
    if (undone) return;
    try { await api.del('/api/questions/' + encodeURIComponent(q.id)); window.Econ.load(); }
    catch (err) { S.pendingDelete.delete(q.id); render(); toast({ message: err.message, tone: 'danger' }); }
    S.pendingDelete.delete(q.id);
  }, 5200);
}

async function addQuestion(e) {
  e.preventDefault();
  const documents = [...document.querySelectorAll('#q-add-docs input:checked')].map((x) => x.value);
  try {
    await api.post('/api/checks/' + encodeURIComponent(state.check.id) + '/questions', { text: $('q-add-text').value, documents });
    $('q-add-text').value = '';
    document.querySelectorAll('#q-add-docs input').forEach((x) => { x.checked = false; });
    $('q-add').hidden = true;
    toast({ message: 'Sual əlavə edildi', tone: 'success' });
    window.Econ.load();
  } catch (err) { toast({ message: err.message, tone: 'danger' }); }
}

/* ── Lövhə (kanban) ─────────────────────────────────────────────────────── */
function board(all) {
  const cols = ORDER.map((s) => {
    const items = all.filter((q) => q.status === s);
    const body = el('ol', { class: 'kb__list', 'aria-label': labels()[s] || s }, items.map((q) => kbCard(q, all.indexOf(q))));
    const col = el('section', { class: ['kb__col', `kb__col--${s}`, S.filter === s && 'is-filtered'], dataset: { status: s } },
      el('h3', { class: 'kb__h' }, el('span', { text: labels()[s] || s }), el('span', { class: 'kb__n', text: String(items.length) })), body);
    if (!state.demo) {
      col.addEventListener('dragover', (e) => { if (dragging) { e.preventDefault(); col.classList.add('is-over'); } });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('is-over'); });
      col.addEventListener('drop', (e) => {
        e.preventDefault(); col.classList.remove('is-over');
        const q = all.find((x) => x.id === (dragging || e.dataTransfer.getData('text/plain')));
        dragging = null;
        if (q) setStatus(q, s).then(() => focusCard(q.id));
      });
    }
    return col;
  });
  return el('div', { class: 'kb', role: 'group', 'aria-label': 'Suallar lövhəsi: kartı seçib ← → ilə statusunu dəyişin' }, cols);
}
function kbCard(q, index) {
  const docs = q.documents.length;
  const got = q.documents.filter((dt) => evidenceOf(q, dt).length).length;
  const node = el('li', { class: ['kbc', q.stale && 'is-stale'], id: 'kb-' + C().domId('', q.id), tabIndex: 0, draggable: !state.demo ? 'true' : 'false',
    dataset: { id: q.id }, 'aria-label': `Sual ${index + 1}, ${labels()[q.status]}. ${q.text}. ← → ilə statusu dəyişin.` },
  el('div', { class: 'kbc__head' }, el('span', { class: 'qc__no', text: String(index + 1) }),
    q.severity ? SeverityBadge(SEV[q.severity] || 'medium', { size: 'sm' }) : null,
    el('span', { class: 'qc__src', text: q.origin === 'qayda' ? 'Qayda' : 'Komitə' })),
  el('p', { class: 'kbc__text', text: minus(q.text) }),
  docs ? el('p', { class: ['kbc__docs', got === docs && 'is-done'] }, icon(got === docs ? 'check' : 'fileText', { size: 'sm' }), `${got}/${docs} sənəd`) : null);
  node.addEventListener('dragstart', (e) => { dragging = q.id; e.dataTransfer.setData('text/plain', q.id); e.dataTransfer.effectAllowed = 'move'; node.classList.add('is-dragging'); });
  node.addEventListener('dragend', () => { dragging = null; node.classList.remove('is-dragging'); });
  node.addEventListener('keydown', (e) => {
    if (state.demo) return;
    const i = ORDER.indexOf(q.status);
    const next = e.key === 'ArrowRight' ? ORDER[i + 1] : e.key === 'ArrowLeft' ? ORDER[i - 1] : null;
    if (!next) return;
    e.preventDefault();
    setStatus(q, next).then(() => focusCard(q.id));
    focusCard(q.id);
  });
  return node;
}
function focusCard(qid) {
  requestAnimationFrame(() => document.getElementById('kb-' + C().domId('', qid))?.focus());
}

/* ── Məktub önizləməsi (A4) ─────────────────────────────────────────────── */
async function openLetter() {
  const check = state.check;
  if (!check) return;
  const open = questions().filter((q) => !CLOSED.has(q.status) && q.status !== 'cavablandi' && !q.stale);
  const chosen = new Set(open.map((q) => q.id));
  const titleId = nextId('letter');
  const paper = el('article', { class: 'letter', 'aria-label': 'Məktubun önizləməsi (A4)' }, el('p', { class: 'letter__loading', text: 'Önizləmə hazırlanır…' }));
  const picks = el('ul', { class: 'letter__picks' }, open.map((q, i) => el('li', null, el('label', null,
    el('input', { type: 'checkbox', checked: true, value: q.id, on: { change: (e) => { if (e.target.checked) chosen.add(q.id); else chosen.delete(q.id); refresh(); } } }),
    el('span', { class: 'letter__pickno', text: `${i + 1}.` }), el('span', { text: q.text })))));
  const download = el('a', { class: 'btn btn--primary btn--small', download: '' }, icon('fileText', { size: 'sm' }), 'Yüklə .docx');
  const print = el('button', { type: 'button', class: 'btn btn--small', on: { click: () => printLetter(paper) } }, icon('printer', { size: 'sm' }), 'Çap');
  const close = el('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Bağla', on: { click: () => dlg.close() } }, icon('x'));
  const dlg = el('dialog', { class: 'letterdlg', 'aria-labelledby': titleId },
    el('header', { class: 'letterdlg__head' }, el('h2', { id: titleId, text: 'Suallar məktubu — önizləmə' }), close),
    el('div', { class: 'letterdlg__body' },
      el('aside', { class: 'letterdlg__side' }, el('h3', { class: 'fdet__h', text: `Məktuba daxil ediləcək suallar (${open.length})` }), picks,
        el('p', { class: 'letterdlg__hint', text: 'Yalnız açıq suallar (Açıq, Cavab gözlənilir) daxil edilir.' })),
      el('div', { class: 'letterdlg__page' }, paper)),
    el('footer', { class: 'letterdlg__foot' }, el('span', { class: 'letterdlg__count', 'aria-live': 'polite' }), print, download));
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  let timer;
  async function refresh() {
    const ids = [...chosen].join(',');
    const qs = '?ids=' + encodeURIComponent(ids);
    download.href = '/api/checks/' + encodeURIComponent(check.id) + '/questions/letter.docx' + qs;
    download.classList.toggle('is-disabled', !chosen.size);
    dlg.querySelector('.letterdlg__count').textContent = `${chosen.size} sual seçilib`;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { paper.replaceChildren(...letterDom(await api.get('/api/checks/' + encodeURIComponent(check.id) + '/questions/letter' + qs))); }
      catch (err) { paper.replaceChildren(el('p', { class: 'alert alert--warn', text: err.message })); }
    }, 120);
  }
  refresh();
}
/** Rəsmi Azərbaycan məktub forması — backend-in letter_content mətni ilə. */
function letterDom(c) {
  return [
    el('p', { class: 'letter__title', text: c.title }),
    el('p', { class: 'letter__meta' }, `Tarix: ${c.date}`, el('br'), `Nömrə: ${c.number}`, el('br'), `Kimə: ${c.to}`),
    el('p', { class: 'letter__subject' }, el('strong', { text: 'Mövzu: ' }), c.subject),
    el('p', { text: c.salutation }), el('p', { text: c.intro }),
    c.questions.length ? [el('h3', { class: 'letter__h', text: 'Suallar' }),
      el('ol', { class: 'letter__qs' }, c.questions.map((q) => el('li', null, q.text, q.written ? el('em', { text: ' (yazılı cavab)' }) : null)))]
      : el('p', { text: 'Açıq sual yoxdur.' }),
    c.documents.length ? [el('h3', { class: 'letter__h', text: 'Tələb olunan sənədlər' }), el('ul', { class: 'letter__docs' }, c.documents.map((d) => el('li', { text: d })))] : null,
    el('p', { class: 'letter__note', text: c.note }),
    el('p', { class: 'letter__sign', text: c.signature }),
  ].flat().filter(Boolean);
}
/** Yalnız məktubu çap edir (gizli iframe — innerHTML yoxdur, DOM klonlanır). */
function printLetter(paper) {
  const frame = el('iframe', { class: 'sr-only', title: 'Çap', 'aria-hidden': 'true' });
  document.body.append(frame);
  const doc = frame.contentDocument;
  const style = doc.createElement('style');
  style.textContent = '@page{size:A4;margin:20mm}body{font:12pt/1.5 "Times New Roman",serif;color:#000}'
    + '.letter__title{text-align:center;font-weight:bold}.letter__h{font-size:12pt;margin:14pt 0 6pt}.letter__note{font-size:10pt}';
  doc.head.append(style);
  doc.body.append(doc.importNode(paper, true));
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 1000);
}
