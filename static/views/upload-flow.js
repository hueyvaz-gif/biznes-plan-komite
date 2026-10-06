/* Yeni yoxlama: biznes plan faylı, əlavə tələb sənədləri, göndərmə. */
import { ApiError, api } from '../core/api.js';
import { $, announce, el, formatAz, formatDate, formatSize, icon, planName, setBusy, setIcon } from '../core/dom.js';
import { openCheck } from '../core/router.js';
import { state } from '../core/state.js';
import { loadHistory } from '../shell/sidebar.js';

/* ── A: biznes plan faylı ───────────────────────────────────────────────── */

function setFile(file) {
  const limits = state.meta
    ? { maxBytes: state.meta.max_upload_bytes, maxMb: state.meta.max_upload_mb } : undefined;
  const result = selectFile(file, limits);       // etibarsız seçim faylı təmizləyir
  state.file = result.file;
  showUploadError(result.error || '');
  if (!result.file) {
    $('filechip').hidden = true;
    $('file-input').value = '';
    $('dropzone').classList.remove('has-file');
    updateFormState();
    return;
  }
  $('filechip-name').textContent = result.file.name;
  $('filechip-size').textContent = formatSize(result.file.size);
  $('filechip').hidden = false;
  $('dropzone').classList.add('has-file');
  announce('Biznes plan seçildi: ' + result.file.name);
  updateFormState();
}
/** "Davam et" vizual olaraq hazır olanda canlanır (deaktiv edilmir — xəta mətni izah edir). */
/** "Yeni plan yarat" / "Mövcud plana versiya əlavə et" — seçim açıqdır, ad uyğunluğu yalnız təklifdir. */
function planMode() {
  const checked = document.querySelector('input[name="plan-mode"]:checked');
  return checked ? checked.value : 'new';
}
function fillPlanSelect(plans) {
  const select = $('plan-select');
  const keep = select.value;
  const empty = el('option', null, plans.length ? 'Plan seçin…' : 'Hələ plan yoxdur');
  empty.value = '';
  select.replaceChildren(empty, ...plans.map((p) => {
    const o = el('option', null, planName(p) + ' · ' + formatAz(p.versions) + ' versiya · ' + formatDate(p.last_at));
    o.value = p.plan_id;
    return o;
  }));
  if (keep && plans.some((p) => p.plan_id === keep)) select.value = keep;
  $('plan-mode-existing').disabled = plans.length === 0;
}
function setPlanMode(mode, planId) {
  const radio = document.querySelector('input[name="plan-mode"][value="' + mode + '"]');
  if (radio) radio.checked = true;
  $('plan-new-box').hidden = mode !== 'new';
  $('plan-existing-box').hidden = mode !== 'existing';
  if (planId !== undefined) $('plan-select').value = planId;
  if (mode === 'existing') $('plan-suggest').hidden = true;
  updateFormState();
}
/** Ad mövcud planın adı ilə üst-üstə düşürsə — TƏKLİF göstərilir, avtomatik birləşdirmə yoxdur. */
function suggestExistingPlan() {
  const name = $('plan-id').value.trim().toLowerCase();
  const match = name && (state.plans || []).find((p) => planName(p).toLowerCase() === name);
  $('plan-suggest').hidden = !match;
  if (match) {
    $('plan-suggest-text').textContent = '“' + planName(match) + '” adlı plan artıq var (' + formatAz(match.versions)
      + ' versiya). Yeni plan ayrıca yaradılacaq — bu faylın həmin planın versiyası olmasını istəyirsinizsə:';
    $('plan-suggest-btn').onclick = () => { setPlanMode('existing', match.plan_id); $('plan-select').focus(); };
  }
}
function updateFormState() {
  const named = planMode() === 'existing' ? Boolean($('plan-select').value) : $('plan-id').value.trim().length > 0;
  const ready = Boolean(state.file) && named;
  $('submit-btn').classList.toggle('is-ready', ready);
  const extras = state.extras.some((e) => !e.error) || $('extra-text').value.trim().length > 0;
  $('next-step').textContent = 'Növbəti addım: ' + (extras ? 'tələblərin təsdiqi' : 'yoxlama və hesabat');
}
/** Əlavə tələblər akkordeonu; fayl və ya xəta varsa başlıqda xülasə görünür (gizli qalmır). */
function setExtrasOpen(open) {
  $('extra-toggle').setAttribute('aria-expanded', String(open));
  $('extra-body').hidden = !open;
  $('extra-acc').classList.toggle('is-open', open);
}
function updateExtraSummary() {
  const files = state.extras.length;
  const errors = state.extras.filter((e) => e.error).length;
  const text = $('extra-text').value.trim().length;
  const parts = [];
  if (files) parts.push(files + ' fayl');
  if (errors) parts.push(errors + ' xəta');
  if (text) parts.push('mətn');
  $('extra-summary').textContent = parts.join(' · ');
  $('extra-acc').classList.toggle('has-error', errors > 0);
  if (errors) setExtrasOpen(true);
  updateFormState();
}
function showUploadError(message) {
  $('upload-error').textContent = message || '';
  $('upload-error').hidden = !message;
}
function wireDropzone() {
  const zone = $('dropzone');
  const input = $('file-input');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => setFile(input.files[0] || null));
  const idleText = $('dropzone-text').textContent;
  ['dragenter', 'dragover'].forEach((n) => zone.addEventListener(n, (e) => {
    e.preventDefault(); zone.classList.add('is-over');
    $('dropzone-text').textContent = 'Buraxın — fayl qəbul ediləcək';
  }));
  ['dragleave', 'drop'].forEach((n) => zone.addEventListener(n, (e) => {
    e.preventDefault(); zone.classList.remove('is-over');
    $('dropzone-text').textContent = idleText;
  }));
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
    if (file) setFile(file);
  });
  $('filechip-remove').addEventListener('click', () => { setFile(null); zone.focus(); });
}
/* ── B: əlavə tələb sənədləri ───────────────────────────────────────────── */

function attachmentLimits() {
  return (state.meta && state.meta.attachments)
    || { max_files: 10, max_file_mb: 10, max_total_mb: 30, max_extra_text: 20000,
         formats: ['.docx', '.pdf', '.txt'] };
}
function extraFileError(file) {
  const lim = attachmentLimits();
  const name = file.name.toLowerCase();
  if (!lim.formats.some((f) => name.endsWith(f))) return 'Dəstəklənməyən format — yalnız PDF, DOCX, TXT.';
  if (file.size === 0) return 'Fayl boşdur.';
  if (file.size > lim.max_file_mb * 1024 * 1024) return 'Fayl ' + lim.max_file_mb + ' MB-dan böyükdür.';
  return null;
}
function addExtraFiles(files) {
  const lim = attachmentLimits();
  [...files].forEach((file) => {
    if (state.extras.length >= lim.max_files) {
      showUploadError('Ən çoxu ' + lim.max_files + ' əlavə fayl yükləmək olar.');
      return;
    }
    state.extras.push({ file, error: extraFileError(file) });
  });
  $('extra-input').value = '';
  renderExtraFiles();
}
function renderExtraFiles() {
  const list = $('extra-list');
  list.replaceChildren();
  state.extras.forEach((entry, index) => {
    const li = el('li', 'extrafile ' + (entry.error ? 'extrafile--error' : 'extrafile--ok'));
    li.append(setIcon(el('span', 'icon extrafile__icon'), entry.error ? 'alert' : 'file'));
    li.append(el('span', 'extrafile__name', entry.file.name));
    li.append(el('span', 'extrafile__size num', formatSize(entry.file.size)));
    const remove = el('button', 'iconbtn');
    remove.type = 'button';
    remove.append(icon('trash'), el('span', 'sr-only', entry.file.name + ' faylını sil'));
    remove.addEventListener('click', () => {
      state.extras.splice(index, 1);
      renderExtraFiles();
      $('extra-add').focus();
    });
    li.append(remove);
    li.append(el('span', 'extrafile__status', entry.error
      ? entry.error + ' Bu fayl göndərilməyəcək.'
      : 'Yükləməyə hazırdır — mətni serverdə çıxarılacaq, oxunma statusu təsdiq ekranında görünəcək.'));
    list.append(li);
  });
  const total = state.extras.reduce((s, e) => s + e.file.size, 0);
  const lim = attachmentLimits();
  updateExtraSummary();
  $('extra-limits').textContent = 'Formatlar: mətnli PDF, DOCX, TXT · hər fayl ən çoxu '
    + lim.max_file_mb + ' MB · cəmi ' + lim.max_total_mb + ' MB-a qədər · ən çoxu '
    + lim.max_files + ' fayl. Skan PDF üçün OCR yoxdur.'
    + (state.extras.length ? ' Seçilib: ' + state.extras.length + ' fayl, ' + formatSize(total) + '.' : '');
}
function updateExtraTextHint() {
  const lim = attachmentLimits();
  const length = $('extra-text').value.length;
  $('extra-text-hint').textContent = 'Hər tələbi ayrıca abzasda yazın. '
    + formatAz(length) + ' / ' + formatAz(lim.max_extra_text) + ' simvol.';
  updateExtraSummary();
}
/* ── Göndərmə ───────────────────────────────────────────────────────────── */

async function submitCheck(event) {
  event.preventDefault();
  if (state.sending) return;
  const existing = planMode() === 'existing';
  const planId = existing ? $('plan-select').value : $('plan-id').value.trim();
  if (!planId) {
    if (existing) { showUploadError('Versiya əlavə ediləcək planı seçin.'); $('plan-select').focus(); }
    else { showUploadError('Planın adını yazın.'); $('plan-id').focus(); }
    return;
  }
  if (state.extras.some((e) => e.error)) setExtrasOpen(true);       // xətalı fayl göndərilmir — görünsün
  if (!state.file) { showUploadError('Biznes plan faylını (DOCX) seçin.'); $('dropzone').focus(); return; }

  const lim = attachmentLimits();
  const valid = state.extras.filter((e) => !e.error);
  const total = valid.reduce((s, e) => s + e.file.size, 0);
  if (total > lim.max_total_mb * 1024 * 1024) {
    showUploadError('Əlavə faylların ümumi həcmi ' + lim.max_total_mb + ' MB-dan çoxdur.');
    return;
  }
  const extraText = $('extra-text').value;
  if (extraText.length > lim.max_extra_text) {
    showUploadError('Əlavə tələb mətni ' + lim.max_extra_text + ' simvoldan uzundur.');
    return;
  }

  const body = new FormData();
  body.append('file', state.file);
  if (existing) body.append('existing_plan_id', planId);
  else body.append('plan_name', planId);
  body.append('fail_at', $('fail-at').value || '');
  body.append('extra_text', extraText);
  valid.forEach((e) => body.append('extra_files', e.file));

  state.sending = true;
  setBusy($('submit-btn'), true, 'Göndərilir…');
  showUploadError('');
  announce('Sənəd göndərilir.');
  try {
    const created = await api.post('/api/checks', body);
    state.extras = [];
    $('extra-text').value = '';
    renderExtraFiles();
    openCheck(created.check_id, { fresh: true });
    loadHistory();
  } catch (e) {
    // Uğursuz olsa plan adı və seçilmiş fayllar saxlanılır.
    showUploadError(e instanceof ApiError ? e.message
      : 'Serverlə əlaqə kəsildi. Bağlantını yoxlayıb yenidən cəhd edin.');
  } finally {
    state.sending = false;
    setBusy($('submit-btn'), false);
  }
}

export { addExtraFiles, fillPlanSelect, renderExtraFiles, setExtrasOpen, setFile, setPlanMode, showUploadError, submitCheck, suggestExistingPlan, updateExtraTextHint, updateFormState, wireDropzone };
