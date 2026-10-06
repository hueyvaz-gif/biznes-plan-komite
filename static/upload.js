/* Fayl seçiminin yoxlanması — DOM-dan asılı deyil (Node testləri üçün).
 *
 * Qayda: YENİ seçim etibarsızdırsa, göndəriləcək fayl TƏMİZLƏNİR. Əvvəlki
 * düzgün fayl səssizcə saxlanılmır — istifadəçi xətanı görüb başqa fayl
 * seçmədən heç nə göndərilməz.
 *
 * Brauzerdə `window.selectFile`, Node-da `module.exports`.
 */
(function (root) {
  'use strict';

  const DEFAULT_LIMITS = { maxBytes: 25 * 1024 * 1024, maxMb: 25 };

  function sizeText(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
  }

  /** Faylın xətası (mətn) və ya null. */
  function fileError(file, limits) {
    const lim = limits || DEFAULT_LIMITS;
    if (!file.name.toLowerCase().endsWith('.docx')) return 'Yalnız .docx faylı qəbul edilir.';
    if (file.size === 0) return 'Fayl boşdur.';
    if (file.size > lim.maxBytes) {
      return 'Fayl çox böyükdür (' + sizeText(file.size) + '). Yuxarı hədd: ' + lim.maxMb + ' MB.';
    }
    return null;
  }

  /** Yeni seçimdən sonrakı vəziyyət: {file, error}. Etibarsız seçim faylı təmizləyir. */
  function selectFile(candidate, limits) {
    if (!candidate) return { file: null, error: null };
    const error = fileError(candidate, limits);
    return error ? { file: null, error: error } : { file: candidate, error: null };
  }

  const api = { selectFile: selectFile, fileError: fileError, sizeText: sizeText };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.selectFile = selectFile;
  }
})(this);
