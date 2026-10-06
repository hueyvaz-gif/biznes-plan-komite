/* Polling və marşrutlaşdırma (?check=…&tab=…). */
import { ApiError, api } from './api.js';
import { $, POLL_MS, announce, planName } from './dom.js';
import { state } from './state.js';
import { closeDetail } from '../shell/detail.js';
import { resetToUpload } from '../shell/session.js';
import { loadHistory, markCurrentVersion, renderNavCurrent } from '../shell/sidebar.js';
import { checkStepper, renderStepper, setOnline, showView } from '../shell/views.js';
import { finishTransition, renderRunError, renderRunProgress, sawRunning } from '../views/run-progress.js';
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
    renderRunProgress(null);
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
    renderRunProgress(check);
    renderRunError(check);
    announce('Yoxlama xəta ilə dayandı.');
    return;
  }
  if (check.run_state !== 'tamamlandi') {
    showView('run', title);
    setRunMode('running');
    $('run-plan').textContent = title;
    $('run-title').textContent = 'Yoxlama gedir';
    $('run-error').hidden = true;
    renderRunProgress(check);
    return;
  }
  if (check.verdict === 'giris_xetasi') {
    showView('run', title);
    setRunMode('ingest');
    $('run-plan').textContent = title;
    $('run-title').textContent = 'Fayl oxunmadı';
    $('ingest-error-text').textContent = check.error || 'Fayl oxunmadı.';
    $('ingest-error').hidden = false;
    announce('Fayl oxunmadı.');
    return;
  }
  const open = () => {
    showView('results', title);
    renderResults(check);
    announce('Yoxlama tamamlandı: ' + (check.verdict_label || ''));
  };
  // Bu sessiyada gedişat izlənibsə — 600ms keçid (mərhələlər ✓, ekran yığılır), sonra hesabat.
  if (sawRunning(check.id) && !$('view-run').hidden) finishTransition(check, open);
  else open();
}
export { openCheck, poller };
