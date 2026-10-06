/* Badge, Chip, FilterChips, Segmented, PlaceholderPill. */
import { el } from './el.js';
import { icon } from './icons.js';
import { t, splitPlaceholders } from '../i18n/az.js';

/** Hər tonun default ikonu: status yalnız rənglə bildirilmir. ✕ YALNIZ "silmək" üçündür — burada yoxdur. */
const TONE_ICON = { success: 'check', warning: 'dot', danger: 'alert', info: 'info', neutral: 'circle' };
export const TONES = Object.keys(TONE_ICON);

/** Köhnə status adları → ton. */
export const STATUS_TONE = { ok: 'success', warn: 'warning', fail: 'danger', skip: 'neutral', doc: 'info' };

/** Badge('Uyğun', {tone: 'success'}); icon: ad | false (ikonsuz); size: 'sm' | 'md'. */
export function Badge(text, { tone = 'neutral', icon: iconName, size = 'md', title } = {}) {
  const name = iconName === undefined ? TONE_ICON[tone] : iconName;
  return el('span', { class: ['ui-badge', `ui-badge--${tone}`, size === 'sm' && 'ui-badge--sm'], title },
    name ? icon(name, { size: 'sm' }) : null, el('span', { class: 'ui-badge__text', text }));
}

/** Ciddilik badge-i: ⚠ Yüksək · ● Orta · ○ Aşağı. */
const SEVERITY = { high: ['danger', 'alert'], medium: ['warning', 'dot'], low: ['neutral', 'circle'] };
export function SeverityBadge(level, opts = {}) {
  const [tone, name] = SEVERITY[level] || SEVERITY.low;
  return Badge(t(`severity.${level in SEVERITY ? level : 'low'}`), { tone, icon: name, ...opts });
}

/** Boş yer pill-i: "⌀ boş yer: təchizatçının adı". */
export function PlaceholderPill(what) {
  return el('span', { class: 'ui-phpill', title: what ? `Sənəddə doldurulmamış yer: ${what}` : 'Sənəddə doldurulmamış yer' },
    icon('empty', { size: 'sm' }),
    el('span', { text: what ? t('placeholder.pillWith', { what }) : t('placeholder.pill') }));
}

/** Mətndəki "[MƏLUMAT LAZIMDIR: …]" markerlərini pill-ə çevirərək fragment qaytarır. */
export function withPlaceholders(text) {
  const frag = document.createDocumentFragment();
  for (const part of splitPlaceholders(text)) {
    frag.append(part.placeholder !== undefined ? PlaceholderPill(part.placeholder) : document.createTextNode(part.text));
  }
  return frag;
}

/** Tək chip (düymə). pressed → aria-pressed. */
export function Chip(label, { count, tone, pressed = false, onClick, size = 'md' } = {}) {
  return el('button', {
    type: 'button', class: ['ui-chip', tone && `ui-chip--${tone}`, size === 'sm' && 'ui-chip--sm'],
    'aria-pressed': String(!!pressed), on: onClick ? { click: onClick } : undefined,
  }, el('span', { class: 'ui-chip__label', text: label }),
  count === undefined || count === null ? null : el('span', { class: 'ui-chip__count', text: String(count) }));
}

/** Roving tabindex: ox düymələri ilə qrup daxilində gəzmək. */
function rove(container, selector, onMove) {
  container.addEventListener('keydown', (e) => {
    const items = [...container.querySelectorAll(selector)].filter((n) => !n.disabled);
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = items[(next + items.length) % items.length];
    items.forEach((n) => { n.tabIndex = n === target ? 0 : -1; });
    target.focus();
    if (onMove) onMove(target);
  });
}

/**
 * FilterChips({label, items: [{id, label, count, tone}], value, onChange}).
 * Say badge-i olan filtr qrupu; aria-pressed; ox düymələri ilə gəzilir. .update(items, value) — sayları yeniləyir.
 */
export function FilterChips({ label, items, value, onChange }) {
  const root = el('div', { class: 'ui-filterchips', role: 'group', 'aria-label': label });
  let current = value;
  function render(list) {
    root.replaceChildren(...list.map((it) => {
      const chip = Chip(it.label, {
        count: it.count, tone: it.tone, pressed: it.id === current,
        onClick: () => { current = it.id; render(list); onChange && onChange(it.id); root.querySelector('[aria-pressed="true"]').focus(); },
      });
      chip.dataset.id = it.id;
      chip.tabIndex = it.id === current ? 0 : -1;
      if (it.count === 0 && it.id !== current) chip.classList.add('ui-chip--empty');
      return chip;
    }));
  }
  render(items);
  rove(root, '.ui-chip');
  root.update = (list, v = current) => { current = v; render(list); };
  return root;
}

/**
 * Segmented({label, options: [{value, label, icon, tone}], value, onChange}) — radiogroup.
 * Ox düymələri seçimi dəyişir (WAI-ARIA radio qaydası).
 */
export function Segmented({ label, options, value, onChange, size = 'md' }) {
  const root = el('div', { class: ['ui-segmented', size === 'sm' && 'ui-segmented--sm'], role: 'radiogroup', 'aria-label': label });
  const select = (btn, emit) => {
    root.querySelectorAll('[role="radio"]').forEach((b) => {
      const on = b === btn;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    root.dataset.value = btn.dataset.value;
    if (emit && onChange) onChange(btn.dataset.value);
  };
  for (const o of options) {
    const btn = el('button', {
      type: 'button', role: 'radio', class: ['ui-segmented__opt', o.tone && `ui-segmented__opt--${o.tone}`],
      dataset: { value: o.value }, 'aria-checked': 'false', tabIndex: -1,
      on: { click: () => select(btn, true) },
    }, o.icon ? icon(o.icon, { size: 'sm' }) : null, el('span', { text: o.label }));
    root.append(btn);
  }
  const initial = [...root.children].find((b) => b.dataset.value === value) || root.firstElementChild;
  select(initial, false);
  rove(root, '[role="radio"]', (btn) => select(btn, true));
  root.setValue = (v) => { const b = [...root.children].find((n) => n.dataset.value === v); if (b) select(b, false); };
  return root;
}

/** Tema keçidi: Avto / Açıq / Tünd — localStorage 'theme'. */
export function ThemeSwitch() {
  let saved = 'auto';
  try { saved = localStorage.getItem('theme') || 'auto'; } catch (_) { /* gizli rejim */ }
  return Segmented({
    label: t('theme.label'), size: 'sm', value: saved,
    options: [
      { value: 'auto', label: t('theme.auto'), icon: 'monitor' },
      { value: 'light', label: t('theme.light'), icon: 'sun' },
      { value: 'dark', label: t('theme.dark'), icon: 'moon' },
    ],
    onChange: (v) => {
      if (v === 'auto') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = v;
      try { if (v === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', v); } catch (_) { /* yox */ }
    },
  });
}

