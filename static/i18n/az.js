/* UI mətnləri — bir mənbə. Terminologiya qaydaları (tapşırıq, Bölmə 13):
 *   • "Dəqiqləşdirmə" (Xəbərdarlıq yox) — bütün tablarda eyni;
 *   • ciddilik: "⚠ Yüksək" / "● Orta" / "○ Aşağı" ("Bayraq" sözü yoxdur);
 *   • "boş yer" (placeholder yox); "[MƏLUMAT LAZIMDIR: X]" → "boş yer: X";
 *   • valyuta "₼" (format.js); başlıqlar cümlə formasında.
 * Yeni mətn əlavə edəndə buraya yaz; komponent və görünüşlər t('açar') ilə oxuyur.
 */

export const AZ = {
  // Ümumi
  'common.more': 'daha çox',
  'common.less': 'daha az',
  'common.close': 'Bağla',
  'common.undo': 'Geri al',
  'common.reset': 'Sıfırla',
  'common.details': 'Ətraflı',
  'common.all': 'Hamısı',
  'common.prev': 'Əvvəlki',
  'common.next': 'Növbəti',
  'common.loading': 'Yüklənir…',
  'common.noData': 'Məlumat yoxdur',
  'common.showTable': 'Cədvəl kimi göstər',
  'common.hideTable': 'Cədvəli gizlət',

  // Status (yoxlama nəticəsi)
  'status.ok': 'Uyğun',
  'status.warn': 'Dəqiqləşdirmə',
  'status.fail': 'Uyğunsuzluq',
  'status.skip': 'Yoxlanılmadı',

  // Tamlıq hökmü
  'verdict.hazir': 'Hazırdır',
  'verdict.duzelis': 'Düzəliş lazımdır',
  'verdict.hazir_deyil': 'Hazır deyil',

  // Ciddilik
  'severity.high': 'Yüksək',
  'severity.medium': 'Orta',
  'severity.low': 'Aşağı',

  // Sual statusları
  'question.open': 'Açıq',
  'question.waiting': 'Cavab gözlənilir',
  'question.answered': 'Cavablandı',
  'question.accepted': 'Qəbul edildi',
  'question.rejected': 'Rədd edildi',

  // Sənəd və mənbə
  'source.inDoc': 'Sənəddə yeri',
  'source.view': 'Mənbəyə bax',
  'source.inText': 'Mətndə',
  'source.inTable': 'Cədvəl {table}-da',
  'placeholder.pill': 'boş yer',
  'placeholder.pillWith': 'boş yer: {what}',
  'calc.computed': 'Hesablanıb',
  'calc.howComputed': 'Necə hesablanıb',

  // Tema
  'theme.label': 'Tema',
  'theme.auto': 'Avto',
  'theme.light': 'Açıq',
  'theme.dark': 'Tünd',

  // Simulyasiya
  'sim.note': 'Simulyasiya: planın öz rəqəmləri əsasında kodun hesabıdır. Yoxlama nəticəsinə təsir etmir.',
};

/** Terminlərin ilk istifadədə tooltip izahı. */
export const GLOSSARY = {
  FCFF: 'FCFF — firmaya sərbəst pul axını',
  NPV: 'NPV — xalis cari dəyər',
  IRR: 'IRR — daxili rentabellik dərəcəsi',
  PP: 'PP — özünü ödəmə müddəti',
  WACC: 'WACC — kapitalın orta çəkili dəyəri',
  Ke: 'Ke — səhmdar kapitalının dəyəri',
  capex: 'Capex — əsaslı xərclər (investisiya)',
};

/** t('source.inTable', {table: 'T9'}) → "Cədvəl T9-da". Açar yoxdursa açarın özü qaytarılır (səhv görünsün). */
export function t(key, vars) {
  const text = AZ[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : text;
}

/** "[MƏLUMAT LAZIMDIR: VÖEN, hüquqi ünvan]" → {what: "VÖEN, hüquqi ünvan"}; marker deyilsə null. */
export function parsePlaceholder(text) {
  const m = /^\s*\[\s*MƏLUMAT LAZIMDIR\s*(?::\s*([^\]]*))?\]\s*$/iu.exec(String(text || ''));
  return m ? { what: (m[1] || '').trim() } : null;
}

/** Mətndəki bütün markerləri parçalara bölür: [{text}|{placeholder: what}] — vizual pill üçün. */
export function splitPlaceholders(text) {
  const out = [];
  const re = /\[\s*MƏLUMAT LAZIMDIR\s*(?::\s*([^\]]*))?\]/giu;
  let last = 0;
  for (const m of String(text || '').matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ placeholder: (m[1] || '').trim() });
    last = m.index + m[0].length;
  }
  if (last < String(text || '').length) out.push({ text: String(text).slice(last) });
  return out;
}
