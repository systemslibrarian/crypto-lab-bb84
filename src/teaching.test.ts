import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bit } from './bb84.ts';
import {
  linearTag, orderingExperiment, postprocessTeachingRun,
  reconcileSingleErrorBlocks, syndrome, toeplitzExtract, VERIFICATION_BITS,
} from './teaching.ts';

test('every supported single error in each Hamming block is corrected', () => {
  for (let length = 1; length <= 7; length += 1) {
    for (let word = 0; word < 2 ** length; word += 1) {
      const alice = Array.from({ length }, (_, i) => ((word >> i) & 1) as Bit);
      for (let error = 0; error < length; error += 1) {
        const bob = [...alice];
        bob[error] = (1 - bob[error]) as Bit;
        const fixed = reconcileSingleErrorBlocks(alice, bob);
        assert.deepEqual(fixed.bobCorrected, alice, `length=${length} word=${word} error=${error}`);
        assert.equal(fixed.attemptedCorrections, 1);
        assert.equal(fixed.disclosureBits, 3);
      }
    }
  }
  assert.equal(syndrome([1, 0, 1, 0, 0, 0, 0]), 1 ^ 3);
});

test('public verification can flag more than one error in a block', () => {
  const alice = Array<Bit>(28).fill(0);
  const bob = [...alice];
  bob[0] = 1; bob[1] = 1;
  // In a Hamming block, errors in columns 1 and 2 have syndrome 3; Bob
  // miscorrects position 3. A public universal tag catches this instance.
  const seed: Bit[] = Array<Bit>(VERIFICATION_BITS * alice.length).fill(0);
  seed[0] = 1;
  const result = postprocessTeachingRun(alice, bob, 28, 1 / 16, { verification: seed });
  assert.equal(result.attemptedCorrections, 1);
  assert.equal(result.actuallyAgreed, false);
  assert.equal(result.verificationPassed, false);
  assert.equal(result.outputBits, 0);
  assert.deepEqual(result.aliceExtracted, []);
});

test('Toeplitz extraction matches a hand-computed 3-by-4 matrix', () => {
  const source: Bit[] = [1, 0, 1, 1];
  // rows: 1101, 0110, 0011. Dot products give 0, 1, 0.
  const seed: Bit[] = [1, 0, 1, 1, 0, 0];
  assert.deepEqual(toeplitzExtract(source, seed, 3), [0, 1, 0]);
  assert.throws(() => toeplitzExtract(source, seed.slice(1), 3), /seed size/);
  assert.deepEqual(toeplitzExtract(source, [], 0), []);
});

test('a manually assumed entropy budget loses every public bit and the error margin', () => {
  const alice = Array<Bit>(84).fill(0).map((_, i) => (i % 3 === 0 ? 1 : 0));
  const bob = [...alice]; bob[8] = (1 - bob[8]) as Bit;
  const seeded = Array<Bit>(VERIFICATION_BITS * alice.length).fill(0);
  const extractionSeed = Array<Bit>(84 + 24 - 1).fill(1);
  const result = postprocessTeachingRun(alice, bob, 84, 1 / 16,
    { verification: seeded, extraction: extractionSeed });
  assert.equal(result.actuallyAgreed, true);
  assert.equal(result.verificationPassed, true);
  assert.equal(result.disclosureBits, 36); // 12 blocks × 3 syndrome bits
  assert.equal(result.publicDisclosureBits, 52); // plus 16-bit public tag
  assert.equal(result.leftoverMarginBits, 8);
  assert.equal(result.outputBits, 24);
  assert.deepEqual(result.bobExtracted, result.aliceExtracted);
  const noEntropy = postprocessTeachingRun(alice, bob, 52, 1 / 16, { verification: seeded });
  assert.equal(noEntropy.outputBits, 0);
  assert.deepEqual(noEntropy.aliceExtracted, []);
  assert.throws(() => postprocessTeachingRun(alice, bob, 85), /between zero/);
});

test('linear tag has expected dimensions and detects a chosen bit difference', () => {
  const seed: Bit[] = [1, 0, 0, 0, 1, 0];
  assert.deepEqual(linearTag([1, 0, 0], seed, 2), [1, 0]);
  assert.deepEqual(linearTag([0, 0, 0], seed, 2), [0, 0]);
});

test('receipt-first restricts Eve to a basis guess; early bases expose all sifted bits', () => {
  const correct = orderingExperiment('receipt-first');
  const flawed = orderingExperiment('bases-first');
  assert.deepEqual(correct, { siftedCases: 32, bobErrors: 8, eveGuessCorrect: 24, eveKnown: 16 });
  assert.deepEqual(flawed, { siftedCases: 32, bobErrors: 0, eveGuessCorrect: 32, eveKnown: 32 });
});
