import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG regression gate. Deploys are already gated on the BB84 unit tests;
 * this gates them on accessibility the same way. Scans the full page with
 * every collapsible section expanded, in both themes.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expandAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('details')) {
      details.open = true;
    }
    // This lab uses class-toggled collapsibles rather than <details>.
    for (const el of document.querySelectorAll('.step, .explainer')) {
      el.classList.add('open');
    }
  });
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

test('no WCAG A/AA violations in dark theme', async ({ page }) => {
  await page.goto('.');
  await expandAll(page);
  await scan(page);
});

test('no WCAG A/AA violations in light theme', async ({ page }) => {
  await page.goto('.');
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expandAll(page);
  await scan(page);
});
