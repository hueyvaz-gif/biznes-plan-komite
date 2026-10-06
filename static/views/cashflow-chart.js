/* Pul axını hekayəsi: illik FCFF sütunları + kumulyativ xətt BİR qrafikdə.
 *   • qalıq dəyər son ilin sütununda ayrıca ştrixli seqmentdir (FCFF = əməliyyat axını + qalıq dəyər);
 *   • kumulyativ xəttin sıfırı kəsdiyi yerdə "Özünü ödəmə" markeri (il backend-in PP hesabından);
 *   • hover / klaviatura (← →) crosshair: il, FCFF, o cümlədən qalıq dəyər, kumulyativ, diskontlaşdırılmış FCFF;
 *   • giriş: sütunlar 40ms ardıcıllıqla böyüyür, xətt 800ms-də çəkilir (ilk görünəndə, bir dəfə).
 * Bütün dəyərlər planın T27 cədvəlindən (API). Diskontlaşdırılmış dəyər yalnız göstərmək üçündür və backend-in
 * NPV qaydası ilə eynidir: FCFF_t / (1 + r)^t, t = 0 — ilk il. */
import { el } from '../ui/el.js';
import { onFirstVisible, reducedMotion } from '../ui/motion.js';
import { fmtMoney, fmtNumber, fmtYears } from '../format.js';

const NICE = [1, 2, 2.5, 5, 10];
function niceStep(range, ticks) {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return NICE.map((n) => n * mag).find((s) => s >= raw) || 10 * mag;
}
const axisLabel = (v) => (v === 0 ? '0' : fmtMoney(v, { compact: true, currency: false }).replace(/,0(?=\s)/, ''));

let uid = 0;

/**
 * cashflowChart({years, fcff, cumulative, residual, ratePct, payback}) → {node, table}
 *   payback — backend-in PP dəyəri (il, ilk ildən sayılır), yoxdursa marker çəkilmir.
 */
export function cashflowChart({ years, fcff, cumulative, residual, ratePct, payback, compact = false }) {
  const id = 'cf' + (++uid);
  const wrap = el('div', { class: 'cfc' });
  const tip = el('div', { class: 'cfc__tip', role: 'status', 'aria-live': 'polite', hidden: true });
  const n = years.length;
  const res = residual || years.map(() => 0);
  const disc = fcff.map((v, t) => (ratePct != null ? v / (1 + ratePct / 100) ** t : null));

  // Ekran oxuyucu üçün nəticə cümləsi.
  const last = cumulative[n - 1];
  const resTotal = res.reduce((s, v) => s + v, 0);
  const label = `Pul axını, ${years[0]}–${years[n - 1]}. İnvestisiya ili FCFF ${fmtMoney(fcff[0], { compact: true })}; `
    + `kumulyativ axın ${payback != null ? `${fmtYears(payback)}-də sıfırı keçir` : 'sıfırı keçmir'} və sonda ${fmtMoney(last, { compact: true })} olur`
    + (resTotal ? `; son ilin ${fmtMoney(resTotal, { compact: true })}-ı qalıq dəyərdir.` : '.');

  function draw() {
    const W = Math.max(320, Math.round(wrap.clientWidth || 720));
    const narrow = W < 560;
    const H = compact ? 240 : narrow ? 260 : 320;
    const m = { t: 34, r: 16, b: 30, l: narrow ? 44 : 60 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const lo = Math.min(0, ...fcff, ...cumulative);
    const hi = Math.max(0, ...fcff, ...cumulative);
    const step = niceStep(hi - lo || 1, narrow ? 4 : 5);
    const y0 = Math.floor(lo / step) * step;
    const y1 = Math.ceil(hi / step) * step;
    const y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
    const band = iw / n;
    const bw = Math.min(36, band * 0.56);
    const cx = (i) => m.l + band * i + band / 2;

    const svg = el('svg', { class: 'cfc__svg', viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
    svg.append(el('defs', null, el('pattern', { id: id + '-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      el('rect', { class: 'cfc__hatchbg', width: 6, height: 6 }), el('line', { class: 'cfc__hatch', x1: 0, y1: 0, x2: 0, y2: 6 }))));

    // Şəbəkə və ox yazıları.
    const grid = el('g', { class: 'cfc__grid' });
    for (let v = y0; v <= y1 + step / 2; v += step) {
      grid.append(el('line', { class: v === 0 ? 'cfc__zero' : 'cfc__gl', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }),
        el('text', { class: 'cfc__yl', x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, axisLabel(v)));
    }
    years.forEach((yr, i) => {
      if (narrow && i % 2 && i !== n - 1) return;
      grid.append(el('text', { class: 'cfc__xl', x: cx(i), y: H - 10, 'text-anchor': 'middle' }, String(yr)));
    });
    svg.append(grid);

    // Sütunlar: əməliyyat axını (FCFF − qalıq dəyər) + qalıq dəyər ştrixli.
    const bars = el('g', { class: 'cfc__bars' });
    years.forEach((_, i) => {
      const op = fcff[i] - res[i];
      const g = el('g', { class: 'cfc__bar', style: { '--i': String(i) } });
      const top = y(Math.max(0, op)); const bottom = y(Math.min(0, op));
      g.append(el('rect', { class: op < 0 ? 'cfc__neg' : 'cfc__pos', x: cx(i) - bw / 2, y: top, width: bw, height: Math.max(1, bottom - top), rx: 2 }));
      if (res[i]) {
        const rt = y(op + res[i]); const rb = y(op);
        g.append(el('rect', { class: 'cfc__res', x: cx(i) - bw / 2, y: rt, width: bw, height: Math.max(1, rb - rt), rx: 2, fill: `url(#${id}-hatch)` }));
      }
      g.style.transformOrigin = `${cx(i)}px ${y(0)}px`;
      bars.append(g);
    });
    svg.append(bars);

    // Kumulyativ xətt.
    const pts = cumulative.map((v, i) => [cx(i), y(v)]);
    const d = pts.map(([px, py], i) => (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1)).join(' ');
    const line = el('path', { class: 'cfc__line', d, pathLength: 1 });
    svg.append(line, el('g', { class: 'cfc__dots' }, pts.map(([px, py], i) =>
      el('circle', { class: cumulative[i] < 0 ? 'cfc__dot cfc__dot--neg' : 'cfc__dot', cx: px, cy: py, r: 3.5 }))));

    // Özünü ödəmə: backend PP-ni kumulyativ nöqtələr arasında interpolyasiya ilə tapır (indeks = il sayı),
    // ona görə marker cx(0) + band × PP-dədir — xəttin sıfırı kəsdiyi yer.
    if (payback != null && payback > 0 && payback < n) {
      const xpos = cx(0) + band * payback;
      const yearLabel = years[0] + Math.floor(payback);
      const text = `Özünü ödəmə · ${yearLabel} · ${fmtYears(payback)}`;
      const lw = text.length * 6.4 + 16;
      const lx = Math.min(W - m.r - lw, Math.max(m.l, xpos - lw / 2));
      svg.append(el('g', { class: 'cfc__pp' },
        el('line', { class: 'cfc__ppline', x1: xpos, x2: xpos, y1: m.t - 6, y2: H - m.b }),
        el('circle', { class: 'cfc__ppdot', cx: xpos, cy: y(0), r: 5 }),
        el('rect', { class: 'cfc__pplabel', x: lx, y: 4, width: lw, height: 22, rx: 11 }),
        el('text', { class: 'cfc__pptext', x: lx + lw / 2, y: 19, 'text-anchor': 'middle' }, text)));
    }

    // Crosshair: il zolaqları.
    const hover = el('g', { class: 'cfc__hover' });
    const cross = el('rect', { class: 'cfc__cross', x: 0, y: m.t, width: band, height: ih, hidden: true });
    hover.append(cross);
    years.forEach((_, i) => hover.append(el('rect', { class: 'cfc__hit', x: m.l + band * i, y: m.t, width: band, height: ih, dataset: { i } })));
    svg.append(hover);

    const show = (i) => {
      if (i == null) { cross.setAttribute('hidden', ''); tip.hidden = true; return; }
      cross.removeAttribute('hidden');
      cross.setAttribute('x', m.l + band * i);
      tip.replaceChildren(
        el('strong', { text: String(years[i]) }),
        el('dl', null,
          el('dt', { text: 'FCFF' }), el('dd', { class: fcff[i] < 0 ? 'tone-negative' : '', text: fmtMoney(fcff[i]) }),
          res[i] ? [el('dt', { text: '— o cümlədən qalıq dəyər' }), el('dd', { text: fmtMoney(res[i]) })] : null,
          el('dt', { text: 'Kumulyativ' }), el('dd', { class: cumulative[i] < 0 ? 'tone-negative' : 'tone-positive', text: fmtMoney(cumulative[i]) }),
          disc[i] != null ? [el('dt', { text: `Diskontlaşdırılmış (${fmtNumber(ratePct, { maxDecimals: 2 })}%)` }), el('dd', { text: fmtMoney(disc[i]) })] : null));
      tip.hidden = false;
      const left = (cx(i) / W) * 100;
      tip.style.left = `${left}%`;
      tip.classList.toggle('is-left', left > 60);
      wrap.dataset.active = String(i);
    };
    svg.addEventListener('mousemove', (e) => { const hit = e.target.closest('.cfc__hit'); if (hit) show(Number(hit.dataset.i)); });
    svg.addEventListener('mouseleave', () => show(null));
    wrap.show = show;
    return svg;
  }

  // Klaviatura: qrafik fokuslanır, ← → illər arasında.
  const figure = el('figure', { class: 'cfc__fig', role: 'img', tabIndex: 0, 'aria-label': label + ' Ox düymələri ilə illər üzrə dəyərlərə baxın.' });
  figure.addEventListener('keydown', (e) => {
    const cur = wrap.dataset.active ? Number(wrap.dataset.active) : -1;
    const next = { ArrowRight: Math.min(n - 1, cur + 1), ArrowLeft: Math.max(0, cur - 1), Home: 0, End: n - 1 }[e.key];
    if (next === undefined) { if (e.key === 'Escape') wrap.show(null); return; }
    e.preventDefault();
    wrap.show(next);
  });
  figure.addEventListener('blur', () => wrap.show && wrap.show(null));
  wrap.append(figure, tip);

  let lastW = 0;
  const render = () => {
    const w = Math.round(wrap.clientWidth);
    if (!w || Math.abs(w - lastW) < 8) return;
    lastW = w;
    figure.replaceChildren(draw());
    if (wrap.classList.contains('is-in')) figure.querySelector('svg').classList.add('is-static');
  };
  if ('ResizeObserver' in window) new ResizeObserver(() => requestAnimationFrame(render)).observe(wrap);
  requestAnimationFrame(render);
  onFirstVisible(wrap, () => { if (!reducedMotion()) wrap.classList.add('is-animating'); wrap.classList.add('is-in'); }, { threshold: 0.3 });

  const legend = el('ul', { class: 'cfc__legend' },
    el('li', null, el('span', { class: 'cfc__key cfc__key--bar' }), 'İllik FCFF'),
    el('li', null, el('span', { class: 'cfc__key cfc__key--neg' }), 'Mənfi FCFF (investisiya)'),
    resTotal ? el('li', null, el('span', { class: 'cfc__key cfc__key--res' }), 'Qalıq dəyər (son il)') : null,
    el('li', null, el('span', { class: 'cfc__key cfc__key--line' }), 'Kumulyativ FCFF'),
    payback != null ? el('li', null, el('span', { class: 'cfc__key cfc__key--pp' }), 'Özünü ödəmə') : null);

  const table = {
    caption: 'Pul axını illər üzrə (T27)',
    columns: [
      { key: 'year', label: 'İl' },
      { key: 'fcff', label: 'FCFF', type: 'number', signed: true, render: (r) => fmtMoney(r.fcff) },
      { key: 'res', label: 'O cümlədən qalıq dəyər', type: 'number', render: (r) => (r.res ? fmtMoney(r.res) : '—') },
      { key: 'cum', label: 'Kumulyativ', type: 'number', signed: true, render: (r) => fmtMoney(r.cum) },
      { key: 'disc', label: 'Diskontlaşdırılmış', type: 'number', signed: true, render: (r) => fmtMoney(r.disc) },
    ],
    rows: years.map((yr, i) => ({ id: yr, year: String(yr), fcff: fcff[i], res: res[i], cum: cumulative[i], disc: disc[i] })),
  };
  return { node: el('div', { class: 'cfc__box' }, wrap, legend), table, label };
}
