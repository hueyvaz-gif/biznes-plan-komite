/* Status etiketləri və ton xəritələri. */

const STATUS_LABELS = { ok: 'Uyğun', warn: 'Xəbərdarlıq', fail: 'Uyğunsuzluq', skip: 'Yoxlanılmadı' };
const STEP_STATE = { gozleyir: 'Gözləyir', isleyir: 'İşləyir', tamamlandi: 'Tamamlandı', xeta: 'Xəta' };
/* Tələbin statusu: etiket + rəng sinfi (sinif həm də işarə qoyur). */
const REQ_STATUS = {
  var: { label: 'Cavablandırılıb', cls: 's-ok' },
  natamam: { label: 'Natamam', cls: 's-warn' },
  yoxdur: { label: 'Cavabsız', cls: 's-fail' },
  tetbiq_edilmir: { label: 'Tətbiq edilmir', cls: 's-na' },
  sened: { label: 'Ayrıca sənəd', cls: 's-doc' },
  skip: { label: 'Yoxlanılmadı', cls: 's-skip' },
};
const REQ_TECHNICAL = { label: 'Texniki nasazlıq', cls: 's-fail' };
const VERDICT_TONE = { hazir: 'ok', duzelis: 'warn', hazir_deyil: 'fail', giris_xetasi: 'fail' };
const SEVERITY = {
  kritik: { label: 'Kritik', cls: 's-fail' },
  duzelis: { label: 'Düzəliş', cls: 's-warn' },
  melumat: { label: 'Məlumat', cls: 's-doc' },
};
const TREND = {
  yaxsilasdi: { label: 'Yaxşılaşdı', cls: 's-ok' },
  pislesdi: { label: 'Pisləşdi', cls: 's-fail' },
  deyisdi: { label: 'Dəyişdi', cls: 's-skip' },
};

export { REQ_STATUS, REQ_TECHNICAL, STATUS_LABELS, STEP_STATE, TREND, VERDICT_TONE };
