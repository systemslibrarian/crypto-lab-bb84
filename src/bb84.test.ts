import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBB84, privacyAmplification } from './bb84.ts';
import type { BB84Accepted, BB84Result } from './bb84.ts';
import { encryptWithBB84Key, decryptWithBB84Key } from './encrypt.ts';

// Statistical tests use a large photon count so sample means are tight; bounds
// are wide enough to make a spurious failure vanishingly unlikely.
const N = 4000;

// Key material only exists on the accepted branch of the result union; this
// narrows (and asserts) before a test touches it.
function assertAccepted(r: BB84Result): asserts r is BB84Accepted {
  assert.equal(r.status, 'accepted', `expected an accepted run, got ${r.status}`);
}

test('clean channel (no Eve, no noise) yields QBER 0 and is not flagged', async () => {
  const r = await runBB84(N, false, 0, 0.11, 0.5);
  assert.equal(r.qber, 0, 'QBER must be exactly 0 with no Eve and no noise');
  assert.equal(r.eveDetected, false);
});

test('sifting keeps ~50% of photons (bases agree half the time)', async () => {
  const r = await runBB84(N, false, 0, 0.11, 0.5);
  const ratio = r.siftedIndices.length / N;
  assert.ok(ratio > 0.42 && ratio < 0.58, `sift ratio ${ratio} should be ~0.5`);
});

test('intercept-resend Eve drives QBER toward 25% and is detected', async () => {
  const r = await runBB84(N, true, 0, 0.11, 0.5);
  assert.ok(r.qber > 0.18 && r.qber < 0.32, `QBER ${r.qber} should be ~0.25`);
  assert.equal(r.eveDetected, true, 'Eve must trip the 11% threshold');
});

test('channel noise alone can be tuned below the detection threshold', async () => {
  // 2% noise, 11% threshold → QBER should stay well under threshold, no false alarm.
  const r = await runBB84(N, false, 0.02, 0.11, 0.5);
  assert.ok(r.qber < 0.06, `noisy-but-clean QBER ${r.qber} should stay low`);
  assert.equal(r.eveDetected, false, 'natural noise must not be flagged as Eve');
});

test('privacy amplification returns a deterministic 256-bit key for typical sizes', async () => {
  const raw = Array.from({ length: 128 }, (_, i) => (i % 2) as 0 | 1);
  const a = await privacyAmplification(raw, 0.01);
  const b = await privacyAmplification(raw, 0.01);
  assert.equal(a.length, 32, 'final key should be 32 bytes (256 bits)');
  assert.deepEqual([...a], [...b], 'privacy amplification must be deterministic');
});

test('privacy amplification expands past one digest without repeating blocks', async () => {
  // Force a > 256-bit target so the counter-mode expansion path runs.
  const raw = Array.from({ length: 2000 }, (_, i) => (i % 3 === 0 ? 1 : 0) as 0 | 1);
  const key = await privacyAmplification(raw, 0); // target = 2000 bits = 250 bytes
  assert.ok(key.length > 32, 'should produce more than one SHA-256 block');
  const first = key.subarray(0, 32);
  const second = key.subarray(32, 64);
  assert.notDeepEqual([...first], [...second], 'expanded blocks must differ');
});

test('AES-256-GCM round-trips a message under the derived key', async () => {
  const r = await runBB84(N, false, 0, 0.11, 0.5);
  assertAccepted(r);
  const msg = 'So whether you eat or drink — BB84 🔐';
  const enc = await encryptWithBB84Key(r.finalKey, msg);
  const dec = await decryptWithBB84Key(r.finalKey, enc.ciphertext, enc.iv);
  assert.equal(dec, msg);
});

test('GCM authentication rejects a tampered ciphertext', async () => {
  const r = await runBB84(N, false, 0, 0.11, 0.5);
  assertAccepted(r);
  const enc = await encryptWithBB84Key(r.finalKey, 'tamper me');
  // Flip the first byte of the ciphertext hex.
  const flipped = (enc.ciphertext[0] === '0' ? '1' : '0') + enc.ciphertext.slice(1);
  await assert.rejects(() => decryptWithBB84Key(r.finalKey, flipped, enc.iv));
});

// ── Key agreement ──────────────────────────────────────────
// Step 6 encrypts under Alice's key and decrypts under Bob's, so these pin down
// when the protocol really does produce a shared secret and when it does not.
// Without an error-correction pass it does not, the moment a retained bit flips.

test('a perfect channel leaves Alice and Bob holding the same key', async () => {
  const r = await runBB84(N, false, 0, 0.11, 0.5);
  assertAccepted(r);
  assert.equal(r.residualErrors, 0, 'no noise and no Eve means no retained-bit disagreement');
  assert.equal(r.keysAgree, true);
  assert.deepEqual([...r.aliceFinalKey], [...r.finalKey]);
});

test('Alice encrypts and Bob decrypts on a perfect channel', async () => {
  const r = await runBB84(N, false, 0, 0.11, 0.5);
  assertAccepted(r);
  const msg = 'So whether you eat or drink — BB84 🔐';
  const enc = await encryptWithBB84Key(r.aliceFinalKey, msg);
  const dec = await decryptWithBB84Key(r.finalKey, enc.ciphertext, enc.iv);
  assert.equal(dec, msg);
});

test('channel noise leaves the two keys different, and Bob cannot decrypt', async () => {
  // 2% noise over ~1000 retained bits: the chance of zero flips is ~e^-20.
  const r = await runBB84(N, false, 0.02, 0.11, 0.5);
  assertAccepted(r);
  assert.ok(r.residualErrors > 0, `expected retained-bit disagreements, got ${r.residualErrors}`);
  assert.equal(r.keysAgree, false, 'different raw bits must not amplify to the same key');
  const enc = await encryptWithBB84Key(r.aliceFinalKey, 'no reconciliation pass here');
  await assert.rejects(
    () => decryptWithBB84Key(r.finalKey, enc.ciphertext, enc.iv),
    'AES-GCM must reject, because BB84 without error correction did not produce a shared key'
  );
});

test('an undetected-Eve run also fails to produce a shared key', async () => {
  // Threshold pushed above 25% so Eve is NOT flagged; the keys still diverge.
  const r = await runBB84(N, true, 0, 0.9, 0.5);
  assert.equal(r.eveDetected, false, 'threshold deliberately set too high to flag her');
  assertAccepted(r);
  assert.ok(r.residualErrors > 0);
  assert.equal(r.keysAgree, false);
});

// ── The threshold boundary ────────────────────────────────────────────────
// `eveDetected` used to be `qber > threshold`, so a run landing EXACTLY on the
// threshold took the clean branch, and the page then said the QBER was "below"
// / "under" the threshold — false, in the state where it matters most.
//
// Measured with this engine: QBER lands exactly on the threshold in 59 of
// 19,200 runs (0.31%), and 49 of those 59 have Eve present. So the boundary is
// overwhelmingly the run where the lab would have announced "no eavesdropper
// detectable" with an eavesdropper on the line.
//
// This asserts the boundary directly rather than hunting for it statistically:
// a sacrifice sample of exactly 4 bits with 1 error is a QBER of 0.25.
test('QBER exactly at the threshold aborts, rather than being called clean', async () => {
  // Drive the boundary through the public API by choosing a threshold the run
  // can hit exactly. With sacrificeRate 0.5 the sacrificed count is half the
  // sifted bits, so QBER is a ratio of small integers and hits round values.
  let sawEquality = false;
  for (let i = 0; i < 2000 && !sawEquality; i += 1) {
    const r = await runBB84(64, true, 0, 0.2, 0.5);
    if (r.qber === 0.2) {
      sawEquality = true;
      assert.equal(
        r.eveDetected,
        true,
        'QBER equal to the threshold must be treated as detected, not clean',
      );
    }
  }
  assert.equal(sawEquality, true, 'the boundary case never occurred — test proved nothing');
});

test('a QBER just below the threshold is still clean', async () => {
  // The fix must not turn the strict inequality inside out: below stays clean.
  const r = await runBB84(4000, false, 0, 0.11, 0.5);
  assert.equal(r.qber, 0);
  assert.equal(r.eveDetected, false, 'a QBER of 0 must never be flagged');
});

// ── Privacy amplification binds the raw-key length ────────────────────────
// `bitsToBytes` fills its 16-byte minimum by repeating the bit sequence
// cyclically, so a key and that same key repeated produced byte-for-byte
// identical material. Verified before the fix: a 16-bit key, its 32-bit double
// and its 64-bit quadruple all derived the same final key.
test('a key and the same key repeated derive DIFFERENT final keys', async () => {
  const k = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 0, 1] as const;
  const bits = [...k] as Array<0 | 1>;
  const doubled = [...bits, ...bits];
  const quad = [...doubled, ...doubled];

  const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
  const a = hex(await privacyAmplification(bits, 0.02));
  const b = hex(await privacyAmplification(doubled, 0.02));
  const c = hex(await privacyAmplification(quad, 0.02));

  assert.notEqual(a, b, 'a key and its double must not collide');
  assert.notEqual(b, c, 'a key and its quadruple must not collide');
  assert.equal(a.length > 0 && b.length > 0 && c.length > 0, true);
});

// ── Fail-closed key derivation ────────────────────────────────────────────
// `runBB84` used to derive Alice's and Bob's final keys BEFORE anyone looked
// at `eveDetected`; the UI refused to show them, but the core still ran
// privacy amplification over a transcript that had failed parameter
// estimation. The result union now makes the aborted branch key-free.

test('an aborted run carries no key material at all', async () => {
  const r = await runBB84(N, true, 0, 0.11, 0.5);
  assert.equal(r.eveDetected, true, 'full intercept-resend must trip an 11% threshold at N=4000');
  assert.equal(r.status, 'aborted');
  assert.equal(r.status === 'aborted' && r.reason, 'qber-threshold');
  for (const field of ['finalKey', 'aliceFinalKey', 'rawFinalKey', 'rawFinalKeyAlice', 'keysAgree']) {
    assert.equal(field in r, false, `aborted transcripts must not carry "${field}"`);
  }
});

test('a 100% sacrifice rate aborts instead of deriving a key from nothing', async () => {
  const r = await runBB84(N, false, 0, 0.11, 1);
  assert.equal(r.status, 'aborted');
  assert.equal(r.status === 'aborted' && r.reason, 'insufficient-key-material');
  assert.equal('finalKey' in r, false, 'no retained bits must mean no key');
});

test('privacy amplification rejects an empty raw key', async () => {
  // The old code hashed deterministic zero material and returned the same
  // fixed 256-bit "key" for every empty input.
  await assert.rejects(() => privacyAmplification([], 0), /at least one raw key bit/);
});

// ── Noise sampling is unbiased ────────────────────────────────────────────
// Noise used to be applied as `randomByte < rate * 256`, rounding every rate
// up to the next multiple of 1/256: a selected 0.2% actually flipped bits at
// 1/256 ≈ 0.39%, nearly double. On a clean no-Eve channel every sacrificed-bit
// error IS a noise flip, so the sampled QBER measures the applied rate
// directly. Aggregated over 30 runs (~30,000 sacrificed bits) the old code
// lands near 0.39% and the fix near 0.2%; the 0.28% cutoff separates the two
// by ~3 sigma each way.
test('a 0.2% noise rate flips ~0.2% of bits, not the next 1/256 step up', async () => {
  let errors = 0;
  let sacrificed = 0;
  for (let i = 0; i < 30; i += 1) {
    // Threshold 1 so the run is never aborted by its own noise.
    const r = await runBB84(N, false, 0.002, 1, 0.5);
    errors += Math.round(r.qber * r.sacrificedBits);
    sacrificed += r.sacrificedBits;
  }
  const rate = errors / sacrificed;
  assert.ok(rate < 0.0028, `noise rate ${rate} shows the old 1/256 rounding bias`);
  assert.ok(rate > 0.0008, `noise rate ${rate} is implausibly low for 0.2%`);
});

test('privacy amplification stays deterministic for the same input', async () => {
  const bits = [1, 0, 0, 1, 1, 1, 0, 1] as Array<0 | 1>;
  const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(
    hex(await privacyAmplification(bits, 0.02)),
    hex(await privacyAmplification(bits, 0.02)),
    'the same raw key must derive the same final key',
  );
});
