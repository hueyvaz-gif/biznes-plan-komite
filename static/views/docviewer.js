/* Sənəd görüntüsü (drawer): planın bütün mətni, hədəf sitat vurğulanmış və görünüşə sürüşdürülmüş.
 *   • boş yerlər qırmızı punktir çərçivədə, problemli tələblərin sitatı kəhrəba, cavabın sitatı yaşıl;
 *   • sol kənarda sənəd mini-xəritəsi (bütün tapıntılar nöqtə kimi, klik → keçid);
 *   • "◀ əvvəlki · növbəti ▶" və [ / ] düymələri ilə bütün tapıntılar arasında gəzmək.
 * Mətn GET /api/checks/{id}/doc-dan (yükləmə zamanı saxlanan sənəd), bir dəfə yüklənir və keşlənir.
 * Sitat sənəddə HƏRFİ axtarılır (boşluqlar normallaşdırılır); tapılmasa bölmə başlığı vurğulanır. */
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { el } from '../ui/el.js';
import { icon } from '../ui/icons.js';
import { openDrawer, tooltip } from '../ui/overlay.js';
import { reducedMotion } from '../ui/motion.js';

const KIND = {
  hole: { label: 'Boş yer', tone: 'danger' },
  problem: { label: 'Problemli tələb', tone: 'warning' },
  quote: { label: 'Sitat', tone: 'success' },
  fin: { label: 'Maliyyə rəqəmi', tone: 'info' },
};

const docCache = new Map();
export async function loadDoc(checkId) {
  if (!docCache.has(checkId)) docCache.set(checkId, api.get('/api/checks/' + encodeURIComponent(checkId) + '/doc').catch((e) => { docCache.delete(checkId); throw e; }));
  return docCache.get(checkId);
}

/* ── Tapıntılar (yoxlamanın nəticəsindən) ───────────────────────────────── */
const PROBLEM = new Set(['natamam', 'yoxdur']);
/**
 * Yoxlamanın bütün sənəd hədəfləri: [{key, kind, section_id, table_id, quote, label, code}].
 * key: 'ph:<index>' | 'req:<id>' | 'fin:<id>:<n>' — "Sənəddə yeri" düymələri bu açarla açır.
 */
export function docTargets(check) {
  const r = (check && check.result) || {};
  const out = [];
  ((r.ingest || {}).placeholders || []).forEach((p, i) => out.push({
    key: 'ph:' + i, kind: 'hole', section_id: p.section_id, table_id: p.table_id, quote: p.text, exact: true,
    label: placeholderTitle(p.text),
  }));
  for (const it of (r.compliance || {}).items || []) {
    const sec = (it.sections || [])[0];
    if (!sec || !it.quote) continue;
    out.push({
      key: 'req:' + it.req_id, kind: PROBLEM.has(it.status) ? 'problem' : 'quote', section_id: sec.id, table_id: sec.table_id,
      quote: it.quote, code: it.req_id, label: `${it.req_id} · ${it.text}`,
    });
  }
  for (const c of ((r.finance || {}).checks || [])) {
    ((c.evidence || {}).snippets || []).forEach((sn, n) => {
      if (!sn.section_id) return;
      const q = sn.mark ? sn.text.slice(sn.mark[0], sn.mark[1]) : null;
      out.push({ key: `fin:${c.id}:${n}`, kind: 'fin', section_id: sn.section_id, quote: q, label: c.title });
    });
  }
  return out;
}
/** "[MƏLUMAT LAZIMDIR: VÖEN, hüquqi ünvan]" → "VÖEN, hüquqi ünvan"; "[VÖEN]" → "VÖEN". */
export function placeholderTitle(text) {
  const s = String(text || '').trim().replace(/^\[|\]$/g, '');
  const m = /^MƏLUMAT LAZIMDIR\s*:?\s*(.*)$/iu.exec(s);
  return (m ? m[1] : s).trim() || 'məlumat';
}

/* ── Sənədin render-i ───────────────────────────────────────────────────── */
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Mətndə bir neçə aralığı <mark>/<span> ilə vurğulayır (aralıqlar üst-üstə düşmür, sıralı). */
function paint(text, ranges) {
  const frag = document.createDocumentFragment();
  let at = 0;
  for (const r of ranges.sort((a, b) => a.start - b.start)) {
    if (r.start < at) continue;
    if (r.start > at) frag.append(text.slice(at, r.start));
    const node = el(r.kind === 'hole' ? 'span' : 'mark', { class: `dv-hit dv-hit--${r.kind}`, dataset: { key: r.key } }, text.slice(r.start, r.end));
    r.node = node;
    frag.append(node);
    at = r.end;
  }
  if (at < text.length) frag.append(text.slice(at));
  return frag;
}

/** Sitatı mətndə tapır: əvvəl dəqiq, sonra boşluqları normallaşdırılmış, sonra ilk 60 simvol. */
function locate(text, quote) {
  if (!quote) return -1;
  let i = text.indexOf(quote);
  if (i >= 0) return { start: i, end: i + quote.length };
  const q = norm(quote);
  const t = text.replace(/\s+/g, ' ');
  i = t.indexOf(q);
  if (i >= 0 && t.length === text.length) return { start: i, end: i + q.length };
  const head = q.slice(0, 60);
  i = head.length > 20 ? text.indexOf(head) : -1;
  if (i >= 0) return { start: i, end: Math.min(text.length, i + q.length) };
  // "A ... B" — model fraqmentləri üç nöqtə ilə birləşdirib: ilk uzun fraqment axtarılır.
  const frag = fragments(quote)[0];
  if (frag && frag !== q) {
    i = text.indexOf(frag);
    if (i >= 0) return { start: i, end: i + frag.length };
  }
  return -1;
}
/** Sitatın "..." / "…" ilə ayrılmış hissələri (≥ 15 simvol), uzundan qısaya. */
function fragments(quote) {
  return norm(quote).split(/\s*(?:\.\.\.|…)\s*/).map((x) => x.trim()).filter((x) => x.length >= 15)
    .sort((a, b) => b.length - a.length);
}
/** Son çarə: render olunmuş sənəddə mətn düyünləri üzrə axtarış (bölmə və cədvəl sərhədindən asılı olmadan). */
function findInDom(root, quote, kind, key) {
  const needles = [...fragments(quote), norm(quote).slice(0, 40)].filter((x) => x.length >= 15);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const needle of needles) {
    for (const n of nodes) {
      const at = n.data.indexOf(needle);
      if (at < 0 || n.parentElement.closest('.dv-hit, .dv-h')) continue;
      const range = document.createRange();
      range.setStart(n, at);
      range.setEnd(n, at + needle.length);
      const mark = el('mark', { class: `dv-hit dv-hit--${kind}`, dataset: { key } });
      range.surroundContents(mark);
      return mark;
    }
  }
  return null;
}

function renderDocument(doc, targets) {
  const tablesById = new Map(doc.tables.map((t) => [t.id, t]));
  const bySection = new Map();
  for (const t of targets) { if (!bySection.has(t.section_id)) bySection.set(t.section_id, []); bySection.get(t.section_id).push(t); }
  const root = el('article', { class: 'dv-doc' });
  for (const s of doc.sections) {
    const sec = el('section', { class: 'dv-sec', id: 'dv-' + s.id, dataset: { sec: s.id } });
    const h = el(s.level <= 1 ? 'h3' : 'h4', { class: `dv-h dv-h--${Math.min(3, Math.max(0, s.level))}`, text: s.title });
    sec.append(h);
    const pending = [...(bySection.get(s.id) || [])];
    const place = (text) => {
      const ranges = [];
      const shared = [];
      for (const t of pending) {
        if (t.placed) continue;
        const hit = locate(text, t.quote);
        if (hit === -1) continue;
        const clash = ranges.find((r) => hit.start < r.end && r.start < hit.end);
        // Üst-üstə düşən hədəflər (məs. sitatın içində boş yer) eyni vurğunu paylaşır — yer yenə dəqiqdir.
        if (clash) shared.push([t, clash]);
        else ranges.push({ ...hit, kind: t.kind, key: t.key, target: t });
        t.placed = true;
      }
      // Bütün boş yer marker-ləri (hədəf olmasa da) punktir çərçivədə.
      for (const m of text.matchAll(/\[[^\]\n]{1,160}\]/g)) {
        if (!/MƏLUMAT LAZIMDIR|^\[[A-ZƏÖÜĞIŞÇ]/u.test(m[0])) continue;
        if (ranges.some((r) => m.index < r.end && r.start < m.index + m[0].length)) continue;
        ranges.push({ start: m.index, end: m.index + m[0].length, kind: 'hole', key: '' });
      }
      const frag = paint(text, ranges);
      ranges.forEach((r) => { if (r.target) r.target.node = r.node; });
      shared.forEach(([t, r]) => { t.node = r.node; });
      return frag;
    };
    for (const p of s.paragraphs) sec.append(el('p', { class: 'dv-p' }, place(p)));
    for (const tid of s.table_ids) {
      const t = tablesById.get(tid);
      if (!t) continue;
      // Cədvəl sitatı "xana | xana | …" formatındadır — sətir səviyyəsində tutuşdurulur (bütün sətir vurğulanır).
      // Bütün yerləşməmiş cədvəl sitatları (cədvəl bəzən başqa bölməyə aiddir).
      const rowTargets = targets.filter((x) => !x.placed && x.quote && x.quote.includes(' | '));
      const tbody = el('tbody', null, (t.rows || []).slice(0, 80).map((row, ri) => {
        const joined = norm(row.map((c) => String(c ?? '')).join(' | '));
        const hit = rowTargets.find((x) => !x.placed && (joined.includes(norm(x.quote)) || norm(x.quote).includes(joined) && joined.length > 12));
        const tr = el('tr', hit ? { class: `dv-hit dv-hit--${hit.kind} dv-hitrow`, dataset: { key: hit.key } } : null,
          row.map((cell) => el(ri === 0 ? 'th' : 'td', null, place(String(cell ?? '')))));
        if (hit) { hit.placed = true; hit.node = tr; }
        return tr;
      }));
      const table = el('table', { class: 'dv-table', id: 'dv-' + tid },
        el('caption', null, el('span', { class: 'dv-tid', text: tid }), t.caption ? ' ' + t.caption : ''), tbody);
      sec.append(el('div', { class: 'dv-tablewrap' }, table));
    }
    root.append(sec);
  }
  // Bölmədə tapılmayan sitatlar: bütün sənəddə axtarış; yenə tapılmasa — öz bölməsinin başlığı (yer yenə görünür).
  for (const t of targets) {
    if (t.placed) continue;
    const node = t.quote ? findInDom(root, t.quote, t.kind, t.key) : null;
    const sec = root.querySelector(`[data-sec="${CSS.escape(t.section_id || '')}"] .dv-h`);
    t.node = node || sec || root.firstElementChild;
    t.fallback = !node;
    t.placed = true;
  }
  return root;
}

/* ── Drawer ─────────────────────────────────────────────────────────────── */
/**
 * openDocAt(key | target) — sənəd görüntüsünü açır və hədəfə keçir. Bütün tapıntılar arasında [ / ] ilə gəzmək olur.
 * Sənəd mətni yoxdursa (köhnə yoxlama) fallback() çağırılır.
 */
export async function openDocAt(keyOrTarget, { fallback, title } = {}) {
  const check = state.check;
  if (!check) return;
  const targets = docTargets(check).map((t) => ({ ...t }));
  let target = typeof keyOrTarget === 'string' ? targets.find((t) => t.key === keyOrTarget) : keyOrTarget;
  if (target && !targets.includes(target)) { targets.push(target); }

  const scroll = el('div', { class: 'dv-scroll', tabIndex: 0, 'aria-label': 'Sənədin mətni' }, el('p', { class: 'dv-loading', text: 'Sənəd yüklənir…' }));
  const map = el('div', { class: 'dv-map', role: 'navigation', 'aria-label': 'Sənəd mini-xəritəsi' });
  const counter = el('span', { class: 'dv-counter', 'aria-live': 'polite' });
  const current = el('p', { class: 'dv-current' });
  const prev = el('button', { type: 'button', class: 'btn btn--small', 'aria-keyshortcuts': '[' }, icon('chevronLeft', { size: 'sm' }), 'Əvvəlki');
  const next = el('button', { type: 'button', class: 'btn btn--small', 'aria-keyshortcuts': ']' }, 'Növbəti', icon('chevronRight', { size: 'sm' }));
  const legend = el('ul', { class: 'dv-legend' }, Object.entries(KIND).map(([k, v]) => el('li', null, el('span', { class: `dv-dot dv-dot--${k}` }), v.label)));
  const body = el('div', { class: 'dv' }, map, scroll);
  const footer = el('div', { class: 'dv-foot' }, el('div', { class: 'dv-foot__nav' }, prev, counter, next), current, legend);
  const drawer = openDrawer({ title: title || (target ? target.label : 'Sənəd'), content: body, footer, width: 920 });
  drawer.dialog.classList.add('ui-drawer--doc');

  let doc;
  try {
    doc = await loadDoc(check.id);
  } catch (err) {
    if (fallback) { drawer.close(); fallback(); return; }
    scroll.replaceChildren(el('p', { class: 'alert alert--warn', text: err.message || 'Sənəd yüklənmədi.' }));
    return;
  }
  scroll.replaceChildren(renderDocument(doc, targets));
  // Sənəd sırası ilə: DOM mövqeyinə görə.
  const ordered = targets.filter((t) => t.node).sort((a, b) => (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  let index = Math.max(0, ordered.indexOf(target));
  body.dataset.fallbacks = String(ordered.filter((t) => t.fallback).length);     // test və diaqnostika üçün
  body.dataset.fallbackKeys = ordered.filter((t) => t.fallback).map((t) => t.key).join(' ');

  // Mini-xəritə: hər tapıntı sənədin uzunluğuna nisbətdə nöqtə.
  const drawMap = () => {
    const total = scroll.scrollHeight || 1;
    const top = scroll.getBoundingClientRect().top - scroll.scrollTop;
    map.replaceChildren(el('span', { class: 'dv-map__view' }), ...ordered.map((t, i) => {
      const y = (t.node.getBoundingClientRect().top - top) / total;
      const dot = el('button', { type: 'button', class: `dv-mapdot dv-dot--${t.kind}`, style: { top: `${(y * 100).toFixed(2)}%` },
        'aria-label': `${KIND[t.kind].label}: ${t.label}`, tabIndex: -1, on: { click: () => go(i) } });
      tooltip(dot, `${KIND[t.kind].label}: ${t.label}`);
      return dot;
    }));
    syncView();
  };
  const syncView = () => {
    const v = map.querySelector('.dv-map__view');
    if (!v) return;
    v.style.top = `${(scroll.scrollTop / scroll.scrollHeight) * 100}%`;
    v.style.height = `${(scroll.clientHeight / scroll.scrollHeight) * 100}%`;
  };
  scroll.addEventListener('scroll', syncView, { passive: true });

  function go(i) {
    if (!ordered.length) return;
    index = (i + ordered.length) % ordered.length;
    const t = ordered[index];
    scroll.querySelectorAll('.is-current').forEach((n) => n.classList.remove('is-current'));
    t.node.classList.add('is-current');
    const nodeTop = t.node.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    scroll.scrollTo({ top: Math.max(0, nodeTop - scroll.clientHeight / 3), behavior: reducedMotion() ? 'auto' : 'smooth' });
    counter.textContent = `${index + 1} / ${ordered.length}`;
    current.replaceChildren(...[el('span', { class: `dv-dot dv-dot--${t.kind}` }), el('strong', { text: KIND[t.kind].label + ': ' }), t.label,
      t.fallback ? el('span', { class: 'dv-note', text: ' — hərfi sitat mətndə tapılmadı, bölmə göstərilir' }) : null].filter(Boolean));
    drawer.setTitle(t.label);
    map.querySelectorAll('.dv-mapdot').forEach((d, k) => d.classList.toggle('is-active', k === index));
  }
  prev.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  drawer.dialog.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === '[') { e.preventDefault(); go(index - 1); }
    if (e.key === ']') { e.preventDefault(); go(index + 1); }
  });
  requestAnimationFrame(() => { drawMap(); go(index); });
  if ('ResizeObserver' in window) new ResizeObserver(() => drawMap()).observe(scroll);
}
