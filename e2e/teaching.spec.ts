import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('.');
});

test('optional post-processing starts at zero assumptions and counts public disclosure', async ({ page }) => {
  await expect(page.locator('#btn-postprocess')).toBeDisabled();
  await page.fill('#sl-photons', '512');
  await page.fill('#sl-noise', '0');
  await page.click('#btn-run-clean');
  await expect(page.locator('#btn-run-clean')).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator('#btn-postprocess')).toBeEnabled();
  const retained = Number(await page.locator('#assumed-hmin').getAttribute('max'));
  expect(retained).toBeGreaterThan(80);

  await page.click('#btn-postprocess');
  await expect(page.locator('#postprocess-result')).toContainText('After verification: 0 bits');
  await expect(page.locator('#postprocess-result')).toContainText('No key is created');

  await page.fill('#assumed-hmin', String(retained));
  await page.click('#btn-postprocess');
  const text = await page.locator('#postprocess-result').innerText();
  const match = text.match(/assumed Hmin (\d+) − public disclosure (\d+) − margin (\d+) .*? at most (\d+) bits/);
  expect(match).not.toBeNull();
  const [, assumption, disclosure, margin, cap] = match!.map(Number);
  expect(assumption).toBe(retained);
  expect(disclosure).toBeGreaterThan(16);
  expect(cap).toBe(Math.max(0, retained - disclosure - margin));
  expect(text).toContain('simulator agreement: yes');
  expect(text).toContain('No AES key is created');
});

test('basis announcement comparison keeps knowledge separate from a correct guess', async ({ page }) => {
  await page.click('#btn-receipt-first');
  await expect(page.locator('#btn-receipt-first')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ordering-result')).toContainText('25% QBER');
  await expect(page.locator('#ordering-result')).toContainText('16/32 sifted positions for certain (50%)');
  await expect(page.locator('#ordering-result')).toContainText('24/32 cases (75%)');

  await page.click('#btn-bases-first');
  await expect(page.locator('#btn-bases-first')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-receipt-first')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#ordering-result')).toContainText('0% QBER');
  await expect(page.locator('#ordering-result')).toContainText('32/32 sifted positions for certain (100%)');
});

test('QBER-aborted runs cannot expose optional retained-bit processing', async ({ page }) => {
  await page.fill('#sl-photons', '512');
  await page.fill('#sl-noise', '0');
  await page.click('#btn-run-eve');
  await expect(page.locator('#btn-run-eve')).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator('#result-banner')).toHaveClass(/detected/);
  await expect(page.locator('#btn-postprocess')).toBeDisabled();
  await expect(page.locator('#postprocess-result')).toContainText('no retained key');
});
