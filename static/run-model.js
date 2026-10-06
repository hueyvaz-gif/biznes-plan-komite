/* Yoxlama gedişatı ekranının modeli (DOM-suz, Node testləri ilə).
 *
 * Mənbələr — hamısı serverdən, heç nə uydurulmur:
 *   check.current_step / run_state — hansı qovşaq gedir;
 *   check.result (aralıq) — maliyyə və uyğunluq qovşaqları bitəndə saxlanılan nəticə;
 *   events — /api/checks/{id}/events (qrup başladı / bitdi, rəy hazırdır);
 *   meta.typical_run_seconds — son yoxlamaların median müddəti (təxmini qalan vaxt üçün).
 */

/** Ekrandakı 5 mərhələ ↔ serverin qovşaqları (meta.steps sırası ilə). */
export const STAGES = [
  { id: 'doc', label: 'Sənəd oxunur', nodes: ['ingest', 'load_previous'] },
  { id: 'fin', label: 'Maliyyə yenidən hesablanır', nodes: ['finance'] },
  { id: 'req', label: (n) => `${n} tələb qrupu yoxlanılır`, nodes: ['compliance'] },
  { id: 'status', label: 'Yekun status və müqayisə', nodes: ['decide_status', 'compare_previous'] },
  { id: 'rey', label: 'Rəy hazırlanır', nodes: ['write_summary', 'save'] },
];

/** Mərhələlərin vəziyyəti: done | active | todo | error. */
export function stageStates(check, steps) {
  const order = (steps || []).map((s) => s.id);
  const runState = check ? check.run_state : 'gozleyir';
  if (runState === 'tamamlandi') return STAGES.map(() => 'done');
  const current = check && check.current_step;
  const at = order.indexOf(current);
  return STAGES.map((st) => {
    const idx = st.nodes.map((n) => order.indexOf(n)).filter((i) => i >= 0);
    if (!idx.length || at < 0) return st.id === 'doc' && runState !== 'xeta' ? 'active' : 'todo';
    const first = Math.min(...idx); const last = Math.max(...idx);
    if (at > last) return 'done';
    if (at < first) return 'todo';
    return runState === 'xeta' ? 'error' : 'active';
  });
}

/** Son icra cəhdinin hadisələri (yenidən cəhddə köhnə cəhd lentə qarışmasın). */
export function lastAttempt(events) {
  const list = events || [];
  const max = list.reduce((m, e) => Math.max(m, e.attempt || 0), 0);
  return list.filter((e) => (e.attempt || 0) === max);
}

const groupId = (grp) => (grp || '').split('|')[0];

/** Tələb qrupları: todo | active (alət/model çağırışı var) | done (nəticə hazır) | error. */
export function groupStates(groups, events, check) {
  const ev = lastAttempt(events);
  // Uyğunluq qovşağı bitib (aralıq nəticə saxlanılıb və ya yoxlama tamamdır) — bütün qruplar hazırdır.
  const complianceDone = Boolean(check && (check.run_state === 'tamamlandi' || (check.result && check.result.compliance)));
  return (groups || []).map((g) => {
    const mine = ev.filter((e) => e.agent === 'uygunluq' && groupId(e.grp) === g.id);
    const result = mine.find((e) => e.kind === 'result');
    let st = 'todo';
    if (result) st = result.status === 'ok' ? 'done' : 'error';
    else if (mine.length) st = 'active';
    if (complianceDone) st = 'done';
    return { id: g.id, title: g.title, items: g.items, state: st, summary: result ? result.summary : null };
  });
}

const FIN_TONE = { ok: 'ok', warn: 'warn', fail: 'fail' };
const REQ_PROBLEM = { natamam: 'natamamdır', yoxdur: 'cavabsızdır' };
const lowerFirst = (s) => (s ? s.charAt(0).toLocaleLowerCase('az') + s.slice(1) : s);

/**
 * Canlı lent: hazır tapıntılar. Element {key, tone: ok|warn|fail|info, text, ts?}.
 * Sıra: qrup/rəy hadisələri vaxtına görə; maliyyə və tələb tapıntıları nəticə görünəndə (sonda əlavə olunur).
 * `seen` — {key → sıra nömrəsi}: əvvəl görünmüş element yerini dəyişmir (poll hər dəfə yenidən qurur).
 */
export function feedItems(check, events, { requirements = {}, groups = [], seen = new Map(), maxProblems = 12 } = {}) {
  const out = [];
  const ev = lastAttempt(events);
  const titles = Object.fromEntries((groups || []).map((g) => [g.id, g.title]));
  const result = (check && check.result) || {};
  ev.filter((e) => e.kind === 'result' && e.agent === 'maliyye' && e.status === 'ok')
    .forEach((e) => out.push({ key: 'fin-done', tone: 'info', text: 'Maliyyə cədvəlləri oxundu: ' + (e.summary || ''), ts: e.ts }));
  ((result.finance || {}).checks || []).forEach((c) => {
    if (c.status === 'skip' || !c.title) return;
    const text = c.status === 'ok' ? `${c.title} uyğundur`
      : c.status === 'warn' ? `${c.title}: kiçik fərq var` : `${c.title}: planın rəqəmi uyğun gəlmir`;
    out.push({ key: 'fin:' + c.id, tone: FIN_TONE[c.status] || 'info', text });
  });
  ev.filter((e) => e.kind === 'result' && e.agent === 'uygunluq')
    .forEach((e) => {
      const id = groupId(e.grp);
      out.push({ key: 'grp:' + id, tone: e.status === 'ok' ? 'ok' : 'fail',
        text: (titles[id] || (e.grp || '').split('|')[1] || id) + (e.status === 'ok' ? ' — yoxlanıldı' : ' — xəta'),
        sub: e.status === 'ok' ? e.summary : null, ts: e.ts });
    });
  const problems = ((result.compliance || {}).items || []).filter((i) => REQ_PROBLEM[i.status] && i.origin !== 'elave');
  problems.slice(0, maxProblems).forEach((i) => {
    const topic = (requirements[i.req_id] || {}).topic || i.text;
    out.push({ key: 'req:' + i.req_id, tone: i.status === 'yoxdur' ? 'fail' : 'warn', text: `${i.req_id}: ${lowerFirst(topic)} ${REQ_PROBLEM[i.status]}` });
  });
  if (problems.length > maxProblems) {
    out.push({ key: 'req:more', tone: 'info', text: `Daha ${problems.length - maxProblems} tələb üzrə qeyd — hesabatda` });
  }
  ev.filter((e) => e.kind === 'result' && e.agent === 'rey' && e.status === 'ok')
    .forEach((e) => out.push({ key: 'rey', tone: 'ok', text: 'Komitə rəyi hazırdır', sub: e.summary, ts: e.ts }));

  // Sabit sıra: köhnə elementlər yerində qalır, yenilər sona.
  out.forEach((item) => { if (!seen.has(item.key)) seen.set(item.key, seen.size); });
  return out.sort((a, b) => seen.get(a.key) - seen.get(b.key));
}

/** Keçən vaxt (s): son cəhdin ilk hadisəsindən; hadisə yoxdursa — ekranın açıldığı andan. */
export function elapsedSeconds(events, nowSec, openedSec) {
  const ev = lastAttempt(events);
  const start = ev.length ? Math.min(...ev.map((e) => e.ts)) : openedSec;
  return Math.max(0, nowSec - (start ?? nowSec));
}

/** Təxmini qalan vaxt mətni (median müddətə görə). Məlumat yoxdursa null — vaxt uydurulmur. */
export function etaText(typical, elapsed) {
  if (!typical || typical <= 0) return null;
  const left = typical - elapsed;
  if (elapsed > typical * 1.3) return 'Adi haldan uzun çəkir — server işləyir';
  if (left < 15) return 'Az qalıb';
  return 'Təxminən ' + duration(left) + ' qalıb';
}

/** 75 → "1 dəq 15 san"; 40 → "40 san"; 125 → "2 dəq 5 san". Yuvarlaqlaşdırma 5 saniyəyə. */
export function duration(sec) {
  const s = Math.max(0, Math.round(sec / 5) * 5);
  const m = Math.floor(s / 60); const r = s % 60;
  if (!m) return `${r} san`;
  return r ? `${m} dəq ${r} san` : `${m} dəq`;
}

/** Saat göstəricisi: 0:42, 1:05. */
export function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Xətanın insan dilində səbəbi (texniki mətn ayrıca, "Texniki məlumat"-da göstərilir). */
const ERRORS = [
  [/credit balance|insufficient_quota|billing|payment required|\b402\b/i, 'Model xidmətinin balansı bitib',
    'Balansı artırın, sonra "Yenidən cəhd et".'],
  [/authentication|invalid x-api-key|api[_ ]key|\b401\b|permission_error|\b403\b/i, 'Model xidmətinin açarı etibarsızdır',
    'Serverdəki API açarını yoxlayın, sonra "Yenidən cəhd et".'],
  [/rate[_ ]limit|\b429\b|too many requests/i, 'Model xidməti hazırda çox sorğu alır',
    'Bir-iki dəqiqə gözləyib "Yenidən cəhd et".'],
  [/overloaded|\b529\b|\b503\b|service unavailable/i, 'Model xidməti müvəqqəti olaraq yüklənib',
    'Bir az sonra "Yenidən cəhd et".'],
  [/timeout|timed out/i, 'Model xidməti vaxtında cavab vermədi', '"Yenidən cəhd et" — adətən ikinci cəhddə keçir.'],
  [/connection|connecterror|network|getaddrinfo|ssl/i, 'Model xidmətinə qoşulmaq alınmadı',
    'İnternet bağlantısını yoxlayıb "Yenidən cəhd et".'],
  [/süni xəta|fail_at|simulated/i, 'Sınaq üçün süni xəta (inkişaf rejimi)', '"Yenidən cəhd et" — ikinci cəhddə xəta təkrarlanmır.'],
];
export function humanError(text) {
  const raw = String(text || '');
  for (const [re, reason, hint] of ERRORS) if (re.test(raw)) return { reason, hint, technical: raw };
  return { reason: 'Gözlənilməz xəta baş verdi', hint: '"Yenidən cəhd et" — problem təkrarlansa, texniki məlumatı administratora göndərin.', technical: raw };
}
