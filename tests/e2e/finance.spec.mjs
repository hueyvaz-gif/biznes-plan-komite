// Maliyyə tabı (Faza 4): terminologiya, KPI, cədvəl (sətir açılır, sticky başlıq), pul axını qrafiki, maliyyələşmə.
import { test, expect } from '@playwright/test';

const CHECK = 'c1b49c3a9ba6';
const URL = `/?check=${CHECK}&tab=maliyye`;

test.beforeEach(async ({ request }) => {
  const res = await request.get(`/api/checks/${CHECK}`);
  test.skip(!res.ok(), 'CFG v2 yoxlaması lokal bazada yoxdur');
});

async function open(page) {
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await expect(page.locator('#fin-lead')).not.toBeEmpty();
  return problems;
}

test('terminologiya: "Xəbərdarlıq" yoxdur; Nəticə və Maliyyə tablarında eyni etiket', async ({ page }) => {
  const problems = await open(page);
  await expect(page.locator('#panel-maliyye')).not.toContainText('Xəbərdarlıq');
  await expect(page.locator('#frow-menbeler_cemi')).toContainText('Dəqiqləşdirmə');
  await page.locator('#tab-xulase').click();
  await expect(page.locator('#finsum-host tr', { hasText: 'Maliyyələşmə mənbələrinin' })).toContainText('Dəqiqləşdirmə');
  expect(problems).toEqual([]);
});

test('nəticə cümləsi və süzgəc sayları cədvəllə eynidir', async ({ page }) => {
  await open(page);
  const rows = await page.locator('.frow').count();
  await expect(page.locator('#fin-lead')).toContainText(`${rows} maliyyə yoxlamasından`);
  await expect(page.locator('[data-fin="hamisi"] .ui-chip__count')).toHaveText(String(rows));
  await page.locator('[data-fin="problem"]').click();
  const problems = await page.locator('.frow').count();
  await expect(page.locator('[data-fin="problem"] .ui-chip__count')).toHaveText(String(problems));
  await expect(page.locator('#count-maliyye')).toHaveText(String(problems));      // tab nişanı ilə eyni
});

test('FCFF düsturu: "Düstur düzgündür", mənasız "−1 ₼" yoxdur', async ({ page }) => {
  await open(page);
  const row = page.locator('#frow-fcff_dusturu');
  await expect(row).toContainText('Düstur düzgündür');
  await expect(row).toContainText('yuvarlaqlaşdırma fərqi 1');
});

test('sətir yerində açılır: izah, sitat, qayda sonda; inert götürülür', async ({ page }) => {
  await open(page);
  const btn = page.locator('#frow-investisiya_cemi .fintbl__more');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const det = page.locator('#fdet-investisiya_cemi');
  await expect(det).toContainText('Necə hesablanıb');
  await expect(det.locator('.ui-quote').first()).toBeVisible();
  await expect(det.locator('.fdet__rule')).toContainText('Qayda');
  await btn.click();
  await expect(det.locator('.fdet__inner')).toHaveAttribute('inert', '');
});

test('KPI kliki sətri açır və vurğulayır', async ({ page }) => {
  await open(page);
  await expect(page.locator('#fin-kpis .ui-tile')).toHaveCount(4);
  await page.locator('#fin-kpis .ui-tile', { hasText: 'NPV' }).click();
  await expect(page.locator('#frow-npv .fintbl__more')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#frow-npv')).toHaveClass(/is-flash/);
});

test('Nəticə tabındakı "Ətraflı" Maliyyə tabında sətri açır', async ({ page }) => {
  await page.goto(`/?check=${CHECK}&tab=xulase`, { waitUntil: 'networkidle' });
  await page.locator('#finsum-host tr', { hasText: 'Daxili rentabellik' }).getByRole('button').click();
  await expect(page).toHaveURL(/tab=maliyye/);
  await expect(page.locator('#frow-irr .fintbl__more')).toHaveAttribute('aria-expanded', 'true');
});

test('sticky: cədvəl başlığı filtr zolağının altında qalır (örtülmür)', async ({ page }) => {
  await open(page);
  // Cədvəlin başı ekrandan yuxarıda, ortası görünür — başlıq sticky olmalıdır (kompakt rejimdə də).
  await page.evaluate(() => { const t = document.querySelector('.fintbl'); scrollTo(0, t.getBoundingClientRect().top + scrollY - 40); });
  await page.waitForTimeout(500);
  await expect(page.locator('#view-results')).toHaveClass(/is-compact/);
  const [filters, th] = await Promise.all([
    page.locator('#panel-maliyye .stickyrow').boundingBox(), page.locator('.fintbl thead th').first().boundingBox()]);
  expect(th.y).toBeGreaterThanOrEqual(filters.y + filters.height - 2);
  expect(th.y).toBeLessThan(filters.y + filters.height + 4);             // filtrə yapışıb, arada boşluq yoxdur
});

test('pul axını: qalıq dəyər ayrıca seqment, payback markeri, hover və klaviatura tooltip-i', async ({ page }) => {
  await open(page);
  const fig = page.locator('.cfc__fig');
  await fig.scrollIntoViewIfNeeded();
  await expect(page.locator('.cfc__res')).toHaveCount(1);
  await expect(page.locator('.cfc__pptext')).toContainText('Özünü ödəmə · 2034');
  const hits = page.locator('.cfc__hit');
  await hits.nth(10).hover();
  const tip = page.locator('.cfc__tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('2037');
  await expect(tip).toContainText('qalıq dəyər');
  await expect(tip).toContainText('Kumulyativ');
  await expect(tip).toContainText('Diskontlaşdırılmış');
  await fig.focus();
  await page.keyboard.press('Home');
  await expect(tip).toContainText('2027');
  await page.keyboard.press('ArrowRight');
  await expect(tip).toContainText('2028');
  await expect(fig).toHaveAttribute('role', 'img');
  expect((await fig.getAttribute('aria-label')).length).toBeGreaterThan(40);
});

test('"Cədvəl kimi göstər": pul axını cədvəli 11 il', async ({ page }) => {
  await open(page);
  const card = page.locator('#fin-cashflow');
  await card.getByRole('button', { name: 'Cədvəl kimi göstər' }).click();
  await expect(card.locator('.ui-dtable tbody tr')).toHaveCount(11);
});

test('maliyyələşmə: donut mərkəzində cəmi, investisiya ↔ mənbələr fərqi backend-dən', async ({ page, request }) => {
  const check = await (await request.get(`/api/checks/${CHECK}`)).json();
  const diff = check.result.finance.checks.find((c) => c.id === 'menbeler_cemi').diff;
  await open(page);
  await expect(page.locator('.cfd__cvalue').first()).toContainText('16,76');
  const expected = new Intl.NumberFormat('en-US').format(Math.round(diff)).replace(/,/g, ' ');
  await expect(page.locator('.cfg__note strong')).toContainText(expected);
});

for (const w of [974, 768, 375]) {
  test(`${w}px: üfüqi daşma yoxdur, "Ətraflı" kartın içindədir`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const [btn, list] = await Promise.all([page.locator('#frow-menbeler_cemi .fintbl__more').boundingBox(), page.locator('#fin-list').boundingBox()]);
    expect(btn.x + btn.width).toBeLessThanOrEqual(list.x + list.width + 1);
  });
}

test('reduced-motion: qrafik animasiyası yoxdur', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.locator('.cfc__fig').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await expect(page.locator('.cfc')).not.toHaveClass(/is-animating/);
});
