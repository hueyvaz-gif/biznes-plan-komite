/* Sol naviqasiya: planlar, versiyalar, tarixçə. */
import { api } from '../core/api.js';
import { $, announce, badge, el, formatAz, formatDate, icon, planName, statusDot, statusOf } from '../core/dom.js';
import { VERDICT_TONE } from '../core/labels.js';
import { openCheck } from '../core/router.js';
import { state } from '../core/state.js';
import { resetToUpload } from './session.js';
import { tooltip } from '../ui/overlay.js';
import { fmtRelative } from '../format.js';
import { fillPlanSelect, setPlanMode } from '../views/upload-flow.js';

/* ── Tarixçə (sol naviqasiya) ───────────────────────────────────────────── */

let historyGeneration = 0;
function filterPlans() {
  const query = ($('plan-search')?.value || '').trim().toLocaleLowerCase('az');
  let visible = 0;
  document.querySelectorAll('#history .plan').forEach((item) => {
    item.hidden = !item.dataset.name.includes(query);
    if (!item.hidden) visible++;
  });
  const empty = $('history-empty');
  empty.hidden = visible > 0;
  empty.textContent = query ? 'Bu adda plan tapılmadı.' : 'İlk planınızı yükləyin — burada görünəcək.';
}
async function loadHistory() {
  const search = $('plan-search');
  if (search && !search.dataset.wired) { search.addEventListener('input', filterPlans); search.dataset.wired = '1'; }
  const generation = ++historyGeneration;
  const list = $('history');
  const empty = $('history-empty');
  list.setAttribute('aria-busy', 'true');
  if (!list.children.length) {
    list.replaceChildren(...[0, 1, 2].map(() => {
      const li = el('li', 'skel');
      li.setAttribute('aria-hidden', 'true');
      return li;
    }));
  }
  let plans;
  try {
    plans = await api.get('/api/plans');
  } catch (_) {
    if (generation !== historyGeneration) return;
    list.replaceChildren();
    list.setAttribute('aria-busy', 'false');
    empty.textContent = 'Tarixçəni yükləmək mümkün olmadı.';
    empty.hidden = false;
    return;
  }
  if (generation !== historyGeneration) return;
  list.replaceChildren(...plans.map(planItem));
  list.setAttribute('aria-busy', 'false');
  state.plans = plans;
  fillPlanSelect(plans);
  $('history-count').textContent = plans.length ? String(plans.length) : '';
  $('history-count').title = plans.length ? plans.length + ' plan' : '';
  empty.textContent = 'Hələ heç bir yoxlama aparılmayıb. İlk planınızı yükləyin — burada görünəcək.';
  empty.hidden = plans.length > 0;
  if (state.check) markCurrentVersion(state.check);
  filterPlans();
}
function runBadge(item) {
  const run = item.run_state || item.last_run_state;
  const verdict = item.verdict || item.last_verdict;
  const verdicts = (state.meta && state.meta.verdicts) || {};
  if (run && run !== 'tamamlandi') {
    if (run === 'xeta') return badge('s-fail', 'Xəta');
    if (run === 'tesdiq_gozleyir') return badge('s-warn', 'Təsdiq gözləyir');
    return badge('s-run', 'İşləyir');
  }
  return badge('s-' + (VERDICT_TONE[verdict] || 'skip'), item.verdict_label || verdicts[verdict] || 'Tamamlandı');
}
function planItem(plan) {
  const item = el('li', 'plan');
  item.dataset.plan = plan.plan_id;
  item.dataset.name = planName(plan).toLocaleLowerCase('az');
  const head = el('button', 'plan__head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  const st = statusOf(plan);
  const when = fmtRelative(plan.last_at);
  const text = el('span', 'plan__text');
  text.append(el('span', 'plan__name', planName(plan)), el('span', 'plan__when', when));
  head.append(...statusDot(plan), text, el('span', 'plan__count', 'v' + plan.versions),
    el('span', 'sr-only', ', ' + formatAz(plan.versions) + ' versiya, son: ' + formatDate(plan.last_at)));
  // Nöqtənin mənası: status + son yoxlama (hover və fokusda).
  tooltip(head, () => st.label + ' · ' + formatAz(plan.versions) + ' versiya · son yoxlama ' + when);
  const panel = el('div', 'plan__panel');
  panel.hidden = true;
  const versions = el('ol', 'versions');
  panel.append(versions);
  // Hover/fokusda görünən əməliyyatlar (başlıq düyməsinin içində deyil — iç-içə interaktiv element olmasın).
  const actions = el('div', 'plan__actions');
  const again = el('button', 'plan__act');
  again.type = 'button';
  again.append(icon('upload'));
  again.setAttribute('aria-label', '“' + planName(plan) + '” — yeni versiya ilə yenidən yoxla');
  tooltip(again, 'Yeni versiya ilə yenidən yoxla');
  again.addEventListener('click', () => {
    resetToUpload();
    setPlanMode('existing', plan.plan_id);
    $('dropzone').focus();
  });
  actions.append(again);
  if (!state.demo) {
    const remove = el('button', 'plan__act plan__act--danger plan__delete');
    remove.type = 'button';
    remove.append(icon('trash'));
    remove.setAttribute('aria-label', '“' + planName(plan) + '” planını sil');
    tooltip(remove, 'Planı sil');
    remove.addEventListener('click', () => askDeletePlan(plan, remove));
    actions.append(remove);
  }
  head.addEventListener('click', () => togglePlan(head, panel, versions, plan.plan_id));
  item.append(head, actions, panel);
  return item;
}
/** "Planı sil": təsdiq pəncərəsi → DELETE /api/plans/{id}. Fokus "Ləğv et"-də başlayır (təhlükəsiz seçim). */
function askDeletePlan(plan, opener) {
  const dialog = $('delete-dialog');
  const confirmBtn = $('delete-confirm');
  $('delete-text').textContent = '“' + planName(plan) + '” — ' + formatAz(plan.versions) + ' versiya, son yoxlama '
    + formatDate(plan.last_at) + '.';
  $('delete-error').hidden = true;
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Planı sil';
  const close = () => { dialog.close(); if (opener.isConnected) opener.focus(); };
  $('delete-cancel').onclick = close;
  dialog.oncancel = (e) => { e.preventDefault(); close(); };
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Silinir…';
    try {
      await api.del('/api/plans/' + encodeURIComponent(plan.plan_id));
      dialog.close();
      const current = state.check && state.check.plan_id === plan.plan_id;
      if (current) resetToUpload();
      await loadHistory();
      announce('“' + planName(plan) + '” planı silindi.');
      (current ? $('plan-id') : $('nav-new')).focus();
    } catch (err) {
      $('delete-error').textContent = err.message || 'Plan silinmədi.';
      $('delete-error').hidden = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Planı sil';
    }
  };
  dialog.showModal();
  $('delete-cancel').focus();
}
function togglePlan(head, panel, versions, planId, forceOpen) {
  const open = head.getAttribute('aria-expanded') === 'true';
  if (open && forceOpen) return Promise.resolve();
  head.setAttribute('aria-expanded', open ? 'false' : 'true');
  panel.hidden = open;
  if (!open && !versions.dataset.loaded) return loadVersions(planId, versions);
  return Promise.resolve();
}
async function loadVersions(planId, host) {
  host.replaceChildren(el('li', 'skel'));
  try {
    const checks = await api.get('/api/plans/' + encodeURIComponent(planId) + '/checks');
    host.replaceChildren(...checks.map((c) => {
      const li = el('li');
      const button = el('button', 'version');
      button.type = 'button';
      button.dataset.check = c.id;
      button.title = c.file_name + ' — ' + statusOf(c).label;
      button.append(el('span', 'version__no', 'v' + c.version), el('span', 'version__date', fmtRelative(c.created_at)),
        ...statusDot(c));
      button.addEventListener('click', () => openCheck(c.id));
      li.append(button);
      return li;
    }));
    host.dataset.loaded = '1';
    if (state.check) markCurrentVersion(state.check);
  } catch (_) {
    host.replaceChildren(el('li', 'note', 'Versiyaları yükləmək mümkün olmadı.'));
  }
}
function markCurrentVersion(check) {
  document.querySelectorAll('.version').forEach((b) => {
    const on = b.dataset.check === check.id;
    b.classList.toggle('is-current', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.plan').forEach((p) => p.classList.toggle('is-current', p.dataset.plan === check.plan_id));
}
function renderNavCurrent(check) {
  $('nav-current').hidden = false;
  $('nav-current-name').textContent = planName(check);
  $('nav-current-meta').textContent = 'v' + check.version + ' · ' + formatDate(check.created_at);
  $('nav-current-status').replaceChildren(runBadge(check));
}

export { loadHistory, markCurrentVersion, renderNavCurrent };
