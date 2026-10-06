// Nəticə tabı (Faza 3): cümlə, göstəricilər, düzəliş checklist-i, ayrıca sənədlər, maliyyə xülasəsi.
// Sənəd yükləmə API-si mock olunur — lokal bazaya heç nə yazılmır.
import { test, expect } from '@playwright/test';

const CHECK = 'c1b49c3a9ba6';
const URL = `/?check=${CHECK}&tab=xulase`;

test.beforeEach(async ({ request, page }) => {
  const res = await request.get(`/api/checks/${CHECK}`);
  test.skip(!res.ok(), 'CFG v2 yoxlaması lokal bazada yoxdur');
  // Checklist yaddaşı testin əvvəlində bir dəfə təmizlənir (reload-da yox).
  await page.addInitScript(() => {
    try { if (!sessionStorage.getItem('e2e-clean')) { localStorage.removeItem('fixdone:c1b49c3a9ba6'); sessionStorage.setItem('e2e-clean', '1'); } } catch (_) {}
  });
});

async function open(page) {
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await expect(page.locator('#sum-sentence')).not.toBeEmpty();
  return problems;
}

test('bir cümləlik nəticə: say düzəliş siyahısı ilə eynidir', async ({ page }) => {
  const problems = await open(page);
  const cards = await page.locator('.fixc.fixc--duzelis, .fixc.fixc--kritik').count();
  await expect(page.locator('#sum-sentence')).toContainText(`Plan təqdimata ${cards} düzəlişdən sonra hazır olacaq.`);
  await expect(page.locator('#sum-sentence')).toContainText('Ən vacibi:');
  expect(problems).toEqual([]);
});

test('göstəricilər: klik müvafiq taba və filtrə aparır', async ({ page }) => {
  await open(page);
  await page.locator('#sum-tiles .ui-tile', { hasText: 'Maliyyə' }).click();
  await expect(page).toHaveURL(/tab=maliyye/);
  await expect(page.locator('[data-fin="problem"]')).toHaveAttribute('aria-pressed', 'true');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('#sum-tiles .ui-tile', { hasText: 'Tələblər' }).click();
  await expect(page).toHaveURL(/tab=teleb/);
  await expect(page.locator('[data-req="problem"]')).toHaveAttribute('aria-pressed', 'true');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('#sum-tiles .ui-tile', { hasText: 'Boş yerlər' }).click();
  await expect(page).toHaveURL(/tab=bosyer/);
});

test('checklist: işarə sayğacı yeniləyir və səhifə yenilənəndən sonra qalır', async ({ page }) => {
  await open(page);
  const total = await page.locator('.fixc').count();
  await expect(page.locator('#fix-progress-text')).toHaveText(`0/${total} işarələnib`);
  await page.locator('.fixc__cb').nth(0).check();
  await page.locator('.fixc__cb').nth(2).check();
  await expect(page.locator('#fix-progress-text')).toHaveText(`2/${total} işarələnib`);
  await expect(page.locator('.fixc').nth(0)).toHaveClass(/is-done/);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#fix-progress-text')).toHaveText(`2/${total} işarələnib`);
  await expect(page.locator('.fixc__cb').nth(2)).toBeChecked();
  // İşarə statusu dəyişmir: hero və tab nişanı eyni qalır.
  await expect(page.locator('#res-status-label')).toHaveText('Düzəliş lazımdır');
});

test('"Daha N bənd göstər": gizli kartlar açılır, inert götürülür', async ({ page }) => {
  await open(page);
  const toggle = page.locator('#fixes-toggle');
  await expect(toggle).toHaveText(/Daha \d+ bənd göstər/);
  await expect(page.locator('#fixes-more')).toHaveAttribute('inert', '');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#fixes-more')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#fixes-more .fixc').first()).toBeVisible();
});

test('boş vəziyyət mətnləri məzmun olanda DOM-da yoxdur', async ({ page }) => {
  await open(page);
  await expect(page.getByText('Düzəliş tələb edən bənd tapılmadı')).toHaveCount(0);
  await expect(page.getByText('Maliyyə yoxlaması aparılmayıb')).toHaveCount(0);
  await expect(page.locator('#about-result')).not.toContainText('əvvəl:');
});

test('FCFF düsturu rəqəm yox, "düzgündür" kimi göstərilir', async ({ page }) => {
  await open(page);
  const row = page.locator('#finsum-host tr', { hasText: 'FCFF' });
  await expect(row).toContainText('düzgündür');
  await expect(row).not.toContainText('−1');
});

test('"Yoxlama haqqında" default yığılıdır, keçid onu açır', async ({ page }) => {
  await open(page);
  await expect(page.locator('#about-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#about-link').click();
  await expect(page.locator('#about-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#scope-list')).toBeVisible();
});

test('ayrıca sənəd: yükləmə → "yoxlanılır" → nəticə inline (API mock)', async ({ page }) => {
  let uploaded = false;
  const real = await (await page.request.get(`/api/checks/${CHECK}/economics`)).json();
  await page.route(`**/api/checks/${CHECK}/evidence`, async (route) => {
    uploaded = true;
    await route.fulfill({ json: { id: 'Emock', req_code: 'LT3', file_name: 'hs.xlsx', analysis: { state: 'isleyir' } } });
  });
  let calls = 0;
  await page.route(`**/api/checks/${CHECK}/economics`, async (route) => {
    if (route.request().method() !== 'GET' || !uploaded) return route.continue();
    calls++;
    const state = calls === 1 ? 'isleyir' : 'tamamlandi';
    const ev = { id: 'Emock', req_code: 'LT3', file_name: 'hs.xlsx', kind: 'excel',
      analysis: state === 'isleyir' ? { state } : { state, checks: [{ title: 'HS kodları', detail: '', status: 'ok' }] } };
    await route.fulfill({ json: { ...real, evidence: [...(real.evidence || []), ev] } });
  });
  await open(page);
  const item = page.locator('.docitem[data-code="LT3"]');
  await expect(item).toContainText('Gözlənilir');
  const chooser = page.waitForEvent('filechooser');
  await item.getByRole('button', { name: 'Yüklə' }).click();
  await (await chooser).setFiles({ name: 'hs.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await expect(item).toContainText('hs.xlsx');
  await expect(item).toHaveClass(/docitem--done/, { timeout: 8000 });
  await expect(item).toContainText('uyğundur');
  await expect(page.locator('#docs-progress')).toContainText('1/');
});

test('375px: düzəliş kartları tək sütun, üfüqi scroll yoxdur', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const cols = await page.locator('.fixc__cols').first().evaluate((n) => getComputedStyle(n).gridTemplateColumns.split(' ').length);
  expect(cols).toBe(1);
});
