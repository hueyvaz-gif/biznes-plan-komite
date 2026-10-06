// İqtisadi təhlil tabı (Faza 6): banner, saylar, tornado, "Nə olarsa?" simulyatoru, yığcam kartlar, reallıq.
// "Suala çevir" sorğusu mock olunur — lokal bazaya heç nə yazılmır.
import { test, expect } from '@playwright/test';

const CHECK = 'c1b49c3a9ba6';
const URL = `/?check=${CHECK}&tab=iqtisadi`;
let econ;

test.beforeEach(async ({ request }) => {
  const res = await request.get(`/api/checks/${CHECK}/economics`);
  test.skip(!res.ok(), 'CFG v2 yoxlaması lokal bazada yoxdur');
  econ = await res.json();
  test.skip(!econ.result, 'iqtisadi təhlil aparılmayıb');
});

async function open(page) {
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await expect(page.locator('#econ-banner-text')).not.toBeEmpty();
  return problems;
}
const needsAction = (f) => !f.summary && (f.status === 'flag' || (f.status === 'info' && !!f.question));

test('banner: risk səviyyəsi və nəticə cümləsi; texniki qeyd bağlanır', async ({ page }) => {
  const problems = await open(page);
  await expect(page.locator('#econ-level')).toContainText('RİSK');
  await expect(page.locator('#econ-banner-text')).toContainText('NPV sıfıra enir');
  if (econ.result.notes) {
    await expect(page.locator('#econ-notes-box')).toBeVisible();
    await page.locator('#econ-notes-close').click();
    await expect(page.locator('#econ-notes-box')).toBeHidden();
  }
  expect(problems).toEqual([]);
});

test('saylar: tab nişanı = kartlardakı diqqət tələb edən tapıntılar; xülasə sayılmır', async ({ page }) => {
  await open(page);
  const n = econ.result.findings.filter(needsAction).length;
  await expect(page.locator('#count-iqtisadi')).toHaveText(String(n));
  const groups = await page.locator('.efgroup__h').allTextContents();
  const sum = groups.map((g) => Number((g.match(/\((\d+)\)/) || [])[1] || 0)).reduce((a, b) => a + b, 0);
  expect(sum).toBe(n);
});

test('terminologiya: developer jarqonu, "Bayraq" və defis-minus yoxdur', async ({ page }) => {
  await open(page);
  const rest = page.locator('.efgroup--ok .ui-disc__btn');
  if (await rest.count()) await rest.click();                     // "Uyğun və məlumat" default yığılıdır
  for (const btn of await page.locator('.efc__head').all()) await btn.click();
  const text = await page.locator('#panel-iqtisadi').innerText();
  expect(text).not.toMatch(/AGENTİN|agentin götürdüyü|Kodun hesabı:|bayraq/i);
  expect(text).not.toMatch(/(^|\s)-\d/m);
});

test('tornado: ssenarilər |ΔNPV|-yə görə sıralı, NPV = 0 xətti var, klik kartı açır', async ({ page }) => {
  await open(page);
  const ok = econ.result.sensitivity.scenarios.filter((s) => s.status === 'ok').sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const labels = await page.locator('.tornado2__label').allTextContents();
  expect(labels).toEqual(ok.map((s) => s.title));
  await expect(page.locator('.tornado2__zero')).toHaveText('NPV = 0');
  await page.locator('.tornado2__btn').first().click();
  const card = page.locator(`#ef-hessasliq-${ok[0].id.replace(/[^a-zA-Z0-9_-]/g, '-')}`);
  await expect(card.locator('.efc__head')).toHaveAttribute('aria-expanded', 'true');
});

test('simulyator: qiymət −1% → NPV mənfi; Shift+ox 5%; sıfırla bazaya qaytarır', async ({ page }) => {
  await open(page);
  const base = econ.result.sensitivity.base.npv;
  const price = page.locator('#sim-price');
  await price.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.sim__npv')).toHaveClass(/is-negative/);
  await expect(price).toHaveAttribute('aria-valuetext', /^−1%, NPV mənfi/);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.locator('#sim-price + output, .sim__row:has(#sim-price) .sim__val')).toHaveText('−6%');
  await page.getByRole('button', { name: 'Sıfırla' }).click();
  const expected = new Intl.NumberFormat('en-US').format(Math.round(base)).replace(/,/g, ' ');
  await expect(page.locator('.sim__npv')).toContainText(expected);
  await expect(page.locator('.sim__npv')).not.toHaveClass(/is-negative/);
});

test('simulyator backend ilə eyni: hər ssenarinin parametrləri ilə NPV ±1 ₼', async ({ page }) => {
  await open(page);
  const got = await page.evaluate(async (scenarios) => {
    const calc = await import('/static/econ-calc.js');
    const r = await fetch('/api/checks/c1b49c3a9ba6/economics').then((x) => x.json());
    const m = r.result.sensitivity.model;
    return scenarios.map((s) => calc.evaluate(m, s.params).npv);
  }, econ.result.sensitivity.scenarios.filter((s) => s.status === 'ok'));
  econ.result.sensitivity.scenarios.filter((s) => s.status === 'ok').forEach((s, i) => expect(Math.abs(got[i] - s.npv)).toBeLessThanOrEqual(1));
});

test('"Bu ssenarini suala çevir": rəqəmlər koddan, sorğu göndərilir (mock)', async ({ page }) => {
  let body = null;
  await page.route(`**/api/checks/${CHECK}/questions`, async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { id: 'mock' } });
  });
  await open(page);
  const ask = page.getByRole('button', { name: 'Bu ssenarini suala çevir' });
  await expect(ask).toBeDisabled();
  await page.locator('#sim-raw').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await ask.click();
  await expect(page.getByText('Ssenari Suallar tabına sual kimi əlavə edildi')).toBeVisible();
  expect(body.text).toContain('xammal qiyməti +5%');
  expect(body.text).toMatch(/NPV .*₼/);
});

test('kart: yığılı → açılır; sual mətni tapıntını təkrarlamır; "Necə hesablanıb" sonda', async ({ page }) => {
  await open(page);
  const card = page.locator('.efc').first();
  await card.locator('.efc__head').click();
  const result = await card.locator('.efc__result').textContent();
  const ask = await card.locator('.efc__ask').textContent();
  expect(result.includes(ask.trim())).toBe(false);
  await expect(card.getByRole('button', { name: 'Necə hesablanıb' })).toBeVisible();
});

test('reallıq: benchmark gözlənilir — boş vəziyyət, mənbəsi çatışmayan göstəricilər, admin qeydi', async ({ page }) => {
  await open(page);
  const real = econ.result.findings.filter((f) => f.group === 'realliq');
  const waiting = real.filter((f) => f.status === 'skip').length;
  if (waiting) {
    await expect(page.locator('#econ-reality')).toContainText('Bazarla müqayisə tamamlanmayıb');
    await expect(page.locator('#econ-reality')).toContainText(`${waiting} göstərici üçün mənbə və tarix çatışmır`);
    await expect(page.locator('#econ-reality details tbody tr')).toHaveCount(waiting);
    await expect(page.locator('#econ-reality .rbars__admin')).toBeVisible();
    await expect(page.locator('#econ-reality .rbars__admin')).toContainText('config/benchmarks/gubre.yaml');
  }
});

test('375px: üfüqi scroll yoxdur; reduced-motion: tornado animasiyasız', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.locator('#econ-radar').scrollIntoViewIfNeeded();
  await expect(page.locator('.tornado2__wrap')).not.toHaveClass(/is-animating/);
});
