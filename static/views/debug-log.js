/* Texniki jurnal (keçmiş "Agentlər" tabı): canlı lent və zaman xətti. */
import { api } from '../core/api.js';
import { $, badge, el, formatAz } from '../core/dom.js';
import { state } from '../core/state.js';

/* ── Agentlər: canlı lent və "Agentlər" tabı ────────────────────────────── */

const AG = { checkId: null, list: [], last: 0, loading: null, filter: '', errorsOnly: false };
/** Hadisələri artımlı gətirir (yalnız yeni olanlar); yoxlama dəyişəndə sıfırlanır. */
async function loadEvents(checkId) {
  if (AG.checkId !== checkId) { AG.checkId = checkId; AG.list = []; AG.last = 0; }
  if (AG.loading) return AG.loading;
  AG.loading = (async () => {
    try {
      const data = await api.get('/api/checks/' + encodeURIComponent(checkId) + '/events?after=' + AG.last);
      if (AG.checkId !== checkId) return;                    // başqa yoxlamaya keçilib
      AG.list = AG.list.concat(data.events || []);
      AG.last = data.last_id || AG.last;
    } catch (_) { /* lent köməkçidir — xəta icranı göstərməyə mane olmur */ }
    finally { AG.loading = null; }
  })();
  return AG.loading;
}
function relTime(e, start) {
  return '+' + Math.max(0, e.ts - start).toFixed(1).replace('.', ',') + ' s';
}
function eventBadge(e) {
  if (e.status === 'ok') return badge('s-ok', e.kind === 'result' ? 'hazır' : 'ok');
  if (e.status === 'alət xətası') return badge('s-warn', 'alət xətası');
  return badge('s-fail', 'xəta');
}
/** Nəticə: xülasə, cəhdlər, zaman xətti (hər cəhd ayrıca), süzgəcli cədvəl. */
function renderAgents() {
  const events = AG.list;
  const s = Agents.stats(events);
  $('count-agentler').textContent = s.toolErrors ? String(s.toolErrors) : '';
  const stats = $('ag-stats');
  stats.replaceChildren();
  // Ölçülmüş sıfır ilə OLMAYAN məlumat fərqlidir: jurnal yoxdursa rəqəm göstərilmir.
  stats.hidden = events.length === 0;
  [['Model çağırışları', formatAz(s.llm)], ['Sənəd alətləri çağırışları', formatAz(s.tools)],
   ['Alət xətaları', formatAz(s.toolErrors)], ['İcra müddəti', Agents.seconds(Math.round(s.busySeconds * 1000))]]
    .forEach(([label, value]) => {
      const box = el('div', 'agstat');
      box.append(el('dt', null, label), el('dd', null, value));
      stats.append(box);
    });

  const attempts = Agents.attempts(events);
  $('ag-attempts').replaceChildren(...attempts.map((a) => {
    const li = el('li', 'attempt');
    li.append(el('strong', null, a.attempt + '-ci cəhd'),
      document.createTextNode(' — ' + a.status + (a.failedAt ? ' (' + a.failedAt + ')' : '')
        + ' · ' + Agents.seconds(Math.round((a.end - a.start) * 1000))));
    return li;
  }));
  $('ag-attempts').hidden = attempts.length < 2;

  const host = $('ag-gantts');
  host.replaceChildren(...attempts.map((a) => ganttFor(events, a, attempts.length > 1)));
  if (!attempts.length) host.append(el('p', 'empty', 'Bu hesabat üçün icra məlumatı qeydə alınmayıb '
    + '(köhnə yoxlama və ya demo). Ona görə çağırış sayı və müddət göstərilmir.'));
  $('ag-pick').hidden = true;
  fillAgentFilter(events);
  renderAgentTable();
}
function ganttFor(events, attempt, showTitle) {
  const line = Agents.timeline(events, attempt.attempt);
  const box = el('section', 'gantt');
  const title = el('h3', 'gantt__title', showTitle
    ? attempt.attempt + '-ci cəhd — ' + attempt.status + (attempt.failedAt ? ' (' + attempt.failedAt + ')' : '')
    : 'Zaman xətti');
  title.append(el('span', 'gantt__span', ' · ' + Agents.seconds(Math.round(line.seconds * 1000))));
  box.append(title);
  line.rows.forEach((row) => {
    const resumedFinance = row.empty && attempt.resumed && row.key === 'maliyye';
    if (row.empty && !resumedFinance) return;           // bu cəhddə işləməyən agent göstərilmir
    const r = el('div', 'gantt__row' + (row.level ? ' gantt__row--sub' : ''));
    r.append(el('span', 'gantt__label', row.label));
    if (!row.bars.length && !resumedFinance) {          // qrup başlığı: zolaqlar alt-sətirlərdədir
      r.classList.add('gantt__row--head');
      box.append(r);
      return;
    }
    const track = el('div', 'gantt__track');
    if (row.empty && attempt.resumed && row.key === 'maliyye') {
      track.append(el('span', 'gantt__note', 'bu cəhddə işləmədi — nəticə saxlanmışdı'));
    }
    row.bars.forEach((b) => {
      const e = b.event;
      const bar = el('button', 'gantt__bar gantt__bar--' + e.kind + (e.status !== 'ok' ? ' gantt__bar--bad' : ''));
      bar.type = 'button';
      bar.style.left = (b.left * 100).toFixed(2) + '%';
      bar.style.width = 'max(4px, ' + (b.width * 100).toFixed(2) + '%)';
      const label = Agents.describe(e) + ' · ' + Agents.seconds(e.duration_ms) + ' · ' + e.status;
      bar.title = label;
      bar.setAttribute('aria-label', label);
      bar.addEventListener('click', () => showPick(row, e));
      track.append(bar);
    });
    r.append(track);
    box.append(r);
  });
  const axis = el('div', 'gantt__axis');
  axis.append(el('span', null, '0 s'), el('span', null, Agents.seconds(Math.round(line.seconds * 1000))));
  box.append(axis);
  return box;
}
/** Zolağa klik: həmin sətirdəki alət çağırışları (seçilən vurğulanır). */
function showPick(row, picked) {
  const box = $('ag-pick');
  box.replaceChildren(el('h3', 'gantt__title', row.label + ' — çağırışlar'));
  const list = el('ol', 'pick__list');
  row.bars.forEach(({ event: e }) => {
    const li = el('li', e === picked ? 'is-picked' : null);
    li.append(el('span', 'pick__text', Agents.describe(e)), el('span', 'pick__time', Agents.seconds(e.duration_ms)),
      eventBadge(e));
    list.append(li);
  });
  box.append(list);
  box.hidden = false;
}
function fillAgentFilter(events) {
  const select = $('ag-filter');
  const agents = [...new Set(events.map((e) => e.agent).filter(Boolean))];
  const all = el('option', null, 'Bütün agentlər');
  all.value = '';
  select.replaceChildren(all, ...agents.map((a) => { const o = el('option', null, Agents.agentLabel(a)); o.value = a; return o; }));
  select.value = agents.includes(AG.filter) ? AG.filter : '';
}
function renderAgentTable() {
  const body = $('ag-body');
  const events = AG.list.filter((e) => e.kind !== 'llm' || !AG.errorsOnly)
    .filter((e) => !AG.filter || e.agent === AG.filter)
    .filter((e) => !AG.errorsOnly || e.status !== 'ok');
  const start = AG.list.length ? Math.min(...AG.list.map((e) => e.ts)) : 0;
  body.replaceChildren(...events.map((e) => {
    const tr = el('tr');
    const status = el('td');
    status.append(eventBadge(e));
    tr.append(el('td', 'num', relTime(e, start)),
      el('td', null, Agents.agentLabel(e.agent) + (e.grp ? ' · ' + Agents.groupTitle(e.grp) : '')),
      el('td', 'mono', e.kind === 'tool' ? e.name : (e.kind === 'llm' ? 'LLM' : e.name)),
      el('td', 'ctx', e.args || ''), el('td', null, e.summary || ''),
      el('td', 'num', Agents.seconds(e.duration_ms)), status);
    return tr;
  }));
  const count = $('ag-count');
  if (count) count.textContent = events.length === AG.list.length ? `${events.length}` : `${events.length} / ${AG.list.length}`;
  $('ag-empty').hidden = events.length > 0;
  $('ag-empty').textContent = 'Bu süzgəcə uyğun hadisə yoxdur.';
}

export { AG, loadEvents, renderAgentTable, renderAgents };
