/* Giriş nöqtəsi (ES module). Klassik UMD skriptləri (poll, upload, charts, agents, market, chat, report,
 * econ-core) index.html-də ƏVVƏL yüklənir və window-a yazılır; Node testləri onları require ilə oxuyur.
 * views/economics.js window.Econ-u qurur — import yan təsir üçündür. */
import './views/economics.js';
import { api } from './core/api.js';
import { $, announce, countUp, el, icon, planName, revealOnce, setIcon } from './core/dom.js';
import { openCheck } from './core/router.js';
import { state } from './core/state.js';
import { closeDetail, trapFocus } from './shell/detail.js';
import { resetToUpload, retryCheck } from './shell/session.js';
import { loadHistory, renderNavCurrent } from './shell/sidebar.js';
import { selectTab, wireTabs } from './shell/tabs.js';
import { wireHero } from './shell/hero.js';
import { wireShortcuts } from './shell/palette.js';
import { wireSummary } from './views/summary-panel.js';
import { closeNav, openNav, setOnline, showView } from './shell/views.js';
import { AG, renderAgentTable } from './views/debug-log.js';
import { setFinanceFilter } from './views/finance.js';
import { renderRequirements, retryFailedGroups, setRequirementFilter } from './views/requirements.js';
import { confirmReview, fitArea, reextract, renderReview, renderReviewItems, updateConfirmState } from './views/review.js';
import { prepareForPrint, setFixesOpen } from './views/summary.js';
import { addExtraFiles, renderExtraFiles, setExtrasOpen, setPlanMode, showUploadError, submitCheck, suggestExistingPlan, updateExtraTextHint, updateFormState, wireDropzone } from './views/upload-flow.js';

/* ── Başlanğıc ──────────────────────────────────────────────────────────── */

function applyMeta() {
  const meta = state.meta || {};
  const facts = meta.facts;
  if (facts) {
    $('facts').hidden = false;
    countUp($('fact-req'), facts.requirements);
    $('fact-req-sub').textContent = facts.document_only !== undefined
      ? '(' + facts.in_plan + '-i planın mətnində yoxlanılır, ' + facts.document_only + '-i ayrıca sənəd)' : '';
    countUp($('fact-groups'), facts.groups);
    countUp($('fact-fin'), facts.finance_checks);
  }
  if (meta.max_upload_mb) $('max-mb').textContent = String(meta.max_upload_mb);
  const select = $('fail-at');
  select.replaceChildren();
  (meta.fail_at_options || []).forEach((o) => { const n = el('option', null, o.label); n.value = o.id; select.append(n); });
  $('dev-box').hidden = !(meta.dev_mode && (meta.fail_at_options || []).length);
  renderExtraFiles();
  updateExtraTextHint();
}
async function init() {
  document.querySelectorAll('[data-icon]').forEach((n) => setIcon(n, n.dataset.icon));
  wireDropzone();
  wireTabs();
  wireHero();
  wireShortcuts();
  wireSummary();
  revealOnce(document.querySelector('.explain__art'));
  $('upload-form').addEventListener('submit', submitCheck);
  $('extra-add').addEventListener('click', () => $('extra-input').click());
  $('extra-input').addEventListener('change', (e) => addExtraFiles(e.target.files));
  $('extra-text').addEventListener('input', updateExtraTextHint);
  $('plan-id').addEventListener('input', () => { updateFormState(); suggestExistingPlan(); });
  document.querySelectorAll('input[name="plan-mode"]').forEach((r) => r.addEventListener('change', () => setPlanMode(r.value)));
  $('plan-select').addEventListener('change', updateFormState);
  $('extra-toggle').addEventListener('click', () => setExtrasOpen($('extra-toggle').getAttribute('aria-expanded') !== 'true'));
  $('nav-history').addEventListener('click', () => {
    // Rail rejimində (861–1080px) siyahı görünmür — panel tam enində açılır.
    if (matchMedia('(min-width: 861px) and (max-width: 1080px)').matches && !$('sidebar').classList.contains('is-open')) {
      openNav();
      return;
    }
    const open = $('nav-history').getAttribute('aria-expanded') !== 'true';
    $('nav-history').setAttribute('aria-expanded', String(open));
    $('history-box').hidden = !open;
  });
  $('nav-help').addEventListener('click', () => { closeNav(); AiChat.open(); });
  $('nav-new').addEventListener('click', resetToUpload);
  $('menu-btn').addEventListener('click', () => ($('sidebar').classList.contains('is-open') ? closeNav() : openNav()));
  $('nav-scrim').addEventListener('click', closeNav);
  $('error-new').addEventListener('click', resetToUpload);
  $('ingest-new').addEventListener('click', resetToUpload);
  $('review-cancel').addEventListener('click', resetToUpload);
  $('retry-btn').addEventListener('click', retryCheck);
  $('retry-groups-btn').addEventListener('click', retryFailedGroups);
  $('review-add').addEventListener('click', () => {
    if (!state.review) return;
    state.review.items.push({ text: '', kind: 'plan', origin: 'istifadeci' });
    renderReviewItems();
    const areas = $('review-items').querySelectorAll('textarea');
    if (areas.length) areas[areas.length - 1].focus();
  });
  $('review-confirm').addEventListener('click', confirmReview);
  $('review-reextract').addEventListener('click', reextract);
  $('review-ack').addEventListener('change', updateConfirmState);
  $('print-btn').addEventListener('click', () => { prepareForPrint(); window.print(); });
  $('res-newversion').addEventListener('click', () => {
    if (!state.check) return;
    const planId = state.check.plan_id;
    resetToUpload();
    setPlanMode('existing', planId);
    $('dropzone').focus();
  });
  window.addEventListener('beforeprint', prepareForPrint);        // Ctrl+P ilə də
  window.addEventListener('afterprint', () => setFixesOpen(false));  // çapdan sonra yenə ilk 6 bənd
  window.addEventListener('resize', () => $('review-items').querySelectorAll('textarea').forEach(fitArea));
  $('sum-retry').addEventListener('click', () => $('retry-groups-btn').click());
  document.querySelectorAll('.golink').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.goto, true)));
  $('ag-filter').addEventListener('change', (e) => { AG.filter = e.target.value; renderAgentTable(); });
  $('ag-errors').addEventListener('change', (e) => { AG.errorsOnly = e.target.checked; renderAgentTable(); });
  $('detail-close').addEventListener('click', closeDetail);
  $('detail-scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    trapFocus(e);
    if (e.key === 'Escape') { closeDetail(); closeNav(); }
  });
  document.querySelectorAll('[data-fin]').forEach((c) => c.addEventListener('click', () => setFinanceFilter(c.dataset.fin)));
  document.querySelectorAll('[data-req]').forEach((c) => c.addEventListener('click', () => setRequirementFilter(c.dataset.req)));
  $('req-group').addEventListener('change', (e) => { state.reqGroup = e.target.value; renderRequirements(); });
  $('req-search').addEventListener('input', (e) => { state.reqQuery = e.target.value.trim().toLowerCase(); renderRequirements(); });
  window.addEventListener('offline', () => setOnline(false));
  window.addEventListener('online', () => setOnline(true));

  const params = new URLSearchParams(location.search);
  if (params.get('demo') === '1') {
    try {
      const response = await fetch('/static/demo/demo.json');
      state.demo = await response.json();
      $('demo-banner').hidden = false;
      $('submit-btn').title = 'Demo rejimində göndərilmir';
    } catch (_) {
      showUploadError('Demo məlumatı tapılmadı: python scripts/make_demo.py işlədin.');
    }
  }
  try { state.meta = await api.get('/api/meta'); } catch (_) { /* meta olmasa da işləyir */ }
  applyMeta();
  // Bazar icmalı və AI köməkçi müstəqildir: xətaları sənəd yoxlamasını dayandırmır.
  const deps = { el, $, setIcon, icon, announce, demo: () => Boolean(state.demo),
    get: (path) => api.get(path) };
  Market.init(deps);
  AiChat.init(deps);

  loadHistory();
  const checkId = params.get('check');
  if (checkId && state.demo && params.get('review') === '1') {
    showReviewDemo(checkId);
  } else if (checkId) {
    openCheck(checkId, { keepTab: true });
  } else {
    showView('upload', 'Yeni yoxlama');
  }
}
/** Demo: əlavə tələbli yoxlamanın təsdiq ekranı (qaralama ilə, göndərilmir). */
function showReviewDemo(checkId) {
  const check = state.demo.checks[checkId];
  if (!check) { showView('upload', 'Yeni yoxlama'); return; }
  const pending = { ...check, run_state: 'tesdiq_gozleyir', error: null };
  state.check = pending;
  renderNavCurrent(pending);
  showView('review', planName(check) + ' · v' + check.version + ' · əlavə tələblər');
  renderReview(pending);
}

init();
