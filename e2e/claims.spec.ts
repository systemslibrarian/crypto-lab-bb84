import { expect, test as base, type Page } from '@playwright/test';

/**
 * Functional claims gate.
 *
 * The a11y spec proves the page is reachable; this one proves it is *honest*.
 * Every assertion below is checked against a number the page itself computed
 * and rendered — the banner's QBER against the error/sacrifice counts printed
 * in step 4, the minimap ticks against the counters, the sifting table's
 * KEEP/DROP against the two bases in the same column — so the suite cannot
 * pass by agreeing with a string that was hardcoded next to it.
 */

const test = base.extend<{ pageErrors: string[] }>({
  // Auto fixture: any uncaught page exception fails the test that caused it.
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e && e.stack ? e.stack : e)));
      await use(errors);
      expect(errors, `uncaught page exceptions: ${errors.join(' | ')}`).toEqual([]);
    },
    { auto: true },
  ],
});

interface RunOpts {
  eve?: boolean;
  photons?: number;
  noise?: number;
  threshold?: number;
  animate?: boolean;
}

/** Set the controls, start a run, and wait for the run to finish. */
async function runProtocol(page: Page, opts: RunOpts = {}): Promise<void> {
  const { eve = false, photons, noise, threshold } = opts;
  if (photons !== undefined) await page.fill('#sl-photons', String(photons));
  if (noise !== undefined) await page.fill('#sl-noise', String(noise));
  if (threshold !== undefined) await page.fill('#sl-threshold', String(threshold));
  await page.click(eve ? '#btn-run-eve' : '#btn-run-clean');
  await waitForRun(page);
}

async function waitForRun(page: Page): Promise<void> {
  // The run disables both run buttons for its whole duration and the `finally`
  // block re-enables them, so "enabled again" is the one signal that covers the
  // clean path, the eavesdropper abort, and the error path alike.
  await expect(page.locator('#btn-run-clean')).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator('#btn-run-eve')).toBeEnabled();
}

/** Open the page with the photon animation skipped, so runs take ~2s not ~15s. */
async function openStill(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('.');
}

async function textOf(page: Page, selector: string): Promise<string> {
  return ((await page.locator(selector).textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

function num(match: RegExpMatchArray | null, group: number, label: string): number {
  expect(match, `could not parse ${label}`).not.toBeNull();
  return Number(match![group]);
}

// ── The clean verdict ──────────────────────────────────────────────────────

test('a clean run headline is the QBER the page itself computed', async ({ page }) => {
  await openStill(page);
  await runProtocol(page, { eve: false, photons: 256, noise: 0, threshold: 11 });

  const banner = page.locator('#result-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/\bclean\b/);
  await expect(banner).not.toHaveClass(/\bdetected\b/);

  const bannerText = await textOf(page, '#result-banner');
  const m = bannerText.match(/✓ TEST PASSED — QBER ([\d.]+)% below ([\d.]+)% threshold/);
  const bannerQberText = (expect(m, 'banner did not match the clean shape').not.toBeNull(), m![1]);
  const bannerQber = num(m, 1, 'banner QBER');
  const bannerThreshold = num(m, 2, 'banner threshold');

  // 1. The verdict must follow from its own two numbers.
  expect(bannerQber, 'a "clean" verdict whose QBER is not below its own threshold')
    .toBeLessThanOrEqual(bannerThreshold);

  // 2. The threshold it claims is the threshold the control is showing.
  expect(bannerThreshold).toBeCloseTo(
    Number((await textOf(page, '#lbl-threshold')).replace('%', '')), 5);

  // 3. The QBER it claims is the ratio step 4 printed: errors / sacrificed bits.
  const step4 = await textOf(page, '#step-4-body');
  const sacrificed = num(step4.match(/Sacrificing (\d+) sifted bits/), 1, 'sacrificed count');
  const errors = num(step4.match(/Errors found: (\d+)/), 1, 'error count');
  expect(sacrificed).toBeGreaterThan(0);
  expect(errors).toBeLessThanOrEqual(sacrificed);
  const pct = (errors / sacrificed) * 100;
  expect(bannerQberText).toBe(pct.toFixed(2));
  expect(step4).toContain(`QBER: ${pct.toFixed(2)}%`);
  expect(step4).toContain('TEST PASSED');
  // The pass is scoped to what a sampled test can actually establish.
  expect(step4).toContain('it cannot prove nobody listened');

  // 4. The gauge, the counters and the caption report the same run. (The gauge
  // clamps at 50%, which no reachable QBER here comes near.)
  expect(await textOf(page, '#gauge-label')).toBe(`${pct.toFixed(1)}%`);
  expect(Number(await textOf(page, '#cnt-errors'))).toBe(errors);
  expect(await textOf(page, '#cnt-error-pct')).toBe(pct.toFixed(1));
  const caption = await textOf(page, '#channel-caption');
  expect(caption).toContain('Step 6');
  await expect(page.locator('#step-4')).toHaveClass(/\bdone\b/);
  await expect(page.locator('#step-4')).not.toHaveClass(/error-step/);

  // 5. A noiseless, un-eavesdropped channel has nothing to find.
  expect(errors).toBe(0);
  expect(bannerQber).toBe(0);
});

test('a clean channel really round-trips the message the user typed', async ({ page }) => {
  await openStill(page);
  const message = 'round trip proof 42';
  await page.fill('#msg-input', message);
  await runProtocol(page, { eve: false, photons: 256, noise: 0, threshold: 11 });

  await expect(page.locator('#step-6')).toHaveClass(/\bdone\b/);
  await expect(page.locator('#step-6')).not.toHaveClass(/error-step/);

  const step6 = await textOf(page, '#step-6-body');
  // The plaintext asserted here is the one Bob's key produced, not a literal
  // baked into the page: it round-trips whatever the input field held.
  expect(step6).toContain(`✓ Bob decrypted Alice's ciphertext: "${message}"`);
  expect(step6).toContain(`Message: "${message}"`);

  // Alice encrypts with her key and Bob decrypts with his, so a successful
  // round trip is only meaningful if the two printed keys are in fact equal.
  const alice = step6.match(/Alice's key: ([0-9a-f]+)/);
  const bob = step6.match(/Bob's key: ([0-9a-f]+)/);
  expect(alice, 'no Alice key printed').not.toBeNull();
  expect(bob, 'no Bob key printed').not.toBeNull();
  expect(alice![1]).toBe(bob![1]);

  // "0 in disagreement" has to be over the same retained-bit count step 5 used.
  const retained = num(step6.match(/\((\d+) retained bits, (\d+) of them in disagreement/), 1, 'retained bits');
  const disagreeing = num(step6.match(/\((\d+) retained bits, (\d+) of them in disagreement/), 2, 'disagreeing bits');
  expect(disagreeing).toBe(0);
  const step5 = await textOf(page, '#step-5-body');
  const rawBits = num(step5.match(/Raw sifted key: (\d+) bits/), 1, 'raw sifted bits');
  expect(rawBits).toBe(retained);

  // Key bits counter is the width of the amplified key, and step 5 says so.
  expect(Number(await textOf(page, '#cnt-key'))).toBe(
    num(step5.match(/Final key: (\d+) bits/), 1, 'final key bits'));

  // Privacy amplification is drawn to scale: at these photon counts the raw key
  // is shorter than 256 bits, so the final bar must not be the shorter one.
  const widths = await page.locator('#step-5-body .pa-bar').evaluateAll(
    (els) => els.map((el) => (el as HTMLElement).getBoundingClientRect().width));
  expect(widths.length).toBe(2);
  expect(rawBits).toBeLessThan(256);
  expect(widths[1]).toBeGreaterThan(widths[0]);
  expect(step5).toContain('stretching');
});

// ── The failure paths ──────────────────────────────────────────────────────

test('an eavesdropper run reaches the detected state and names the cause', async ({ page }) => {
  await openStill(page);
  await runProtocol(page, { eve: true, photons: 256, noise: 1, threshold: 5 });

  const banner = page.locator('#result-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/\bdetected\b/);
  await expect(banner).not.toHaveClass(/\bclean\b/);

  // The verdict claims what Alice and Bob observe (excess disturbance), not
  // that they identified Eve — they cannot tell her from noise. The Eve
  // attribution below is simulation ground truth, and this run really had her.
  const bannerText = await textOf(page, '#result-banner');
  const m = bannerText.match(
    /✗ ABORT — QBER ([\d.]+)% is at or above the ([\d.]+)% threshold\. Excess disturbance; key discarded\./,
  );
  expect(m, 'banner did not match the detected shape').not.toBeNull();
  const qberText = m![1];
  const qber = num(m, 1, 'banner QBER');
  const threshold = num(m, 2, 'banner threshold');
  // `toBeGreaterThanOrEqual`, not `toBeGreaterThan`. The detection boundary is
  // `qber >= threshold`: a run landing exactly on the threshold is detected, and
  // this assertion previously encoded the strict form the code has been fixed
  // away from. QBER hits the threshold exactly in 59 of 19,200 engine runs, and
  // 49 of those have Eve present — so the equality case is not hypothetical.
  expect(qber, 'a "detected" verdict whose QBER is below its own threshold')
    .toBeGreaterThanOrEqual(threshold);

  // The cause is named, not just the outcome — and this run had Eve, so the
  // simulation's ground-truth commentary must attribute the errors to her.
  const step4 = await textOf(page, '#step-4-body');
  expect(step4).toContain('Status: ✗ ABORT — excess disturbance. Key discarded.');
  expect(step4).toContain('Reason: QBER reached the threshold');
  expect(step4).toContain('errors came from Eve measuring photons in random bases');
  await expect(page.locator('#step-4')).toHaveClass(/error-step/);
  await expect(page.locator('#step-4')).not.toHaveClass(/\bdone\b/);

  // Step 4's own counts reproduce the QBER on the banner.
  const sacrificed = num(step4.match(/Errors found: \d+ of (\d+) sacrificed bits/), 1, 'sacrificed');
  const errors = num(step4.match(/Errors found: (\d+) of \d+ sacrificed bits/), 1, 'errors');
  const pct = (errors / sacrificed) * 100;
  expect(qberText).toBe(pct.toFixed(2));

  // Gauge, counters and caption must not tell a different story than the banner.
  expect(await textOf(page, '#gauge-label')).toBe(`${pct.toFixed(1)}%`);
  expect(await textOf(page, '#cnt-error-pct')).toBe(pct.toFixed(1));
  const caption = await textOf(page, '#channel-caption');
  expect(caption).toContain('Run aborted');
  expect(caption).toContain(`${pct.toFixed(2)}%`);
  expect(caption).toContain(`${threshold.toFixed(1)}%`);
  // Over threshold means the needle must be the "red" colour this theme defines,
  // read from the stylesheet rather than hardcoded.
  const red = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--gauge-red').trim());
  expect(red).not.toBe('');
  expect(await page.locator('#gauge-needle').getAttribute('stroke')).toBe(red);

  // "Key discarded" has to mean discarded: no key, no encryption offered, and
  // steps 5 and 6 never ran.
  expect(await textOf(page, '#cnt-key')).toBe('0');
  await expect(page.locator('#btn-encrypt')).toBeDisabled();
  expect(await textOf(page, '#step-5-body')).toBe('');
  expect(await textOf(page, '#step-6-body')).toBe('');

  // The abort must not leave the controls dead.
  await expect(page.locator('#btn-run-clean')).toBeEnabled();
  await expect(page.locator('#btn-run-eve')).toBeEnabled();
  await expect(page.locator('#sl-photons')).toBeEnabled();
});

test('a noisy channel ends at the AES-GCM tag check and names the missing step', async ({ page }) => {
  await openStill(page);
  // 5% noise over ~128 retained bits: the two keys disagree in all but ~0.2% of
  // runs. Retry a few times rather than assert on a coin flip.
  let step6 = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await runProtocol(page, { eve: false, photons: 512, noise: 5, threshold: 20 });
    if (await page.locator('#step-6.error-step').count()) {
      step6 = await textOf(page, '#step-6-body');
      break;
    }
  }
  expect(step6, 'five noisy runs in a row produced a shared key — implausible at 5% noise').not.toBe('');

  // It reaches the failure state...
  await expect(page.locator('#step-6')).toHaveClass(/error-step/);
  await expect(page.locator('#step-6')).not.toHaveClass(/\bdone\b/);
  expect(step6).toContain("✗ Bob cannot decrypt Alice's ciphertext — AES-GCM's tag check rejected it.");
  expect(step6).not.toContain('✓ Bob decrypted');

  // ...and names the cause, with numbers that hold together.
  const why = step6.match(/Why: (\d+) of the (\d+) retained bits disagree/);
  const disagreeing = num(why, 1, 'disagreeing bits');
  const retained = num(why, 2, 'retained bits');
  expect(disagreeing).toBeGreaterThan(0);
  expect(disagreeing).toBeLessThanOrEqual(retained);
  expect(step6).toContain('information-reconciliation (error-correction)');
  expect(step6).toContain('Set noise to 0% and run without Eve to see the keys agree.');

  // The keys it prints really do differ — the tag failure is not decoration.
  const alice = step6.match(/Alice's key: ([0-9a-f]+)/)![1];
  const bob = step6.match(/Bob's key: ([0-9a-f]+)/)![1];
  expect(alice).not.toBe(bob);

  // This is a step-6 failure, not an Eve detection: the channel verdict is still
  // clean, so the two surfaces are not contradicting each other.
  await expect(page.locator('#result-banner')).toHaveClass(/\bclean\b/);
  expect(await textOf(page, '#result-banner')).toContain('TEST PASSED');
  await expect(page.locator('#step-4')).toHaveClass(/\bdone\b/);
});

test('a noise-only abort reports disturbance without blaming an eavesdropper', async ({ page }) => {
  await openStill(page);
  // 5% noise against a 5% threshold at 64 photons: the sampled QBER reaches
  // the threshold in roughly half of runs (the sacrifice sample is ~16 bits,
  // so one flipped bit is already 6.25%). Retry rather than assert a coin
  // flip; ten consecutive misses would be ~0.1%.
  let aborted = false;
  for (let attempt = 0; attempt < 10 && !aborted; attempt += 1) {
    await runProtocol(page, { eve: false, photons: 64, noise: 5, threshold: 5 });
    aborted = (await page.locator('#result-banner.detected').count()) > 0;
  }
  expect(aborted, 'ten 5%-noise runs never reached a 5% threshold — implausible').toBe(true);

  // The old page blamed this state on an eavesdropper ("EAVESDROPPER
  // DETECTED ... Eve introduced errors by measuring photons in random
  // bases") — with no Eve on the line. The verdict must claim only the
  // observed disturbance, and the ground-truth commentary must name noise.
  const step4 = await textOf(page, '#step-4-body');
  expect(step4).toContain('Status: ✗ ABORT — excess disturbance. Key discarded.');
  expect(step4).toContain('errors came from channel noise — no Eve was on the line');
  expect(step4).not.toContain('came from Eve measuring');
  const caption = await textOf(page, '#channel-caption');
  expect(caption).toContain('Run aborted');
  expect(caption).toContain('no Eve was on the line');

  // An abort is an abort regardless of cause: no key, no encryption.
  expect(await textOf(page, '#cnt-key')).toBe('0');
  await expect(page.locator('#btn-encrypt')).toBeDisabled();
  expect(await textOf(page, '#step-5-body')).toBe('');
});

// ── Counters and the minimap ───────────────────────────────────────────────

test('the minimap partitions every photon and reconciles with the counters', async ({ page }) => {
  await openStill(page);
  await runProtocol(page, { eve: true, photons: 128, noise: 1, threshold: 20 });

  const sent = Number(await textOf(page, '#cnt-sent'));
  const sifted = Number(await textOf(page, '#cnt-sifted'));
  const siftPct = Number(await textOf(page, '#cnt-sift-pct'));
  expect(sent).toBe(128);
  expect(sifted).toBeGreaterThan(0);
  expect(sifted).toBeLessThanOrEqual(sent);
  expect(siftPct).toBe(Math.round((sifted / sent) * 100));

  const ticks = await page.locator('#minimap .mm-tick').count();
  const kept = await page.locator('#minimap .t-key').count();
  const discarded = await page.locator('#minimap .t-discard').count();
  const errored = await page.locator('#minimap .t-err').count();
  const empty = await page.locator('#minimap .minimap-empty').count();

  // One tick per photon, and the three classes partition them.
  expect(ticks).toBe(sent);
  expect(kept + discarded + errored).toBe(ticks);
  expect(empty).toBe(0);
  // Kept + errored are exactly the sifted photons; the rest are the drops.
  expect(kept + errored).toBe(sifted);
  expect(discarded).toBe(sent - sifted);

  // The screen-reader summary is the same partition, not an independent count.
  const label = (await page.locator('#minimap').getAttribute('aria-label')) ?? '';
  const m = label.match(/Overview of (\d+) photons: (\d+) kept, (\d+) discarded, (\d+) sacrificed bits in error\./);
  expect(num(m, 1, 'aria total')).toBe(ticks);
  expect(num(m, 2, 'aria kept')).toBe(kept);
  expect(num(m, 3, 'aria discarded')).toBe(discarded);
  expect(num(m, 4, 'aria errored')).toBe(errored);
  expect(await textOf(page, '#minimap-title')).toBe(`All ${sent} photons at a glance`);

  // The sacrificed-error ticks are the errors the QBER was measured over.
  expect(errored).toBe(Number(await textOf(page, '#cnt-errors')));
});

test('every KEEP/DROP in the sifting table follows from the two bases beside it', async ({ page }) => {
  await openStill(page);
  await runProtocol(page, { eve: false, photons: 256, noise: 0, threshold: 11 });

  const rows = await page.evaluate(() => {
    const cells = (id: string) =>
      Array.from(document.querySelectorAll(`#${id} td`)).map((td) => (td.textContent ?? '').trim());
    return {
      idx: cells('sift-row-idx'),
      aBasis: cells('sift-row-abasis'),
      bBasis: cells('sift-row-bbasis'),
      aBit: cells('sift-row-abit'),
      outcome: cells('sift-row-outcome'),
    };
  });

  expect(rows.outcome.length).toBeGreaterThan(0);
  for (const key of ['idx', 'aBasis', 'bBasis', 'aBit'] as const) {
    expect(rows[key].length, `row ${key} is a different length than the outcome row`)
      .toBe(rows.outcome.length);
  }

  rows.outcome.forEach((out, j) => {
    const match = rows.aBasis[j] === rows.bBasis[j];
    expect(out, `column ${j}: bases ${rows.aBasis[j]}/${rows.bBasis[j]} but outcome "${out}"`)
      .toBe(match ? '✓ KEEP' : '✕ DROP');
    expect(['⊕', '⊗']).toContain(rows.aBasis[j]);
    expect(['⊕', '⊗']).toContain(rows.bBasis[j]);
    expect(['0', '1']).toContain(rows.aBit[j]);
    expect(Number(rows.idx[j])).toBeGreaterThan(0);
  });

  // Not every column can be a KEEP, or the "bases agree about half the time"
  // lesson under the table would be a claim the table never demonstrates.
  expect(rows.outcome).toContain('✓ KEEP');
  expect(rows.outcome).toContain('✕ DROP');

  const note = await textOf(page, '#sift-sample-note');
  const m = note.match(/Showing (\d+) of (\d+) photons/);
  expect(num(m, 1, 'sample size')).toBe(rows.outcome.length);
  expect(num(m, 2, 'photon total')).toBe(Number(await textOf(page, '#cnt-sent')));
  await expect(page.locator('#sift-empty')).toBeHidden();
});

// ── The animated surfaces the README promises ──────────────────────────────

test('Eve is annotated in flight and the inspector decodes the photon it names', async ({ page }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('.');
  await page.fill('#sl-photons', '64');
  await page.fill('#sl-threshold', '11');
  await page.click('#btn-run-eve');

  // While the run is active, Reset would be a silent no-op (`resetAll` returns
  // early) — so the control must be disabled, not just inert.
  await expect(page.locator('#btn-reset')).toBeDisabled();

  // A landed-and-clickable photon carries an accessible name describing exactly
  // what Alice encoded; clicking it must put the same reading in the inspector.
  const photon = page.locator('#photon-group g[data-inspectable]').first();
  await photon.waitFor({ state: 'attached', timeout: 30_000 });
  const label = (await photon.getAttribute('aria-label')) ?? '';
  const lm = label.match(/Photon (\d+): Alice bit ([01]), (rectilinear|diagonal) basis, (\d+) degrees\./);
  const bit = num(lm, 2, 'photon bit');
  const basis = lm![3];
  const deg = num(lm, 4, 'photon angle');
  expect([0, 45, 90, 135]).toContain(deg);
  // The angle has to be the one BB84 assigns to that (basis, bit) pair.
  expect(deg).toBe(basis === 'rectilinear' ? (bit === 0 ? 0 : 90) : bit === 0 ? 45 : 135);

  await photon.dispatchEvent('click');
  const reading = `Alice sent: bit ${bit}, ${basis === 'rectilinear' ? '⊕' : '⊗'} basis, ${deg}° polarization.`;
  const inspector = await textOf(page, '#photon-inspector');
  expect(inspector).toContain(reading);
  expect(inspector).toMatch(/Bob measured in [⊕⊗] — bases (match, KEEP|differ, DISCARD)\./);
  // Inspecting a photon lights its whole column in the sifting table.
  expect(await page.locator('#sift-table td.col-active').count()).toBe(5);

  // Somewhere in an Eve run, a wrong-basis interception is captioned on the wire.
  const annotation = page.locator('#photon-group text').filter({ hasText: 'Eve guessed' }).first();
  await expect(annotation).toBeVisible({ timeout: 30_000 });
  expect(await annotation.textContent()).toMatch(/^Eve guessed [⊕⊗], Alice used [⊕⊗] → rotated$/);

  await waitForRun(page);

  // REGRESSION: the frozen reading has to still be there at the end of the run.
  // Eve's tally used to be written into this same element, so on a full-intercept
  // run the reading a visitor clicked a photon to freeze was wiped out by the
  // next wrong-basis interception a few hundred milliseconds later.
  expect(await textOf(page, '#photon-inspector'), 'the "frozen" photon reading was overwritten')
    .toContain(reading);

  // The running tally ties those interceptions to the QBER, and cannot claim
  // more induced errors than interceptions.
  const tally = await textOf(page, '#eve-tally');
  const tm = tally.match(/Eve wrong-basis intercepts: (\d+) · Bob misreads so far: (\d+)/);
  const intercepts = num(tm, 1, 'wrong-basis intercepts');
  const misreads = num(tm, 2, 'Bob misreads');
  expect(intercepts).toBeGreaterThan(0);
  expect(misreads).toBeLessThanOrEqual(intercepts);
  expect(tally).toContain('This is what drives the QBER up.');
});

// ── Verdict lifetime and control liveness ──────────────────────────────────

test('a new run replaces the previous verdict instead of outliving it', async ({ page }) => {
  await openStill(page);
  await runProtocol(page, { eve: true, photons: 256, noise: 1, threshold: 5 });
  await expect(page.locator('#result-banner')).toHaveClass(/\bdetected\b/);

  await runProtocol(page, { eve: false, photons: 256, noise: 0, threshold: 11 });
  const banner = page.locator('#result-banner');
  await expect(banner).toHaveClass(/\bclean\b/);
  await expect(banner).not.toHaveClass(/\bdetected\b/);
  expect(await textOf(page, '#result-banner')).not.toContain('ABORT');
  expect(await textOf(page, '#step-4-body')).not.toContain('ABORT');
  await expect(page.locator('#step-4')).not.toHaveClass(/error-step/);
  expect(await textOf(page, '#channel-caption')).not.toContain('Run aborted');
});

test('Reset clears the run and leaves every control live', async ({ page }) => {
  await openStill(page);
  await runProtocol(page, { eve: true, photons: 128, noise: 1, threshold: 5 });
  await expect(page.locator('#result-banner')).toBeVisible();

  await page.click('#btn-reset');

  await expect(page.locator('#result-banner')).toBeHidden();
  for (const id of ['cnt-sent', 'cnt-sifted', 'cnt-sift-pct', 'cnt-errors', 'cnt-key']) {
    expect(await textOf(page, `#${id}`), `#${id} survived Reset`).toBe('0');
  }
  expect(await textOf(page, '#gauge-label')).toBe('0.0%');
  await expect(page.locator('#btn-encrypt')).toBeDisabled();
  await expect(page.locator('#sift-empty')).toBeVisible();
  expect(await page.locator('#minimap .mm-tick').count()).toBe(0);
  expect(await page.locator('#minimap-empty').count()).toBe(1);
  for (let i = 1; i <= 6; i += 1) {
    expect(await textOf(page, `#step-${i}-body`), `step ${i} body survived Reset`).toBe('');
  }
  expect(await textOf(page, '#photon-inspector')).toContain('Click a photon as it lands');
  expect(await textOf(page, '#eve-tally')).toBe('');
  await expect(page.locator('#eve-tally')).toBeHidden();

  // Reset must not be a dead end: the page still runs afterwards.
  await runProtocol(page, { eve: false, photons: 128, noise: 0, threshold: 11 });
  await expect(page.locator('#result-banner')).toHaveClass(/\bclean\b/);
  await expect(page.locator('#step-6')).toHaveClass(/\bdone\b/);
  await expect(page.locator('#btn-encrypt')).toBeEnabled();
});

test('Encrypt re-runs the round trip on demand after a completed run', async ({ page }) => {
  await openStill(page);
  await runProtocol(page, { eve: false, photons: 128, noise: 0, threshold: 11 });
  await expect(page.locator('#btn-encrypt')).toBeEnabled();

  await page.fill('#msg-input', 'second message');
  await page.click('#btn-encrypt');
  await expect(page.locator('#step-6-body')).toContainText('second message', { timeout: 15_000 });

  const step6 = await textOf(page, '#step-6-body');
  expect(step6).toContain('✓ Bob decrypted Alice\'s ciphertext: "second message"');
  expect(step6).not.toContain('Hello from BB84');
  await expect(page.locator('#step-6')).toHaveClass(/\bdone\b/);
});
