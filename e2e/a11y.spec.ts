import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { auditContrast, formatContrastFailures } from './contrast';

/**
 * WCAG regression gate. Deploys are already gated on the BB84 unit tests; this
 * gates them on accessibility the same way.
 *
 * Two things this file deliberately does NOT do, both of which it used to:
 *
 * 1. It does not scan the untouched page and stop there. The static markup is
 *    only the shell: the verdict banner ships `hidden`, all six step bodies are
 *    empty, the minimap has no ticks, the sifting table shows its empty state,
 *    the QBER gauge reads 0.0%, and the Eve node is `display:none`. None of the
 *    states the simulation actually produces — the clean verdict, the
 *    excess-disturbance ABORT with its `.error-step`, a noisy channel, the
 *    encrypted round trip, the post-reset empty state — existed at the moment
 *    the old gate scanned. Each scan below drives the page into a named state
 *    and asserts that state rendered before axe runs.
 *
 * 2. It does not inject `transition: none; animation: none`. The previous
 *    version did, reasoning that the header links blend over 150ms and axe would
 *    otherwise sample a colour neither theme ships. That reasoning describes a
 *    real problem and reaches for the wrong tool: while the injection was
 *    present the suite was structurally unable to observe a transition or
 *    theme-swap defect at all, having deleted the thing it was meant to check.
 *    A mid-blend sample is a settling problem, so it is now settled rather than
 *    deleted — `page.emulateMedia({ reducedMotion: 'reduce' })`, which is a real
 *    user path this lab already honours (the JS checks the same media query to
 *    skip the photon flight), plus a poll until `getAnimations()` reports
 *    nothing running.
 *
 *    `test.use({ reducedMotion: 'reduce' })` is NOT equivalent — on Playwright
 *    1.61.1 it silently does nothing, at file level and inside `test.describe`,
 *    and the page still reports `matches === false`. Hence `emulateMedia` plus
 *    `assertReducedMotion`, so a regression to the no-op form fails loudly
 *    instead of quietly disabling the premise.
 *
 * Contrast is additionally measured arithmetically in `./contrast`, because axe
 * is not a complete contrast oracle. It declines to compute a ratio over a
 * background gradient, and — the case that matters most here — it does not
 * check SVG `<text>` at all. This lab paints ALICE / BOB / EVE and the entire
 * QBER gauge as SVG text, so those nodes were wholly outside the gate.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Fail loudly if reduced motion is not actually in effect. */
async function assertReducedMotion(page: Page): Promise<void> {
  const matches = await page.evaluate(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  expect(
    matches,
    'reduced motion is not in effect — page.emulateMedia is the only form that works here'
  ).toBe(true);
}

/** Poll until no animation is running, rather than deleting animations. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'),
    undefined,
    { timeout: 15_000 }
  );
}

/** Expand the class-toggled collapsibles so their content is in scope. */
async function expandAll(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const details of Array.from(document.querySelectorAll('details'))) {
      (details as HTMLDetailsElement).open = true;
    }
    for (const el of Array.from(document.querySelectorAll('.step, .explainer'))) {
      el.classList.add('open');
    }
  });
}

/**
 * Guard against scanning a state that never rendered. Each scan names the
 * content it believes it is looking at, so a missing panel fails here rather
 * than producing a clean axe run over an empty box.
 */
async function expectRendered(page: Page, selectors: string[]): Promise<void> {
  for (const sel of selectors) {
    const locator = page.locator(sel).first();
    await expect(locator, `expected content at ${sel}`).toBeVisible();
    // textContent, not innerText: several of these targets are SVG <text>
    // nodes, which are not HTMLElements and have no innerText.
    const text = ((await locator.textContent()) ?? '').trim();
    expect(text.length, `expected non-empty content at ${sel}`).toBeGreaterThan(0);
  }
}

async function open(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('.');
  await assertReducedMotion(page);
  await expectRendered(page, ['h1', '#sift-empty']);
  await expandAll(page);
  await settle(page);
}

async function scan(page: Page, label: string): Promise<void> {
  await expandAll(page);
  await settle(page);

  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary, `axe violations in state: ${label}`).toEqual([]);

  const failures = await auditContrast(page);
  expect(
    formatContrastFailures(failures),
    `measured contrast failures in state: ${label}`
  ).toEqual([]);
}

interface RunOpts {
  eve?: boolean;
  photons?: number;
  noise?: number;
  threshold?: number;
}

/** Set the controls, start a run, and wait for it to finish. */
async function runProtocol(page: Page, opts: RunOpts = {}): Promise<void> {
  const { eve = false, photons, noise, threshold } = opts;
  if (photons !== undefined) await page.fill('#sl-photons', String(photons));
  if (noise !== undefined) await page.fill('#sl-noise', String(noise));
  if (threshold !== undefined) await page.fill('#sl-threshold', String(threshold));
  await page.click(eve ? '#btn-run-eve' : '#btn-run-clean');
  // Both run buttons are disabled for the whole run and re-enabled in `finally`,
  // so "enabled again" covers the clean path, the abort and the error path alike.
  await expect(page.locator('#btn-run-clean')).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator('#btn-run-eve')).toBeEnabled();
}

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations on first paint (${theme})`, async ({ page }) => {
    await open(page, theme);
    await scan(page, `${theme} / initial`);
  });

  test(`no WCAG A/AA violations after a clean run (${theme})`, async ({ page }) => {
    await open(page, theme);
    await runProtocol(page, { eve: false, photons: 256, noise: 0, threshold: 11 });

    await expect(page.locator('#result-banner')).toHaveClass(/\bclean\b/);
    await expect(page.locator('#step-6')).toHaveClass(/\bdone\b/);
    // Everything below only exists once a run has completed.
    await expectRendered(page, [
      '#result-banner',
      '#step-4-body',
      '#step-6-body',
      '#gauge-label',
    ]);
    expect(await page.locator('#minimap .mm-tick').count()).toBeGreaterThan(0);
    await scan(page, `${theme} / clean verdict`);
  });

  test(`no WCAG A/AA violations in the eavesdropper abort (${theme})`, async ({ page }) => {
    await open(page, theme);
    await runProtocol(page, { eve: true, photons: 256, noise: 1, threshold: 5 });

    // The detected verdict, the red gauge, the .error-step and the revealed Eve
    // node in the channel SVG are all states the untouched page cannot show.
    await expect(page.locator('#result-banner')).toHaveClass(/\bdetected\b/);
    await expect(page.locator('#step-4')).toHaveClass(/error-step/);
    await expectRendered(page, ['#result-banner', '#step-4-body']);
    await scan(page, `${theme} / eavesdropper detected`);
  });

  test(`no WCAG A/AA violations at maximum channel noise (${theme})`, async ({ page }) => {
    await open(page, theme);
    // Worst honest channel this lab allows: 5% noise against a 20% threshold, so
    // the run clears the QBER check and lands on the downstream outcome.
    await runProtocol(page, { eve: false, photons: 512, noise: 5, threshold: 20 });
    await expectRendered(page, ['#result-banner', '#step-4-body']);
    await scan(page, `${theme} / noisy channel`);
  });

  test(`no WCAG A/AA violations around the encrypt round trip and reset (${theme})`, async ({
    page,
  }) => {
    await open(page, theme);
    await runProtocol(page, { eve: false, photons: 128, noise: 0, threshold: 11 });
    await expect(page.locator('#btn-encrypt')).toBeEnabled();

    await page.fill('#msg-input', 'second message');
    await page.click('#btn-encrypt');
    await expect(page.locator('#step-6-body')).toContainText('second message', {
      timeout: 15_000,
    });
    await scan(page, `${theme} / re-encrypted round trip`);

    // Reset is its own rendered state: the banner goes back to hidden, the
    // counters zero, and the empty states return.
    await page.click('#btn-reset');
    await expect(page.locator('#result-banner')).toBeHidden();
    await expect(page.locator('#sift-empty')).toBeVisible();
    await scan(page, `${theme} / after reset`);
  });

  /**
   * The photon flight is the one part of this UI that only exists with motion
   * enabled: the inspector line, and the sifting column the landing photon
   * lights up (`td.col-active`, a tinted fill drawn under existing cell text),
   * are unreachable under reduced motion because the JS returns early. Scanning
   * only the reduced-motion path would leave both permanently unchecked, so this
   * test deliberately runs with motion on.
   *
   * The transient highlight is sampled arithmetically rather than with a full
   * axe pass: the audit is a single synchronous evaluate, so it reads a coherent
   * DOM, whereas an axe traversal across a mutating page is a flake waiting to
   * happen. The settled state afterwards gets the full scan.
   */
  test(`no WCAG A/AA violations in the animated photon states (${theme})`, async ({ page }) => {
    await page.goto('.');
    // The premise of this test is the opposite of the others; assert it, so it
    // cannot silently become a duplicate of the reduced-motion path.
    expect(
      await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      'this test must run with motion enabled'
    ).toBe(false);

    await page.fill('#sl-photons', '64');
    await page.click('#btn-run-eve');

    // A photon has landed and lit its column in the sifting table.
    await expect(page.locator('.sift-block td.col-active').first()).toBeVisible({
      timeout: 60_000,
    });
    const inFlight = await auditContrast(page);
    expect(
      formatContrastFailures(inFlight),
      `measured contrast failures in state: ${theme} / photon in flight, column highlighted`
    ).toEqual([]);

    // Freeze a photon's reading in the inspector. Photons are removed 120ms
    // after landing, so retry against whichever one is currently in the air.
    await expect
      .poll(
        async () => {
          const photon = page.locator('#photon-group g[data-inspectable]').first();
          if (await photon.count()) {
            await photon.dispatchEvent('click').catch(() => undefined);
          }
          return (await page.locator('#photon-inspector').textContent()) ?? '';
        },
        { timeout: 60_000 }
      )
      .not.toContain('Click a photon as it lands');

    await expect(page.locator('#btn-run-clean')).toBeEnabled({ timeout: 120_000 });
    await expect(page.locator('#btn-run-eve')).toBeEnabled();
    await expectRendered(page, ['#photon-inspector', '#result-banner']);
    await scan(page, `${theme} / animated run settled, photon inspected`);
  });
}
