/* Yoxlama gedişatı ekranı (Faza 9): vertikal mərhələlər (11 tələb qrupu ayrıca işıqlanır), canlı tapıntılar lenti,
 * keçən vaxt + təxmini qalan vaxt, bitəndə nəticəyə keçid, xəta vəziyyəti insan dilində.
 * Bütün məlumat serverdəndir (run-model.js) — faiz və ya vaxt uydurulmur. */
import { $ } from '../core/dom.js';
import { state } from '../core/state.js';
import { el, setText } from '../ui/el.js';
import { icon } from '../ui/icons.js';
import { reducedMotion } from '../ui/motion.js';
import { AG, loadEvents } from './debug-log.js';
import { STAGES, clock, elapsedSeconds, etaText, feedItems, groupStates, humanError, stageStates } from '../run-model.js';

const R = { checkId: null, seen: new Map(), shown: new Set(), opened: 0, timer: null, running: false, check: null };
const meta = () => state.meta || {};
const now = () => Date.now() / 1000;

/** Bu yoxlama üçün ekran sıfırlanır (başqa yoxlamaya keçəndə lent qarışmasın). */
function reset(checkId) {
  if (R.checkId === checkId) return;
  R.checkId = checkId; R.seen = new Map(); R.shown = new Set(); R.opened = now(); R.running = false;
  $('run-feed').replaceChildren();
}

/** İcra gedir və ya dayanıb: hadisələr gətirilir, ekran qurulur. `check` null — yeni göndərilib (hələ cavab yoxdur). */
export async function renderRunProgress(check) {
  const id = check ? check.id : state.pendingCheckId || 'new';
  reset(id);
  R.check = check;
  if (check && check.run_state !== 'xeta') R.running = true;
  // Mərhələlər dərhal; lent hadisələr gələndən sonra (sıra pozulmasın — "cədvəllər oxundu" tapıntılardan əvvəl).
  paint(!check);
  if (check) {
    await loadEvents(check.id);
    if (R.checkId === check.id) paint(true);
  }
  tick();
}

function events() { return R.check && AG.checkId === R.check.id ? AG.list : []; }

function paint(withFeed = true) {
  const check = R.check;
  const groups = meta().requirement_groups || [];
  const st = stageStates(check || { run_state: 'gozleyir' }, meta().steps);
  const stopped = check && check.run_state === 'xeta';
  // Dayanıbsa — bitməmiş qruplar fırlanmır (gözləyir kimi görünür).
  const gs = groupStates(groups, events(), check).map((g) => (stopped && g.state === 'active' ? { ...g, state: 'todo' } : g));
  $('run-stages').replaceChildren(...STAGES.map((stage, i) => {
    const s = st[i];
    const label = typeof stage.label === 'function' ? stage.label(groups.length || (meta().facts || {}).groups || '') : stage.label;
    const li = el('li', { class: ['rstage', `is-${s}`], 'aria-current': s === 'active' ? 'step' : null },
      el('span', { class: 'rstage__mark', 'aria-hidden': 'true' },
        s === 'done' ? icon('check', { size: 'sm' }) : s === 'error' ? icon('x', { size: 'sm' }) : null),
      el('span', { class: 'rstage__body' },
        el('span', { class: 'rstage__label', text: label }),
        el('span', { class: 'sr-only', text: ' — ' + ({ done: 'tamamlandı', active: 'gedir', todo: 'gözləyir', error: 'dayandı' })[s] }),
        stage.id === 'req' && gs.length ? groupGrid(gs, s) : null));
    return li;
  }));
  if (withFeed) feed(check);
}

/** 11 qrup: hər biri ayrıca işıqlanır (gözləyir → yoxlanılır → ✓). */
function groupGrid(gs, stageState) {
  const done = gs.filter((g) => g.state === 'done').length;
  return el('span', { class: 'rgroups' },
    el('span', { class: 'rgroups__count', text: stageState === 'todo' ? `${gs.length} qrup` : `${done} / ${gs.length} qrup hazır` }),
    el('span', { class: 'rgroups__grid', role: 'list' }, gs.map((g) => el('span', {
      role: 'listitem', class: ['rgroup', `is-${g.state}`], title: g.title + (g.summary ? ' — ' + g.summary : ''),
    }, el('span', { class: 'rgroup__mark', 'aria-hidden': 'true' }, g.state === 'done' ? icon('check', { size: 'sm' }) : null),
      el('span', { class: 'rgroup__name', text: g.title.replace(/^\d+\.\s*/, '') }),
      el('span', { class: 'sr-only', text: ' — ' + ({ done: 'hazır', active: 'yoxlanılır', todo: 'gözləyir', error: 'xəta' })[g.state] })))));
}

const TONE_ICON = { ok: 'check', warn: 'alert', fail: 'x', info: 'info' };
/** Lent: yalnız YENİ elementlər əlavə olunur (rise animasiyası, 30ms stagger, ən çoxu 10). */
function feed(check) {
  const items = feedItems(check, events(), { requirements: meta().requirements || {}, groups: meta().requirement_groups || [], seen: R.seen });
  const list = $('run-feed');
  let fresh = 0;
  items.forEach((item) => {
    if (R.shown.has(item.key)) return;
    R.shown.add(item.key);
    const li = el('li', { class: ['rfeed', `rfeed--${item.tone}`] },
      el('span', { class: 'rfeed__icon', 'aria-hidden': 'true' }, icon(TONE_ICON[item.tone] || 'dot', { size: 'sm' })),
      el('span', { class: 'rfeed__body' }, el('span', { class: 'rfeed__text', text: item.text }),
        item.sub ? el('span', { class: 'rfeed__sub', text: item.sub }) : null));
    if (!reducedMotion() && fresh < 10) { li.classList.add('is-rising'); li.style.animationDelay = `${fresh * 30}ms`; }
    fresh += 1;
    list.append(li);
  });
  setText('run-feed-count', items.length ? String(items.length) : '');
  $('run-feed-empty').hidden = items.length > 0;
  if (fresh) list.lastElementChild.scrollIntoView({ block: 'nearest' });
}

/** Saat: hər saniyə keçən vaxt və təxmini qalan vaxt (yalnız icra gedəndə). */
function tick() {
  clearInterval(R.timer);
  const update = () => {
    const check = R.check;
    const running = !check || !['xeta', 'tamamlandi'].includes(check.run_state);
    const elapsed = elapsedSeconds(events(), now(), R.opened);
    const eta = running ? etaText(meta().typical_run_seconds, elapsed) : null;
    const parts = [el('span', { class: 'runtime__clock' }, icon('clock', { size: 'sm' }), el('span', { text: clock(elapsed), 'aria-label': 'Keçən vaxt ' + clock(elapsed) }))];
    if (eta) parts.push(el('span', { class: 'runtime__eta', text: eta }));
    $('run-time').replaceChildren(...parts);
    if (!running || $('view-run').hidden) clearInterval(R.timer);
  };
  update();
  R.timer = setInterval(update, 1000);
}

/** Xəta: hansı mərhələdə dayandı, səbəb insan dilində, texniki mətn bağlı "Texniki məlumat"-da. */
export function renderRunError(check) {
  const st = stageStates(check, meta().steps);
  const idx = st.indexOf('error');
  const groups = meta().requirement_groups || [];
  const stage = STAGES[idx >= 0 ? idx : 0];
  setText('error-step', (typeof stage.label === 'function' ? stage.label(groups.length) : stage.label).toLocaleLowerCase('az'));
  const h = humanError(check.error);
  setText('error-text', h.reason);
  setText('error-hint', h.hint);
  setText('error-tech', h.technical || '—');
  $('error-tech-box').hidden = !h.technical;
  $('run-error').hidden = false;
}

/** Bu sessiyada icra ekranında gedişat görülübsə — nəticəyə keçid animasiyalı olsun. */
export function sawRunning(checkId) { return R.checkId === checkId && R.running; }

/**
 * Bitəndə 600ms keçid: bütün mərhələlər ✓, gedişat yığılır, sonra nəticə (Verdict Hero möhürü hero.js-də ilk açılışda).
 * Reduced motion — dərhal.
 */
export function finishTransition(check, done) {
  R.check = check;
  R.running = false;
  clearInterval(R.timer);
  if (reducedMotion()) { done(); return; }
  paint(true);
  const view = $('view-run');
  view.classList.add('is-finishing');
  setTimeout(() => { view.classList.remove('is-finishing'); done(); }, 600);
}
