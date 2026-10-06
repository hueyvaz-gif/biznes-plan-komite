/* Polling və marşrutlaşdırma (?check=…&tab=…). */
import { ApiError, api } from './api.js';
import { $, POLL_MS, announce, el, icon, planName } from './dom.js';
import { STEP_STATE } from './labels.js';
import { state } from './state.js';
import { closeDetail } from '../shell/detail.js';
import { resetToUpload } from '../shell/session.js';
import { loadHistory, markCurrentVersion, renderNavCurrent } from '../shell/sidebar.js';
import { checkStepper, renderStepper, setOnline, showView } from '../shell/views.js';
import { refreshFeed } from '../views/debug-log.js';
import { renderReview } from '../views/review.js';
import { renderResults } from '../views/summary.js';
import { showUploadError } from '../views/upload-flow.js';

/* ── Polling və marşrutlaşdırma ─────────────────────────────────────────── */

const poller = createPoller({
  intervalMs: POLL_MS,
  fetchCheck: async (checkId, signal) => {
    try {
      return { status: 'ok', check: await api.get('/api/checks/' + encodeURIComponent(checkId), signal) };
    } catch (e) {
      if (e.status === 404) return { status: 'notfound' };
      if (e instanceof ApiError) return { status: 'offline' };
      throw e;
    }
  },
  onOffline: (offline) => setOnline(!offline),
  onNotFound: () => {
    resetToUpload();
    showUploadError('Belə yoxlama tapılmadı.');
  },
  onResult: (check) => {
    render(check);
    // Təsdiq gözləyəndə, bitəndə və ya xətada sorğu dayanır.
    return ['tamamlandi', 'xeta', 'tesdiq_gozleyir'].includes(check.run_state);
  },
});
/**
 * İcra ekranının rejimi:
 *   loading — hesabat serverdən gəlir ("Hesabat açılır…"), mərhələlər GÖSTƏRİLMİR;
 *   running — yoxlama həqiqətən davam edir (mərhələlər, canlı lent);
 *   error   — yoxlama dayanıb (mərhələ və xəta);
 *   ingest  — fayl oxunmadı.
 */
function setRunMode(mode) {
  $('run-loading').hidden = mode !== 'loading';
  $('run-lead').hidden = mode !== 'running';
  $('stepper-run').hidden = mode === 'loading' || mode === 'ingest';
  document.querySelector('#view-run .runlayout').hidden = mode === 'loading' || mode === 'ingest';
  if (mode === 'loading') { $('run-title').textContent = 'Hesabat açılır…'; $('run-plan').textContent = ''; }
}
function openCheck(checkId, opts) {
  closeDetail();
  state.check = null;
  const params = new URLSearchParams(location.search);
  params.set('check', checkId);
  if (!(opts && opts.keepTab)) params.delete('tab');
  history.replaceState(null, '', '?' + params.toString());
  $('run-error').hidden = true;
  $('ingest-error').hidden = true;
  if (opts && opts.fresh) {
    // Yeni göndərilmiş sənəd: yoxlama həqiqətən başlayır.
    showView('run', 'Yoxlama');
    setRunMode('running');
    $('run-title').textContent = 'Yoxlama başladı';
    renderStepper('stepper-run', checkStepper(null));
    renderSteps(null);
  } else {
    showView('run', 'Hesabat açılır…');
    setRunMode('loading');
  }
  poller.open(checkId);
}
function render(check) {
  // Bu yoxlamanın icra vəziyyəti dəyişibsə (məs. işləyir → tamamlandı), sol paneldəki siyahı yenilənir.
  const prev = state.runStates[check.id];
  state.runStates[check.id] = check.run_state;
  if (prev && prev !== check.run_state) loadHistory();
  state.check = check;
  renderNavCurrent(check);
  markCurrentVersion(check);
  const title = planName(check) + ' · v' + check.version;
  AiChat.setContext({ checkId: check.id, planId: planName(check), version: check.version, runState: check.run_state });
  renderStepper('stepper-review', checkStepper(check));
  renderStepper('stepper-run', checkStepper(check));

  if (check.run_state === 'telebler_hazirlanir' || check.run_state === 'tesdiq_gozleyir') {
    showView('review', title + ' · əlavə tələblər');
    renderReview(check);
    return;
  }
  if (check.run_state === 'xeta') {
    showView('run', title);
    setRunMode('error');
    $('run-plan').textContent = title;
    $('run-title').textContent = 'Yoxlama dayandı';
    renderSteps(check);
    $('error-step').textContent = stepLabel(check.current_step);
    $('error-text').textContent = check.error || 'Naməlum xəta.';
    $('run-error').hidden = false;
    refreshFeed(check.id);
    announce('Yoxlama xəta ilə dayandı.');
    return;
  }
  if (check.run_state !== 'tamamlandi') {
    showView('run', title);
    setRunMode('running');
    $('run-plan').textContent = title;
    $('run-title').textContent = 'Yoxlama gedir';
    $('run-error').hidden = true;
    renderSteps(check);
    refreshFeed(check.id);
    return;
  }
  if (check.verdict === 'giris_xetasi') {
    showView('run', title);
    setRunMode('ingest');
    $('run-plan').textContent = title;
    $('run-title').textContent = 'Fayl oxunmadı';
    $('steps').replaceChildren();
    $('ingest-error-text').textContent = check.error || 'Fayl oxunmadı.';
    $('ingest-error').hidden = false;
    announce('Fayl oxunmadı.');
    return;
  }
  showView('results', title);
  renderResults(check);
  announce('Yoxlama tamamlandı: ' + (check.verdict_label || ''));
}
function stepLabel(stepId) {
  const steps = (state.meta && state.meta.steps) || [];
  const found = steps.find((s) => s.id === stepId);
  return found ? found.label : (stepId || '—');
}
/** Addımlar: yalnız serverin current_step-inə görə; faiz/vaxt uydurulmur. */
function renderSteps(check) {
  const host = $('steps');
  host.replaceChildren();
  const steps = (state.meta && state.meta.steps) || [];
  const current = check ? check.current_step : null;
  const runState = check ? check.run_state : 'gozleyir';
  const currentIndex = steps.findIndex((s) => s.id === current);
  steps.forEach((step, index) => {
    let status = 'gozleyir';
    if (runState === 'tamamlandi') status = 'tamamlandi';
    else if (currentIndex >= 0 && index < currentIndex) status = 'tamamlandi';
    else if (index === currentIndex) status = runState === 'xeta' ? 'xeta' : 'isleyir';
    const li = el('li', 'step step--' + status);
    const mark = el('span', 'step__mark');
    if (status === 'tamamlandi') mark.append(icon('check'));
    if (status === 'xeta') mark.append(icon('x'));
    li.append(mark, el('span', 'step__label', step.label), el('span', 'step__state', STEP_STATE[status]));
    if (status === 'isleyir') li.setAttribute('aria-current', 'step');
    host.append(li);
  });
}

export { openCheck, poller };
