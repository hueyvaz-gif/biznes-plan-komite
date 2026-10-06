// Yeni yoxlama axını və gedişat ekranı (Faza 9). Gedişat real yoxlamanın məlumatı ilə mock olunur
// (real icra ~100 s çəkir və model çağırır).
import { test, expect } from '@playwright/test';

const CHECK = 'c1b49c3a9ba6';
const SAMPLE = 'samples/plan_demo_v1.docx';

function watch(page) {
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

test('landing: "Davam et" səbəbi, fayl kartı, "Dəyiş", silmə', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  const btn = page.locator('#submit-btn');
  await expect(page.locator('#submit-why')).toHaveText('Əvvəlcə .docx faylı seçin');
  await expect(btn).toHaveAttribute('aria-disabled', 'true');
  await page.locator('#file-input').setInputFiles(SAMPLE);
  await expect(page.locator('#filechip')).toBeVisible();
  await expect(page.locator('#dropzone')).toBeHidden();
  await expect(page.locator('#filechip-name')).toHaveText('plan_demo_v1.docx');
  await expect(page.locator('#submit-why')).toHaveText('Planın adını yazın');
  await page.locator('#plan-id').fill('E2E plan');
  await expect(btn).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('#submit-why')).toBeHidden();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Dəyiş' }).click();
  await chooser;
  await page.getByRole('button', { name: 'Faylı sil' }).click();
  await expect(page.locator('#dropzone')).toBeVisible();
  await expect(page.locator('#submit-why')).toHaveText('Əvvəlcə .docx faylı seçin');
  expect(problems).toEqual([]);
});

test('landing: faktlar konfiqurasiyadan (iqtisadi yoxlamalar daxil); "Nəyi yoxlamırıq" ziddiyyətsiz', async ({ page, request }) => {
  const meta = await (await request.get('/api/meta')).json();
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('#fact-econ')).toHaveText(String(meta.facts.economics_checks));
  await expect(page.locator('#fact-econ-sub')).toHaveText(`(+${meta.facts.scenarios} həssaslıq ssenarisi)`);
  const not = page.locator('.explain__not');
  await page.locator('.upload-info > summary').click();
  await expect(not).not.toContainText('gəlirli olub-olmayacağını');
  await expect(page.locator('.explain__name', { hasText: 'İqtisadi təhlil' })).toBeVisible();
  // Planın adı sahəsi normal forma sahəsidir (ui-field nəzarət stili ilə toqquşmur)
  const box = await page.locator('#plan-id').boundingBox();
  expect(box.height).toBeGreaterThan(30);
});

/** Real yoxlamadan mərhələ mock-u: hadisələr `until` anına qədər, vaxtlar "indi"yə köçürülür. */
async function mockRun(page, request, { stage, state = 'isleyir', error = null }) {
  const res = await request.get(`/api/checks/${CHECK}`);
  test.skip(!res.ok(), 'CFG v2 yoxlaması lokal bazada yoxdur');
  const real = await res.json();
  const all = (await (await request.get(`/api/checks/${CHECK}/events`)).json()).events;
  const lastA = Math.max(...all.map((e) => e.attempt));
  const evs = all.filter((e) => e.attempt === lastA);
  const t0 = Math.min(...evs.map((e) => e.ts));
  const groupsDone = evs.filter((e) => e.kind === 'result' && e.agent === 'uygunluq').map((e) => e.ts).sort();
  const nodeStart = (n) => evs.find((e) => e.kind === 'node' && e.name === n).ts;
  const S = {
    finance: { until: nodeStart('finance') + 5, step: 'finance', result: null },
    compliance: { until: groupsDone[5] + 0.01, step: 'compliance', result: { finance: real.result.finance } },
    summary: { until: nodeStart('write_summary') + 5, step: 'write_summary', result: { finance: real.result.finance, compliance: real.result.compliance } },
  }[stage];
  const shift = Date.now() / 1000 - S.until;
  const events = evs.filter((e) => e.ts <= S.until).map((e) => ({ ...e, ts: e.ts + shift }));
  const ctl = { check: { ...real, run_state: state, current_step: S.step, verdict: null, error, result: S.result }, events };
  await page.route(`**/api/checks/${CHECK}`, (r) => r.fulfill({ json: ctl.check }));
  await page.route(`**/api/checks/${CHECK}/events*`, (r) => r.fulfill({ json: { check_id: CHECK, events: ctl.events, last_id: 0 } }));
  return { ctl, real };
}

test('gedişat: mərhələlər, 11 qrup ayrıca, canlı tapıntılar, vaxt', async ({ page, request }) => {
  const problems = watch(page);
  await mockRun(page, request, { stage: 'compliance' });
  await page.goto(`/?check=${CHECK}`, { waitUntil: 'networkidle' });
  const stages = page.locator('#run-stages .rstage');
  await expect(stages).toHaveCount(5);
  await expect(stages.nth(0)).toHaveClass(/is-done/);
  await expect(stages.nth(1)).toHaveClass(/is-done/);
  await expect(stages.nth(2)).toHaveClass(/is-active/);
  await expect(stages.nth(2)).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.rgroup')).toHaveCount(11);
  await expect(page.locator('.rgroup.is-done')).toHaveCount(6);
  await expect(page.locator('.rgroups__count')).toHaveText('6 / 11 qrup hazır');
  // Lent: maliyyə tapıntıları (aralıq nəticədən) və bitmiş qruplar
  await expect(page.locator('#run-feed .rfeed--ok').first()).toBeVisible();
  await expect(page.locator('#run-feed')).toContainText('uyğundur');
  await expect(page.locator('#run-feed')).toContainText('1. Layihənin qısa xülasəsi — yoxlanıldı');
  await expect(page.locator('.runtime__clock')).toContainText(':');
  expect(problems).toEqual([]);
});

test('gedişat: uyğunluq bitəndə tələb problemləri lentə düşür; reload-da sıra dəyişmir', async ({ page, request }) => {
  await mockRun(page, request, { stage: 'summary' });
  await page.goto(`/?check=${CHECK}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.rgroup.is-done')).toHaveCount(11);
  await expect(page.locator('#run-feed .rfeed--warn, #run-feed .rfeed--fail').first()).toBeVisible();
  const first = await page.locator('#run-feed .rfeed__text').allTextContents();
  await page.waitForTimeout(2000);                      // bir neçə poll
  expect(await page.locator('#run-feed .rfeed__text').allTextContents()).toEqual(first);
});

test('xəta: mərhələ, səbəb insan dilində, texniki mətn bağlı; "Yenidən cəhd et"', async ({ page, request }) => {
  await mockRun(page, request, { stage: 'compliance', state: 'xeta',
    error: "APIStatusError: Error code: 400 - {'message': 'Your credit balance is too low to access the Anthropic API.'}" });
  await page.goto(`/?check=${CHECK}`, { waitUntil: 'networkidle' });
  await expect(page.locator('#run-error')).toBeVisible();
  await expect(page.locator('#error-step')).toHaveText('11 tələb qrupu yoxlanılır');
  await expect(page.locator('#error-text')).toHaveText('Model xidmətinin balansı bitib');
  await expect(page.locator('#error-tech')).toBeHidden();
  await page.locator('#error-tech-box summary').click();
  await expect(page.locator('#error-tech')).toContainText('credit balance');
  await expect(page.getByRole('button', { name: 'Yenidən cəhd et' })).toBeVisible();
  // Dayanmış mərhələdə qruplar fırlanmır
  await expect(page.locator('.rgroup.is-active')).toHaveCount(0);
  await expect(page.locator('#run-stages .rstage.is-error')).toHaveCount(1);
});

test('bitəndə: keçid və Verdict Hero açılır', async ({ page, request }) => {
  const { ctl, real } = await mockRun(page, request, { stage: 'summary' });
  await page.goto(`/?check=${CHECK}`, { waitUntil: 'networkidle' });
  await expect(page.locator('#view-run')).toBeVisible();
  ctl.check = real;                                     // növbəti poll — tamamlandı
  await expect(page.locator('#view-run')).toHaveClass(/is-finishing/, { timeout: 5000 });
  await expect(page.locator('#view-results')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#view-run')).not.toHaveClass(/is-finishing/);
});

test('375px: gedişat ekranında üfüqi scroll yoxdur', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await mockRun(page, request, { stage: 'compliance' });
  await page.goto(`/?check=${CHECK}`, { waitUntil: 'networkidle' });
  await expect(page.locator('.rgroup').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
