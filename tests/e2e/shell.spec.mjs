// Qabıq (Faza 2): Verdict Hero, tablar, qısayollar, Ctrl+K, sidebar rail/drawer, CLS, a11y.
// Məlumat: CFG v2 yoxlaması (c1b49c3a9ba6) — lokal bazada olmalıdır; yoxdursa testlər ötürülür.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const CHECK = 'c1b49c3a9ba6';
const url = (tab, extra = '') => `/?check=${CHECK}${tab ? `&tab=${tab}` : ''}${extra}`;

test.beforeEach(async ({ request }) => {
  const res = await request.get(`/api/checks/${CHECK}`);
  test.skip(!res.ok(), 'CFG v2 yoxlaması lokal bazada yoxdur');
});

async function open(page, tab, extra) {
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(url(tab, extra), { waitUntil: 'networkidle' });
  await expect(page.locator('#res-plan')).not.toBeEmpty();
  return problems;
}

const TABS = ['xulase', 'duzelis', 'maliyye', 'iqtisadi', 'teleb', 'bosyer', 'suallar', 'elave', 'muqayise'];
async function chooseTab(page, id, name) {
  if (await page.locator('#tab-' + id).isVisible()) await page.locator('#tab-' + id).click();
  else {
    await page.locator('#tabs-more').click();
    await page.locator('#tabs-menu').getByRole('menuitemradio', { name: new RegExp('^' + name) }).click();
  }
}
for (const tab of TABS) {
  test(`?tab=${tab} açılır, konsol təmizdir`, async ({ page }) => {
    const problems = await open(page, tab);
    await expect(page.locator(`#panel-${tab}`)).toBeVisible();
    expect(problems).toEqual([]);
  });
}

test('köhnə ?tab=agentler linki Texniki jurnalı açır; debug olmadan tab gizlidir', async ({ page }) => {
  await open(page, 'agentler');
  await expect(page.locator('#panel-agentler')).toBeVisible();
  await page.goto(url('xulase'), { waitUntil: 'networkidle' });
  await expect(page.locator('#tab-agentler')).toBeHidden();
  await page.locator('#tabs-more').click();
  await expect(page.locator('#tabs-menu')).not.toContainText('Texniki jurnal');
  await expect(page.locator('#tabs-menu')).toContainText('Müqayisə');
});

test('hero: rəqəmlər API-dən; bloklar müvafiq taba aparır', async ({ page, request }) => {
  const check = await (await request.get(`/api/checks/${CHECK}`)).json();
  const econ = await (await request.get(`/api/checks/${CHECK}/economics`)).json();
  await open(page, 'xulase');
  // Report.reqCounts qaydası: "planın mətnində yoxlanılan" = ayrıca sənəd (sened) xaric hamısı.
  const items = check.result.compliance.items.filter((i) => (i.origin || 'standart') === 'standart' && i.status !== 'sened');
  const answered = items.filter((i) => i.status === 'var').length;
  await expect(page.locator('#hero-ready-sub')).toContainText(`${answered}/${items.length}`);
  await expect(page.locator('#hero-risk-q')).toHaveText(`${econ.open_questions} açıq sual`);
  await expect(page.locator('#hero-risk-level')).toHaveText(econ.result.risk.label.toLocaleUpperCase('az'));
  await page.locator('[data-hero-goto="panel-iqtisadi"]').click();
  await expect(page).toHaveURL(/tab=iqtisadi/);
  await page.locator('#tab-xulase').click();
  await page.locator('[data-hero-goto="panel-teleb"]').click();
  await expect(page).toHaveURL(/tab=teleb/);
});

test('tab nişanı ilə panel daxilindəki say eynidir (Maliyyə, Boş yerlər)', async ({ page }) => {
  await open(page, 'maliyye');
  const fin = await page.locator('#count-maliyye').textContent();
  const chip = await page.locator('[data-fin="problem"] .count, [data-fin="problem"] span').last().textContent().catch(() => null);
  if (chip !== null) expect(chip.trim()).toBe(fin.trim());
  const holes = await page.locator('#count-bosyer').textContent();
  await chooseTab(page, 'bosyer', 'Boş yerlər');
  await expect(page.locator('#ph-list .phcard')).toHaveCount(Number(holes));
});

test('Ctrl+K → "TS2" → Enter: Tələblər tabı, TS2 sətri fokusda və vurğulanır', async ({ page }) => {
  await open(page, 'xulase');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('TS2');
  await expect(page.locator('.pal__opt.is-active .pal__code')).toHaveText('TS2');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/tab=teleb/);
  const row = page.locator('.reqrow[data-code="TS2"]');
  await expect(row).toBeFocused();
  await expect(row).toHaveClass(/is-flash/);
});

test('qısayollar: 1–5, g n, ?; yazı sahəsində işləmir', async ({ page }) => {
  await open(page, 'xulase');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('4');
  await expect(page).toHaveURL(/tab=iqtisadi/);
  await chooseTab(page, 'teleb', 'Standart tələblər');
  await page.locator('#req-search').fill('');
  await page.locator('#req-search').press('2');
  await expect(page).toHaveURL(/tab=teleb/);                     // input-da "2" yazılır, tab dəyişmir
  await page.locator('#req-search').fill('');
  await page.locator('#tab-teleb').focus();
  await page.keyboard.press('g');
  await page.keyboard.press('n');
  await expect(page).toHaveURL(/tab=xulase/);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Klaviatura qısayolları' })).toBeVisible();
});

test('aktiv tab indikatoru aktiv tabın altındadır', async ({ page }) => {
  await open(page, 'iqtisadi');
  await page.waitForTimeout(300);
  const [ind, tab] = await Promise.all([page.locator('#tabs-ind').boundingBox(), page.locator('#tab-iqtisadi').boundingBox()]);
  expect(Math.abs(ind.x - tab.x)).toBeLessThan(2);
  expect(Math.abs(ind.width - tab.width)).toBeLessThan(2);
});

test('scroll → kompakt zolaq; CLS < 0,05 (yükləmə, scroll, tab keçidi)', async ({ page }) => {
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  });
  await open(page, 'maliyye');
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(30); }
  await expect(page.locator('#view-results')).toHaveClass(/is-compact/);
  await expect(page.locator('#herobar')).toBeInViewport();
  for (const t of ['tab-duzelis', 'tab-suallar', 'tab-maliyye']) await page.locator('#' + t).click();
  expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.05);
});

test('rail (974px): ikon zolağı, "Planlar" paneli açır, Esc bağlayır', async ({ page }) => {
  await page.setViewportSize({ width: 974, height: 800 });
  await open(page, 'xulase');
  expect((await page.locator('#sidebar').boundingBox()).width).toBeLessThan(80);
  await page.locator('#nav-history').click();
  await expect(page.locator('#sidebar')).toHaveClass(/is-open/);
  await expect(page.locator('#history')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sidebar')).not.toHaveClass(/is-open/);
});

test('375px: üfüqi scroll yoxdur, bütün əsas tablara keçmək olur', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page, 'xulase');
  for (const t of ['duzelis', 'maliyye', 'iqtisadi', 'suallar']) {
    await page.locator('#tab-' + t).click();
    await expect(page).toHaveURL(new RegExp('tab=' + t));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }
});

test('reduced-motion: panel keçid animasiyası yoxdur', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'xulase');
  await page.locator('#tab-maliyye').click();
  await expect(page.locator('#panel-maliyye')).not.toHaveClass(/is-entering/);
});

for (const scheme of ['light', 'dark']) {
  test(`axe: Nəticə və Maliyyə tabları (${scheme}) — kritik/ciddi yoxdur`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const t of ['xulase', 'maliyye']) {
      await open(page, t);
      // Köhnə görünüşlər hələ yenidən işlənməyib (Faza 3–8): yalnız qabıq yoxlanılır.
      const result = await new AxeBuilder({ page }).include('#reshead').include('.tabsbar').include('#sidebar').include('.topbar').analyze();
      const bad = result.violations.filter((v) => ['critical', 'serious'].includes(v.impact));
      expect(bad.map((v) => `${t}: ${v.id} → ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
    }
  });
}

test('başlıq ierarxiyası: səhifədə ilk başlıq h1-dir', async ({ page }) => {
  await open(page, 'xulase');
  const first = await page.evaluate(() => [...document.querySelectorAll('h1, h2, h3')].find((h) => h.offsetParent !== null || h.closest('.sr-only'))?.tagName);
  expect(first).toBe('H1');
});
