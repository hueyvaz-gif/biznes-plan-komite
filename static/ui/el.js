/* DOM köməkçiləri — innerHTML YOXDUR: sənəddən gələn mətn həmişə textContent / mətn düyünü kimi yazılır. */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'defs', 'pattern', 'clipPath', 'linearGradient', 'stop', 'title', 'desc', 'mask', 'use']);

/**
 * el(tag, props, ...children)
 *   props: { class, text, attrs: {}, dataset: {}, style: {}, on: {event: fn}, hidden, …başqa xassələr }
 *          — `class` sətir və ya massiv (falsy elementlər atılır); "aria-*", "role", "for" və s. birbaşa da verilə bilər.
 *   children: Node | string | number | null | false | massiv (düzlənir; null/false atılır).
 */
export function el(tag, props, ...children) {
  const node = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (props) applyProps(node, props);
  append(node, children);
  return node;
}

export function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') {
      const cls = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
      if (cls) node.setAttribute('class', cls);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'attrs') {
      for (const [a, v] of Object.entries(value)) if (v !== undefined && v !== null && v !== false) node.setAttribute(a, v === true ? '' : String(v));
    } else if (key === 'dataset') {
      for (const [a, v] of Object.entries(value)) if (v !== undefined && v !== null) node.dataset[a] = String(v);
    } else if (key === 'style') {
      for (const [a, v] of Object.entries(value)) {
        if (a.startsWith('--')) node.style.setProperty(a, String(v)); else node.style[a] = v;
      }
    } else if (key === 'on') {
      for (const [ev, fn] of Object.entries(value)) node.addEventListener(ev, fn);
    } else if (key.startsWith('aria-') || key.startsWith('data-') || key === 'role' || key === 'for'
               || node instanceof SVGElement) {
      node.setAttribute(key, value === true ? '' : String(value));
    } else {
      node[key] = value;
    }
  }
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** id ilə element (null qaytarır, atmır). */
export const $ = (id) => document.getElementById(id);

/** Null-safe yazı: element yoxdursa xəbərdarlıq etmir, səhifəni çökdürmür — sadəcə null qaytarır. */
export function setText(target, value) {
  const node = typeof target === 'string' ? $(target) : target;
  if (node) node.textContent = value === null || value === undefined ? '' : String(value);
  return node;
}

export function setHidden(target, hidden) {
  const node = typeof target === 'string' ? $(target) : target;
  if (node) node.hidden = !!hidden;
  return node;
}

let uid = 0;
/** Səhifədə unikal id (aria-controls, aria-describedby üçün). */
export const nextId = (prefix = 'ui') => `${prefix}-${++uid}`;
