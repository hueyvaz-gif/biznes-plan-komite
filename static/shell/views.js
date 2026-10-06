/* Görünüşlər, mərhələ göstəricisi, şəbəkə vəziyyəti. */
import { $, el, icon } from '../core/dom.js';

/* ── Görünüşlər və naviqasiya ───────────────────────────────────────────── */

const VIEWS = ['upload', 'review', 'run', 'results'];
function showView(name, title) {
  VIEWS.forEach((v) => { $('view-' + v).hidden = v !== name; });
  $('topbar-title').textContent = title || '';
  $('nav-new').classList.toggle('is-here', name === 'upload');
  if (name === 'upload') { $('nav-new').setAttribute('aria-current', 'page'); renderStepper('stepper-upload', ['current', 'todo', 'todo']); }
  else $('nav-new').removeAttribute('aria-current');
  closeNav();
}
/* ── Mərhələ göstəricisi: Sənəd → Tələblər → Hesabat ───────────────────────
 * Vəziyyət real axından gəlir: əlavə tələb yoxdursa "Tələblər" addımı ötürülür;
 * faiz və ya qalan vaxt göstərilmir. */
const STEPPER = [['Sənəd'], ['Tələblər'], ['Hesabat']];
const STEP_NOTE = { done: 'tamamlanıb', current: 'cari addım', todo: 'gözləyir', skipped: 'əlavə tələb yoxdur', error: 'dayanıb' };
function renderStepper(hostId, states) {
  const host = $(hostId);
  if (!host) return;
  // Poll hər 1,5 s-dən bir render edir — vəziyyət dəyişməyibsə yenidən qurulmur (animasiya təkrarlanmasın).
  const key = states.join();
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  host.replaceChildren(...STEPPER.map(([label], i) => {
    const st = states[i];
    const li = el('li', 'stepper__step is-' + st);
    const mark = el('span', 'stepper__mark');
    if (st === 'done') mark.append(icon('check'));
    else if (st === 'error') mark.append(icon('x'));
    else mark.textContent = String(i + 1);
    mark.setAttribute('aria-hidden', 'true');
    const text = el('span', 'stepper__text');
    text.append(el('span', 'stepper__label', label));
    if (st === 'skipped' || st === 'error') text.append(el('span', 'stepper__note', STEP_NOTE[st]));
    li.append(mark, text, el('span', 'sr-only', ' — ' + STEP_NOTE[st]));
    if (st === 'current') li.setAttribute('aria-current', 'step');
    return li;
  }));
}
/** Yoxlamanın vəziyyətinə görə addımlar (təsdiq / icra ekranları). */
function checkStepper(check) {
  const extras = check && (check.has_extras || (check.result && check.result.extras));
  const second = extras ? 'done' : 'skipped';
  if (!check) return ['done', 'skipped', 'current'];
  if (check.run_state === 'telebler_hazirlanir' || check.run_state === 'tesdiq_gozleyir') return ['done', 'current', 'todo'];
  if (check.run_state === 'xeta') return ['done', second, 'error'];
  if (check.run_state === 'tamamlandi') return ['done', second, 'done'];
  return ['done', second, 'current'];
}
function openNav() {
  $('sidebar').classList.add('is-open');
  $('nav-scrim').hidden = false;
  $('menu-btn').setAttribute('aria-expanded', 'true');
  $('nav-new').focus();
}
function closeNav() {
  if (!$('sidebar').classList.contains('is-open')) return;
  $('sidebar').classList.remove('is-open');
  $('nav-scrim').hidden = true;
  $('menu-btn').setAttribute('aria-expanded', 'false');
}
/* Şəbəkə vəziyyəti: kəsilmə və bərpa görünür. */
let netTimer = null;
function setOnline(online) {
  const box = $('net');
  clearTimeout(netTimer);
  if (!online) {
    box.className = 'net net--off';
    box.replaceChildren(icon('wifiOff'), document.createTextNode(
      'Serverlə əlaqə yoxdur — yenidən qoşulmağa cəhd edilir (icra serverdə davam edir)'));
    box.hidden = false;
    box.dataset.off = '1';
    return;
  }
  if (box.dataset.off) {
    delete box.dataset.off;
    box.className = 'net net--on';
    box.replaceChildren(icon('wifi'), document.createTextNode('Bağlantı bərpa olundu'));
    box.hidden = false;
    netTimer = setTimeout(() => { box.hidden = true; }, 3000);
  }
}

export { checkStepper, closeNav, openNav, renderStepper, setOnline, showView };
