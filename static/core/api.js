/* API (demo rejimində yalnız oxuma). */
import { state } from './state.js';

/* ── API (demo rejimində yalnız oxuma) ──────────────────────────────────── */

class ApiError extends Error {}
async function readError(response) {
  try {
    const data = await response.json();
    if (data && typeof data.detail === 'string') return data.detail;
  } catch (_) { /* cavab JSON deyil */ }
  return 'Server xətası (' + response.status + ').';
}
/** Demo məlumatından GET cavabı; tapılmasa 404. */
function demoGet(path) {
  const d = state.demo;
  const m = (re) => path.match(re);
  let r;
  if (path === '/api/meta') return { ...d.meta, dev_mode: false, fail_at_options: [] };
  if (path === '/api/plans') return d.plans;
  if ((r = m(/^\/api\/plans\/(.+)\/checks$/))) return d.plan_checks[decodeURIComponent(r[1])] || [];
  if ((r = m(/^\/api\/checks\/([^/]+)\/events\?after=(\d+)$/))) {
    const all = (d.events || {})[decodeURIComponent(r[1])] || [];
    const after = Number(r[2]);
    const events = all.filter((e) => e.id > after);
    return { events, last_id: events.length ? events[events.length - 1].id : after };
  }
  if ((r = m(/^\/api\/checks\/([^/]+)\/section\?title=(.+)$/))) {
    const text = ((d.sections || {})[decodeURIComponent(r[1])] || {})[decodeURIComponent(r[2])];
    if (text !== undefined) return { section_title: decodeURIComponent(r[2]), text };
  }
  if ((r = m(/^\/api\/checks\/([^/]+)\/requirements$/))) {
    const found = d.requirements[decodeURIComponent(r[1])];
    if (found) return found;
  }
  if ((r = m(/^\/api\/checks\/([^/]+)$/))) {
    const found = d.checks[decodeURIComponent(r[1])];
    if (found) return found;
  }
  return null;
}
const api = {
  async get(path, signal) {
    if (state.demo) {
      const data = demoGet(path);
      if (data === null) { const e = new ApiError('Tapılmadı.'); e.status = 404; throw e; }
      return data;
    }
    const response = await fetch(path, { signal });
    if (!response.ok) { const e = new ApiError(await readError(response)); e.status = response.status; throw e; }
    return response.json();
  },
  async del(path) {
    if (state.demo) throw new ApiError('Demo rejimində heç nə silinmir — bu, yalnız nümunədir.');
    const response = await fetch(path, { method: 'DELETE' });
    if (!response.ok) { const e = new ApiError(await readError(response)); e.status = response.status; throw e; }
    return response.json();
  },
  async post(path, body) {
    if (state.demo) throw new ApiError('Demo rejimində heç nə göndərilmir — bu, yalnız nümunədir.');
    const options = { method: 'POST' };
    if (body instanceof FormData) options.body = body;
    else if (body !== undefined) {
      options.body = JSON.stringify(body);
      options.headers = { 'Content-Type': 'application/json' };
    }
    const response = await fetch(path, options);
    if (!response.ok) { const e = new ApiError(await readError(response)); e.status = response.status; throw e; }
    return response.json();
  },
};

export { ApiError, api };
