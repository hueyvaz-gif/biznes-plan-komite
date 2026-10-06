// Komponent kitabxanası: davranış, a11y (axe) və vizual reqressiya (açıq + tünd, 1280 və 375px).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const URL = '/?ui=kitchen-sink';

function collectConsole(page) {
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

test('konsolda xəta və xəbərdarlıq yoxdur', async ({ page }) => {
  const problems = collectConsole(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await expect(page.locator('#ks-table .ui-dtable').first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('FilterChips: klik və ox düymələri, aria-pressed', async ({ page }) => {
  await page.goto(URL);
  const group = page.getByRole('group', { name: 'Tələb filtri' });
  await group.getByRole('button', { name: /Problemlilər/ }).click();
  await expect(group.getByRole('button', { name: /Problemlilər/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Seçim: problem')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('button', { name: /Yoxdur/ })).toBeFocused();
});

test('Segmented: radiogroup, ox düyməsi seçimi dəyişir', async ({ page }) => {
  await page.goto(URL);
  const seg = page.getByRole('radiogroup', { name: 'Sualın statusu' });
  await seg.getByRole('radio', { name: 'Açıq' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(seg.getByRole('radio', { name: 'Cavab gözlənilir' })).toHaveAttribute('aria-checked', 'true');
  await expect(seg.getByRole('radio', { name: 'Açıq' })).toHaveAttribute('aria-checked', 'false');
});

test('Disclosure: aria-expanded və inert məzmun', async ({ page }) => {
  await page.goto(URL);
  const btn = page.getByRole('button', { name: 'Necə hesablanıb' });
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Hər ilin satış gəliri 10% azaldılır.')).toBeVisible();
});

test('SourceQuote: uzun sitatda "daha çox" açır', async ({ page }) => {
  await page.goto(URL);
  const more = page.locator('#ks-quote .ui-quote__more').first();
  await expect(more).toBeVisible();
  await more.click();
  await expect(more).toHaveText('daha az');
  await expect(page.locator('#ks-quote .ui-quote__more').nth(1)).toBeHidden();   // qısa sitat
});

test('Drawer: açılır, fokus tələsi, Esc bağlayır və fokus açan düyməyə qayıdır', async ({ page }) => {
  await page.goto(URL);
  const opener = page.getByRole('button', { name: 'Sənəd görüntüsünü aç' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '7.1. İnvestisiyanın həcmi' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('Toast: görünür, "Geri al" işləyir', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: 'Uğur' }).click();
  await expect(page.getByText('Sual əlavə edildi')).toBeVisible();
  await page.getByRole('button', { name: 'Geri al' }).click();
  await expect(page.getByText('Geri alındı')).toBeVisible();
});

test('Tooltip: fokusda görünür, aria-describedby bağlıdır, Esc gizlədir', async ({ page }) => {
  await page.goto(URL);
  const abbr = page.locator('#ks-overlay abbr');
  await abbr.focus();
  const tip = page.getByRole('tooltip');
  await expect(tip).toHaveText('FCFF — firmaya sərbəst pul axını');
  await expect(abbr).toHaveAttribute('aria-describedby', await tip.getAttribute('id'));
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
});

test('Tema keçidi: tünd seçimi saxlanılır', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('radio', { name: 'Tünd' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: 'Avto' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('reduced-motion: count-up yoxdur, dəyər dərhal sondur', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(URL);
  await expect(page.locator('#ks-tiles .ui-tile__num').first()).toHaveText('6/7');
});

for (const scheme of ['light', 'dark']) {
  test(`axe: kritik/ciddi pozuntu yoxdur (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto(URL, { waitUntil: 'networkidle' });
    const result = await new AxeBuilder({ page }).analyze();
    const bad = result.violations.filter((v) => ['critical', 'serious'].includes(v.impact));
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
  });

  for (const width of [1280, 375]) {
    test(`vizual: kitchen-sink ${scheme} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(URL, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await expect(page).toHaveScreenshot(`kitchen-sink-${scheme}-${width}.png`, { fullPage: true });
    });
  }
}
