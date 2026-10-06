/* Hesabatın məzmunu — yoxlamanın STRUKTURLAŞDIRILMIŞ nəticəsindən (DOM-suz, LLM-siz).
 *
 * Qısa nəticə, vahid düzəliş siyahısı, maliyyə cədvəli və saylar yalnız təsdiqlənmiş tapıntılardan
 * qurulur: model mətni (rəy, suallar) burada iştirak etmir, yeni problem, prioritet və ya rəqəm
 * yaranmır. Düzəliş mətni tələblər siyahısının öz "action" sahəsindən gəlir.
 *
 * Brauzerdə `window.Report`, Node-da `module.exports` (testlər üçün).
 */
(function (root) {
  'use strict';

  const REQ_LABEL = {
    var: 'Cavablandırılıb', natamam: 'Natamam', yoxdur: 'Cavabsız', tetbiq_edilmir: 'Tətbiq edilmir',
    sened: 'Ayrıca sənəd', skip: 'Yoxlanılmadı',
  };
  const FIN_LABEL = { ok: 'Uyğun', warn: 'Kiçik fərq', fail: 'Uyğunsuz', skip: 'Yoxlanılmadı' };
  const SEVERITY_ORDER = { kritik: 0, duzelis: 1, deqiqlesdir: 2 };
  const SEVERITY_LABEL = { kritik: 'Vacib', duzelis: 'Düzəliş', deqiqlesdir: 'Dəqiqləşdirin' };

  /* ── Saylar: bütün ekranlarda eyni qayda ─────────────────────────────── */

  /**
   * cəmi = yoxlanılan + ayrıca sənəd + yoxlanılmadı;
   * yoxlanılan = cavablandırılıb + natamam + cavabsız + tətbiq edilmir.
   * "Tamamlanıb" yalnız hər bənd ya cavablandırılıb, ya da tətbiq edilmir olanda.
   */
  function reqCounts(items) {
    const n = (st) => items.filter((i) => i.status === st).length;
    const answered = n('var');
    const notApplicable = n('tetbiq_edilmir');
    const partial = n('natamam');
    const missing = n('yoxdur');
    const document = n('sened');
    const evaluated = answered + notApplicable + partial + missing;
    return {
      total: items.length, evaluated, answered, notApplicable, partial, missing, document,
      notChecked: items.length - evaluated - document,
      complete: items.length > 0 && answered + notApplicable === items.length,
    };
  }

  /* ── Versiyadan saxlanan status: bir əsas nəticə ──────────────────────── */

  /**
   * Bölmənin mətni dəyişməyibsə, əvvəlki versiyanın statusu saxlanılır. Yeni qiymətləndirmə fərqli
   * olsa belə istifadəçiyə BİR status göstərilir:
   *  • saxlanan status sübutludur (var + sitat) və ya hər ikisi problem göstərir — ziddiyyət həll
   *    olunub, tarixçə yalnız detalda;
   *  • saxlanan status problemdir, yeni qiymətləndirmə isə sitatla "var" deyir — həll olunmayıb,
   *    istifadəçi sənəddə yoxlamalıdır.
   */
  function resolveCarried(item) {
    const carried = item.carried_from;
    if (!carried || !carried.status_now || carried.status_now === item.status) {
      return { status: item.status, conflict: null };
    }
    const kept = item.status;
    const now = carried.status_now;
    const resolved = !(kept !== 'var' && now === 'var') && !(kept === 'var' && !item.quote);
    return {
      status: kept,
      conflict: {
        version: carried.version, kept, now, resolved,
        note: 'v' + carried.version + '-dən saxlanılıb (bölmənin mətni dəyişməyib); yeni qiymətləndirmə: '
          + (REQ_LABEL[now] || now).toLowerCase() + '.',
      },
    };
  }

  /* ── Mətn köməkçiləri ──────────────────────────────────────────────── */

  function firstSentence(text, max) {
    const limit = max || 200;
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    const m = clean.match(/^(.+?[.!?])(\s|$)/);
    let s = m ? m[1] : clean;
    if (s.length > limit) s = s.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
    return s;
  }

  /** "[MƏLUMAT LAZIMDIR: VÖEN, hüquqi ünvan]" → {what: "VÖEN, hüquqi ünvan", kind: "melumat"}. */
  function placeholderText(raw) {
    const inner = String(raw || '').trim().replace(/^\[+|\]+$/g, '').trim();
    const m = inner.match(/^(MƏLUMAT LAZIMDIR|M[ƏE]LUMAT LAZIMDIR|DOLDURULMALIDIR|QEYD)\s*[:—-]\s*(.+)$/i);
    if (m) return { what: m[2].trim(), kind: 'melumat' };
    if (/^yenil[əe]nm[əe]li$/i.test(inner)) return { what: '', kind: 'yenile' };
    if (/^\.{2,}$|^_+$|^x+$/i.test(inner)) return { what: '', kind: 'bos' };
    return { what: inner, kind: 'diger' };
  }

  function unique(list) { return [...new Set(list.filter(Boolean))]; }

  /** Agentin "nə çatışmır" mətnindən xam qeydlər ([MƏLUMAT LAZIMDIR: …], [[yenilənməli]]) çıxarılır. */
  function cleanMissing(text) {
    let t = String(text || '');
    t = t.replace(/\(\s*\[+[^\]]*\]+\s*qeydi\s*\)/gi, '');
    t = t.replace(/\s*\[+M[ƏE]LUMAT LAZIMDIR[^\]]*\]+(\s*kimi)?/gi, '');
    t = t.replace(/\s*\[+[^\]]{1,60}\]+/g, '');
    t = t.replace(/\bplaceholder(lər)?\b/gi, 'boş yer');
    t = t.replace(/\(\s*\)/g, '').replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
    const dash = t.indexOf(' — ');
    if (dash >= 8) t = t.slice(0, dash).trim();
    t = t.replace(/[,;:]$/, '');
    return t && !/[.!?…]$/.test(t) ? t + '.' : t;
  }

  /* Açar söz kökləri (5 hərf) — boş yerin hansı tələbə aid olduğunu tapmaq üçün. */
  const STOP = new Set(['məlum', 'lazım', 'göstə', 'üzrə', 'qeydi', 'konkr', 'olunu', 'edilm', 'yalnı', 'lakin']);
  function stems(text, extraStop) {
    return new Set((String(text || '').toLocaleLowerCase('az').match(/[a-zəğıöşüç]{5,}/g) || [])
      .map((w) => w.slice(0, 5)).filter((w) => !STOP.has(w) && !(extraStop && extraStop.has(w))));
  }
  function overlap(a, b) { let n = 0; a.forEach((w) => { if (b.has(w)) n += 1; }); return n; }

  /* Mövzu adında ümumi sözlər — iki tələbi yalnız bu sözə görə birləşdirmək olmaz. */
  const TOPIC_STOP = new Set(['layih', 'planı', 'pland', 'haqqı', 'barəd', 'digər']);

  function lowerFirst(s) {
    // "Ofis …" → "ofis …", amma abreviatura ("VÖEN", "T&İ") olduğu kimi qalır.
    return s.length > 1 && s[1] === s[1].toLocaleLowerCase('az') ? s.charAt(0).toLocaleLowerCase('az') + s.slice(1) : s;
  }
  function upperFirst(s) { return s ? s.charAt(0).toLocaleUpperCase('az') + s.slice(1) : s; }

  /**
   * Tapşırıq formasında yazılmış çatışmazlıq ("Niyyət məktublarının CFG adına yenilənməsi.") →
   * çatışmazlıq kimi ("Niyyət məktubları CFG adına yenilənməyib."). Başqa mətnlər dəyişmir.
   */
  function asShortfall(text) {
    const t = String(text || '').trim();
    const m = t.match(/^(.+\s)?(\S+?)(m)(ə|a)(si|sı)\.$/);
    if (!m || !/(n|l|ş|r|z|t|d)$/.test(m[2])) return t;
    const verb = m[2] + m[3] + m[4] + (m[4] === 'ə' ? 'yib' : 'yıb');
    // Cəmdə yiyəlik hal ("məktublarının") adlıq hala qayıdır ("məktubları").
    const head = (m[1] || '').replace(/(\S*?)(lar|lər)(ının|inin)(\s)/, (_a, stem, pl, gen, sp) => stem + pl + gen[0] + sp);
    return upperFirst(head + verb + '.');
  }

  /** "X göstərilməyib / doldurulmayıb / boş qalıb" → X (konkret çatışmayan məlumat). */
  const GAP_VERB = /\s+(?:dəqiq\s+|aydın\s+)?(?:göstərilməyib|doldurulmayıb|boş qalıb|yazılmayıb|qeyd olunmayıb|verilməyib|təqdim olunmayıb|əlavə olunmayıb)\b/i;
  function gapSubject(missing) {
    const t = String(missing || '').trim();
    const m = t.match(GAP_VERB);
    if (!m) return null;
    let subject = t.slice(0, m.index);
    const turn = subject.search(/(?:^|[,;]\s*)(?:lakin|amma|ancaq)\s/i);      // "…var, lakin X göstərilməyib"
    if (turn >= 0) subject = subject.slice(turn).replace(/^[,;]?\s*(?:lakin|amma|ancaq)\s+/i, '');
    subject = subject.replace(/\s*\(\s*yalnız[^)]*\)/gi, '').replace(/[,;:\s]+$/, '').trim();
    return subject.length >= 3 ? lowerFirst(subject) : null;
  }

  /** Tövsiyə tapıntıdan qurulur; tapıntıda konkret sahə yoxdursa — tələbin şablonu (fallback). */
  function actionFor(missing, template) {
    const subject = gapSubject(missing);
    if (subject) return 'Plana əlavə edin: ' + subject + '.';
    const raw = String(missing || '').trim();
    if (asShortfall(raw) !== raw) {                     // tapşırıq formasıdır: "…yenilənməsi."
      const task = raw.slice(0, -1);
      return upperFirst(task) + (task.endsWith('si') ? 'ni' : 'nı') + ' təmin edin.';
    }
    return template;
  }

  function fixAnchor(key) { return 'fix-' + String(key).replace(/[^a-zA-Z0-9_-]/g, '-'); }

  /* Azərbaycan dilində rəqəmdən sonra şəkilçi — rəqəmin oxunuşuna görə ("6-sı", "9-u", "1-də"). */
  const POSS_UNITS = ['', 'i', 'si', 'ü', 'ü', 'i', 'sı', 'si', 'i', 'u'];
  const POSS_TENS = ['', 'u', 'si', 'u', 'ı', 'si', 'ı', 'i', 'i', 'ı'];
  const LOC_UNITS = ['', 'də', 'də', 'də', 'də', 'də', 'da', 'də', 'də', 'da'];
  const LOC_TENS = ['', 'da', 'də', 'da', 'da', 'də', 'da', 'də', 'də', 'da'];
  function suffix(n, units, tens, hundred, thousand, zero) {
    const v = Math.abs(Math.trunc(n));
    if (v === 0) return zero;
    if (v % 10) return units[v % 10];
    if (v % 100) return tens[(v % 100) / 10];
    return v % 1000 ? hundred : thousand;
  }
  function poss(n) { return n + '-' + suffix(n, POSS_UNITS, POSS_TENS, 'ü', 'i', 'ı'); }
  function loc(n) { return n + '-' + suffix(n, LOC_UNITS, LOC_TENS, 'də', 'də', 'da'); }

  /** Bölmə və cədvəl istinadlarından oxunaqlı yer: "7.1. İnvestisiyanın həcmi … · Cədvəl 7.1". */
  function locationLabel(sections, tables) {
    const byId = new Map((tables || []).map((t) => [t.id, t]));
    const byTitle = new Map();
    (sections || []).forEach((s) => {
      const title = s.title || s.id || '';
      if (!byTitle.has(title)) byTitle.set(title, []);
      if (s.table_id) {
        const t = byId.get(s.table_id);
        const cap = t && t.caption ? (t.caption.match(/^Cədvəl\s+[\d.]+\d/i) || [])[0] : null;
        byTitle.get(title).push(cap || 'cədvəl');
      }
    });
    const parts = [...byTitle].map(([title, caps]) => title + (caps.length ? ' · ' + unique(caps).join(', ') : ''));
    return parts.join('; ') || null;
  }

  /* ── Vahid düzəliş siyahısı ────────────────────────────────────────── */

  /**
   * @param result  yoxlamanın nəticəsi (finance, compliance, ingest, …)
   * @param meta    {requirements: {req_id: {topic, action}}} — tələblər siyahısından
   * @param fmt     {money(v, unit), value(check, v)} — rəqəm formatı (UI ilə eyni)
   */
  function buildReport(result, meta, fmt) {
    const reqMeta = (meta && meta.requirements) || {};
    const format = fmt || { value: (_c, v) => String(v), money: (v) => String(v) };
    const finance = (result && result.finance) || {};
    const compliance = (result && result.compliance) || {};
    const ingest = (result && result.ingest) || {};
    const tables = ingest.tables || [];
    const fixes = [];
    const unchecked = [];
    const documents = [];
    const notApplicable = [];

    // Maliyyə yoxlamaları
    const checks = finance.checks || [];
    const sourcesMissing = (finance.not_found || []).filter((n) => n.field === 'sources');
    const otherMissing = (finance.not_found || []).filter((n) => n.field !== 'sources');
    checks.forEach((c) => {
      if (c.status === 'ok') return;
      const fix = {
        key: 'fin:' + c.id, kind: 'maliyye', code: null, ref: { type: 'fin', id: c.id },
        topic: c.title, location: null, related: [],
      };
      if (c.status === 'skip') {
        fix.severity = 'duzelis';
        fix.missing = firstSentence(String(c.detail || '').replace(/^Yoxlanıla bilmədi\s*[—-]\s*/i, ''))
          || 'Yoxlama üçün lazım olan rəqəmlər tapılmadı.';
        fix.action = 'Yoxlama üçün lazım olan rəqəmləri planda aydın göstərin.';
        if (c.id === 'menbeler_cemi') {
          fix.related = sourcesMissing.map((n) => ({
            text: n.label.replace(/^Mənbə:\s*/, '') + ': ' + format.money(n.value)
              + ' — məbləğ sənəddə bu mənbənin yanında təsdiqlənmədi.',
          }));
          fix.action = 'Hər maliyyələşmə mənbəyinin məbləğini maliyyələşmə cədvəlində aydın göstərin.';
        }
      } else if (c.clarify) {
        fix.severity = 'deqiqlesdir';
        const sentences = String(c.clarify).match(/[^.]+\./g) || [c.clarify];
        fix.missing = sentences.slice(0, -1).join(' ').trim() || firstSentence(c.detail);
        fix.action = sentences[sentences.length - 1].trim();
      } else {
        fix.severity = c.status === 'fail' && c.critical ? 'kritik' : 'duzelis';
        fix.missing = (c.claimed !== null && c.claimed !== undefined && c.computed !== null && c.computed !== undefined)
          ? 'Planda ' + format.value(c, c.claimed) + ', yenidən hesablanmış dəyər ' + format.value(c, c.computed) + '.'
          : firstSentence(c.detail);
        fix.action = c.title + ' göstəricisini planın öz cədvəlləri ilə uyğunlaşdırın.';
      }
      fixes.push(fix);
    });
    if (sourcesMissing.length && !checks.some((c) => c.id === 'menbeler_cemi' && c.status === 'skip')) {
      sourcesMissing.forEach((n) => otherMissing.push(n));
    }
    otherMissing.forEach((n, i) => {
      const isSource = n.field === 'sources';
      fixes.push({
        key: 'nf:' + i, kind: 'menbe', severity: 'duzelis', code: null, ref: null, location: null, related: [],
        topic: isSource ? 'Maliyyələşmə mənbəyinin məbləği' : (n.label || 'Rəqəmin mənbəyi'),
        missing: isSource
          ? n.label.replace(/^Mənbə:\s*/, '') + ': ' + format.money(n.value) + ' — məbləğ sənəddə təsdiqlənmədi.'
          : 'Planda ' + format.money(n.value) + ' göstərilib, amma sənəddə mənbəyi təsdiqlənmədi.',
        action: 'Rəqəmi sənəddə aydın göstərin (bölmə və ya cədvəl) və ya düzəldin.',
      });
    });

    // Tələblər
    const reqFixBySection = new Map();
    (compliance.items || []).forEach((item) => {
      const m = reqMeta[item.req_id] || {};
      const resolved = resolveCarried(item);
      const status = resolved.status;
      if (status === 'sened') { documents.push({ code: item.req_id, text: m.topic || item.text }); return; }
      if (status === 'tetbiq_edilmir') {
        notApplicable.push({ code: item.req_id, text: m.topic || item.text, quote: item.quote,
          reason: (item.condition && item.condition.text) || null });
        return;
      }
      if (status === 'skip') {
        unchecked.push({ code: item.req_id, group: item.group_title, technical: Boolean(item.technical) });
        return;
      }
      const extra = item.origin === 'elave';
      const topic = m.topic || (extra ? firstSentence(item.text, 90) : firstSentence(item.text, 90));
      const location = locationLabel(item.sections, tables);
      if (status === 'var') {
        if (resolved.conflict && !resolved.conflict.resolved) {
          fixes.push({
            key: 'req:' + item.req_id, kind: 'teleb', severity: 'deqiqlesdir', code: item.req_id,
            ref: { type: 'req', id: item.req_id }, topic, location, related: [], conflict: resolved.conflict,
            missing: 'Bu bənd üzrə versiyalar arasında fərqli qiymətləndirmə var: ' + resolved.conflict.note,
            action: 'Bölməni sənəddə yoxlayın və tələbə tam cavab verildiyinə əmin olun.',
          });
        }
        return;
      }
      const found = firstSentence(cleanMissing(item.missing));
      const template = m.action || (extra ? 'Planda bu tələbə cavab əlavə edin: ' + firstSentence(item.text, 160)
        : 'Bu tələbi planda tam cavablandırın.');
      const fix = {
        key: 'req:' + item.req_id, kind: 'teleb', code: item.req_id, ref: { type: 'req', id: item.req_id },
        severity: item.clarify ? 'deqiqlesdir' : status === 'yoxdur' ? 'kritik' : 'duzelis',
        topic, location, related: [], conflict: resolved.conflict,
        missing: asShortfall(found) || (status === 'yoxdur' ? 'Planda bu mövzu yoxdur.' : 'Tələb qismən cavablanıb.'),
        action: found ? actionFor(found, template) : template,
        codes: [{ code: item.req_id, title: item.req_id + ' — ' + (m.topic || firstSentence(item.text, 90)) + ': ' + item.text }],
        holes: [],
        _stems: stems((item.missing || '') + ' ' + item.text),
        _topic: stems(topic, TOPIC_STOP),
        _places: new Set((item.sections || []).map((s) => s.table_id || s.title).filter(Boolean)),
        _sections: (item.sections || []).map((s) => s.title).filter(Boolean),
      };
      // Eyni cədvələ/bölməyə aid, mövzusu üst-üstə düşən bənd (məs. "Avadanlıq və təchizatçılar" və
      // "Avadanlıq siyahısı", ikisi də Cədvəl 3.5) ayrıca kart deyil — eyni karta birləşir.
      const twin = fixes.find((f) => f.kind === 'teleb' && f._topic && overlap(f._topic, fix._topic) > 0
        && [...f._places].some((pl) => fix._places.has(pl)));
      if (twin) mergeInto(twin, fix); else fixes.push(fix);
      const owner = twin || fix;
      fix._sections.forEach((title) => {
        if (!reqFixBySection.has(title)) reqFixBySection.set(title, []);
        if (!reqFixBySection.get(title).includes(owner)) reqFixBySection.get(title).push(owner);
      });
    });
    const reqFixes = fixes.filter((f) => f.kind === 'teleb' && f._stems);

    /* Boş yer hansı tələb düzəlişinə aiddir: eyni bölmədə və mənaca üst-üstə düşən (≥1 ortaq kök),
       və ya başqa bölmədə olsa da açıq-aydın eyni məlumat (≥2 ortaq kök). Tapılmasa — ayrıca bənd. */
    function ownerOf(p, ph) {
      const words = stems(ph.what || p.text);
      if (!words.size) return null;
      const best = (list, min) => {
        let top = null; let score = min - 1;
        list.forEach((f) => { const o = overlap(words, f._stems); if (o > score) { score = o; top = f; } });
        return top;
      };
      return best((p.section_title && reqFixBySection.get(p.section_title)) || [], 1) || best(reqFixes, 2);
    }

    // Doldurulmamış yerlər: eyni bölmədə natamam tələb varsa — həmin düzəlişə birləşir.
    const phGroups = new Map();
    (ingest.placeholders || []).forEach((p, index) => {
      const key = (p.section_title || '') + '\u0000' + p.text;
      if (!phGroups.has(key)) phGroups.set(key, { p, index, indices: [] });
      phGroups.get(key).indices.push(index);
    });
    const loose = [];                                  // heç bir tələbə aid olmayan boş yerlər
    phGroups.forEach(({ p, index, indices }) => {
      const count = indices.length;
      const ph = placeholderText(p.text);
      const label = ph.kind === 'yenile' ? 'Sənəddə “yenilənməli” qeydi qalıb'
        : ph.what ? 'Doldurulmamış yer: ' + ph.what : 'Doldurulmamış yer: “' + p.text + '”';
      const owner = ownerOf(p, ph);
      if (owner) {
        owner.related.push({ text: label + (count > 1 ? ' (' + count + ' yerdə)' : ''), ref: { type: 'ph', index } });
        owner.holes.push(...indices);
        return;
      }
      loose.push({ p, ph, index, indices, count });
    });
    if (loose.length) {
      // Kodsuz boş yerlər bir kartda: hər biri üçün nəyin, harada yazılacağı konkret göstərilir.
      const what = (l) => (l.ph.kind === 'yenile' ? '“yenilənməli” qeydi qalan hissə'
        : l.ph.what || '“' + l.p.text + '”') + (l.count > 1 ? ' (' + l.count + ' yerdə)' : '');
      const where = (l) => (l.p.section_title ? ' — ' + l.p.section_title : '');
      const single = loose.length === 1 ? loose[0] : null;
      fixes.push({
        key: 'ph:other', kind: 'bosyer', severity: 'duzelis', code: null, codes: [],
        ref: single ? { type: 'ph', index: single.index } : null,
        topic: single && single.ph.what ? upperFirst(single.ph.what) : 'Digər boş yerlər',
        location: unique(loose.map((l) => l.p.section_title)).join('; ') || null,
        related: single ? [] : loose.map((l) => ({ text: upperFirst(what(l)) + where(l), ref: { type: 'ph', index: l.index } })),
        holes: loose.flatMap((l) => l.indices),
        missing: single ? 'Sənəddə boş qalıb: ' + what(single) + '.'
          : 'Sənəddə ' + loose.length + ' yer boş qalıb (heç bir tələbin kartına aid deyil).',
        action: loose.every((l) => l.ph.kind === 'yenile') ? 'Bu hissələri yeniləyin və qeydi silin.'
          : 'Plana əlavə edin: ' + loose.map((l) => what(l)).join('; ') + '.',
        raw: single ? single.p.text : null,
      });
    }

    fixes.forEach((f) => {
      ['_stems', '_topic', '_places', '_sections', '_gaps'].forEach((k) => { delete f[k]; });
      f.codes = f.codes || [];
      f.holes = f.holes || [];
      f.anchor = fixAnchor(f.key);
    });
    fixes.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    return { fixes, unchecked, documents, notApplicable };
  }

  /** İki tələb bəndi bir kartda: kodlar, çatışmazlıq, tövsiyə və yerlər birləşir. */
  function mergeInto(target, fix) {
    const join = (a, b) => unique([a, b]).join(' ');
    target.codes.push(...fix.codes);
    if (SEVERITY_ORDER[fix.severity] < SEVERITY_ORDER[target.severity]) target.severity = fix.severity;
    target._gaps = target._gaps || [gapSubject(target.missing)];
    target._gaps.push(gapSubject(fix.missing));
    target.missing = join(target.missing, fix.missing);
    target.action = target._gaps.every(Boolean) ? 'Plana əlavə edin: ' + unique(target._gaps).join('; ') + '.'
      : join(target.action, fix.action);
    target.location = unique([...(target.location || '').split('; '), ...(fix.location || '').split('; ')]).join('; ') || null;
    fix._stems.forEach((w) => target._stems.add(w));
    fix._places.forEach((p) => target._places.add(p));
  }

  /* ── Nəticə bloku: başlıq, bloklayan problem, 3 göstərici, ən vacib düzəlişlər ── */

  /** Maliyyə yoxlamasının sayları — nəticə bloku və tab nişanı eyni qaydanı işlədir. */
  function financeCounts(checks) {
    const list = checks || [];
    const clarify = list.filter((c) => c.clarify).length;
    const by = (st) => list.filter((c) => c.status === st && !c.clarify).length;
    return { total: list.length, ok: by('ok'), clarify, fail: by('fail'), warn: by('warn'), skip: by('skip'),
      problems: list.length - by('ok') };
  }

  function requirementItems(result, origin) {
    return ((((result && result.compliance) || {}).items) || [])
      .filter((i) => (i.origin || 'standart') === origin).map((i) => ({ ...i, status: resolveCarried(i).status }));
  }

  /**
   * Bütün rəqəmlər eyni mənbədən: kart sayları `report.fixes`-dən, tələb sayları `reqCounts`-dan,
   * bloklayan problem statusu müəyyən edən qaydanın öz səbəblərindən (`result.reasons`, ağırlıq "kritik").
   */
  function buildOverview(check, result, report, statusLabel) {
    const fixes = report.fixes;
    const sev = (s) => fixes.filter((f) => f.severity === s).length;
    const counts = { kritik: sev('kritik'), duzelis: sev('kritik') + sev('duzelis'), deqiqlesdir: sev('deqiqlesdir') };
    const tally = [counts.duzelis && counts.duzelis + ' düzəliş', counts.deqiqlesdir && counts.deqiqlesdir + ' dəqiqləşdirmə']
      .filter(Boolean).join(', ');
    const headline = (statusLabel || 'Yoxlama tamamlandı') + ' — ' + (tally || 'düzəliş tələb edən bənd yoxdur');

    const stored = (result && result.reasons) || null;            // verdict.decide(): {verdict, reasons, notes}
    const reasons = Array.isArray(stored) ? stored : stored && Array.isArray(stored.reasons) ? stored.reasons : null;
    const blockers = reasons ? reasons.filter((r) => r.severity === 'kritik')
      : fixes.filter((f) => f.severity === 'kritik').map((f) => ({ text: f.topic, items: [] }));
    const blocking = blockers.length
      ? { critical: true, text: 'Bloklayan problem var: ' + blockers.map((r) => lowerFirst(r.text)
        + (r.items && r.items.length ? ' (' + r.items.join(', ') + ')' : '')).join('; ') + '. Bu düzəlməyincə status “Hazır deyil” qalır.' }
      : { critical: false, text: 'Bloklayan problem yoxdur: kritik maliyyə uyğunsuzluğu və ya tamamilə cavabsız tələb tapılmayıb.' };

    const tiles = [];
    const fin = financeCounts(((result && result.finance) || {}).checks);
    if (fin.total) {
      const sub = [fin.clarify && fin.clarify + ' dəqiqləşdirmə', fin.fail && fin.fail + ' uyğunsuz',
        fin.warn && fin.warn + ' kiçik fərq', fin.skip && fin.skip + ' yoxlanılmadı'].filter(Boolean);
      tiles.push({ id: 'maliyye', title: 'Maliyyə', value: fin.ok + '/' + fin.total, unit: 'uyğun',
        sub: sub.join(' · ') || 'hamısı uyğun', tab: 'panel-maliyye',
        hint: fin.total + ' maliyyə yoxlamasından ' + poss(fin.ok) + ' uyğundur' });
    }
    const std = reqCounts(requirementItems(result, 'standart'));
    if (std.total) {
      const sub = [std.partial && std.partial + ' natamam', std.missing && std.missing + ' cavabsız',
        std.notApplicable && std.notApplicable + ' tətbiq edilmir', std.document && std.document + ' ayrıca sənəd',
        std.notChecked && std.notChecked + ' yoxlanılmadı'].filter(Boolean);
      tiles.push({ id: 'teleb', title: 'Tələblər', value: std.answered + '/' + std.evaluated, unit: 'tam',
        sub: sub.join(' · ') || 'hamısı cavablandırılıb', tab: 'panel-teleb',
        hint: std.total + ' standart tələb: ' + std.evaluated + '-i planın mətnində yoxlanılıb, '
          + poss(std.answered) + ' tam cavablandırılıb'
          + (std.document ? '; ' + std.document + ' ayrıca sənəddir, mövcudluğu yoxlanılmır' : '') + '.' });
    }
    const extraItems = requirementItems(result, 'elave');
    if (extraItems.length) {
      const ex = reqCounts(extraItems);
      const sub = [ex.partial && ex.partial + ' natamam', ex.missing && ex.missing + ' cavabsız',
        ex.document && ex.document + ' ayrıca sənəd', ex.notChecked && ex.notChecked + ' yoxlanılmadı'].filter(Boolean);
      tiles.push({ id: 'elave', title: 'Əlavə tələblər', value: ex.answered + '/' + ex.evaluated, unit: 'tam',
        sub: sub.join(' · ') || 'hamısı cavablandırılıb', tab: 'panel-elave',
        hint: ex.total + ' əlavə tələb' + (ex.document ? '; ' + ex.document + ' ayrıca sənəd yoxlanılmayıb' : '') + '.' });
    }
    const holesTotal = ((((result && result.ingest) || {}).placeholders) || []).length;
    const inside = fixes.filter((f) => f.kind !== 'bosyer').reduce((s, f) => s + f.holes.length, 0);
    const apart = holesTotal - inside;
    tiles.push({ id: 'bosyer', title: 'Boş yerlər', value: String(holesTotal), unit: 'yer',
      sub: holesTotal ? [inside && poss(inside) + ' düzəlişlərin içində', apart && poss(apart) + ' ayrıca kartda']
        .filter(Boolean).join(' · ') : 'boş yer qalmayıb',
      tab: 'panel-bosyer', hint: holesTotal + ' doldurulmamış yer' });

    // Sayların əlaqəsi: tələblər, boş yerlər və maliyyə bəndləri kartlara necə yığılıb.
    const reqCards = fixes.filter((f) => f.kind === 'teleb');
    const reqN = reqCards.reduce((s, f) => s + f.codes.length, 0);
    const merged = reqCards.filter((f) => f.codes.length > 1).map((f) => f.codes.map((c) => c.code).join(' və '));
    const finCards = fixes.filter((f) => f.kind === 'maliyye' || f.kind === 'menbe').length;
    const composition = [
      reqN && reqN + ' tələb bəndi → ' + reqCards.length + ' kart'
        + (merged.length ? ' (' + merged.join(', ') + ' eyni cədvələ aid olduğu üçün bir kartdadır)' : ''),
      holesTotal && holesTotal + ' boş yerdən ' + (inside ? poss(inside) + ' tələb kartlarının içindədir' : 'heç biri tələb kartında deyil')
        + (apart ? ', ' + poss(apart) + ' ayrıca kartdadır' : ''),
      finCards && finCards + ' maliyyə bəndi',
    ].filter(Boolean);

    return {
      headline, counts, blocking, tiles,
      top: fixes.slice(0, 3).map((f) => ({ anchor: f.anchor, topic: f.topic })),
      composition: composition.length ? 'Siyahı belə yığılıb: ' + composition.join(' · ') + '.' : '',
    };
  }

  /* ── Maliyyə: yığcam cədvəl ────────────────────────────────────────── */

  /** Maliyyə yoxlamasının etiketi və tonu — Nəticə və Maliyyə tablarında EYNİ qayda. */
  function financeLabel(c) {
    if (!c) return { label: '—', tone: 'neutral' };
    if (c.clarify) return { label: 'Dəqiqləşdirmə', tone: 'warning' };
    return { label: FIN_LABEL[c.status] || c.status, tone: { ok: 'success', warn: 'warning', fail: 'danger', skip: 'neutral' }[c.status] || 'neutral' };
  }

  function financeRows(result) {
    return ((((result && result.finance) || {}).checks) || []).map((c) => ({
      id: c.id, title: c.title, claimed: c.claimed, computed: c.computed, status: c.status,
      label: c.clarify ? 'Dəqiqləşdirmə' : FIN_LABEL[c.status] || c.status, critical: Boolean(c.critical),
    }));
  }

  /* ── Bir cümləlik nəticə (Nəticə tabının başı) ───────────────────────── */

  /** "a", "a və b", "a, b və c". Elementin özündə "və" və ya vergül varsa — "a; b; c" (oxunaqlı qalsın). */
  function joinAz(list) {
    if (list.length <= 1) return list.join('');
    if (list.some((x) => / və |,/.test(x))) return list.join('; ');
    return list.slice(0, -1).join(', ') + ' və ' + list[list.length - 1];
  }

  /**
   * Nəticə + səbəb, bir-iki cümlə. Hər say report.fixes-dən (siyahı ilə eyni mənbə), mövzular overview.top-dan.
   *   hazir        → "Plan təqdimata hazırdır." (+ dəqiqləşdirmə tövsiyəsi)
   *   duzelis      → "Plan təqdimata 9 düzəlişdən sonra hazır olacaq. Ən vacibi: a, b və c."
   *   hazir_deyil  → "Plan hazır deyil: 2 bloklayan problem var. Əvvəlcə: a və b."
   */
  function buildSentence(verdict, report, overview) {
    const fixes = (report && report.fixes) || [];
    const n = fixes.filter((f) => f.severity === 'kritik' || f.severity === 'duzelis').length;
    const c = fixes.filter((f) => f.severity === 'deqiqlesdir').length;
    const top = ((overview && overview.top) || []).map((t) => lowerFirst(t.topic));
    if (verdict === 'hazir' || (!n && !c)) {
      return 'Plan təqdimata hazırdır.' + (c ? ' ' + c + ' bəndin dəqiqləşdirilməsi tövsiyə olunur.' : '');
    }
    if (verdict === 'hazir_deyil') {
      const blockers = fixes.filter((f) => f.severity === 'kritik').map((f) => lowerFirst(f.topic));
      const k = blockers.length;
      return 'Plan hazır deyil' + (k ? ': ' + k + ' bloklayan problem var. Əvvəlcə: ' + joinAz(blockers.slice(0, 3)) + '.'
        : '.' + (top.length ? ' Ən vacibi: ' + joinAz(top) + '.' : ''));
    }
    const head = n ? 'Plan təqdimata ' + n + ' düzəlişdən sonra hazır olacaq.'
      : 'Plan təqdimata ' + c + ' bənd dəqiqləşdiriləndən sonra hazır olacaq.';
    return head + (top.length ? ' Ən vacibi: ' + joinAz(top) + '.' : '');
  }

  const api = {
    REQ_LABEL, FIN_LABEL, SEVERITY_LABEL, reqCounts, resolveCarried, firstSentence, placeholderText,
    cleanMissing, asShortfall, actionFor, locationLabel, buildReport, buildOverview, financeCounts, financeRows, poss, loc,
    buildSentence, joinAz, financeLabel,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Report = api;
})(this);
