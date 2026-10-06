/* AI köməkçi — sağdan açılan söhbət paneli.
 *
 * Qaydalar:
 *   • Panel özbaşına açılmır; yalnız "AI köməkçi" düyməsi (və ya "Kömək mərkəzi") ilə.
 *   • Söhbət hər kontekst üçün AYRIDIR: "umumi" (sənəd seçilməyib) və hər yoxlama (check ID).
 *     Cavab gələnə qədər başqa plana keçilsə, cavab öz söhbətinə yazılır — qarışmır.
 *   • Kontekst (nəticə, sənəd) serverdə check ID ilə qurulur; brauzer yalnız sualı, öz
 *     əvvəlki mesajlarını və check ID-ni göndərir.
 *   • Model cavabı yalnız textContent ilə göstərilir; "1. ..." və "- ..." sətirləri siyahıya çevrilir.
 *   • Bir anda bir sorğu; sənəd yükləmə və yoxlama chat-dan asılı deyil.
 *
 * Saf funksiyalar Node testləri üçün `module.exports`-dadır; brauzerdə `window.AiChat`.
 */
(function (root) {
  'use strict';

  const MAX_HISTORY = 8;

  function contextKey(ctx) {
    return ctx && ctx.checkId ? 'check:' + ctx.checkId : 'umumi';
  }

  /** Kontekstlərə görə ayrılmış söhbətlər. */
  function createStore() {
    const chats = new Map();
    let seq = 0;
    return {
      list(key) { return chats.get(key) || []; },
      add(key, message) {
        const item = { id: ++seq, ...message };
        chats.set(key, this.list(key).concat(item));
        return item;
      },
      update(key, id, patch) {
        chats.set(key, this.list(key).map((m) => (m.id === id ? { ...m, ...patch } : m)));
      },
      remove(key, id) { chats.set(key, this.list(key).filter((m) => m.id !== id)); },
    };
  }

  /** Modelə gedən əvvəlki mesajlar: yalnız uğurlu sual-cavablar, son MAX_HISTORY. */
  function historyFor(messages, max) {
    return messages.filter((m) => (m.role === 'user' && !m.failed) || m.role === 'assistant')
      .map((m) => ({ role: m.role, text: m.text })).slice(-(max || MAX_HISTORY));
  }

  /** Cavab mətnini bloklara bölür: paraqraf, nömrəli və nişanlı siyahı (HTML yoxdur). */
  function parseReply(text) {
    const blocks = [];
    String(text || '').split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line) { blocks.push(null); return; }
      const ol = line.match(/^(\d{1,2})[.)]\s+(.+)$/);
      const ul = line.match(/^[-•*]\s+(.+)$/);
      const type = ol ? 'ol' : ul ? 'ul' : 'p';
      const content = ol ? ol[2] : ul ? ul[1] : line;
      const prev = blocks[blocks.length - 1];
      if (type !== 'p' && prev && prev.type === type) prev.items.push(content);
      else if (type !== 'p') blocks.push({ type, items: [content], start: ol ? Number(ol[1]) : undefined });
      else if (prev && prev.type === 'p') prev.text += ' ' + content;
      else blocks.push({ type: 'p', text: content });
    });
    return blocks.filter(Boolean);
  }

  function suggestions(ctx) {
    const list = ['Planı necə hazırlayım?', 'Nələri yoxlayırsınız?'];
    if (ctx && ctx.checkId && ctx.runState === 'tamamlandi') list.push('Hesabatı izah et');
    return list;
  }

  function contextLabel(ctx) {
    if (!ctx || !ctx.checkId) return 'Sənəd yüklənməyib';
    const state = { tamamlandi: 'nəticə hazırdır', isleyir: 'yoxlama gedir', gozleyir: 'yoxlama gedir',
      xeta: 'yoxlama dayanıb', tesdiq_gozleyir: 'tələblərin təsdiqi gözlənilir',
      telebler_hazirlanir: 'tələblər hazırlanır' }[ctx.runState] || '';
    return ctx.planId + ' · v' + ctx.version + (state ? ' · ' + state : '');
  }

  const api = { contextKey, createStore, historyFor, parseReply, suggestions, contextLabel, MAX_HISTORY };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ── DOM ─────────────────────────────────────────────────────────────── */

  const S = { deps: null, ctx: null, store: createStore(), pending: null, available: false,
    unavailable: '', open: false, minimized: false, maxLength: 1500 };
  const $ = (id) => document.getElementById(id);

  /** Xoş gəldin kartı: köməkçinin REAL imkanları (kontekstə görə). */
  function greeting() {
    const { el, icon } = S.deps;
    const li = el('li', 'aiwelcome');
    const logo = el('img', 'aiwelcome__logo');
    logo.src = '/static/favicon.svg';
    logo.alt = '';
    logo.width = 44;
    logo.height = 44;
    const plan = S.ctx && S.ctx.checkId;
    li.append(logo, el('p', 'aiwelcome__title', 'Salam! Biznes planınızı hazırlamağa və yoxlama nəticələrini anlamağa kömək edə bilərəm.'));
    li.append(el('p', 'aiwelcome__text', plan
      ? 'Seçilmiş plan: ' + S.ctx.planId + ' (v' + S.ctx.version + '). Cavablar bu yoxlamanın nəticəsinə və sənədin bölmələrinə əsaslanır.'
      : 'Hələ sənəd seçilməyib — ümumi biznes plan məsləhəti verirəm, sənədi oxumuş kimi danışmıram.'));
    const caps = el('ul', 'aiwelcome__caps');
    (plan
      ? [['bookOpen', 'Problemləri bölmə və cədvəl istinadı ilə izah edirəm'],
        ['trendUp', 'Maliyyə yoxlamalarının mənasını şərh edirəm'],
        ['shield', 'Status və rəqəmləri dəyişmirəm, investisiya qərarı vermirəm']]
      : [['bookOpen', 'Planın bölmələrini və strukturunu izah edirəm'],
        ['trendUp', 'Hansı maliyyə göstəricilərinin yoxlandığını deyirəm'],
        ['shield', 'Rəqəm uydurmuram, investisiya qərarı vermirəm']]).forEach(([name, text]) => {
      const item = el('li');
      item.append(icon(name), el('span', null, text));
      caps.append(item);
    });
    li.append(caps);
    return li;
  }

  function timeText(at) {
    if (!at) return '';
    const d = new Date(at);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function avatar() {
    const node = S.deps.el('span', 'aimsg__avatar');
    node.setAttribute('aria-hidden', 'true');
    S.deps.setIcon(node, 'sparkle');
    return node;
  }

  /** Hazır suallar — yazı sahəsinin üstündə, söhbət uzansa da əlçatan qalır. */
  function renderSuggestions() {
    const { el } = S.deps;
    $('ai-suggest').replaceChildren(...suggestions(S.ctx).map((text) => {
      const b = el('button', 'aisugg__btn', text);
      b.type = 'button';
      b.disabled = !S.available || Boolean(S.pending);
      b.addEventListener('click', () => send(text));
      return b;
    }));
  }

  function replyNode(text) {
    const { el } = S.deps;
    const box = el('div', 'aimsg__bubble');
    parseReply(text).forEach((b) => {
      if (b.type === 'p') { box.append(el('p', null, b.text)); return; }
      const list = el(b.type, 'aimsg__list');
      if (b.type === 'ol' && b.start && b.start !== 1) list.start = b.start;
      b.items.forEach((item) => list.append(el('li', null, item)));
      box.append(list);
    });
    return box;
  }

  function copyButton(text) {
    const { el, icon, setIcon } = S.deps;
    const b = el('button', 'aimsg__copy');
    b.type = 'button';
    const ic = icon('copy');
    const label = el('span', 'aimsg__copytext', 'Kopyala');
    b.append(ic, label);
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        S.deps.announce('Cavab kopyalandı.');
        setIcon(ic, 'check');
        label.textContent = 'Kopyalandı';
        b.classList.add('is-done');
        setTimeout(() => { setIcon(ic, 'copy'); label.textContent = 'Kopyala'; b.classList.remove('is-done'); }, 1600);
      } catch (_) { S.deps.announce('Kopyalamaq mümkün olmadı.'); }
    });
    return b;
  }

  function messageNode(m, key) {
    const { el } = S.deps;
    if (m.role === 'user') {
      const li = el('li', 'aimsg aimsg--user' + (m.failed ? ' is-failed' : ''));
      const col = el('div', 'aimsg__col');
      col.append(el('div', 'aimsg__bubble', m.text), el('span', 'aimsg__time', m.failed ? 'göndərilmədi' : timeText(m.at)));
      li.append(col);
      return li;
    }
    if (m.role === 'assistant') {
      const li = el('li', 'aimsg aimsg--bot');
      li.append(avatar());
      const col = el('div', 'aimsg__col');
      if (m.agents && m.agents.length) {
        // Açıq handoff görünür: kim cavab verdi və sual kimdən kimə ötürüldü.
        const who = el('span', 'aimsg__agent');
        const last = m.agents[m.agents.length - 1];
        who.append(el('strong', null, last.label));
        if (m.agents.length > 1) who.append(document.createTextNode(' · ' + m.agents.map((a) => a.label).join(' → ')));
        col.append(who);
      }
      const meta = el('div', 'aimsg__meta');
      meta.append(el('span', 'aimsg__time', timeText(m.at)), copyButton(m.text));
      col.append(replyNode(m.text), meta);
      li.append(col);
      return li;
    }
    // Xəta: mətn + yenidən cəhd
    const li = el('li', 'aimsg aimsg--error');
    const box = el('div', 'aimsg__bubble');
    box.append(el('p', null, m.text));
    if (m.retry) {
      const b = el('button', 'btn btn--small', 'Yenidən cəhd et');
      b.type = 'button';
      b.addEventListener('click', () => { S.store.remove(key, m.id); send(m.retry, m.retryOf); });
      box.append(b);
    }
    li.append(box);
    return li;
  }

  function typingNode() {
    const { el } = S.deps;
    const li = el('li', 'aimsg aimsg--bot aimsg--typing');
    li.append(avatar());
    const bubble = el('div', 'aimsg__bubble');
    bubble.append(el('span', 'aidots'), el('span', 'sr-only', 'Cavab hazırlanır…'));
    bubble.firstChild.append(el('span'), el('span'), el('span'));
    bubble.firstChild.setAttribute('aria-hidden', 'true');
    li.append(bubble);
    return li;
  }

  function render() {
    if (!S.deps) return;
    const key = contextKey(S.ctx);
    const log = $('ai-log');
    const items = [greeting(), ...S.store.list(key).map((m) => messageNode(m, key))];
    if (S.pending === key) items.push(typingNode());
    log.replaceChildren(...items);
    log.scrollTop = log.scrollHeight;
    $('ai-context-text').textContent = contextLabel(S.ctx);
    $('ai-unavailable').hidden = S.available;
    $('ai-unavailable').textContent = S.unavailable;
    const input = $('ai-input');
    input.disabled = !S.available;
    $('ai-send').disabled = !S.available || Boolean(S.pending);
    $('ai-send').setAttribute('aria-label', S.pending ? 'Cavab gözlənilir' : 'Göndər');
    renderSuggestions();
    const status = !S.available ? ['off', S.deps.demo() ? 'Demo — model çağırılmır' : 'Qoşulmayıb']
      : S.pending ? ['busy', 'Cavab yazır…'] : ['on', 'Hazır'];
    $('ai-status').dataset.state = status[0];
    $('ai-status-text').textContent = status[1];
    $('ai-context').classList.toggle('is-plan', Boolean(S.ctx && S.ctx.checkId));
    updateCounter();
  }

  /** Yazı sahəsi məzmuna görə böyüyür (ən çoxu ~5 sətir). */
  function fitInput() {
    const input = $('ai-input');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }

  function updateCounter() {
    const length = $('ai-input').value.length;
    const counter = $('ai-count');
    counter.textContent = length > S.maxLength * 0.8 ? length + ' / ' + S.maxLength : '';
  }

  async function send(text, retryOf) {
    const message = String(text || '').trim();
    if (!message || !S.available || S.pending) return;
    if (message.length > S.maxLength) { S.deps.announce('Sual çox uzundur.'); return; }
    const key = contextKey(S.ctx);
    const ctx = S.ctx;
    const history = historyFor(S.store.list(key));
    const user = retryOf ? null : S.store.add(key, { role: 'user', text: message, at: Date.now() });
    if (retryOf) S.store.update(key, retryOf, { failed: false });
    const userId = user ? user.id : retryOf;
    S.pending = key;
    if (!retryOf) { $('ai-input').value = ''; fitInput(); }
    render();
    const controller = new AbortController();
    const guard = setTimeout(() => controller.abort(), 75000);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ message, history, check_id: ctx && ctx.checkId ? ctx.checkId : null }),
      });
      let data = null;
      try { data = await response.json(); } catch (_) { data = null; }
      if (!response.ok) throw new Error((data && typeof data.detail === 'string') ? data.detail : 'Server xətası (' + response.status + ').');
      S.store.add(key, { role: 'assistant', text: String(data.reply || ''), at: Date.now(),
        agents: Array.isArray(data.agents) ? data.agents.filter((a) => a && typeof a.label === 'string') : [] });
      if (key === contextKey(S.ctx)) S.deps.announce('AI köməkçi cavab verdi.');
    } catch (e) {
      S.store.update(key, userId, { failed: true });
      const text = e.name === 'AbortError' ? 'Cavab gəlmədi (vaxt bitdi). Yenidən cəhd edin.' : (e.message || 'Serverlə əlaqə kəsildi.');
      S.store.add(key, { role: 'error', text, retry: message, retryOf: userId });
      if (key === contextKey(S.ctx)) S.deps.announce('AI köməkçi xətası: ' + text);
    } finally {
      clearTimeout(guard);
      S.pending = null;
      render();
    }
  }

  function setOpen(open, focus) {
    S.open = open;
    $('ai-panel').hidden = !open;
    $('ai-fab').setAttribute('aria-expanded', String(open));
    $('ai-fab').classList.toggle('is-open', open);
    if (open) {
      setMinimized(false);
      render();
      if (focus !== false) (S.available ? $('ai-input') : $('ai-close')).focus();
    } else if (focus !== false) {
      $('ai-fab').focus();
    }
  }

  function setMinimized(min) {
    S.minimized = min;
    $('ai-body').hidden = min;
    $('ai-panel').classList.toggle('is-min', min);
    $('ai-min').setAttribute('aria-expanded', String(!min));
    $('ai-min-label').textContent = min ? 'Genişləndir' : 'Kiçilt';
    S.deps.setIcon($('ai-min-icon'), min ? 'chevronUp' : 'minus');
  }

  /** app.js seçilmiş yoxlama dəyişəndə çağırır (null — sənəd seçilməyib). */
  function setContext(ctx) {
    S.ctx = ctx && ctx.checkId ? ctx : null;
    if (S.open) render();
    else if (S.deps) $('ai-context-text').textContent = contextLabel(S.ctx);
  }

  async function init(deps) {
    S.deps = deps;
    $('ai-fab').addEventListener('click', () => setOpen(!S.open));
    $('ai-close').addEventListener('click', () => setOpen(false));
    $('ai-min').addEventListener('click', () => { setMinimized(!S.minimized); if (!S.minimized) $('ai-input').focus(); });
    $('ai-form').addEventListener('submit', (e) => { e.preventDefault(); send($('ai-input').value); });
    $('ai-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send($('ai-input').value); }
    });
    $('ai-input').addEventListener('input', () => { updateCounter(); fitInput(); });
    $('ai-panel').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    });
    if (deps.demo()) {
      S.available = false;
      S.unavailable = 'Demo rejimində AI köməkçi modelə müraciət etmir — bu, yalnız nümunədir.';
    } else {
      try {
        const status = await deps.get('/api/chat/status');
        S.available = Boolean(status.available);
        S.unavailable = status.message || '';
        if (status.limits && status.limits.max_message) S.maxLength = status.limits.max_message;
        if (status.memory) {
          $('ai-memory').textContent = 'Sənəd axtarışı: ' + (status.memory.semantic
            ? 'semantik (' + status.memory.label + ')' : status.memory.label);
        }
      } catch (_) {
        S.available = false;
        S.unavailable = 'AI köməkçinin vəziyyəti yoxlanıla bilmədi (server əlçatan deyil).';
      }
    }
    $('ai-input').maxLength = S.maxLength;
    render();
  }

  root.AiChat = { init, setContext, open: () => setOpen(true), close: () => setOpen(false) };
})(this);
