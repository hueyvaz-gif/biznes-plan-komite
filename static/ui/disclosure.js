/* SourceQuote, Disclosure. */
import { el, nextId } from './el.js';
import { icon } from './icons.js';
import { t } from '../i18n/az.js';

/**
 * Disclosure({summary, content, open, level}) — "▸ Necə hesablanıb" tipli yığılan blok.
 * Hündürlük grid-template-rows 0fr → 1fr ilə animasiyalıdır; bağlı olanda məzmun `inert`-dir (fokus düşmür).
 */
export function Disclosure({ summary, content, open = false, onToggle } = {}) {
  const id = nextId('disc');
  const btn = el('button', { type: 'button', class: 'ui-disc__btn', 'aria-expanded': String(open), 'aria-controls': id },
    icon('chevronRight', { size: 'sm' }), el('span', { text: summary }));
  const inner = el('div', { class: 'ui-disc__inner' }, content);
  const panel = el('div', { class: 'ui-disc__panel', id }, inner);
  const root = el('div', { class: ['ui-disc', open && 'is-open'] }, btn, panel);
  const set = (v) => {
    root.classList.toggle('is-open', v);
    btn.setAttribute('aria-expanded', String(v));
    inner.inert = !v;
    if (onToggle) onToggle(v);
  };
  inner.inert = !open;
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  root.setOpen = set;
  return root;
}

/**
 * SourceQuote({section, quote, location, onOpen}) — sənəd sitatı.
 *   section — bölmə adı (onOpen varsa link-düymə: sənəd görüntüsünü açır);
 *   quote — HƏRFİ sitat (italik, 2 sətirdən sonra "daha çox");
 *   location — "Mətndə" / "Cədvəl T9-da" kimi yer tipi.
 */
export function SourceQuote({ section, quote, location, onOpen } = {}) {
  const text = el('blockquote', { class: 'ui-quote__text' }, el('span', { text: quote ? `“${quote}”` : '' }));
  const more = el('button', { type: 'button', class: 'ui-quote__more', hidden: true, 'aria-expanded': 'false', text: t('common.more') });
  more.addEventListener('click', () => {
    const open = !text.classList.contains('is-open');
    text.classList.toggle('is-open', open);
    more.setAttribute('aria-expanded', String(open));
    more.textContent = open ? t('common.less') : t('common.more');
  });
  const sectionNode = onOpen
    ? el('button', { type: 'button', class: 'ui-quote__section', title: t('source.inDoc'), on: { click: onOpen } }, icon('locate', { size: 'sm' }), el('span', { text: section }))
    : el('span', { class: 'ui-quote__section ui-quote__section--static' }, icon('locate', { size: 'sm' }), el('span', { text: section }));
  const node = el('figure', { class: 'ui-quote' },
    quote ? text : null,
    el('figcaption', { class: 'ui-quote__cap' }, section ? sectionNode : null,
      location ? el('span', { class: 'ui-quote__loc', text: location }) : null, quote ? more : null));
  // "daha çox" yalnız mətn həqiqətən 2 sətirdən uzundursa (render-dən sonra ölçülür).
  requestAnimationFrame(() => { if (text.scrollHeight > text.clientHeight + 2) more.hidden = false; });
  return node;
}
