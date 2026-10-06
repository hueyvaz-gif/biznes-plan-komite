/* Davam etdirmə və sıfırlama. */
import { api } from '../core/api.js';
import { $, setBusy } from '../core/dom.js';
import { openCheck, poller } from '../core/router.js';
import { state } from '../core/state.js';
import { closeDetail } from './detail.js';
import { markCurrentVersion } from './sidebar.js';
import { showView } from './views.js';
import { setFile, setPlanMode, showUploadError } from '../views/upload-flow.js';

/* ── Davam etdirmə və sıfırlama ─────────────────────────────────────────── */

async function retryCheck() {
  if (!state.check) return;
  setBusy($('retry-btn'), true, 'Davam edilir…');
  try {
    await api.post('/api/checks/' + encodeURIComponent(state.check.id) + '/retry');
    openCheck(state.check.id);
  } catch (e) {
    $('error-text').textContent = e.message || 'Serverlə əlaqə kəsildi.';
  } finally {
    setBusy($('retry-btn'), false);
  }
}
function resetToUpload() {
  poller.stop();
  closeDetail();
  state.check = null;
  state.review = null;
  setFile(null);
  showUploadError('');
  const params = new URLSearchParams(location.search);
  ['check', 'tab', 'review'].forEach((k) => params.delete(k));
  const query = params.toString();
  history.replaceState(null, '', query ? '?' + query : location.pathname);
  $('nav-current').hidden = true;
  setPlanMode('new');
  $('plan-id').value = '';
  $('plan-suggest').hidden = true;
  markCurrentVersion({ id: '', plan_id: '' });
  AiChat.setContext(null);
  showView('upload', 'Yeni yoxlama');
  $('plan-id').focus();
}

export { resetToUpload, retryCheck };
