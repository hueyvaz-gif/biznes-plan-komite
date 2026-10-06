// Yoxlama gedişatı ekranının skrinşotları (Faza 9). Real yoxlama ~100 s çəkir və model çağırır —
// ona görə tamamlanmış yoxlamanın məlumatı və hadisələri mərhələlərə bölünüb mock olunur.
//
//   node scripts/run-shots.mjs <çıxış-qovluğu> [--widths=1280,375] [--theme=dark] [--check=c1b49c3a9ba6]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, '').split('=')));
const out = process.argv[2];
if (!out) { console.error('çıxış qovluğu lazımdır'); process.exit(2); }
mkdirSync(out, { recursive: true });
const base = args.base || 'http://127.0.0.1:8010/';
const id = args.check || 'c1b49c3a9ba6';
const widths = (args.widths || '1440,1280,974,768,375').split(',').map(Number);
const theme = args.theme || 'light';

const real = await (await fetch(`${base}api/checks/${id}`)).json();
const allEvents = (await (await fetch(`${base}api/checks/${id}/events`)).json()).events;
const last = Math.max(...allEvents.map((e) => e.attempt));
const evs = allEvents.filter((e) => e.attempt === last);
const t0 = Math.min(...evs.map((e) => e.ts));
const nodeStart = (name) => (evs.find((e) => e.kind === 'node' && e.name === name) || {}).ts;
const groupDone = evs.filter((e) => e.kind === 'result' && e.agent === 'uygunluq').map((e) => e.ts).sort();

/** Mərhələ: hansı ana qədər hadisələr, hansı qovşaq gedir, nəticənin hansı hissəsi hazırdır. */
const STAGES = {
  ingest: { until: t0 + 1, step: 'ingest', result: null },
  finance: { until: nodeStart('finance') + 15, step: 'finance', result: null },
  compliance: { until: groupDone[5] + 0.01, step: 'compliance', result: { finance: real.result.finance } },
  summary: { until: nodeStart('write_summary') + 10, step: 'write_summary', result: { finance: real.result.finance, compliance: real.result.compliance, ingest: real.result.ingest } },
  error: { until: groupDone[5] + 0.01, step: 'compliance', result: { finance: real.result.finance }, state: 'xeta',
    error: "APIStatusError: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'Your credit balance is too low to access the Anthropic API.'}}" },
};

const browser = await chromium.launch();
const problems = new Set();
for (const w of widths) {
  for (const [name, st] of Object.entries(STAGES)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme === 'dark' ? 'dark' : 'light' });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.add(`${w} ${name} ${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => problems.add(`${w} ${name} pageerror: ${e.message}`));
    // Hadisələrin vaxtı "indi"yə köçürülür: keçən vaxt və təxmini qalan vaxt real görünsün.
    const shift = Date.now() / 1000 - st.until;
    const events = evs.filter((e) => e.ts <= st.until).map((e) => ({ ...e, ts: e.ts + shift }));
    const check = { ...real, run_state: st.state || 'isleyir', current_step: st.step, verdict: null, verdict_label: '', error: st.error || null, result: st.result };
    await page.route(`**/api/checks/${id}`, (r) => r.fulfill({ json: check }));
    await page.route(`**/api/checks/${id}/events*`, (r) => r.fulfill({ json: { check_id: id, events, last_id: events.length ? events[events.length - 1].id : 0 } }));
    await page.goto(`${base}?check=${id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) problems.add(`${w} ${name}: üfüqi daşma ${overflow}px`);
    await page.screenshot({ path: `${out}/run-${name}-${w}${theme === 'dark' ? '-dark' : ''}.png`, fullPage: true });
    await ctx.close();
  }
}
await browser.close();
console.log(problems.size ? [...problems].join('\n') : 'konsol təmizdir, daşma yoxdur');
