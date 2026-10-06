// UI skrinşotları: landing + bütün tablar, 5 endə, konsol xətaları və üfüqi daşma hesabatı ilə.
//
//   node scripts/ui-shots.mjs <çıxış-qovluğu> [--theme=dark] [--widths=1280,375] [--base=http://127.0.0.1:8010/]
//                             [--check=c1b49c3a9ba6] [--pages=kitchen-sink]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, '').split('=')));
const out = process.argv[2];
if (!out) { console.error('çıxış qovluğu lazımdır'); process.exit(2); }
mkdirSync(out, { recursive: true });

const base = args.base || 'http://127.0.0.1:8010/';
const check = args.check || 'c1b49c3a9ba6';
const widths = (args.widths || '1440,1280,974,768,375').split(',').map(Number);
const theme = args.theme || 'light';
const TABS = ['xulase', 'maliyye', 'iqtisadi', 'teleb', 'elave', 'bosyer', 'suallar', 'muqayise', 'agentler'];
const pages = args.pages
  ? args.pages.split(',').map((p) => [p, p === 'kitchen-sink' ? '?ui=kitchen-sink' : `?check=${check}&tab=${p}`])
  : [['landing', ''], ...TABS.map((t) => [t, `?check=${check}&tab=${t}`])];

const browser = await chromium.launch();
const problems = new Set();
for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme === 'dark' ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.add(`${w} ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.add(`${w} pageerror: ${e.message}`));
  for (const [name, query] of pages) {
    await page.goto(base + query, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    // İlk görünmədə animasiya olunan elementlər (qrafiklər) üçün səhifə sona qədər sürüşdürülür, sonra yuxarı qayıdır.
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
      scrollTo(0, 0);
    });
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) problems.add(`${w} ${name}: üfüqi daşma ${overflow}px`);
    await page.screenshot({ path: `${out}/${name}-${w}${theme === 'dark' ? '-dark' : ''}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log(problems.size ? [...problems].join('\n') : 'konsol təmizdir, daşma yoxdur');
