/* Kitchen-sink: hər komponentin bütün variantları (dev vitrini, ?ui=kitchen-sink).
 * Buradakı rəqəmlər NÜMUNƏDİR — tətbiq görünüşləri rəqəmi yalnız API-dən alır. */
import {
  el, icon, Badge, SeverityBadge, PlaceholderPill, withPlaceholders, Chip, FilterChips, Segmented, ThemeSwitch,
  Card, StatTile, ProgressRing, MiniBar, KeyValue, EmptyState, Skeleton, DataTable, Disclosure, SourceQuote,
  toast, tooltip, openDrawer, TONES,
} from './index.js';
import { fmtMoney, fmtPct, fmtNumber, fmtYears, fmtDelta, fmtDate, fmtRelative, moneyLabel } from '../format.js';
import { GLOSSARY } from '../i18n/az.js';

const root = document.getElementById('ks-root');
document.getElementById('ks-theme').append(ThemeSwitch());

function section(id, title, note, ...content) {
  root.append(el('section', { class: 'ks-sec', id: `ks-${id}`, 'aria-labelledby': `ks-${id}-t` },
    el('h2', { class: 'ks-sec__title', id: `ks-${id}-t`, text: title }),
    note ? el('p', { class: 'ks-sec__note', text: note }) : null, ...content));
}
const row = (label, ...items) => el('div', { class: 'ks-row' }, label ? el('span', { class: 'ks-label', text: label }) : null, ...items);

/* ── Tokenlər ───────────────────────────────────────────────────────────── */
const SIZES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'kpi'];
section('type', 'Tipoqrafiya', '8 pillə. Rəqəmlər tabular (tnum), Inter ss01/cv11.',
  el('div', { class: 'ks-type' }, SIZES.map((s) => el('div', null,
    el('span', { class: 'ks-label', text: `--fs-${s}` }),
    el('span', { style: { fontSize: `var(--fs-${s})`, lineHeight: s === 'kpi' ? '1.1' : `var(--lh-${s})`, fontWeight: s === 'kpi' || s === '3xl' ? '700' : '500', letterSpacing: s === 'kpi' ? '-.02em' : null } },
      s === 'kpi' ? fmtMoney(1944881, { compact: true }) : 'Gübrə istehsalı — 14 746 938 ₼')))));

section('colors', 'Status rəngləri', 'Hər status: fon, sərhəd, mətn. Kontrast ≥ 4,5:1 (scripts/contrast-check.mjs).',
  el('div', { class: 'ks-swatches' }, TONES.map((tone) => el('div', {
    class: 'ks-swatch', style: { '--sw-bg': `var(--${tone}-bg)`, '--sw-line': `var(--${tone}-border)`, '--sw-fg': `var(--${tone}-fg)` },
  }, el('b', { text: tone }), el('span', { text: `--${tone}-bg / -border / -fg` })))));

section('elevation', 'Elevation', 'Kartın 1px sərhədi + çox yumşaq kölgə. Hover kölgəni bir pillə qaldırır, kart yerindən oynamır.',
  el('div', { class: 'ks-grid' }, ['e-0', 'e-1', 'e-2', 'e-3', 'e-accent'].map((e) =>
    el('div', { class: 'ks-elev', style: { boxShadow: `var(--${e})`, border: e === 'e-0' ? null : '1px solid var(--line)' }, text: `--${e}` }))));

/* ── Format ─────────────────────────────────────────────────────────────── */
const d = fmtDelta(14, 8, { higherIsBetter: false });
section('format', 'Rəqəm formatı (format.js)', 'Valyuta "₼", mənfi işarə U+2212, mərtəbələr bölünməz boşluqla.',
  KeyValue([
    ['fmtMoney', el('span', { class: 'ks-fmt', text: fmtMoney(1944881) })],
    ['kompakt', el('span', { class: 'ks-fmt', text: `${fmtMoney(1944881, { compact: true })} · ${fmtMoney(-18.9e6, { compact: true })} · ${fmtMoney(1.2e6, { compact: true, signed: true })}` })],
    ['fmtPct', el('span', { class: 'ks-fmt', text: `${fmtPct(0.1178)} · ${fmtPct(-0.009)} · ${fmtPct(0.025, { signed: true })}` })],
    ['fmtYears', el('span', { class: 'ks-fmt', text: fmtYears(7.44) })],
    ['fmtDelta', el('span', { class: `ks-fmt tone-${d.tone}`, text: `Boş yer 14 → 8: ${fmtNumber(d.abs, { signed: true })} (${fmtPct(d.pct, { signed: true })}), ${d.tone}` })],
    ['mənfi rəng', el('span', { class: 'ks-fmt tone-negative', text: fmtMoney(-3354836) })],
    ['ekran oxuyucu', el('span', { class: 'ks-fmt', text: moneyLabel(-3354836, { compact: true }) })],
    ['tarix', el('span', { class: 'ks-fmt', text: `${fmtDate('2026-10-05T21:59:00')} · ${fmtRelative('2026-10-05T21:59:00', new Date('2026-10-06T10:00:00'))}` })],
  ]));

/* ── Badge ──────────────────────────────────────────────────────────────── */
section('badge', 'Badge', 'Status heç vaxt yalnız rənglə bildirilmir: ikon + mətn. ✕ yalnız "sil" üçündür.',
  row('md', Badge('Uyğun', { tone: 'success' }), Badge('Dəqiqləşdirmə', { tone: 'warning' }), Badge('Uyğunsuzluq', { tone: 'danger' }),
    Badge('Ayrıca sənəd', { tone: 'info' }), Badge('Yoxlanılmadı', { tone: 'neutral' })),
  row('sm', Badge('Uyğun', { tone: 'success', size: 'sm' }), Badge('Dəqiqləşdirmə', { tone: 'warning', size: 'sm' }),
    Badge('Kritik', { tone: 'danger', size: 'sm' }), Badge('v2', { tone: 'neutral', size: 'sm', icon: false })),
  row('ciddilik', SeverityBadge('high'), SeverityBadge('medium'), SeverityBadge('low')),
  row('boş yer', PlaceholderPill('təchizatçının adı'), PlaceholderPill()),
  row('mətndə', el('span', null, withPlaceholders('Şirkətin adı: [MƏLUMAT LAZIMDIR: VÖEN, hüquqi ünvan], qeydiyyat tarixi [MƏLUMAT LAZIMDIR].'))));

/* ── Chip / FilterChips / Segmented ─────────────────────────────────────── */
const live = el('p', { class: 'ks-sec__note', 'aria-live': 'polite', text: 'Seçim: Hamısı' });
section('chips', 'Chip və filtrlər', 'Saylar badge-dədir; aria-pressed; ox düymələri ilə gəzmək olur.',
  row(null, FilterChips({
    label: 'Tələb filtri', value: 'all',
    items: [{ id: 'all', label: 'Hamısı', count: 47 }, { id: 'problem', label: 'Problemlilər', count: 9, tone: 'warning' },
      { id: 'missing', label: 'Yoxdur', count: 0, tone: 'danger' }, { id: 'skip', label: 'Yoxlanılmayan', count: 0 },
      { id: 'doc', label: 'Ayrıca sənəd', count: 3 }],
    onChange: (id) => { live.textContent = 'Seçim: ' + id; },
  })), live,
  row('tək', Chip('Kritik', { count: 3, tone: 'danger' }), Chip('Seçilmiş', { pressed: true, count: 12 }), Chip('Kiçik', { size: 'sm' })),
  row('segmented', Segmented({
    label: 'Sualın statusu', value: 'open',
    options: [{ value: 'open', label: 'Açıq' }, { value: 'waiting', label: 'Cavab gözlənilir', tone: 'warning' },
      { value: 'answered', label: 'Cavablandı', tone: 'success' }, { value: 'rejected', label: 'Rədd edildi', tone: 'danger' }],
  })),
  row('kiçik', Segmented({ label: 'Görünüş', size: 'sm', value: 'list', options: [{ value: 'list', label: 'Siyahı' }, { value: 'board', label: 'Lövhə' }] })));

/* ── StatTile / ProgressRing / MiniBar ──────────────────────────────────── */
section('tiles', 'StatTile, ProgressRing, MiniBar', 'Dəyər ilk görünəndə count-up ilə gəlir (400ms); reduced-motion-da ani.',
  el('div', { class: 'ks-grid' },
    StatTile({ label: 'Maliyyə', value: 6, format: (v) => `${fmtNumber(Math.round(v))}/7`, sub: '1 dəqiqləşdirmə', progress: { value: 6, max: 7 }, onClick: () => toast({ message: 'Maliyyə tabına keçid' }) }),
    StatTile({ label: 'Tələblər', value: 34, format: (v) => `${fmtNumber(Math.round(v))}/44`, sub: '9 natamam · 1 tətbiq edilmir',
      segments: [{ value: 34, tone: 'success', label: 'tam' }, { value: 9, tone: 'warning', label: 'natamam' }, { value: 1, tone: 'neutral', label: 'tətbiq edilmir' }], onClick: () => {} }),
    StatTile({ label: 'Boş yerlər', value: 8, unit: 'yer', sub: '7-si düzəlişlərin içində', tone: 'warning', onClick: () => {} }),
    StatTile({ label: 'NPV', value: 1944881, format: (v) => fmtMoney(v, { compact: true }), sub: 'Planda ↔ yenidən hesablanmış ✓', delta: { text: `${fmtMoney(-4.2e6, { compact: true })} baza ilə`, tone: 'negative' } })),
  row('ring', ProgressRing({ value: 77, label: 'Hazırlıq 77%' }), ProgressRing({ value: 100, size: 48, stroke: 5, tone: 'success' }),
    ProgressRing({ value: 40, size: 48, stroke: 5, tone: 'warning' }), ProgressRing({ value: 12, size: 40, stroke: 4, tone: 'danger', center: '1/8' })),
  el('div', { style: { maxWidth: '320px' } }, MiniBar({ value: 3, max: 9, label: '3/9 işarələnib' })));

/* ── Card ───────────────────────────────────────────────────────────────── */
section('card', 'Card', 'header (başlıq + meta + actions), body, footer; variant accent-left.',
  el('div', { class: 'ks-grid ks-grid--2' },
    Card({ title: 'Maliyyə xülasəsi', meta: 'Planın öz cədvəllərindən', actions: el('button', { type: 'button', class: 'btn btn--small', text: 'Ətraflı' }),
      body: KeyValue([['İnvestisiya', fmtMoney(14746938)], ['NPV', fmtMoney(1944881)], ['IRR', fmtPct(0.1178)], ['PP', fmtYears(7.44)]]),
      footer: 'Yenidən hesablanıb · 05.10.2026' }),
    Card({ title: 'Şirkətin rekvizitləri', meta: 'TS2 · Düzəliş', variant: 'accent-left', tone: 'warning',
      body: el('p', null, withPlaceholders('VÖEN, hüquqi ünvan və təsis tarixi doldurulmayıb: [MƏLUMAT LAZIMDIR: VÖEN, hüquqi ünvan].')) }),
    Card({ title: 'Satış qiyməti −10%', meta: 'Sıfır həddi −0,9%', variant: 'accent-left', tone: 'danger', body: el('p', { text: 'NPV mənfi olur, çünki gəlirin kiçik azalması pul axınını sıfırın altına salır.' }) }),
    Card({ title: 'Uyğun', variant: 'accent-left', tone: 'success', body: el('p', { text: 'İnvestisiyanın cəmi planla eynidir.' }) })));

/* ── DataTable ──────────────────────────────────────────────────────────── */
const finRows = [
  { id: 'inv', name: 'İnvestisiyanın cəmi', plan: 14746938, calc: 14746938, diff: 0, status: { status: 'ok', label: 'Uyğun' } },
  { id: 'src', name: 'Maliyyələşmə mənbələrinin cəmi', plan: 14746938, calc: 16760899, diff: 2013961, status: { status: 'warn', label: 'Dəqiqləşdirmə' } },
  { id: 'npv', name: 'Xalis cari dəyər (NPV)', plan: 1944880, calc: 1944881, diff: 1, status: { status: 'ok', label: 'Uyğun' } },
  { id: 'nowtv', name: 'NPV (qalıq dəyərsiz)', plan: null, calc: -3354836, diff: null, status: { status: 'skip', label: 'Məlumat' } },
];
section('table', 'DataTable', 'Rəqəm sütunları sağa və tabular; mənfi qırmızı; başlıq sticky; < 768px kart siyahısı.',
  DataTable({
    caption: 'Maliyyə yoxlamaları', rows: finRows,
    columns: [
      { key: 'name', label: 'Yoxlama', width: '34%' },
      { key: 'plan', label: 'Planda', type: 'number', render: (r) => fmtMoney(r.plan) },
      { key: 'calc', label: 'Hesablama', type: 'number', signed: true, render: (r) => fmtMoney(r.calc) },
      { key: 'diff', label: 'Fərq', type: 'number', render: (r) => fmtMoney(r.diff) },
      { key: 'status', label: 'Status', type: 'status' },
      { key: 'go', label: 'Əməliyyat', type: 'actions', render: () => el('button', { type: 'button', class: 'btn btn--small', text: 'Ətraflı' }) },
    ],
  }),
  el('div', { style: { marginTop: 'var(--sp-4)' } }, DataTable({ columns: [{ key: 'a', label: 'Boş cədvəl' }], rows: [], empty: 'Bu filtrə uyğun yoxlama yoxdur' })));

/* ── SourceQuote / Disclosure / KeyValue ────────────────────────────────── */
section('quote', 'SourceQuote, Disclosure, KeyValue', 'Sitat hərfidir; 2 sətirdən uzundursa "daha çox".',
  el('div', { class: 'ks-grid ks-grid--2' },
    Card({ title: 'Sitat', body: el('div', { style: { display: 'grid', gap: 'var(--sp-4)' } },
      SourceQuote({ section: '7.1. İnvestisiyanın həcmi və strukturu', location: 'Cədvəl T15-də', onOpen: () => toast({ message: 'Sənəd görüntüsü açılır…' }),
        quote: 'Layihənin ümumi investisiya dəyəri 14 746 938 manat təşkil edir ki, bunun 12 546 938 manatı əsas vəsaitlərə, 2 200 000 manatı isə dövriyyə kapitalına yönəldilir. Maliyyələşmə mənbələri bank krediti və təsisçinin öz vəsaitidir.' }),
      SourceQuote({ section: '3.5. Avadanlıqlar', location: 'Mətndə', quote: 'Avadanlıq Çindən gətiriləcək.' })) }),
    Card({ title: 'Disclosure', body: el('div', null,
      Disclosure({ summary: 'Necə hesablanıb', content: el('div', null,
        el('ol', { style: { margin: '0', paddingLeft: '18px' } },
          el('li', { text: 'Hər ilin satış gəliri 10% azaldılır.' }),
          el('li', { text: 'Yeni pul axını planın diskont dərəcəsi ilə bu günə gətirilir.' }),
          el('li', { text: 'Bütün illərin cəmi yeni NPV-dir.' })),
        el('p', { class: 'mono', style: { color: 'var(--ink-faint)', marginTop: 'var(--sp-2)' }, text: 'NPV = Σ FCFF_t / (1+r)^t' })) }),
      Disclosure({ summary: 'Yoxlama haqqında', open: true, content: KeyValue([['Model', 'Gemini'], ['Qaydalar', 'v2026.10'], ['Tarix', fmtDate('2026-10-05T21:59:00')]], { dense: true }) })) })));

/* ── EmptyState / Skeleton ──────────────────────────────────────────────── */
section('empty', 'EmptyState və Skeleton', null,
  el('div', { class: 'ks-grid ks-grid--2' },
    EmptyState({ title: 'Bu yoxlamada əlavə tələb yoxdur', text: 'Əlavə tələb sənədi yükləsəniz, tələblər ayrıca yoxlanılacaq.', action: { label: 'Əlavə tələb sənədi ilə yenidən yoxla', onClick: () => toast({ message: 'Yeni versiya axını' }) } }),
    EmptyState({ icon: 'search', compact: true, title: 'Nəticə tapılmadı', text: '"VÖEN" sorğusuna uyğun tələb yoxdur.' })),
  el('div', { class: 'ks-grid' }, Skeleton({ shape: 'tile' }), Skeleton({ shape: 'card', lines: 3 }), Skeleton({ shape: 'text', lines: 4 })),
  Skeleton({ shape: 'table', rows: 3 }));

/* ── Overlay: Toast / Tooltip / Drawer ──────────────────────────────────── */
const tipTarget = el('abbr', { class: 'ks-abbr', text: 'FCFF' });
tooltip(tipTarget, GLOSSARY.FCFF);
const tipBtn = el('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Düstur' }, icon('func'));
tooltip(tipBtn, 'Satış gəliri hər il 10% azaldılır, fərq pul axınından çıxılır.');
section('overlay', 'Toast, Tooltip, Drawer', 'Tooltip 300ms gecikmə ilə, fokusda da açılır. Drawer: fokus tələsi, Esc, fokus açan düyməyə qayıdır.',
  row('toast',
    el('button', { type: 'button', class: 'btn', text: 'Uğur', on: { click: () => toast({ message: 'Sual əlavə edildi', tone: 'success', action: { label: 'Geri al', onClick: () => toast({ message: 'Geri alındı' }) } }) } }),
    el('button', { type: 'button', class: 'btn', text: 'Xəta', on: { click: () => toast({ message: 'Status saxlanmadı — şəbəkə xətası', tone: 'danger' }) } })),
  row('tooltip', el('span', null, 'Termin: ', tipTarget), tipBtn),
  row('drawer', el('button', { type: 'button', class: 'btn btn--primary', text: 'Sənəd görüntüsünü aç', on: { click: () => openDrawer({
    title: '7.1. İnvestisiyanın həcmi',
    content: el('div', { style: { display: 'grid', gap: 'var(--sp-4)' } },
      el('p', { text: 'Layihənin ümumi investisiya dəyəri 14 746 938 manat təşkil edir.' }),
      SourceQuote({ section: 'Cədvəl T15', quote: 'Əsas vəsaitlər — 12 546 938 manat' }),
      el('button', { type: 'button', class: 'btn', text: 'Fokuslanan düymə' })),
    footer: el('div', { class: 'ks-row', style: { margin: 0, justifyContent: 'space-between' } },
      el('button', { type: 'button', class: 'btn btn--small' }, icon('chevronLeft', { size: 'sm' }), 'Əvvəlki'),
      el('button', { type: 'button', class: 'btn btn--small' }, 'Növbəti', icon('chevronRight', { size: 'sm' }))),
  }) } })));
