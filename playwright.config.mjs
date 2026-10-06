// Playwright: e2e, vizual reqressiya və a11y testləri (tests/e2e/).
//   npm run test:e2e                      — server yoxdursa özü qaldırır (port 8010)
//   npx playwright test --update-snapshots — vizual baza şəkillərini yeniləyir
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || 8010;
const python = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.mjs/,
  timeout: 30_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' } },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `${python} -m uvicorn app.main:app --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/meta`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
