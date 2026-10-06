/* Bazar icmalı (sol panel) — /api/market cavabını göstərir.
 *
 * Qaydalar:
 *   • Rəqəm yalnız serverdən gəlir; mənbə qoşulmayıbsa və ya cavab yoxdursa, bunu açıq yazırıq.
 *   • Demo rejimində ayrıca işarələnmiş NÜMUNƏ göstərilir — canlı məlumat kimi təqdim edilmir.
 *   • Dəyər yenilənəndə dəyişmə istiqaməti qısa vurğulanır (prefers-reduced-motion-a hörmət edilir).
 *
 * Saf funksiyalar Node testləri üçün `module.exports`-dadır; brauzerdə `window.Market`.
 */
(function (root) {
  'use strict';

  /** Demo rejimi üçün nümunə — maketdəki kimi, canlı deyil. */
  const SAMPLE = {
    sample: true,
    enabled: true,
    fx: { status: 'ok', bulletin_date: null, source: { name: 'Nümunə' },
      items: [{ pair: 'USD/AZN', value: 1.7 }, { pair: 'EUR/AZN', value: 1.85 }, { pair: 'TRY/AZN', value: 0.05 }] },
    assets: [
      { id: 'aapl', label: 'AAPL', status: 'ok', value: 220, currency: 'USD', unit: '1 səhm', change_pct: 0.8 },
      { id: 'brent', label: 'Brent', status: 'ok', value: 75, currency: 'USD', unit: '1 barel', change_pct: -0.4 },
      { id: 'gold', label: 'Qızıl', status: 'ok', value: 2500, currency: 'USD', unit: '1 troya unsiyası', change_pct: 0.3 },
    ],
    news: { status: 'ok', items: [
      { title: 'Bazarların həftəlik icmalı', source: 'Nümunə xəbər', url: null, published: null },
      { title: 'Valyuta bazarında əsas trendlər', source: 'Nümunə xəbər', url: null, published: null },
    ] },
  };

  function number(value, decimals) {
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    const fixed = Math.abs(value).toFixed(decimals);
    const [int, frac] = fixed.split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (value < 0 ? '−' : '') + grouped + (frac ? ',' + frac : '');
  }

  /** Məzənnə 4 onluqla (1,7000), qiymətlər 2 onluqla, valyuta işarəsi ilə. */
  function rateText(value) { return number(value, 4); }

  function priceText(value, currency) {
    const text = number(value, value >= 1000 ? 0 : 2);
    // Dollar işarəsi önə; manat və digərləri kod ilə (₼ bəzi şriftlərdə oxunaqsızdır).
    return currency === 'USD' ? '$' + text : text + ' ' + (currency || '');
  }

  /** "0,80" → "0,8"; "1,00" → "1"; "0,00" → "0". */
  function trimZeros(text) {
    return text.indexOf(',') < 0 ? text : text.replace(/0+$/, '').replace(/,$/, '');
  }

  /** Dəyişmə: istiqamət MƏTN və işarə ilə (yalnız rənglə yox). */
  function change(pct) {
    if (typeof pct !== 'number' || !isFinite(pct)) return null;
    const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
    const word = dir === 'up' ? 'artım' : dir === 'down' ? 'azalma' : 'dəyişməyib';
    const short = trimZeros(number(Math.abs(pct), 2));
    return { dir, text: arrow + ' ' + short + '%', label: word + (dir === 'flat' ? '' : ' ' + short + '%') };
  }

  /** "2026-10-05T14:30:00" → "05.10.2026 14:30"; "2026-10-02" → "02.10.2026". */
  function dateText(value) {
    if (!value) return '';
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return String(value);
    return m[3] + '.' + m[2] + '.' + m[1] + (m[4] ? ' ' + m[4] + ':' + m[5] : '');
  }

  const STATUS_TEXT = {
    not_configured: 'Mənbə qoşulmayıb',
    unavailable: 'Məlumat mövcud deyil',
    disabled: 'Söndürülüb',
  };

  /** Dəyişən dəyərlərin istiqaməti (əvvəlki yeniləmə ilə müqayisə). */
  function movement(previous, key, value) {
    if (typeof value !== 'number' || !previous || typeof previous[key] !== 'number' || previous[key] === value) return null;
    return value > previous[key] ? 'up' : 'down';
  }

  const api = { SAMPLE, number, rateText, priceText, change, dateText, movement, STATUS_TEXT };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ── DOM ─────────────────────────────────────────────────────────────── */

  let deps = null;
  let last = {};
  let timer = null;
  let firstPaint = true;
  const REFRESH_MS = 15 * 60 * 1000;

  /** Sətrin solundakı simvol (dekorativdir — ekran oxuyucu adı sətrin mətnindən alır). */
  const SYMBOL = { 'USD/AZN': '$', 'EUR/AZN': '€', 'TRY/AZN': '₺', aapl: 'A', brent: 'B', gold: 'Au' };
  const SUBLABEL = { 'USD/AZN': 'ABŞ dolları', 'EUR/AZN': 'Avro', 'TRY/AZN': 'Türk lirəsi',
    aapl: 'Apple · NASDAQ', brent: 'Neft · 1 barel', gold: '1 troya unsiyası' };

  function reduced() { return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  /** Dəyər dərhal dəqiq yazılır — sayılma animasiyası yanlış aralıq məzənnə göstərirdi. */
  function setValue(node, value, format) {
    node.textContent = format(value);
  }

  function flash(node, dir) {
    if (!dir) return;
    node.classList.remove('flash-up', 'flash-down');
    void node.offsetWidth;                       // animasiyanı yenidən başlat
    node.classList.add('flash-' + dir);
  }

  function changeNode(pct) {
    const c = change(pct);
    if (!c) return deps.el('span', 'mchg mchg--none', '');
    const node = deps.el('span', 'mchg mchg--' + c.dir + ' num', c.text);
    node.setAttribute('aria-label', c.label);
    return node;
  }

  /** Sətir: simvol · ad (+ alt ad) · dəyər (+ dəyişmə). */
  function row(key, label, value, format, pct, title) {
    const { el } = deps;
    const li = el('li', 'mrow');
    const sym = el('span', 'msym', SYMBOL[key] || label.slice(0, 1));
    sym.setAttribute('aria-hidden', 'true');
    const name = el('span', 'mname');
    name.append(el('span', 'mrow__label', label), el('span', 'mrow__sub', SUBLABEL[key] || ''));
    const right = el('span', 'mval');
    const valueNode = el('span', 'mrow__value num');
    setValue(valueNode, value, format);
    right.append(valueNode, changeNode(pct));
    li.append(sym, name, right);
    if (title) li.title = title;
    return li;
  }

  function emptyRow(label, text, title) {
    const { el } = deps;
    const li = el('li', 'mrow mrow--empty');
    const sym = el('span', 'msym msym--off', SYMBOL[label.toLowerCase()] || label.slice(0, 1));
    sym.setAttribute('aria-hidden', 'true');
    li.append(sym, el('span', 'mrow__label', label), el('span', 'mrow__missing', text));
    if (title) li.title = title;
    return li;
  }

  function stateText(block) {
    return (STATUS_TEXT[block.status] || 'Məlumat mövcud deyil')
      + (block.message && block.message.indexOf(': ') > 0 ? ' — ' + block.message.split(': ').slice(1).join(': ') : '');
  }

  function render(data) {
    const { el, $ } = deps;
    $('market').setAttribute('aria-busy', 'false');
    $('market-tag').hidden = !data.sample;
    $('market-fx').removeAttribute('aria-label');

    // Valyutalar
    const fx = data.fx || {};
    if (fx.items && fx.items.length) {
      $('market-fx').replaceChildren(...fx.items.map((i) => {
        const li = row(i.pair, i.pair, i.value, rateText, i.change_pct,
          '1 ' + i.pair.split('/')[0] + ' = ' + rateText(i.value) + ' AZN');
        flash(li, movement(last, i.pair, i.value));
        last[i.pair] = i.value;
        return li;
      }));
      $('market-fx-src').textContent = data.sample ? 'Nümunə məlumat · canlı deyil'
        : (fx.source ? fx.source.name : '') + (fx.bulletin_date ? ' · ' + fx.bulletin_date + ' bülleteni' : '')
          + (fx.status === 'stale' ? ' · köhnəlmiş' : '');
    } else {
      $('market-fx').replaceChildren(el('li', 'mrow mrow--empty', stateText(fx)));
      $('market-fx-src').textContent = '';
    }

    // Səhmlər və əmtəələr
    const assets = data.assets || [];
    $('market-assets').replaceChildren(...assets.map((a) => {
      if (a.status !== 'ok' && a.status !== 'stale') return emptyRow(a.label, STATUS_TEXT[a.status] || '—', a.message || '');
      const li = row(a.id, a.label, a.value, (v) => priceText(v, a.currency), a.change_pct,
        a.unit + (a.as_of ? ' · ' + (a.as_of_label || 'tarix') + ': ' + dateText(a.as_of) : '')
          + (a.source ? ' · ' + a.source.name : '') + (a.status === 'stale' ? ' · köhnəlmiş' : ''));
      flash(li, movement(last, a.id, a.value));
      last[a.id] = a.value;
      return li;
    }));
    const sources = [...new Set(assets.filter((a) => a.status === 'ok' || a.status === 'stale')
      .map((a) => a.source && a.source.name).filter(Boolean))];
    const dates = assets.filter((a) => a.as_of && (a.status === 'ok' || a.status === 'stale'))
      .map((a) => a.label + ' ' + dateText(a.as_of));
    $('market-assets-src').textContent = data.sample ? 'Nümunə məlumat · canlı deyil'
      : [sources.join(', '), dates.join(' · ')].filter(Boolean).join(' · ');

    // Xəbərlər — əsas axından çıxarılıb (element yoxdursa göstərilmir)
    const news = data.news || {};
    if (!$('market-news')) { /* xəbər bloku yoxdur */ } else if (news.items && news.items.length) {
      $('market-news').replaceChildren(...news.items.map((n) => {
        const li = el('li', 'mnews');
        let title;
        if (n.url && /^https?:\/\//.test(n.url)) {
          title = el('a', 'mnews__title', n.title);
          title.href = n.url;
          title.target = '_blank';
          title.rel = 'noopener noreferrer';
          title.append(el('span', 'sr-only', ' (yeni pəncərədə açılır)'));
        } else {
          title = el('span', 'mnews__title', n.title);
        }
        title.lang = 'en';   // ekran oxuyucu ingilis tələffüzü ilə oxusun
        li.append(title, el('span', 'mnews__meta', [n.source, dateText(n.published)].filter(Boolean).join(' · ')));
        return li;
      }));
    } else {
      $('market-news').replaceChildren(el('li', 'mnews mnews--empty', stateText(news)));
    }
    $('market-note').textContent = data.sample ? 'Demo məlumatlar · canlı deyil'
      : 'Yalnız məlumat üçündür, investisiya tövsiyəsi deyil.';
    firstPaint = false;
  }

  /** Tablar: klik və ox düymələri (roving tabindex). */
  function wireTabs() {
    const tabs = ['mtab-fx', 'mtab-assets', 'mtab-news'].map((id) => document.getElementById(id)).filter(Boolean);
    const select = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab, false));
      tab.addEventListener('keydown', (e) => {
        const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        select(tabs[(next + tabs.length) % tabs.length], true);
      });
    });
  }

  /* Brauzer keşi (1 saat): /api/market bir neçə saniyə çəkir — açılışda yalnız keşdən göstərilir.
   * localStorage əlçatmazdırsa (gizli rejim) sadəcə şəbəkədən oxunur. */
  const CACHE_KEY = 'market-cache-v1';
  const CACHE_MS = 60 * 60 * 1000;
  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return c && Date.now() - c.t < CACHE_MS ? c.data : null;
    } catch (_) { return null; }
  }
  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch (_) { /* yer yoxdur */ }
  }

  async function refresh(force) {
    if (!deps) return;
    try {
      if (deps.demo()) { render(SAMPLE); return; }
      const cached = force ? null : readCache();
      if (cached) { render(cached); return; }
      const data = await deps.get('/api/market');
      writeCache(data);
      render(data);
    } catch (_) {
      // Bazar bloku köməkçidir — xətası sənəd yoxlamasına təsir etmir.
      render({ fx: { status: 'unavailable' }, assets: [], news: { status: 'unavailable' } });
    }
  }

  function init(d) {
    deps = d;
    last = {};
    firstPaint = true;
    wireTabs();
    clearInterval(timer);
    // Lazy: vidcet yığılıdır — məlumat yalnız ilk açılanda yüklənir, yeniləmə yalnız açıq olanda işləyir.
    const box = document.getElementById('market-box');
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      refresh();
      timer = setInterval(() => { if (!document.hidden && (!box || box.open)) refresh(true); }, REFRESH_MS);
    };
    if (!box || box.open) start();
    else box.addEventListener('toggle', () => { if (box.open) start(); });
  }

  root.Market = { init, refresh, render };
})(this);
