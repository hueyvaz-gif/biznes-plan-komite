// Müqayisə, Əlavə tələblər, Texniki jurnal (Faza 8).
import { test, expect } from '@playwright/test';

const CHECK = 'c1b49c3a9ba6';
let check;

test.beforeEach(async ({ request }) => {
  const res = await request.get(`/api/checks/${CHECK}`);
  test.skip(!res.ok(), 'CFG v2 yoxlaması lokal bazada yoxdur');
  check = await res.json();
});

function watch(page) {
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

test('müqayisə: statuslar cari qaydalarla (API ilə eyni), xülasə və plitələr bir mənbədən', async ({ page, request }) => {
  const problems = watch(page);
  const versions = (await (await request.get(`/api/plans/${check.plan_id}/checks`)).json()).filter((v) => v.run_state === 'tamamlandi');
  test.skip(versions.length < 2, 'ikinci versiya yoxdur');
  const prev = versions.filter((v) => v.version < check.version).sort((a, b) => b.version - a.version)[0];
  const api = await (await request.get(`/api/checks/${CHECK}/compare?with=${prev.id}`)).json();
  // Cari verdict-lər — saxlanmış (köhnəlmiş) müqayisədən yox
  expect(api.verdict).toEqual({ before: prev.verdict, after: check.verdict });

  await page.goto(`/?check=${CHECK}&tab=muqayise`, { waitUntil: 'networkidle' });
  const body = page.locator('#cmp-body');
  await expect(body.locator('.sumv__sentence')).toHaveText(`v${check.version}-də ${api.counts.yaxsilasdi} bənd yaxşılaşıb, ${api.counts.pislesdi} bənd pisləşib; boş yerlər ${api.placeholders.before}-dan ${api.placeholders.after}-a enib.`);
  await expect(body.locator('.ui-tile').filter({ hasText: 'Boş yer' }).first()).toContainText(`${api.placeholders.before} → ${api.placeholders.after}`);
  const verdicts = body.locator('.cmpv__status .ui-badge');
  await expect(verdicts).toHaveCount(2);
  const reqCount = await body.locator('.cmpv__sec').filter({ hasText: 'Tələblərin statusu' }).locator('.diff__row').count();
  expect(reqCount).toBe(api.requirements.length);
  // Köhnə dəyər üstüxətli
  await expect(body.locator('del.diff__old').first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('müqayisə: versiya seçicisi — digər tərəfdəki versiya bağlıdır, dəyişiklik yenidən hesablayır', async ({ page, request }) => {
  const versions = (await (await request.get(`/api/plans/${check.plan_id}/checks`)).json()).filter((v) => v.run_state === 'tamamlandi');
  test.skip(versions.length < 2, 'ikinci versiya yoxdur');
  await page.goto(`/?check=${CHECK}&tab=muqayise`, { waitUntil: 'networkidle' });
  const from = page.locator('#cmp-from');
  const to = page.locator('#cmp-to');
  await expect(from).toBeVisible();
  const fromVal = await from.inputValue();
  const toVal = await to.inputValue();
  await expect(from.locator(`option[value="${toVal}"]`)).toBeDisabled();
  await expect(to.locator(`option[value="${fromVal}"]`)).toBeDisabled();
  const third = versions.find((v) => v.id !== fromVal && v.id !== toVal);
  test.skip(!third, 'üçüncü versiya yoxdur — seçim dəyişikliyi yoxlanmır');
  const wait = page.waitForResponse((r) => r.url().includes('/compare?with='));
  await from.selectOption(third.id);
  await wait;
  const ids = [await page.locator('#cmp-from').inputValue(), await page.locator('#cmp-to').inputValue()];
  expect(ids.sort()).toEqual([third.id, toVal].sort());
});

test('müqayisə: boş yer doldurulubsa "Yeni mətnə bax" sənəd görüntüsünü açır', async ({ page }) => {
  await page.goto(`/?check=${CHECK}&tab=muqayise`, { waitUntil: 'networkidle' });
  const btn = page.getByRole('button', { name: 'Yeni mətnə bax' }).first();
  test.skip(!(await btn.count()), 'doldurulmuş boş yer yoxdur');
  await btn.click();
  await expect(page.locator('dialog[open] .dv-scroll')).toBeVisible();
});

test('müqayisə: tək versiyalı planda EmptyState', async ({ page }) => {
  await page.route('**/api/plans/*/checks', (route) => route.fulfill({ json: [{ ...check, result: undefined }] }));
  await page.goto(`/?check=${CHECK}&tab=muqayise`, { waitUntil: 'networkidle' });
  await expect(page.locator('#cmp-body .ui-empty__title')).toHaveText('Müqayisə üçün başqa versiya yoxdur');
});

test('əlavə tələblər: EmptyState əməliyyatı eyni plan üçün formu açır, B bölməsi açıq', async ({ page }) => {
  test.skip(Boolean(check.result && check.result.extras), 'bu yoxlamada əlavə tələb var');
  await page.goto(`/?check=${CHECK}&tab=elave`, { waitUntil: 'networkidle' });
  await expect(page.locator('#extra-empty .ui-empty__title')).toHaveText('Əlavə tələb sənədi yüklənməyib');
  await page.getByRole('button', { name: 'Yeni versiya + əlavə tələblər' }).click();
  await expect(page.locator('input[name="plan-mode"][value="existing"]')).toBeChecked();
  await expect(page.locator('#plan-select')).toHaveValue(check.plan_id);
  await expect(page.locator('#extra-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('texniki jurnal: yalnız debug rejimində; hadisələr sayı və öz içində sürüşən cədvəl', async ({ page }) => {
  await page.goto(`/?check=${CHECK}`, { waitUntil: 'networkidle' });
  await expect(page.locator('#tab-agentler')).toBeHidden();
  await page.goto(`/?check=${CHECK}&tab=agentler`, { waitUntil: 'networkidle' });
  await expect(page.locator('#ag-body tr').first()).toBeVisible();
  const rows = await page.locator('#ag-body tr').count();
  await expect(page.locator('#ag-count')).toHaveText(String(rows));
  const box = await page.locator('.ag-scroll').boundingBox();
  expect(box.height).toBeLessThanOrEqual(660);
});

test('375px: müqayisədə üfüqi scroll yoxdur', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/?check=${CHECK}&tab=muqayise`, { waitUntil: 'networkidle' });
  await expect(page.locator('#cmp-body .sumv__sentence, #cmp-body .ui-empty').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
