/* Verdict Hero: komitə üzvü 5 saniyədə üç şeyi görür — (1) plan təqdimata hazırdırmı, (2) iqtisadi risk,
 * (3) ilk növbədə nə etmək lazımdır. Hər rəqəm API cavabından (Report / iqtisadi təhlil) gəlir.
 * Scroll aşağı gedəndə hero kompakt zolağa (herobar) çevrilir; tab zolağı transform ilə aşağı sürüşür (CLS yox). */
import { $, planName, reqCounts, setText } from '../core/dom.js';
import { state } from '../core/state.js';
import { moveIndicator, selectTab } from './tabs.js';
import { ProgressRing } from '../ui/card.js';
import { playOnce } from '../ui/motion.js';
import { fmtNumber, fmtPct, fmtDate } from '../format.js';

const TONE = { hazir: 'ok', duzelis: 'warn', hazir_deyil: 'fail', giris_xetasi: 'fail' };
const RISK_TONE = { yuksek: 'fail', orta: 'warn', asagi: 'ok' };

/** Ən təsirli tapıntı: sıfır həddi ən kiçik olan ssenari — cümlə kodla qurulur. */
const pctOf = (v) => fmtPct(Math.abs(v), { points: true, decimals: Math.abs(v) < 1 ? 2 : 1 });
const THRESHOLD_TEXT = {
  price_: (v) => `Satış qiyməti ${pctOf(v)} düşsə`,
  raw_: (v) => `Xammal ${pctOf(v)} bahalaşsa`,
  capex_: (v) => `İnvestisiya ${pctOf(v)} artsa`,
  capacity_: (v) => `Gücdən istifadə ${fmtPct(v, { points: true })}-dən aşağı düşsə`,
};
export function riskSentence(result) {
  const sens = (result && result.sensitivity) || {};
  const scenarios = (sens.scenarios || []).filter((s) => s.status === 'ok' && s.threshold && Number.isFinite(s.threshold.value));
  if (sens.base && sens.base.npv <= 0) return 'Baza ssenaridə NPV artıq mənfidir';
  // "change" hədləri faizlə müqayisə olunur; "level" (güc) — 100%-ə qədər ehtiyat: 100 − dəyər.
  const margin = (s) => (s.threshold.kind === 'level' ? 100 - s.threshold.value : Math.abs(s.threshold.value));
  const worst = scenarios.sort((a, b) => margin(a) - margin(b))[0];
  if (!worst) return null;
  const key = Object.keys(THRESHOLD_TEXT).find((k) => worst.id.startsWith(k));
  return key ? `${THRESHOLD_TEXT[key](worst.threshold.value)} NPV mənfiyə düşür` : null;
}

let lastCheckId = null;
let ring = null;

/** Tamlıq bloku və meta — renderResults-dan (state.report və overview hazır olandan sonra). */
export function renderHero(check, overview) {
  const result = check.result || {};
  const tone = TONE[check.verdict] || 'skip';
  const hero = $('reshead');
  if (hero) hero.dataset.tone = tone;
  setText('res-plan', planName(check));
  setText('res-file', check.file_name);
  setText('res-version', 'v' + check.version);
  setText('res-runstate', fmtDate(check.created_at));

  // Status pill-i: köhnə .statuspill sinifləri (çap və economics.js eyni işlədir).
  const pill = $('res-status');
  if (pill) pill.className = 'statuspill statuspill--' + tone;
  const label = check.verdict_label || ((state.meta && state.meta.verdicts) || {})[check.verdict] || 'Tamamlandı';
  setText('res-status-label', label);

  // Hazırlıq: planın mətnində yoxlanılan standart tələblərdən cavablandırılanların payı.
  const items = ((result.compliance || {}).items || []).filter((i) => (i.origin || 'standart') === 'standart');
  const c = reqCounts(items);
  const pct = c.evaluated ? Math.round((c.answered / c.evaluated) * 100) : 0;
  const host = $('hero-ring');
  if (host) {
    ring = ProgressRing({ value: pct, size: 72, stroke: 7, label: `Hazırlıq ${pct}%: ${c.answered}/${c.evaluated} tələb cavablandırılıb`,
      tone: tone === 'ok' ? 'success' : tone === 'fail' ? 'danger' : 'accent' });
    host.replaceChildren(ring);
  }
  setText('hero-ready-sub', `${fmtNumber(c.answered)}/${fmtNumber(c.evaluated)} tələb cavablandırılıb`);

  // Nə etmək lazımdır: düzəliş və dəqiqləşdirmə sayı + bloklayan problem.
  const fixes = (state.report && state.report.fixes) || [];
  const n = (s) => fixes.filter((f) => f.severity === s).length;
  const fixCount = n('kritik') + n('duzelis');
  const clarify = n('deqiqlesdir');
  setText('hero-verdict-tally', [fixCount && `${fixCount} düzəliş`, clarify && `${clarify} dəqiqləşdirmə`].filter(Boolean).join(' · ')
    || 'Düzəliş tələb edən bənd yoxdur');
  const blocking = overview && overview.blocking;
  const block = $('hero-verdict-block');
  if (block) {
    block.textContent = blocking && blocking.critical ? 'Bloklayan problem var' : 'Bloklayan problem yoxdur';
    block.dataset.tone = blocking && blocking.critical ? 'fail' : 'ok';
  }

  // Herobar (kompakt zolaq) — eyni mənbə.
  setText('herobar-name', planName(check));
  setText('herobar-status', label);
  const bpill = $('herobar-pill');
  if (bpill) bpill.className = 'statuspill statuspill--' + tone;

  // Möhür: yalnız bu yoxlama ilk dəfə açılanda (polling təkrar render etsə də təkrarlanmır).
  if (check.id !== lastCheckId) {
    lastCheckId = check.id;
    playOnce(pill, 'is-stamping');
    renderRisk(null);
  }
}

/** İqtisadi risk bloku — views/economics.js məlumatı yükləyəndə ('econ:data' hadisəsi). */
export function renderRisk(data) {
  const result = data && data.result;
  const risk = result && result.risk;
  const block = $('hero-risk');
  if (!block) return;
  const level = risk ? String(risk.label || risk.level).toLocaleUpperCase('az') : null;
  block.dataset.tone = risk ? RISK_TONE[risk.level] || 'skip' : 'skip';
  const busy = data && data.state === 'isleyir';
  setText('hero-risk-level', level || (busy ? 'hesablanır…' : '—'));
  const idle = !data ? '' : data.state === 'xeta' ? 'Təhlil xəta ilə dayanıb' : busy ? '' : 'İqtisadi təhlil aparılmayıb';
  setText('hero-risk-text', result ? (riskSentence(result) || (risk && risk.reasons && risk.reasons[0]) || '') : idle);
  const open = data ? data.open_questions : null;
  setText('hero-risk-q', Number.isFinite(open) ? (open ? `${fmtNumber(open)} açıq sual` : 'Açıq sual yoxdur') : '');
  setText('herobar-risk', level ? `İqtisadi risk: ${level}` : '');
  const br = $('herobar-risk');
  if (br) br.dataset.tone = block.dataset.tone;
}

/** Klik → tab; scroll → kompakt zolaq. Bir dəfə (init). */
export function wireHero() {
  document.querySelectorAll('[data-hero-goto]').forEach((b) => b.addEventListener('click', () => {
    selectTab(b.dataset.heroGoto, true);
    const bar = document.querySelector('.tabsbar');
    if (bar && bar.getBoundingClientRect().top > 120) bar.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }));
  $('herobar-top')?.addEventListener('click', () => {
    scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  document.addEventListener('econ:data', (e) => renderRisk(e.detail));
  const hero = $('reshead');
  const view = $('view-results');
  if (!hero || !view || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(([entry]) => {
    const compact = !entry.isIntersecting && entry.boundingClientRect.top < 0;
    if (view.classList.contains('is-compact') === compact) return;
    view.classList.toggle('is-compact', compact);
    $('herobar')?.toggleAttribute('inert', !compact);
    moveIndicator(false);
  }, { threshold: 0, rootMargin: '-64px 0px 0px 0px' });
  io.observe(hero);
}
