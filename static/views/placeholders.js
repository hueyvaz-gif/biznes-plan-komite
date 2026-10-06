/* Boş yerlər tabı (Faza 5): kart siyahısı — insan dilində başlıq, yer tipi (¶ mətndə / ▦ cədvəl), sənəd fraqmenti
 * (<mark> ilə), "Sənəddə göstər" (sənəd görüntüsü drawer-i). Yuxarıda üfüqi sənəd mini-xəritəsi: hər boş yerin
 * sənəddəki mövqeyi (bölmələrin real mətn uzunluğuna görə). */
import { $, badge, el, group } from '../core/dom.js';
import { state } from '../core/state.js';
import { openDetail } from '../shell/detail.js';
import { snippetCard } from './finance.js';
import { loadDoc, openDocAt, placeholderTitle } from './docviewer.js';
import { el as el2 } from '../ui/el.js';
import { icon as uiIcon } from '../ui/icons.js';
import { EmptyState } from '../ui/card.js';
import { tooltip } from '../ui/overlay.js';
import { reducedMotion } from '../ui/motion.js';

function renderPlaceholders(items) {
  const host = $('ph-list');
  const lead = $('ph-lead');
  if (!items.length) {
    lead.textContent = 'Sənəddə doldurulmamış yer qalmayıb.';
    $('ph-map').hidden = true;
    host.replaceChildren(EmptyState({ icon: 'check', compact: true, title: 'Doldurulmamış yer tapılmadı',
      text: '“[MƏLUMAT LAZIMDIR]” və oxşar boş yer işarələri sənəddə yoxdur.' }));
    return;
  }
  const tables = items.filter((i) => i.where === 'cədvəl').length;
  const sections = new Set(items.map((i) => i.section_id)).size;
  lead.textContent = `Sənəddə ${items.length} doldurulmamış yer var: ${items.length - tables} mətndə, ${tables} cədvəldə, ${sections} bölmədə. `
    + 'Təqdimatdan əvvəl real məlumatla əvəz olunmalıdır.';
  host.replaceChildren(...items.map((item, index) => placeholderCard(item, index)));
  renderMap(items);
}

const upperFirst = (s) => (s ? s.charAt(0).toLocaleUpperCase('az') + s.slice(1) : s);

function placeholderCard(item, index) {
  const title = upperFirst(placeholderTitle(item.text));
  const inTable = item.where === 'cədvəl';
  const where = inTable ? (item.table_id ? `Cədvəl ${item.table_id}-da` : 'Cədvəldə') : 'Mətndə';
  const card = el2('li', { class: 'phcard', id: 'ph-' + index, tabIndex: -1 },
    el2('span', { class: 'phcard__no', 'aria-hidden': 'true', text: String(index + 1) }),
    el2('div', { class: 'phcard__main' },
      el2('h3', { class: 'phcard__title', text: title }),
      el2('p', { class: 'phcard__meta' },
        el2('span', { class: 'phcard__where' }, uiIcon(inTable ? 'table' : 'paragraph', { size: 'sm' }), el2('span', { text: where })),
        el2('span', { class: 'phcard__sec', text: item.section_title })),
      item.context ? el2('blockquote', { class: 'phcard__ctx' }, fragment(item.context, item.text)) : null),
    el2('button', { type: 'button', class: 'btn btn--small phcard__go', 'aria-label': `Sənəddə göstər: ${title}`,
      on: { click: (e) => openDocAt('ph:' + index, { fallback: () => openPlaceholderDetail(item, index, e.currentTarget) }) } },
    uiIcon('locate', { size: 'sm' }), 'Sənəddə göstər'));
  return card;
}

/** Kontekst: boş yer <mark> ilə (punktir çərçivə), qalan mətn olduğu kimi. */
function fragment(context, needle) {
  const frag = document.createDocumentFragment();
  const at = needle ? context.indexOf(needle) : -1;
  if (at < 0) { frag.append(context); return frag; }
  frag.append(context.slice(0, at), el2('mark', { class: 'phmark', text: needle }), context.slice(at + needle.length));
  return frag;
}

/** Üfüqi mini-xəritə: sənəd bir zolaqdır; hər boş yer — mövqeyinə görə nömrəli nişan. */
async function renderMap(items) {
  const map = $('ph-map');
  const check = state.check;
  let doc;
  try { doc = await loadDoc(check.id); } catch (_) { map.hidden = true; return; }
  if (state.check !== check) return;
  const tables = new Map(doc.tables.map((t) => [t.id, t]));
  const sections = doc.sections.map((s) => {
    const parts = [s.title, ...s.paragraphs, ...s.table_ids.map((id) => ((tables.get(id) || {}).rows || []).map((r) => r.join(' | ')).join('\n'))];
    return { id: s.id, title: s.title, text: parts.join('\n') };
  });
  const total = sections.reduce((n, s) => n + s.text.length, 0) || 1;
  let offset = 0;
  const start = new Map(sections.map((s) => { const o = offset; offset += s.text.length; return [s.id, o]; }));
  const used = new Map();
  const marks = items.map((item, i) => {
    const sec = sections.find((s) => s.id === item.section_id);
    let pos = start.has(item.section_id) ? start.get(item.section_id) : 0;
    if (sec) {
      const from = used.get(item.section_id + item.text) || 0;          // eyni ifadənin təkrarı — növbəti yer
      const at = sec.text.indexOf(item.text, from);
      if (at >= 0) { pos += at; used.set(item.section_id + item.text, at + 1); }
    }
    const title = placeholderTitle(item.text);
    const b = el2('button', { type: 'button', class: 'phmap__mark', style: { left: `${((pos / total) * 100).toFixed(2)}%` },
      'aria-label': `${i + 1}. ${title} — ${item.section_title}`, on: { click: () => focusCard(i) } }, String(i + 1));
    tooltip(b, `${i + 1}. ${title} · ${item.section_title}`);
    b.dataset.pos = String(pos / total);
    return b;
  });
  // Bir-birinə çox yaxın nişanlar növbə ilə yuxarı/aşağı çəkilir (üst-üstə düşməsin).
  const sorted = [...marks].sort((a, b) => a.dataset.pos - b.dataset.pos);
  sorted.forEach((m, k) => { if (k && m.dataset.pos - sorted[k - 1].dataset.pos < 0.025 && !sorted[k - 1].classList.contains('is-up')) m.classList.add('is-up'); });
  // Bölmə sərhədləri (başlıq səviyyəsi 1) — zolaqda incə xətlər.
  const ticks = doc.sections.filter((s) => s.level <= 1).map((s) => el2('span', { class: 'phmap__tick', style: { left: `${((start.get(s.id) / total) * 100).toFixed(2)}%` } }));
  map.replaceChildren(
    el2('div', { class: 'phmap__track' }, ...ticks, ...marks),
    el2('div', { class: 'phmap__ends' }, el2('span', { text: 'Sənədin əvvəli' }), el2('span', { text: 'Sonu' })));
  map.hidden = false;
}
function focusCard(i) {
  const card = $('ph-' + i);
  if (!card) return;
  card.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  card.focus({ preventScroll: true });
  card.classList.remove('is-flash');
  void card.offsetWidth;
  card.classList.add('is-flash');
}

function openPlaceholderDetail(item, index, row) {
  openDetail('Doldurulmamış yer', (body) => {
    const head = el('p');
    head.append(badge('s-warn', 'Doldurulmayıb'));
    body.append(head, group('İfadə', el('p', 'mono', item.text)));
    const source = ['Bölmə: ' + item.section_title];
    if (item.table_id) source.push('Cədvəl ' + item.table_id);
    body.append(group('Mənbə', el('p', null, source.join(' · '))));
    body.append(group('Sənəddən', item.evidence ? snippetCard(item.evidence)
      : (item.context ? highlight(item.context, item.text) : el('p', null, '—'))));
    body.append(group('Qeyd', el('p', 'rule', 'Təqdimatdan əvvəl real məlumatla əvəz olunmalıdır. '
      + 'Eyni ifadənin hər təkrarı ayrıca sətirdir (bu, ' + (index + 1) + '-ci tapıntıdır).')));
  }, row);
}
function highlight(text, needle) {
  const box = el('blockquote', 'quote');
  const at = needle ? text.indexOf(needle) : -1;
  if (at < 0) { box.textContent = text; return box; }
  box.append(document.createTextNode(text.slice(0, at)), el('mark', 'hit', needle),
    document.createTextNode(text.slice(at + needle.length)));
  return box;
}

export { openPlaceholderDetail, renderPlaceholders };
