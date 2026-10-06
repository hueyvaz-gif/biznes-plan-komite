// Suallar və sənədlər (Faza 7): pipeline, siyahı/lövhə, optimistic status, redaktə, yükləmə, silmə + geri al, məktub.
// Bazanı dəyişən testlər sonda vəziyyəti geri qaytarır; qalanlarında API mock olunur.
import { test, expect } from '@playwright/test';

const CHECK = 'c1b49c3a9ba6';
const URL = `/?check=${CHECK}&tab=suallar`;
let econ;

test.beforeEach(async ({ request, page }) => {
  const res = await request.get(`/api/checks/${CHECK}/economics`);
  test.skip(!res.ok(), 'CFG v2 yoxlaması lokal bazada yoxdur');
  econ = await res.json();
  test.skip(!(econ.questions || []).length, 'sual yoxdur');
  // Görünüş seçimi testin əvvəlində bir dəfə sıfırlanır (reload-da yox — "yadda qalır" yoxlanılır).
  await page.addInitScript(() => {
    try { if (!sessionStorage.getItem('e2e-q')) { localStorage.removeItem('q-view'); sessionStorage.setItem('e2e-q', '1'); } } catch (_) {}
  });
});

async function open(page) {
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/status of 500/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await expect(page.locator('#q-lead')).not.toBeEmpty();
  return problems;
}

test('pipeline sayları statuslarla eyni; addım kliki süzür; ikinci klik süzgəci götürür', async ({ page }) => {
  const problems = await open(page);
  const n = (s) => econ.questions.filter((q) => q.status === s).length;
  await expect(page.locator('.qpipe__step--aciq .qpipe__n')).toHaveText(String(n('aciq')));
  await expect(page.locator('#q-lead')).toContainText(`${econ.questions.length} sualdan`);
  await expect(page.locator('#count-suallar')).toHaveText(String(econ.open_questions));
  await page.locator('.qpipe__step--aciq').click();
  await expect(page.locator('.qc')).toHaveCount(n('aciq'));
  await page.locator('.qpipe__step--aciq').click();
  await expect(page.locator('.qc')).toHaveCount(econ.questions.length);
  expect(problems).toEqual([]);
});

test('optimistic: status dərhal dəyişir; backend xətasında geri qayıdır və toast çıxır', async ({ page }) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/api/questions/*', async (route) => { await gate; await route.fulfill({ status: 500, json: { detail: 'test xətası' } }); });
  await open(page);
  const first = page.locator('.qc').first();
  const before = await first.getAttribute('data-status');
  await first.getByRole('radio', { name: 'Cavab gözlənilir' }).click();
  await expect(page.locator('.qc').first()).toHaveAttribute('data-status', 'cavab_gozlenilir');   // dərhal
  release();
  await expect(page.getByText('Status saxlanmadı: test xətası')).toBeVisible();
  await expect(page.locator('.qc').first()).toHaveAttribute('data-status', before);
});

test('status dəyişikliyi saxlanılır (reload-dan sonra) — sonda geri qaytarılır', async ({ page, request }) => {
  const q = econ.questions[0];
  try {
    await open(page);
    const card = page.locator(`#q-${q.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`);
    await card.getByRole('radio', { name: 'Cavab gözlənilir' }).click();
    await expect(card).toHaveAttribute('data-status', 'cavab_gozlenilir');
    await page.waitForResponse((r) => r.url().includes('/economics') && r.request().method() === 'GET');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator(`#q-${q.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`)).toHaveAttribute('data-status', 'cavab_gozlenilir');
  } finally {
    await request.patch(`/api/questions/${encodeURIComponent(q.id)}`, { data: { status: q.status } });
  }
});

test('lövhə: 5 sütun; klaviatura ilə (→) növbəti status; görünüş yadda qalır', async ({ page }) => {
  let body = null;
  let release;
  const gate = new Promise((r) => { release = r; });
  // Cavab gecikdirilir — optimistic mərhələ yoxlanılır (mock heç nə saxlamır, sonra real statusa qayıdır).
  await page.route('**/api/questions/*', async (route) => { body = route.request().postDataJSON(); await gate; await route.fulfill({ json: {} }); });
  await open(page);
  await page.getByRole('radio', { name: 'Lövhə' }).click();
  await expect(page.locator('.kb__col')).toHaveCount(5);
  const card = page.locator('.kb__col--aciq .kbc').first();
  const id = await card.getAttribute('data-id');
  await card.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(`.kb__col--cavab_gozlenilir .kbc[data-id="${id}"]`)).toBeVisible();
  await expect(page.locator(`.kb__col--cavab_gozlenilir .kbc[data-id="${id}"]`)).toBeFocused();
  expect(body).toEqual({ status: 'cavab_gozlenilir' });
  release();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.kb')).toBeVisible();
});

test('lövhə: sürükləyib atma statusu dəyişir', async ({ page }) => {
  let body = null;
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/api/questions/*', async (route) => { body = route.request().postDataJSON(); await gate; await route.fulfill({ json: {} }); });
  await open(page);
  await page.getByRole('radio', { name: 'Lövhə' }).click();
  const before = await page.locator('.kb__col--qebul .kbc').count();
  // HTML5 drag & drop: hadisələr DataTransfer ilə birbaşa (mouse simulyasiyası yük altında qeyri-sabitdir).
  await page.evaluate(() => {
    const card = document.querySelector('.kb__col--aciq .kbc');
    const col = document.querySelector('.kb__col--qebul');
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    col.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  });
  await expect(page.locator('.kb__col--qebul .kbc')).toHaveCount(before + 1);
  expect(body).toEqual({ status: 'qebul' });
  release();
});

test('redaktə: Esc ləğv edir, Ctrl+Enter saxlayır', async ({ page }) => {
  let body = null;
  await page.route('**/api/questions/*', async (route) => { body = route.request().postDataJSON(); await route.fulfill({ json: {} }); });
  await open(page);
  const card = page.locator('.qc').first();
  await card.getByRole('button', { name: 'Redaktə et' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.qc__edit')).toHaveCount(0);
  expect(body).toBeNull();
  await page.locator('.qc').first().getByRole('button', { name: 'Redaktə et' }).click();
  await page.keyboard.type(' Əlavə dəqiqləşdirmə.');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => body && body.text).toContain('Əlavə dəqiqləşdirmə.');
});

test('yükləmə: kartın üzərinə fayl → faiz → "yoxlanılır" (API mock)', async ({ page }) => {
  await page.route(`**/api/checks/${CHECK}/evidence`, async (route) => { await route.fulfill({ json: { id: 'Emock' } }); });
  await open(page);
  const card = page.locator('.qc').filter({ has: page.locator('.qdocs') }).first();
  const chooser = page.waitForEvent('filechooser');
  await card.getByRole('button', { name: 'seçin' }).click();
  await (await chooser).setFiles({ name: 'muqavile.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(page.getByText('“muqavile.pdf” yükləndi — yoxlanılır')).toBeVisible();
  await expect(page.locator('.qup__label').first()).toContainText('muqavile.pdf');
});

test('komitə sualı: silmə "Geri al" ilə ləğv olunur; sonra həqiqətən silinir', async ({ page, request }) => {
  const added = await (await request.post(`/api/checks/${CHECK}/questions`, { data: { text: 'E2E test sualı — silinəcək', documents: [] } })).json();
  try {
    await open(page);
    const sel = `#q-${added.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    await page.locator(sel).getByRole('button', { name: 'Sil' }).click();
    await expect(page.locator(sel)).toHaveCount(0);
    await page.getByRole('button', { name: 'Geri al' }).click();
    await expect(page.locator(sel)).toBeVisible();
    await page.locator(sel).getByRole('button', { name: 'Sil' }).click();
    await expect.poll(async () => (await (await request.get(`/api/checks/${CHECK}/economics`)).json()).questions.some((q) => q.id === added.id), { timeout: 10000 }).toBe(false);
  } finally {
    await request.delete(`/api/questions/${encodeURIComponent(added.id)}`);
  }
});

test('məktub: A4 önizləmə, sualları seçmək, .docx linki seçimə uyğun', async ({ page }) => {
  await open(page);
  await page.locator('#q-letter-btn').click();
  const dlg = page.getByRole('dialog', { name: 'Suallar məktubu — önizləmə' });
  await expect(dlg.locator('.letter__title')).toHaveText('BİZNES PLAN QİYMƏTLƏNDİRMƏ KOMİTƏSİ');
  const total = await dlg.locator('.letter__qs li').count();
  await dlg.locator('.letter__picks input').first().uncheck();
  await expect(dlg.locator('.letter__qs li')).toHaveCount(total - 1);
  const href = await dlg.getByRole('link', { name: 'Yüklə .docx' }).getAttribute('href');
  expect(href).toContain('/questions/letter.docx?ids=');
  const res = await page.request.get(href);
  expect(res.ok()).toBe(true);
  expect((await res.body()).subarray(0, 2).toString()).toBe('PK');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
});

test('375px: üfüqi scroll yoxdur; lövhə öz içində sürüşür', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.getByRole('radio', { name: 'Lövhə' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
