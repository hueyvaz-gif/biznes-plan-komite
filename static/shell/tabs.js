/* Tablar: ox düymələri, "Daha çox" menyusu, sticky ofsetlər. */
import { $, el } from '../core/dom.js';

/* ── Tablar (ox düymələri ilə) ──────────────────────────────────────────── */

function tabs() { return [...document.querySelectorAll('#tabs .tab')]; }
function selectTab(panelId, focus) {
  tabs().forEach((tab) => {
    const on = tab.getAttribute('aria-controls') === panelId;
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !on;
    if (on) revealTab(tab);
  });
  layoutTabs();                                      // aktiv tab menyudadırsa — düymədə onun adı
  const active = tabs().find((t) => t.getAttribute('aria-controls') === panelId);
  if (focus && active) {
    if (active.hidden) $('tabs-more').focus(); else active.focus();
  }
  const params = new URLSearchParams(location.search);
  params.set('tab', panelId.replace('panel-', ''));
  history.replaceState(null, '', '?' + params.toString());
}
/** Seçilmiş tabı yalnız tab zolağının İÇİNDƏ üfüqi görünən edir — səhifə şaquli sürüşmür
 *  (əvvəl scrollIntoView mobil ekranı açılışda başlıq və möhürdən aşağı aparırdı). */
function revealTab(tab) {
  const strip = $('tabs');
  const t = tab.getBoundingClientRect();
  const s = strip.getBoundingClientRect();
  if (t.left < s.left) strip.scrollLeft -= s.left - t.left + 16;
  else if (t.right > s.right) strip.scrollLeft += t.right - s.right + 16;
}
function wireTabs() {
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
/* ── Tab zolağı: sığmayan tablar "Daha çox" menyusuna (üfüqi scrollbar yoxdur) ── */

/** Menyuya ilk keçən tablar (aşağı prioritet). Nişanında problem sayı olan tab menyuya düşmür. */
const TAB_OVERFLOW_ORDER = ['tab-agentler', 'tab-muqayise', 'tab-elave'];
function tabBadge(tab) {
  const count = tab.querySelector('.tab__count');
  return count && !count.classList.contains('is-zero') && Number(count.textContent) > 0;
}
/**
 * Mərhələlər: (1) hamısı tam adla; (2) qısa adlarla; (3) aşağı prioritetli, nişansız tablar menyuya;
 * (4) dar ekranda yalnız aktiv tab zolaqda, qalanları menyuda. Hər mərhələdə zolağın sığması ölçülür.
 */
function layoutTabs() {
  const strip = $('tabs');
  const wrap = $('tabs-more-wrap');
  if (!strip || !wrap) return;
  const all = tabs();
  const active = all.find((t) => t.getAttribute('aria-selected') === 'true') || all[0];
  const btn = $('tabs-more');
  const fits = () => strip.scrollWidth <= strip.clientWidth + 1;
  let overflow = [];
  // Menyu və düymənin mətni hər yoxlamadan ƏVVƏL yazılır — düymənin eni də ölçüyə daxildir.
  const apply = () => renderTabsMenu(all.filter((t) => overflow.includes(t)), active);
  all.forEach((t) => { t.hidden = false; });
  strip.classList.remove('is-short', 'is-tight');
  btn.classList.remove('is-icon');
  apply();
  const steps = [
    () => strip.classList.add('is-short'),                         // 2) qısa adlar
    () => {                                                          // 3) aşağı prioritetli, nişansız tablar menyuya
      for (const id of TAB_OVERFLOW_ORDER) {
        const t = $(id);
        if (!t || tabBadge(t)) continue;
        t.hidden = true;
        overflow.push(t);
        apply();
        if (fits()) return;
      }
    },
    () => strip.classList.add('is-tight'),                         // 4) sıx tablar
    () => { if (!overflow.includes(active)) btn.classList.add('is-icon'); },   // 5) "Daha çox" — yalnız ikon
    () => {                                                          // 6) dar ekran: zolaqda yalnız aktiv tab
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
}
function renderTabsMenu(overflow, active) {
  const wrap = $('tabs-more-wrap');
  const menu = $('tabs-menu');
  const label = $('tabs-more-label');
  const btn = $('tabs-more');
  wrap.hidden = overflow.length === 0;
  const activeInMenu = overflow.includes(active);
  // Aktiv tab menyudadırsa — düymədə onun adı.
  // Zolaq qısa adlardadırsa, düymədə də qısa ad ("Əlavə") — en ölçüsünə daxildir.
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
 * (`--filters-h`): altdakı yapışqan elementlər və keçidlərin hədəfi (scroll-margin) bunları işlədir.
 */
function updateStickyOffsets() {
  const bar = document.querySelector('.tabsbar');
  if (!bar || bar.offsetParent === null) return;
  const top = parseFloat(getComputedStyle(bar).top) || 0;
  document.documentElement.style.setProperty('--tabs-h', Math.ceil(top + bar.offsetHeight) + 'px');
  const panel = [...document.querySelectorAll('#view-results .panel')].find((p) => !p.hidden);
  const sticky = panel && [...panel.querySelectorAll('.stickyrow')].find((n) => getComputedStyle(n).position === 'sticky');
  document.documentElement.style.setProperty('--filters-h', (sticky ? Math.ceil(sticky.offsetHeight) : 0) + 'px');
}

export { layoutTabs, selectTab, wireTabs };
