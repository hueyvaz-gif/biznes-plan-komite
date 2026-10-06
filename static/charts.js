/* Qrafiklər — kitabxanasız SVG.
 *
 * Niyə öz SVG-miz: cəmi 4 sadə qrafik lazımdır (sütun, xətt, iki bölgü);
 * kitabxana asılılığı, şəbəkədən yükləmə və böyük fayl lazım deyil, oflayn
 * işləyir. Bütün HESABLAMALAR (kumulyativ axın, paylar) Python-dadır — burada
 * yalnız ölçü şkalası və həndəsə qurulur.
 *
 * Əlçatanlıq: hər qrafik role="img" + aria-label ilə qısa təsvir daşıyır, və
 * hər qrafikin altında eyni məlumatın CƏDVƏL alternativi var. Mətn yalnız
 * textContent ilə yazılır.
 *
 * Brauzerdə `window.Charts`, Node-da `module.exports` (testlər üçün).
 */
(function (root) {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';

  /** Oxu üçün "gözəl" bölgülər: min..max aralığını təxminən `count` hissəyə bölür. */
  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const raw = span / Math.max(1, count || 4);
    const power = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) || raw;
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return ticks;
  }

  /** Qısa yazılış: 13 481 000 -> "13,5 mln"; mənfi ədəd "−" ilə. */
  function formatShort(value) {
    const abs = Math.abs(value);
    const sign = value < 0 ? '−' : '';
    const fmt = (n, d) => n.toFixed(d).replace('.', ',');
    if (abs >= 1e9) return sign + fmt(abs / 1e9, 1) + ' mlrd';
    if (abs >= 1e6) return sign + fmt(abs / 1e6, 1) + ' mln';
    if (abs >= 1e3) return sign + fmt(abs / 1e3, 0) + ' min';
    return sign + fmt(abs, 0);
  }

  /** Tam yazılış: 13481000 -> "13 481 000". */
  function formatFull(value) {
    const text = Math.round(Math.abs(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (value < 0 ? '−' : '') + text;
  }

  function percent(share) {
    return share === null || share === undefined
      ? '—' : (share * 100).toFixed(1).replace('.', ',') + '%';
  }

  // ── DOM köməkçiləri (yalnız brauzerdə) ──────────────────────────────────

  function svg(tag, attrs, text) {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, String(v)));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function html(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /** Qrafikin cədvəl alternativi (<details> içində). */
  function dataTable(caption, headers, rows) {
    const details = html('details', 'chart__table');
    details.append(html('summary', null, 'Cədvəl kimi göstər'));
    const table = html('table', 'table table--compact');
    table.append(html('caption', 'sr-only', caption));
    const head = html('tr');
    headers.forEach((h, i) => {
      const th = html('th', i ? 'num' : null, h);
      th.scope = 'col';
      head.append(th);
    });
    const thead = html('thead');
    thead.append(head);
    const tbody = html('tbody');
    rows.forEach((cells) => {
      const tr = html('tr');
      cells.forEach((c, i) => tr.append(html('td', i ? 'num' : null, c)));
      tbody.append(tr);
    });
    table.append(thead, tbody);
    const wrap = html('div', 'tablewrap');
    wrap.append(table);
    details.append(wrap);
    return details;
  }

  // Eni çəkiləndə seçilir (dar ekranda 360): yazılar real ölçüdə qalır, sıxılmır.
  let W = 640;
  const H = 240;
  const PAD = { top: 16, right: 12, bottom: 34, left: 78 };

  function frame(label) {
    return svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label,
                        class: 'chart__svg', preserveAspectRatio: 'xMidYMid meet' });
  }

  function yAxis(node, ticks, y) {
    ticks.forEach((t) => {
      node.append(svg('line', { x1: PAD.left, x2: W - PAD.right, y1: y(t), y2: y(t),
                                class: t === 0 ? 'chart__zero' : 'chart__grid' }));
      node.append(svg('text', { x: PAD.left - 8, y: y(t) + 4, 'text-anchor': 'end',
                                class: 'chart__tick' }, formatShort(t)));
    });
  }

  /** FCFF illər üzrə: müsbət və mənfi sütunlar sıfır xəttindən. */
  function barChart(data, label) {
    const values = data.values;
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const y = (v) => PAD.top + (hi - v) / (hi - lo) * (H - PAD.top - PAD.bottom);
    const node = frame(label);
    yAxis(node, ticks, y);
    const slot = (W - PAD.left - PAD.right) / values.length;
    const every = slot < 40 ? 2 : 1;               // dar ekranda iki ildən bir yazı
    const bar = Math.max(4, slot * 0.62);
    values.forEach((v, i) => {
      const x = PAD.left + i * slot + (slot - bar) / 2;
      const top = Math.min(y(v), y(0));
      const height = Math.max(1, Math.abs(y(v) - y(0)));
      const rect = svg('rect', { x, y: top, width: bar, height, rx: 2,
                                 class: v < 0 ? 'chart__bar chart__bar--neg' : 'chart__bar' });
      rect.append(svg('title', {}, `${data.years[i]}: ${formatFull(v)} ${data.unit}`));
      node.append(rect);
      if (i % every === 0) {
        node.append(svg('text', { x: x + bar / 2, y: H - 10, 'text-anchor': 'middle',
                                  class: 'chart__tick' }, String(data.years[i])));
      }
    });
    return node;
  }

  /** Kumulyativ axın: xətt + nöqtələr; sıfır xətti ödəmə nöqtəsini göstərir. */
  function lineChart(data, label) {
    const values = data.values;
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const y = (v) => PAD.top + (hi - v) / (hi - lo) * (H - PAD.top - PAD.bottom);
    const step = values.length > 1 ? (W - PAD.left - PAD.right - 24) / (values.length - 1) : 0;
    const x = (i) => PAD.left + 12 + i * step;
    const every = step < 40 ? 2 : 1;
    const node = frame(label);
    yAxis(node, ticks, y);
    node.append(svg('polyline', { points: values.map((v, i) => `${x(i)},${y(v)}`).join(' '),
                                  class: 'chart__line' }));
    values.forEach((v, i) => {
      const dot = svg('circle', { cx: x(i), cy: y(v), r: 3.5,
                                  class: v < 0 ? 'chart__dot chart__dot--neg' : 'chart__dot' });
      dot.append(svg('title', {}, `${data.years[i]}: ${formatFull(v)} ${data.unit}`));
      node.append(dot);
      if (i % every === 0) {
        node.append(svg('text', { x: x(i), y: H - 10, 'text-anchor': 'middle',
                                  class: 'chart__tick' }, String(data.years[i])));
      }
    });
    return node;
  }

  /** Bölgü: bir üfüqi zolaq (100%) + əfsanə (məbləğ, pay, mənbə). */
  function splitChart(data, label) {
    const box = html('div', 'split');
    const bar = html('div', 'split__bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', label);
    data.parts.forEach((p, i) => {
      const seg = html('span', 'split__seg split__seg--' + (i % 4));
      seg.style.flexGrow = String(Math.max(p.share || 0, 0.001));
      seg.title = `${p.label}: ${formatFull(p.value)} ${data.unit} (${percent(p.share)})`;
      bar.append(seg);
    });
    const legend = html('ul', 'split__legend');
    data.parts.forEach((p, i) => {
      const li = html('li');
      li.append(html('span', 'split__key split__seg--' + (i % 4)));
      li.append(html('span', 'split__label', p.label));
      li.append(html('span', 'split__value num', `${formatFull(p.value)} ${data.unit}`));
      li.append(html('span', 'split__share num', percent(p.share)));
      legend.append(li);
    });
    box.append(bar, legend);
    return box;
  }

  /**
   * Bir qrafik kartı: başlıq, vahid/il/mənbə, qrafik, cədvəl alternativi.
   * Məlumat yoxdursa — uydurulmur, aydın boş vəziyyət göstərilir.
   */
  function chartCard(kind, title, data, width) {
    W = width || 640;
    const card = html('figure', 'chart');
    card.append(html('figcaption', 'chart__title', title));
    if (!data || !data.available) {
      card.classList.add('chart--empty');
      card.append(html('p', 'chart__empty',
        'Qrafik qurulmadı: ' + ((data && data.reason) || 'məlumat yoxdur') + ' Rəqəm uydurulmur.'));
      return card;
    }
    const meta = [];
    if (data.unit) meta.push('Vahid: ' + data.unit);
    if (data.years) meta.push('İllər: ' + data.years[0] + '–' + data.years[data.years.length - 1]);
    if (data.source) meta.push('Mənbə: cədvəl ' + data.source);
    if (data.parts) {
      const sources = [...new Set(data.parts.map((p) => p.source).filter(Boolean))];
      if (sources.length) meta.push('Mənbə: ' + sources.join(', '));
    }
    card.append(html('p', 'chart__meta', meta.join(' · ')));

    if (kind === 'bar' || kind === 'line') {
      const description = `${title}, ${data.years[0]}–${data.years[data.years.length - 1]}, `
        + `ən kiçik ${formatShort(Math.min(...data.values))}, ən böyük `
        + `${formatShort(Math.max(...data.values))} ${data.unit}.`;
      card.append(kind === 'bar' ? barChart(data, description) : lineChart(data, description));
      card.append(dataTable(title, ['İl', `Məbləğ, ${data.unit}`],
        data.years.map((year, i) => [String(year), formatFull(data.values[i])])));
    } else {
      const description = `${title}: ` + data.parts.map((p) => `${p.label} ${percent(p.share)}`).join(', ');
      card.append(splitChart(data, description));
      card.append(dataTable(title, ['Hissə', `Məbləğ, ${data.unit}`, 'Pay', 'Mənbə'],
        data.parts.map((p) => [p.label, formatFull(p.value), percent(p.share), p.source || '—'])));
    }
    if (data.note) card.append(html('p', 'chart__note', data.note));
    return card;
  }

  const api = { niceTicks, formatShort, formatFull, percent, chartCard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Charts = api;
})(this);
