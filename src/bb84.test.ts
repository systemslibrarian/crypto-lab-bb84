import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBB84, privacyAmplification } from './bb84.ts';
import { encryptWithBB84Key, decryptWithBB84Key } from './encrypt.ts';

// Statistical tests use a large photon count so sample means are tight; bounds
// are wide enough to make a spurious failure vanishingly unlikely.
const N = 4000;

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
  const msg = 'So whether you eat or drink — BB84 🔐';
  const enc = await encryptWithBB84Key(r.finalKey, msg);
  const dec = await decryptWithBB84Key(r.finalKey, enc.ciphertext, enc.iv);
  assert.equal(dec, msg);
});

test('GCM authentication rejects a tampered ciphertext', async () => {
  const r = await runBB84(N, false, 0, 0.11, 0.5);
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
  assert.equal(r.residualErrors, 0, 'no noise and no Eve means no retained-bit disagreement');
  assert.equal(r.keysAgree, true);
  assert.deepEqual([...r.aliceFinalKey], [...r.finalKey]);
});

test('Alice encrypts and Bob decrypts on a perfect channel', async () => {
  const r = await runBB84(N, false, 0, 0.11, 0.5);
  const msg = 'So whether you eat or drink — BB84 🔐';
  const enc = await encryptWithBB84Key(r.aliceFinalKey, msg);
  const dec = await decryptWithBB84Key(r.finalKey, enc.ciphertext, enc.iv);
  assert.equal(dec, msg);
});

test('channel noise leaves the two keys different, and Bob cannot decrypt', async () => {
  // 2% noise over ~1000 retained bits: the chance of zero flips is ~e^-20.
  const r = await runBB84(N, false, 0.02, 0.11, 0.5);
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
  assert.ok(r.residualErrors > 0);
  assert.equal(r.keysAgree, false);
});
