// Faza 5: Tələblər tabı, sənəd görüntüsü drawer-i (mini-xəritə, [ ] naviqasiyası), Boş yerlər tabı.
import { test, expect } from '@playwright/test';

const CHECK = 'c1b49c3a9ba6';
const url = (tab) => `/?check=${CHECK}&tab=${tab}`;

test.beforeEach(async ({ request }) => {
  const res = await request.get(`/api/checks/${CHECK}`);
  test.skip(!res.ok(), 'CFG v2 yoxlaması lokal bazada yoxdur');
});

async function open(page, tab) {
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(url(tab), { waitUntil: 'networkidle' });
  return problems;
}

/* ── Tələblər ───────────────────────────────────────────────────────────── */
test('tələblər: süzgəc sayları, tab nişanı və siyahı eyni mənbədən', async ({ page, request }) => {
  const problems = await open(page, 'teleb');
  const check = await (await request.get(`/api/checks/${CHECK}`)).json();
  const std = check.result.compliance.items.filter((i) => (i.origin || 'standart') === 'standart');
  const prob = std.filter((i) => ['natamam', 'yoxdur'].includes(i.status)).length;
  await expect(page.locator('[data-req="hamisi"] .ui-chip__count')).toHaveText(String(std.length));
  await expect(page.locator('[data-req="problem"] .ui-chip__count')).toHaveText(String(prob));
  await page.locator('[data-req="problem"]').click();
  await expect(page.locator('.reqrow')).toHaveCount(prob);
  await expect(page.locator('#req-count')).toHaveText(`${std.length}-dən ${prob} nəticə`);
  expect(problems).toEqual([]);
});

test('tələblər: problemli qruplar açıq, tam qruplar yığılı; kafel kliki qrupa süzür', async ({ page }) => {
  await open(page, 'teleb');
  await expect(page.locator('#reqgroup-tesebbuskar .reqgrp__head')).toHaveAttribute('aria-expanded', 'true');
  const full = page.locator('.reqgrp:not(.is-open)').first();
  await expect(full.locator('.reqgrp__head')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#req-map .reqtile')).toHaveCount(await page.locator('.reqgrp').count());
  await page.locator('#req-map .reqtile').first().click();
  await expect(page.locator('.reqgrp')).toHaveCount(1);
  await expect(page.locator('#req-map .reqtile').first()).toHaveAttribute('aria-pressed', 'true');
});

test('tələblər: axtarış (debounce) uyğun mətni <mark> ilə vurğulayır, canlı say', async ({ page }) => {
  await open(page, 'teleb');
  await page.locator('#req-search').fill('VÖEN');
  await expect(page.locator('#req-count')).toContainText('nəticə');
  await expect(page.locator('.reqhit').first()).toHaveText(/VÖEN/i);
  await expect(page.locator('#req-count')).toHaveAttribute('aria-live', 'polite');
});

test('tələblər: xam [MƏLUMAT LAZIMDIR] və "placeholder" sözü göstərilmir', async ({ page }) => {
  await open(page, 'teleb');
  await expect(page.locator('#req-groups')).not.toContainText('[MƏLUMAT LAZIMDIR');
  await expect(page.locator('#req-groups')).not.toContainText(/placeholder/i);
  await expect(page.locator('#req-groups .ui-phpill').first()).toBeVisible();
});

test('tələblər: sətir yerində açılır — sitat, "Sənəddə yeri" sənəd görüntüsünü açır', async ({ page }) => {
  await open(page, 'teleb');
  const row = page.locator('.reqrow[data-code="TS2"]');
  await row.locator('.reqrow__head').click();
  await expect(row.locator('.reqrow__head')).toHaveAttribute('aria-expanded', 'true');
  await expect(row.locator('.ui-quote')).toBeVisible();
  await row.locator('.ui-quote__section').click();
  const drawer = page.locator('dialog.ui-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.ui-drawer__title')).toContainText('TS2');
  await expect(drawer.locator('.dv-hit.is-current')).toBeInViewport();
});

/* ── Sənəd görüntüsü ────────────────────────────────────────────────────── */
test('sənəd görüntüsü: mini-xəritə, [ ] ilə keçid, Esc fokusu qaytarır, sitatların çoxu tapılır', async ({ page }) => {
  await open(page, 'xulase');
  const opener = page.locator('.fixc__where').first();
  await opener.click();
  const drawer = page.locator('dialog.ui-drawer');
  await expect(drawer.locator('.dv-counter')).toHaveText(/\d+ \/ \d+/);
  const [cur, total] = (await drawer.locator('.dv-counter').textContent()).split(' / ').map(Number);
  await expect(drawer.locator('.dv-mapdot')).toHaveCount(total);
  await page.keyboard.press(']');
  await expect(drawer.locator('.dv-counter')).toHaveText(`${cur + 1} / ${total}`);
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  await expect(drawer.locator('.dv-counter')).toHaveText(`${cur - 1} / ${total}`);
  await drawer.locator('.dv-mapdot').nth(0).click();
  await expect(drawer.locator('.dv-counter')).toHaveText(`1 / ${total}`);
  const fallbacks = Number(await drawer.locator('.dv').getAttribute('data-fallbacks'));
  expect(fallbacks / total).toBeLessThan(0.1);                       // hərfi sitatların 90%+ mətndə tapılır
  await expect(drawer.locator('.dv-hit--hole').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
});

/* ── Boş yerlər ─────────────────────────────────────────────────────────── */
test('boş yerlər: kartlar insan dilində, mini-xəritədə hər biri; "Sənəddə göstər" drawer-i boş yerdə açır', async ({ page, request }) => {
  const problems = await open(page, 'bosyer');
  const check = await (await request.get(`/api/checks/${CHECK}`)).json();
  const n = check.result.ingest.placeholders.length;
  await expect(page.locator('.phcard')).toHaveCount(n);
  await expect(page.locator('.phmap__mark')).toHaveCount(n);
  await expect(page.locator('.phcard__title').first()).not.toContainText('[');
  await expect(page.locator('.phcard').first().locator('.phmark')).toBeVisible();
  await expect(page.locator('#panel-bosyer')).not.toContainText('paraqraf');
  await page.locator('.phmap__mark').nth(2).click();
  await expect(page.locator('#ph-2')).toBeFocused();
  await page.locator('#ph-0 .phcard__go').click();
  const drawer = page.locator('dialog.ui-drawer');
  await expect(drawer.locator('.dv-hit--hole.is-current')).toBeInViewport();
  expect(problems).toEqual([]);
});

test('375px: Tələblər və Boş yerlərdə üfüqi scroll yoxdur', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const tab of ['teleb', 'bosyer']) {
    await open(page, tab);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }
});
