/* Hərəkət köməkçiləri. Qayda: hər animasiya nəyisə izah edir, 150–600ms, sonra dayanır;
 * prefers-reduced-motion → hamısı ani. Yalnız ilk görünmədə işləyir (IntersectionObserver). */

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const seen = new WeakSet();

/** Element ekrana ilk dəfə girəndə fn bir dəfə çağırılır (artıq görünübsə dərhal). */
export function onFirstVisible(node, fn, { threshold = 0.2 } = {}) {
  if (!node || seen.has(node)) return;
  seen.add(node);
  if (!('IntersectionObserver' in window)) { fn(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { threshold });
  io.observe(node);
}

const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * Count-up: node-un mətni 0-dan `value`-ya qədər `format` ilə dəyişir.
 * Aralıq dəyərlər SON dəyərin dəqiqliyi ilə formatlanır (format eyni funksiyadır) — "1,2833" kimi
 * yanlış aralıq rəqəm yaranmır. Ekran oxuyucu yalnız son dəyəri eşidir (aria-label).
 */
export function countUp(node, value, format, { duration = 400 } = {}) {
  const final = format(value);
  node.setAttribute('aria-label', final);
  if (reducedMotion() || typeof value !== 'number' || !Number.isFinite(value) || value === 0) {
    node.textContent = final;
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    node.textContent = t < 1 ? format(value * easeOut(t)) : final;
    if (t < 1) requestAnimationFrame(step);
  };
  node.textContent = format(0);
  requestAnimationFrame(step);
}

/** Sinfi bir dəfəlik animasiya üçün əlavə edir və bitəndə silir (stamp, pop, flash). */
export function playOnce(node, className) {
  if (!node || reducedMotion()) return;
  node.classList.remove(className);
  void node.offsetWidth;            // reflow — eyni sinif yenidən işləsin
  node.classList.add(className);
  node.addEventListener('animationend', () => node.classList.remove(className), { once: true });
}
