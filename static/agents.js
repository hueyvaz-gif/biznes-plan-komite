/* "Agentlər nə etdi" — hadisələrdən zaman xətti, cəhdlər və xülasə (DOM-suz).
 *
 * Giriş: /api/checks/{id}/events hadisələri — {id, attempt, ts (saniyə), agent,
 * grp ("qrup_id|Qrupun adı"), kind (node|tool|llm|result), name, args, summary,
 * status, duration_ms}. Modelin mətni burada YOXDUR.
 *
 * Brauzerdə `window.Agents`, Node-da `module.exports` (testlər üçün).
 */
(function (root) {
  'use strict';

  const AGENT_LABELS = {
    qraf: 'Qovşaqlar',
    maliyye: 'Maliyyə yoxlayıcısı',
    uygunluq: 'Uyğunluq eksperti',
    rey: 'Rəy katibi',
    elave: 'Tələb çıxarıcı',
  };
  const NODE_AGENT = { finance: 'maliyye', compliance: 'uygunluq', write_summary: 'rey' };
  const ROW_ORDER = ['qraf', 'elave', 'maliyye', 'uygunluq', 'rey'];

  function agentLabel(agent) { return AGENT_LABELS[agent] || agent || '—'; }

  function groupTitle(grp) {
    if (!grp) return '';
    const at = grp.indexOf('|');
    return at < 0 ? grp : grp.slice(at + 1);
  }

  // "nəticə hazır" bitmə anında yazılır: onun müddəti geriyə doğrudur, nişan ts-dədir.
  function endOf(e) { return e.kind === 'result' ? e.ts : e.ts + (e.duration_ms || 0) / 1000; }

  /** Ümumi göstəricilər: LLM çağırışları, alət çağırışları, alət xətaları, müddət. */
  function stats(events) {
    const tools = events.filter((e) => e.kind === 'tool');
    const runs = events.filter((e) => e.attempt > 0);
    const start = runs.length ? Math.min(...runs.map((e) => e.ts)) : 0;
    const end = runs.length ? Math.max(...runs.map(endOf)) : 0;
    const busy = attempts(events).reduce((sum, a) => sum + (a.end - a.start), 0);
    return {
      llm: events.filter((e) => e.kind === 'llm').length,
      tools: tools.length,
      toolErrors: tools.filter((e) => e.status !== 'ok').length,
      attempts: new Set(runs.map((e) => e.attempt)).size,
      busySeconds: busy,             // cəhdlərin cəmi (aralarındakı gözləmə daxil deyil)
      wallSeconds: end - start,
    };
  }

  /** Cəhdlər: "1-ci cəhd — dayandı (Uyğunluq eksperti)", "2-ci cəhd — davam etdi". */
  function attempts(events) {
    const numbers = [...new Set(events.map((e) => e.attempt))].filter((n) => n > 0).sort((a, b) => a - b);
    return numbers.map((n, index) => {
      const own = events.filter((e) => e.attempt === n);
      const failed = own.find((e) => e.kind === 'node' && e.status !== 'ok');
      const saved = own.some((e) => e.kind === 'node' && e.name === 'save' && e.status === 'ok');
      let status = 'işləyir';
      let failedAt = null;
      if (failed) {
        status = 'dayandı';
        failedAt = agentLabel(NODE_AGENT[failed.name]) !== '—' && NODE_AGENT[failed.name]
          ? agentLabel(NODE_AGENT[failed.name]) : failed.name;
      } else if (saved) {
        status = index > 0 ? 'davam etdi və tamamlandı' : 'tamamlandı';
      } else if (index < numbers.length - 1) {
        status = 'dayandı';
      }
      return {
        attempt: n,
        status,
        failedAt,
        start: Math.min(...own.map((e) => e.ts)),
        end: Math.max(...own.map(endOf)),
        resumed: index > 0,
      };
    });
  }

  /**
   * Bir cəhdin zaman xətti: sətirlər və onların zolaqları (0..1 nisbətində).
   * Uyğunluq eksperti üçün hər qrup ayrıca alt-sətirdir — paralellik görünür.
   */
  function timeline(events, attempt) {
    const own = events.filter((e) => e.attempt === attempt);
    if (!own.length) return { rows: [], start: 0, end: 0, seconds: 0 };
    const start = Math.min(...own.map((e) => e.ts));
    const end = Math.max(...own.map(endOf));
    const span = Math.max(end - start, 0.001);
    const bar = (e) => ({
      event: e,
      left: (e.ts - start) / span,
      width: e.kind === 'result' ? 0 : Math.max((e.duration_ms || 0) / 1000 / span, 0),
    });
    const rows = [];
    ROW_ORDER.forEach((agent) => {
      const mine = own.filter((e) => (e.agent || 'qraf') === agent);
      if (agent === 'uygunluq') {
        const groups = [...new Set(mine.map((e) => e.grp).filter(Boolean))];
        rows.push({ key: agent, label: agentLabel(agent), level: 0,
                    bars: mine.filter((e) => !e.grp).map(bar),
                    empty: mine.length === 0 });
        groups.forEach((grp) => {
          const own = mine.filter((e) => e.grp === grp);
          // Qrupların nəticəsi paralel batch bitəndə BİRLİKDƏ yazılır; qrupun öz
          // bitmə anı onun son alət/LLM çağırışının sonudur — nişan oraya qoyulur.
          const work = own.filter((e) => e.kind !== 'result');
          const done = work.length ? Math.max(...work.map(endOf)) : null;
          rows.push({
            key: agent + ':' + grp, label: groupTitle(grp), level: 1,
            bars: own.map((e) => (e.kind === 'result' && done !== null
              ? { ...bar(e), left: (done - start) / span } : bar(e))),
          });
        });
      } else {
        rows.push({ key: agent, label: agentLabel(agent), level: 0, bars: mine.map(bar),
                    empty: mine.length === 0 });
      }
    });
    return { rows, start, end, seconds: span };
  }

  /** Hadisənin bir sətirlik təsviri (lent və siyahılar üçün). */
  function describe(e) {
    if (e.kind === 'tool') return e.name + (e.args ? '(' + e.args + ')' : '()') + (e.summary ? ' → ' + e.summary : '');
    if (e.kind === 'llm') return 'Model çağırışı' + (e.summary ? ' · ' + e.summary : '');
    if (e.kind === 'node') return 'Qovşaq: ' + e.name + (e.status !== 'ok' && e.summary ? ' — ' + e.summary : '');
    return (e.name || 'nəticə') + (e.summary ? ': ' + e.summary : '');
  }

  function seconds(ms) {
    if (ms === null || ms === undefined) return '—';
    return ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1).replace('.', ',') + ' s';
  }

  const api = { agentLabel, groupTitle, stats, attempts, timeline, describe, seconds, AGENT_LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Agents = api;
})(this);
