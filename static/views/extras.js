/* Əlavə tələblər tabı. */
import { $, badge, el, formatDate } from '../core/dom.js';
import { openRequirementDetail, reqMeta } from './requirements.js';

/* ── Əlavə tələblər ─────────────────────────────────────────────────────── */

function renderExtraResults(p) {
  const items = (p.compliance.items || []).filter((i) => i.origin === 'elave');
  const host = $('extra-results');
  const meta = $('extra-meta');
  host.replaceChildren();
  meta.replaceChildren();
  $('extra-empty').hidden = Boolean(p.extras) || items.length > 0;
  if (p.extras) {
    const files = (p.extras.attachments || []).map((a) => a.name + (a.status === 'oxundu' ? '' : ' (oxunmadı)'));
    meta.append(el('p', 'panel__lead', 'Mənbə sənədlər: ' + (files.join(', ') || '—')
      + ' · təsdiqlənmiş siyahının versiyası ' + (p.extras.list_version || '—')
      + (p.extras.confirmed_at ? ' · təsdiq: ' + formatDate(p.extras.confirmed_at) : '')
      + '. Əlavə tələblər standart siyahını əvəz etmir və yekun statusa daxildir.'));
    if (p.extras.incomplete) {
      meta.append(el('p', 'alert alert--warn', 'Diqqət: tələb çıxarışı natamam idi (bənd limiti və ya '
        + 'mətnin kəsilməsi) və istifadəçi bunu qəbul edərək təsdiqləyib. Bu yoxlama tələb sənədinin '
        + 'bütün bəndlərini əhatə etməyə bilər.'));
    }
  }
  items.forEach((item) => {
    const meta2 = reqMeta(item);
    const li = el('li', 'extraresult');
    const head = el('div', 'extraresult__head');
    const title = el('div');
    title.append(el('span', 'req__id', item.req_id + ' '), el('span', 'extraresult__text', item.text));
    head.append(title, badge(meta2.cls, meta2.label));
    const left = el('div', 'extraresult__col');
    left.append(el('p', 'extraresult__label', 'Tələb sənədində'));
    const src = item.source || {};
    left.append(el('p', 'note', (src.source_name || 'İstifadəçi əlavə edib') + (src.ref ? ' · ' + src.ref : '')));
    if (src.fragment) left.append(el('blockquote', 'quote', src.fragment));
    const right = el('div', 'extraresult__col');
    right.append(el('p', 'extraresult__label', 'Biznes planda'));
    if (item.quote) right.append(el('blockquote', 'quote', item.quote));
    right.append(el('p', 'note', item.missing || (item.quote ? '' : 'Cavab tapılmadı.')));
    li.append(head, left, right);
    li.tabIndex = 0;
    li.addEventListener('click', () => openRequirementDetail(item, li));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') openRequirementDetail(item, li); });
    host.append(li);
  });
}

export { renderExtraResults };
