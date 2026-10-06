/* Tablar: 5 əsas tab + "Daha çox" (tələblər, boş yerlər, əlavə tələblər, müqayisə); jurnal yalnız ?debug=1.
 * Sürüşən aktiv indikator, ton badge-ləri, klaviatura qısayolları, panel keçid animasiyası,
 * hər tab üçün scroll mövqeyi yaddaşı. URL ?tab=… geri uyğundur (köhnə linklər işləyir). */
import { $, el } from '../core/dom.js';
import { reducedMotion } from '../ui/motion.js';

export const PRIMARY = ['panel-xulase', 'panel-duzelis', 'panel-maliyye', 'panel-iqtisadi', 'panel-suallar'];
/** Həmişə "Daha çox" menyusunda olan tablar. */
const MORE = ['tab-teleb', 'tab-bosyer', 'tab-elave', 'tab-muqayise'];
const DEBUG = 'tab-agentler';

/** ?debug=1 və ya köhnə ?tab=agentler linki — Texniki jurnal görünür. */
export function debugMode() {
  const p = new URLSearchParams(location.search);
  return p.get('debug') === '1' || p.get('tab') === 'agentler';
}

function tabs() { return [...document.querySelectorAll('#tabs .tab')].filter((t) => t.id !== DEBUG || debugMode()); }
const scrollMemory = new Map();
let current = null;

function selectTab(panelId, focus) {
  if (!$(panelId) || (panelId === 'panel-agentler' && !debugMode())) panelId = 'panel-xulase';
  $('view-results')?.classList.toggle('is-overview', panelId === 'panel-xulase');
  const prev = current;
  if (prev && prev !== panelId) scrollMemory.set(prev, scrollY);
  document.querySelectorAll('#tabs .tab').forEach((tab) => {
    const on = tab.getAttribute('aria-controls') === panelId;
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
    const panel = $(tab.getAttribute('aria-controls'));
    if (panel) panel.hidden = !on;
    if (on) revealTab(tab);
  });
  current = panelId;
  layoutTabs();                                      // aktiv tab menyudadırsa — düymədə onun adı
  const active = tabs().find((t) => t.getAttribute('aria-controls') === panelId);
  if (focus && active) {
    if (active.hidden) $('tabs-more').focus(); else active.focus({ preventScroll: true });
  }
  const params = new URLSearchParams(location.search);
  params.set('tab', panelId.replace('panel-', ''));
  history.replaceState(null, '', '?' + params.toString());

  if (prev && prev !== panelId) {
    // Panel 8px yuxarıdan fade-in; scroll mövqeyi tab üzrə bərpa olunur (tab zolağından yuxarı qalxmır).
    const panel = $(panelId);
    if (panel && !reducedMotion()) {
      panel.classList.remove('is-entering');
      void panel.offsetWidth;
      panel.classList.add('is-entering');
    }
    const bar = document.querySelector('.tabsbar');
    const barTop = bar ? bar.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(bar).top) || 0) : 0;
    const saved = scrollMemory.get(panelId);
    const target = saved !== undefined ? Math.max(saved, Math.min(scrollY, barTop)) : Math.min(scrollY, barTop);
    if (scrollY > barTop || saved !== undefined) scrollTo({ top: target });
  }
}
/** Seçilmiş tabı yalnız tab zolağının İÇİNDƏ üfüqi görünən edir — səhifə şaquli sürüşmür. */
function revealTab(tab) {
  const strip = $('tabs');
  const t = tab.getBoundingClientRect();
  const s = strip.getBoundingClientRect();
  if (t.left < s.left) strip.scrollLeft -= s.left - t.left + 16;
  else if (t.right > s.right) strip.scrollLeft += t.right - s.right + 16;
}

/** Aktiv tab altında sürüşən pill (FLIP: transform + en, 200ms). Aktiv tab menyudadırsa gizlənir. */
function moveIndicator(animate = true) {
  const ind = $('tabs-ind');
  const strip = $('tabs');
  if (!ind || !strip) return;
  const active = tabs().find((t) => t.getAttribute('aria-selected') === 'true');
  if (!active || active.hidden) { ind.classList.add('is-off'); return; }
  ind.classList.toggle('is-instant', !animate || !ind.dataset.ready);
  ind.classList.remove('is-off');
  ind.style.width = active.offsetWidth + 'px';
  ind.style.height = active.offsetHeight + 'px';
  ind.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  ind.dataset.ready = '1';
}

function wireTabs() {
  const strip = $('tabs');
  strip.classList.add('has-ind');
  const agent = $(DEBUG);
  if (agent && !debugMode()) agent.hidden = true;
  tabs().forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab.getAttribute('aria-controls'), true));
    tab.addEventListener('keydown', (e) => {
      // Ox düymələri yalnız zolaqda GÖRÜNƏN tablar arasında; qalanları "Daha çox" menyusundadır.
      const all = tabs().filter((t) => !t.hidden);
      const index = all.indexOf(tab);
      let next = null;
      if (e.key === 'ArrowRight') next = all[(index + 1) % all.length];
      if (e.key === 'ArrowLeft') next = all[(index - 1 + all.length) % all.length];
      if (e.key === 'Home') next = all[0];
      if (e.key === 'End') next = all[all.length - 1];
      if (next) { e.preventDefault(); selectTab(next.getAttribute('aria-controls'), true); }
    });
  });
  // Kənar fade-ləri yalnız o istiqamətdə sürüşdürmək mümkün olanda (mobil scroll-snap zolağı).
  const edges = () => {
    strip.classList.toggle('at-start', strip.scrollLeft <= 1);
    strip.classList.toggle('at-end', strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1);
  };
  strip.addEventListener('scroll', edges, { passive: true });
  strip.edges = edges;
  wireTabsMore();
  if ('ResizeObserver' in window) {
    // Zolağın eni və tabların öz eni (şrift yüklənəndə, nişan dəyişəndə) dəyişəndə yenidən yerləşdirilir.
    let pending = false;
    const ro = new ResizeObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; layoutTabs(); });
    });
    ro.observe(document.querySelector('.tabsbar'));
  }
  window.addEventListener('resize', () => layoutTabs());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layoutTabs());
}
/* ── Tab zolağı: "Daha çox" menyusu (üfüqi scrollbar yoxdur) ───────────── */

/**
 * Mərhələlər: (0) Əlavə tələblər, Müqayisə (və Texniki jurnal) həmişə menyuda; (1) tam adlar; (2) qısa adlar;
 * (3) sıx tablar; (4) "Daha çox" yalnız ikon; (5) dar ekranda yalnız aktiv tab zolaqda, qalanları menyuda.
 */
function layoutTabs() {
  const strip = $('tabs');
  const wrap = $('tabs-more-wrap');
  if (!strip || !wrap) return;
  const all = tabs();
  const active = all.find((t) => t.getAttribute('aria-selected') === 'true') || all[0];
  const btn = $('tabs-more');
  const fits = () => strip.scrollWidth <= strip.clientWidth + 1;
  const fixed = all.filter((t) => MORE.includes(t.id) || t.id === DEBUG);
  let overflow = [...fixed];
  const apply = () => renderTabsMenu(all.filter((t) => overflow.includes(t)), active);
  all.forEach((t) => { t.hidden = fixed.includes(t) && t !== active; });
  // Menyudakı tab aktivdirsə, o zolaqda görünür (istifadəçi harada olduğunu görsün).
  if (fixed.includes(active)) overflow = overflow.filter((t) => t !== active);
  strip.classList.remove('is-short', 'is-tight', 'is-scroll');
  btn.classList.remove('is-icon');
  apply();
  if (matchMedia('(max-width: 768px)').matches) {
    // Mobil: zolaq üfüqi sürüşür (scroll-snap) — tablar menyuya gizlədilmir, qısa adlar işlənir.
    strip.classList.add('is-scroll', 'is-short');
    btn.classList.add('is-icon');
    apply();
    updateStickyOffsets();
    moveIndicator(false);
    const act = all.find((t) => t.getAttribute('aria-selected') === 'true');
    if (act && !act.hidden) revealTab(act);
    if (strip.edges) strip.edges();
    return;
  }
  const steps = [
    () => strip.classList.add('is-short'),
    () => strip.classList.add('is-tight'),
    () => btn.classList.add('is-icon'),
    () => {
      all.forEach((t) => { t.hidden = t !== active; });
      overflow = all.filter((t) => t !== active);
      btn.classList.remove('is-icon');
    },
  ];
  for (const step of steps) {
    if (fits()) break;
    step();
    apply();
  }
  updateStickyOffsets();
  moveIndicator();
}
function renderTabsMenu(overflow, active) {
  const wrap = $('tabs-more-wrap');
  const menu = $('tabs-menu');
  const label = $('tabs-more-label');
  const btn = $('tabs-more');
  wrap.hidden = overflow.length === 0;
  const activeInMenu = overflow.includes(active);
  const short = $('tabs').classList.contains('is-short') && active.querySelector('.tab__short');
  label.textContent = activeInMenu
    ? (short || active.querySelector('.tab__full') || active).firstChild.textContent.trim() : 'Daha çox';
  btn.classList.toggle('is-current', activeInMenu);
  menu.replaceChildren(...overflow.map((t) => {
    const item = el('button', 'tabsmore__item');
    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', t === active ? 'true' : 'false');
    item.tabIndex = -1;
    const name = t.querySelector('.tab__full') ? t.querySelector('.tab__full').textContent : t.firstChild.textContent.trim();
    item.append(el('span', null, name));
    const count = t.querySelector('.tab__count');
    if (count && count.textContent) {
      const c = el('span', 'tab__count' + (count.classList.contains('is-zero') ? ' is-zero' : ''), count.textContent);
      if (count.dataset.tone) c.dataset.tone = count.dataset.tone;
      c.title = count.title;
      item.append(c);
    }
    item.dataset.panel = t.getAttribute('aria-controls');
    return item;
  }));
}
function setTabsMenu(open, focusFirst) {
  const menu = $('tabs-menu');
  const btn = $('tabs-more');
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open && focusFirst) {
    const items = [...menu.querySelectorAll('.tabsmore__item')];
    (items.find((i) => i.getAttribute('aria-checked') === 'true') || items[0])?.focus();
  }
}
function wireTabsMore() {
  const btn = $('tabs-more');
  const menu = $('tabs-menu');
  if (!btn) return;
  btn.addEventListener('click', () => setTabsMenu(menu.hidden, true));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setTabsMenu(true, true); }
  });
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.tabsmore__item');
    if (!item) return;
    setTabsMenu(false);
    selectTab(item.dataset.panel, false);
    btn.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('.tabsmore__item')];
    const i = items.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
    if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
    if (e.key === 'Home') next = items[0];
    if (e.key === 'End') next = items[items.length - 1];
    if (next) { e.preventDefault(); next.focus(); }
    if (e.key === 'Escape' || e.key === 'Tab') { setTabsMenu(false); if (e.key === 'Escape') { e.preventDefault(); btn.focus(); } }
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('#tabs-more-wrap')) setTabsMenu(false);
  });
}
/**
 * Yapışqan zolağın alt sərhədi (`--tabs-h`) və açıq paneldəki yapışqan filtr sətrinin hündürlüyü
 * (`--filters-h`), cəmi (`--sticky-stack-h`, cədvəl başlıqları üçün).
 */
function updateStickyOffsets() {
  const bar = document.querySelector('.tabsbar');
  if (!bar || bar.offsetParent === null) return;
  // Kompakt rejimdə ölçülmür: --tabs-h tam ölçüdə qalır (kompensasiya margin-dədir) — sticky ofsetlər oynamır.
  if (document.getElementById('view-results')?.classList.contains('is-compact')) return;
  const top = parseFloat(getComputedStyle(bar).top) || 0;
  const tabsH = Math.ceil(top + bar.offsetHeight);
  document.documentElement.style.setProperty('--tabs-h', tabsH + 'px');
  const panel = [...document.querySelectorAll('#view-results .panel')].find((p) => !p.hidden);
  const sticky = panel && [...panel.querySelectorAll('.stickyrow')].find((n) => getComputedStyle(n).position === 'sticky');
  const filtersH = sticky ? Math.ceil(sticky.offsetHeight) : 0;
  document.documentElement.style.setProperty('--filters-h', filtersH + 'px');
  document.documentElement.style.setProperty('--sticky-stack-h', (tabsH + filtersH) + 'px');
}

/**
 * Tab nişanı — tab, tile və siyahı eyni mənbədən sayır; burada yalnız göstərilir.
 *   n > 0 → say, ton (warn | fail | info); n === 0 və complete → yaşıl ✓; məlumat yoxdursa boş.
 */
export function setTabCount(id, n, { tone = 'warn', title = '', complete = false, doneTitle = '' } = {}) {
  const b = $(id);
  if (!b) return;
  if (n) {
    b.textContent = String(n);
    b.dataset.tone = tone;
    b.classList.remove('is-zero');
    b.title = title;
  } else if (complete) {
    b.textContent = '✓';
    b.dataset.tone = 'ok';
    b.classList.add('is-zero');
    b.title = doneTitle || 'Problem yoxdur';
  } else {
    b.textContent = '';
    delete b.dataset.tone;
    b.classList.add('is-zero');
    b.title = '';
  }
  b.parentElement.title = b.title;
}

export { layoutTabs, moveIndicator, selectTab, wireTabs };
