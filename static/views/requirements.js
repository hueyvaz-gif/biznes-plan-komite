/* Standart tələblər tabı. */
import { api } from '../core/api.js';
import { $, badge, el, group, reqCounts, reqSummary, setBusy } from '../core/dom.js';
import { REQ_STATUS, REQ_TECHNICAL } from '../core/labels.js';
import { openCheck } from '../core/router.js';
import { state } from '../core/state.js';
import { openDetail } from '../shell/detail.js';
import { previewCard } from './finance.js';
import { resultParts } from './summary.js';

/* ── Standart tələblər ──────────────────────────────────────────────────── */

function reqMeta(item) {
  if (item.status === 'skip' && item.technical) return REQ_TECHNICAL;
  return REQ_STATUS[item.status] || REQ_STATUS.skip;
}
function standardItems() {
  const items = state.check ? (resultParts(state.check).compliance.items || []) : [];
  return items.filter((i) => (i.origin || 'standart') === 'standart');
}
function setRequirementFilter(name) {
  state.reqFilter = name;
  document.querySelectorAll('[data-req]').forEach((chip) => {
    chip.classList.toggle('is-on', chip.dataset.req === name);
    chip.setAttribute('aria-pressed', chip.dataset.req === name ? 'true' : 'false');
  });
  renderRequirements();
}
function requirementMatches(item) {
  const f = state.reqFilter;
  if (f === 'problem' && item.status !== 'natamam' && item.status !== 'yoxdur') return false;
  if (f === 'yoxdur' && item.status !== 'yoxdur') return false;
  if (f === 'skip' && item.status !== 'skip') return false;
  if (f === 'sened' && item.status !== 'sened') return false;
  if (state.reqGroup && item.group_id !== state.reqGroup) return false;
  if (state.reqQuery) {
    const haystack = (item.req_id + ' ' + item.text + ' ' + (item.missing || '')).toLowerCase();
    if (!haystack.includes(state.reqQuery)) return false;
  }
  return true;
}
function renderCoverage(check, compliance) {
  const c = compliance.coverage;
  const std = reqCounts(standardItems());
  $('req-coverage').textContent = c
    ? 'Cəmi ' + std.total + ' standart tələb: ' + std.evaluated + '-i planın mətnində yoxlanılıb ('
      + reqSummary({ ...std, document: 0, notChecked: 0, total: std.evaluated }) + ')'
      + (std.document ? '; ' + std.document + '-i ayrıca sənəd tələb edir — mövcudluğu yoxlanılmır' : '')
      + (c.not_selected ? '; ' + c.not_selected + ' seçilməyən qrupda' : '')
      + (c.technical ? '; ' + c.technical + ' texniki nasazlıq səbəbindən yoxlanılmayıb' : '')
      + (c.no_answer ? '; ' + c.no_answer + ' üçün nəticə alınmayıb' : '') + '.'
    : '';
  const failed = compliance.failed_groups || [];
  const box = $('failed-groups');
  box.hidden = !(failed.length && check.run_state === 'tamamlandi');
  if (!box.hidden) {
    const names = (list) => list.map((g) => g.group_title || g.group_id).join(', ');
    const full = failed.filter((g) => !g.partial);
    const partial = failed.filter((g) => g.partial);
    $('failed-groups-text').textContent = [
      full.length ? 'Texniki nasazlıq: model bu qrupları yoxlaya bilmədi — ' + names(full) + '.' : '',
      partial.length ? 'Qismən yoxlanıldı (agentin addım büdcəsi çatmadı): ' + names(partial)
        + ' — yoxlanılmayan bəndlər “Texniki nasazlıq” kimi göstərilir.' : '',
      'Bu, sənəddə məlumatın olmaması demək deyil. Digər nəticələr saxlanılır, yalnız bu qruplar yenidən yoxlanılır.',
    ].filter(Boolean).join(' ');
  }
}
function renderRequirements() {
  const items = standardItems();
  fillGroupSelect(items);
  const host = $('req-groups');
  host.replaceChildren();
  const visible = items.filter(requirementMatches);
  $('req-empty').hidden = visible.length > 0;
  $('req-empty').textContent = 'Bu süzgəcə uyğun tələb yoxdur.';
  const grouped = new Map();
  visible.forEach((item) => {
    if (!grouped.has(item.group_id)) grouped.set(item.group_id, []);
    grouped.get(item.group_id).push(item);
  });
  grouped.forEach((members) => {
    const box = el('section', 'reqgroup');
    box.id = 'reqgroup-' + members[0].group_id;
    const title = el('h3', 'reqgroup__title', members[0].group_title + ' ');
    title.tabIndex = -1;
    title.append(el('span', 'reqgroup__count', '(' + members.length + ')'));
    const list = el('ul', 'reqlist');
    members.forEach((item) => list.append(requirementRow(item)));
    box.append(title, list);
    host.append(box);
  });
}
function requirementRow(item) {
  const meta = reqMeta(item);
  const row = el('li', 'req');
  row.tabIndex = 0;
  row.dataset.code = item.req_id;                  // command palette (Ctrl+K) hədəfi
  const text = el('span', 'req__text');
  text.append(document.createTextNode(item.text));
  if (item.missing) {
    text.append(el('span', 'req__missing' + (item.status === 'sened' ? ' req__missing--doc' : ''), item.missing));
  }
  const carried = Report.resolveCarried(item).conflict;
  if (carried && !carried.resolved) {
    text.append(el('span', 'req__carried', 'Versiyalar arasında fərqli qiymətləndirmə — sənəddə yoxlayın.'));
  }
  const status = el('span');
  status.append(badge(meta.cls, meta.label));
  row.append(el('span', 'req__id', item.req_id), text, status);
  const open = () => openRequirementDetail(item, row);
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return row;
}
function fillGroupSelect(items) {
  const select = $('req-group');
  const seen = new Map();
  items.forEach((i) => { if (!seen.has(i.group_id)) seen.set(i.group_id, i.group_title); });
  const signature = [...seen.keys()].join('|');
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  const all = el('option', null, 'Bütün qruplar');
  all.value = '';
  select.replaceChildren(all);
  seen.forEach((title, id) => { const o = el('option', null, title); o.value = id; select.append(o); });
  select.value = seen.has(state.reqGroup) ? state.reqGroup : '';
  state.reqGroup = select.value;
}
function openRequirementDetail(item, row) {
  const meta = reqMeta(item);
  openDetail('Tələb ' + item.req_id, (body) => {
    const head = el('p');
    head.append(badge(meta.cls, meta.label));
    body.append(head, group('Tələb', el('p', null, item.text)), group('Qrup', el('p', null, item.group_title)));
    if (item.source) {
      // Tələb sənədindəki mənbə — plandakı cavabdan AYRI.
      const src = el('div');
      src.append(el('p', null, (item.source.source_name || 'İstifadəçi əlavə edib')
        + (item.source.ref ? ' · ' + item.source.ref : '')
        + (item.source.edited ? ' · istifadəçi redaktə edib' : '')));
      if (item.source.fragment) src.append(el('blockquote', 'quote', item.source.fragment));
      body.append(group('Tələb sənədindəki mənbə', src));
    }
    if (item.missing) body.append(group('Nə çatışmır', el('p', null, item.missing)));
    const carried = Report.resolveCarried(item).conflict;
    if (carried) {
      // Texniki qərar tarixçəsi — əsas statusun yanında deyil, burada.
      const history = el('details', 'history');
      history.append(el('summary', null, 'Qiymətləndirmə tarixçəsi'),
        el('p', null, 'Status v' + carried.version + '-dən saxlanılıb: istinad edilən bölmələrin mətni dəyişməyib. '
          + 'Bu yoxlamada yeni qiymətləndirmə “' + (REQ_STATUS[carried.now] || REQ_STATUS.skip).label + '” verdi. '
          + (carried.resolved ? 'Saxlanan statusun sənəddən sitatı var — o əsas götürülür.'
            : 'Yeni qiymətləndirmənin sitatı var — fərq həll olunmayıb, bölməni sənəddə yoxlayın.')));
      body.append(history);
    }
    if (item.condition) {
      body.append(group('Tətbiq şərti', el('p', null, item.condition.text
        + (item.status === 'tetbiq_edilmir' ? ' — plan bu şərti açıq istisna edir, tələb tətbiq edilmir.'
          : ' — planda bu barədə açıq ifadə yoxdur, dəqiqləşdirmə lazımdır.'))));
    }
    const sections = item.sections || [];
    const list = el('ul', 'bullets');
    sections.forEach((s) => list.append(el('li', null, s.id + (s.table_id ? ' · cədvəl ' + s.table_id : '') + ' — ' + s.title)));
    body.append(group('Biznes plandakı yer', sections.length ? list : el('p', null, 'Təsdiqlənmiş istinad yoxdur.')));
    (item.previews || []).forEach((pv) => body.append(group('Bölmədən: ' + pv.section_title, previewCard(pv))));
    body.append(group('Biznes plandan (hərfi sitat)', item.quote
      ? el('blockquote', 'quote', item.quote) : el('p', null, 'Təsdiqlənmiş sitat yoxdur.')));
    if (!item.quote && item.evidence) {
      // Köhnə formatda saxlanmış nəticə: sübut o vaxt sənədlə tutuşdurulmurdu.
      body.append(group('Köhnə formatda sübut (sənədlə tutuşdurulmayıb)', el('p', null, item.evidence)));
    }
    if (item.comment) body.append(group('Modelin şərhi', el('p', null, item.comment)));
    body.append(group('Yoxlama qaydası', el('p', 'rule', item.status === 'sened'
      ? 'Bu bənd ayrıca sənəd tələb edir. Tətbiq həmin sənədin mövcudluğunu YOXLAMIR.'
      : '"Var" statusu yalnız mövcud bölməyə/cədvələ istinad və sənəddə hərfi tapılan sitat varsa qalır.')));
  }, row);
}
async function retryFailedGroups() {
  if (!state.check) return;
  const button = $('retry-groups-btn');
  setBusy(button, true, 'Göndərilir…');
  try {
    await api.post('/api/checks/' + encodeURIComponent(state.check.id) + '/retry-groups');
    openCheck(state.check.id);
  } catch (e) {
    $('failed-groups-text').textContent = e.message || 'Serverlə əlaqə kəsildi.';
  } finally {
    setBusy(button, false);
  }
}

export { openRequirementDetail, renderCoverage, renderRequirements, reqMeta, retryFailedGroups, setRequirementFilter, standardItems };
