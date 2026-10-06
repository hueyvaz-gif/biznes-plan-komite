/* Əlavə tələblərin təsdiqi. */
import { api } from '../core/api.js';
import { $, el, formatAz, formatSize, icon, planName, setBusy, setIcon } from '../core/dom.js';
import { openCheck } from '../core/router.js';
import { state } from '../core/state.js';

/* ── Əlavə tələblərin təsdiqi ───────────────────────────────────────────── */

async function renderReview(check) {
  const preparing = check.run_state === 'telebler_hazirlanir';
  $('review-plan').textContent = planName(check) + ' · v' + check.version;
  $('review-progress').hidden = !preparing;
  $('review-confirm').disabled = preparing;
  if (preparing) {
    $('review-items').replaceChildren();
    $('review-files').replaceChildren();
    return;
  }
  let data;
  try {
    data = await api.get('/api/checks/' + encodeURIComponent(check.id) + '/requirements');
  } catch (e) {
    $('review-error-text').textContent = e.message || 'Tələbləri yükləmək mümkün olmadı.';
    $('review-error').hidden = false;
    return;
  }
  if (!state.check || state.check.id !== check.id) return;     // başqa yoxlamaya keçilib
  const draft = data.draft || { items: [], rejected: [] };
  if (!state.review || state.review.checkId !== check.id) {
    state.review = {
      checkId: check.id,
      items: (draft.items || []).map((i) => ({ ...i })),
    };
  }
  const problem = check.error || draft.error;
  $('review-error').hidden = !problem;
  $('review-error-text').textContent = problem
    ? (draft.error ? 'Model tələbləri çıxara bilmədi: ' + draft.error : problem)
      + ' Tələbləri əl ilə əlavə edə və ya yenidən çıxara bilərsiniz.' : '';

  renderReviewFiles(data.attachments || [], draft.truncated || []);
  renderReviewLimits(draft);
  renderReviewItems();
  renderRejected(draft.rejected || []);
}
/** Natamam çıxarış: bənd limiti və mətn kəsilməsi AYRI göstərilir; təsdiq razılıq tələb edir. */
function renderReviewLimits(draft) {
  const limits = draft.limits || {};
  const box = $('review-limits');
  box.hidden = !limits.incomplete;
  $('review-ack').checked = false;
  updateConfirmState();
  if (!limits.incomplete) return;
  const lines = [];
  if (limits.over_limit) {
    lines.push('Bənd limiti: model ' + limits.received + ' bənd qaytarıb, ' + limits.kept
      + ' bənd saxlanılıb, ' + limits.over_limit + ' bənd limitdən (' + limits.max_items
      + ') kənarda qalıb.');
  } else if (limits.model_at_limit) {
    lines.push('Bənd limiti: model limitə (' + limits.max_items + ') çatıb — sənəddə daha çox tələb ola bilər.');
  }
  if (limits.input_truncated) {
    lines.push('Mətnin kəsilməsi: ' + (limits.truncated_files || []).join(', ') + ' faylının bir hissəsi '
      + 'modelə verilməyib (ən çoxu ' + limits.max_chunks + ' hissə × ' + formatAz(limits.max_prompt_chars)
      + ' simvol). Tam əhatə üçün sənədi kiçik fayllara bölüb ayrı yoxlamalarda yükləyin.');
  }
  $('review-limits-list').replaceChildren(...lines.map((line) => el('li', null, line)));
  const over = draft.over_limit_items || [];
  $('review-overlimit-box').hidden = over.length === 0;
  $('review-overlimit-count').textContent = over.length ? '(' + over.length + ')' : '';
  $('review-overlimit').replaceChildren(...over.map((i) => el('li', null, i.text + (i.ref ? ' — ' + i.ref : ''))));
}
/** Natamam siyahını istifadəçi açıq qəbul etmədən təsdiq düyməsi bağlıdır. */
function updateConfirmState() {
  const blocked = !$('review-limits').hidden && !$('review-ack').checked;
  $('review-confirm').disabled = blocked || !$('review-progress').hidden;
  $('review-confirm').title = blocked ? 'Əvvəl siyahının natamam olduğunu qəbul edin' : '';
}
function renderReviewFiles(files, truncated) {
  const list = $('review-files');
  list.replaceChildren();
  files.forEach((a) => {
    const ok = a.status === 'oxundu';
    const li = el('li', 'extrafile ' + (ok ? 'extrafile--ok' : 'extrafile--error'));
    li.append(setIcon(el('span', 'icon extrafile__icon'), ok ? 'check' : 'alert'));
    li.append(el('span', 'extrafile__name', a.name + ' (' + a.id + ')'));
    li.append(el('span', 'extrafile__size num', formatSize(a.size)));
    li.append(el('span'));
    li.append(el('span', 'extrafile__status', ok
      ? 'Oxundu — ' + formatAz(a.chars) + ' simvol, ' + a.parts + ' hissə'
        + (truncated.includes(a.name) ? '. Diqqət: mətn uzun olduğu üçün modelə qismən verilib.' : '')
      : 'Oxunmadı — ' + a.error));
    list.append(li);
  });
}
function renderReviewItems() {
  const list = $('review-items');
  list.replaceChildren();
  const items = state.review ? state.review.items : [];
  $('review-empty').hidden = items.length > 0;
  $('review-count').textContent = items.length ? '(' + items.length + ')' : '';
  items.forEach((item, index) => list.append(reviewRow(item, index)));
  // Hündürlük yalnız DOM-a əlavə ediləndən sonra ölçülə bilər.
  requestAnimationFrame(() => list.querySelectorAll('textarea').forEach(fitArea));
}
/** Mətn sahəsi məzmuna görə uzanır — uzun tələb kəsilmir, daxili sürüşmə lazım olmur. */
function fitArea(area) {
  area.style.height = 'auto';
  area.style.height = (area.scrollHeight + 2) + 'px';
}
function reviewRow(item, index) {
  const li = el('li', 'reviewitem');
  const head = el('div', 'reviewitem__head');
  head.append(el('span', 'reviewitem__id', item.id || 'yeni'));
  if (item.origin === 'istifadeci' || !item.source_id) head.append(el('span', 'tag', 'Sizin əlavəniz'));
  else head.append(el('span', 'tag tag--req', 'Sənəddən çıxarılıb'));
  li.append(head);

  const fields = el('div', 'reviewitem__fields');
  const textId = 'rv-text-' + index;
  const textBox = el('div', 'field');
  const textLabel = el('label', 'sr-only', 'Tələb mətni');
  textLabel.htmlFor = textId;
  const area = el('textarea', 'input input--area');
  area.id = textId;
  area.rows = 2;
  area.value = item.text || '';
  area.addEventListener('input', () => { item.text = area.value; fitArea(area); });
  textBox.append(textLabel, area);

  const kindId = 'rv-kind-' + index;
  const kindBox = el('div', 'field');
  const kindLabel = el('label', 'sr-only', 'Tələbin növü');
  kindLabel.htmlFor = kindId;
  const select = el('select', 'input');
  select.id = kindId;
  [['plan', 'Planın mətnində yoxlanır'], ['sened', 'Ayrıca sənəd tələb edir']].forEach(([v, l]) => {
    const option = el('option', null, l);
    option.value = v;
    select.append(option);
  });
  select.value = item.kind || 'plan';
  select.addEventListener('change', () => { item.kind = select.value; });
  kindBox.append(kindLabel, select);
  fields.append(textBox, kindBox);
  li.append(fields);

  const remove = el('button', 'btn btn--small btn--danger reviewitem__remove');
  remove.type = 'button';
  remove.append(icon('trash'), document.createTextNode('Sil'));
  remove.addEventListener('click', () => {
    state.review.items.splice(index, 1);
    renderReviewItems();
    $('review-add').focus();
  });
  li.append(remove);

  const source = el('div', 'reviewitem__source');
  if (item.source_id) {
    source.append(el('span', null, 'Mənbə: ' + (item.source_name || item.source_id) + ' · ' + (item.ref || '')));
    source.append(el('blockquote', 'quote', item.fragment || ''));
  } else {
    source.append(el('span', null, 'Mənbə faylı yoxdur — tələbi siz yazmısınız.'));
  }
  li.append(source);
  return li;
}
function renderRejected(rejected) {
  const box = $('review-rejected-box');
  const list = $('review-rejected');
  list.replaceChildren();
  box.hidden = rejected.length === 0;
  $('review-rejected-count').textContent = rejected.length ? '(' + rejected.length + ')' : '';
  rejected.forEach((r) => {
    const li = el('li');
    li.append(el('p', null, r.text || '—'));
    if (r.fragment) li.append(el('blockquote', 'quote', r.fragment));
    li.append(el('p', 'rejected__reason', 'Səbəb: ' + r.reason));
    const add = el('button', 'btn btn--small');
    add.type = 'button';
    add.append(icon('plus'), document.createTextNode('Öz tələbim kimi əlavə et'));
    add.addEventListener('click', () => {
      state.review.items.push({ text: r.text || '', kind: 'plan', origin: 'istifadeci' });
      renderReviewItems();
    });
    li.append(add);
    list.append(li);
  });
}
async function confirmReview() {
  if (!state.check || !state.review) return;
  const items = state.review.items.map((i) => ({ id: i.id, text: (i.text || '').trim(), kind: i.kind || 'plan' }));
  const empty = items.findIndex((i) => !i.text);
  if (empty >= 0) {
    $('review-submit-error').textContent = (empty + 1) + '-ci tələbin mətni boşdur — doldurun və ya silin.';
    $('review-submit-error').hidden = false;
    return;
  }
  $('review-submit-error').hidden = true;
  setBusy($('review-confirm'), true, 'Təsdiqlənir…');
  try {
    await api.post('/api/checks/' + encodeURIComponent(state.check.id) + '/requirements',
      { items, acknowledge_incomplete: $('review-ack').checked });
    state.review = null;
    openCheck(state.check.id);
  } catch (e) {
    $('review-submit-error').textContent = e.message || 'Serverlə əlaqə kəsildi.';
    $('review-submit-error').hidden = false;
  } finally {
    setBusy($('review-confirm'), false);
  }
}
async function reextract() {
  if (!state.check) return;
  setBusy($('review-reextract'), true, 'Göndərilir…');
  try {
    await api.post('/api/checks/' + encodeURIComponent(state.check.id) + '/requirements/extract');
    state.review = null;
    openCheck(state.check.id);
  } catch (e) {
    $('review-error-text').textContent = e.message;
  } finally {
    setBusy($('review-reextract'), false);
  }
}

export { confirmReview, fitArea, reextract, renderReview, renderReviewItems, updateConfirmState };
