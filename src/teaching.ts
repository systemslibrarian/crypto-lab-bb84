import type { Bit } from './bb84';

/**
 * Optional, classical teaching model of BB84's public post-processing.
 * It deliberately takes a *supplied* conditional-min-entropy lower bound;
 * the BB84 simulator cannot infer that bound from its sampled QBER.
 */
export const VERIFICATION_BITS = 16;

function randomBits(length: number): Bit[] {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => (byte & 1) as Bit);
}

function assertBits(bits: readonly Bit[], label: string): void {
  if (!bits.every(bit => bit === 0 || bit === 1)) throw new Error(`${label} must contain bits`);
}

/** The columns of the Hamming parity-check matrix are 1, 2, ..., 7. */
export function syndrome(block: readonly Bit[]): number {
  if (block.length > 7) throw new Error('syndrome accepts at most seven bits');
  assertBits(block, 'block');
  return block.reduce<number>((sum, bit, index) => bit ? sum ^ (index + 1) : sum, 0);
}

export interface Reconciliation {
  bobCorrected: Bit[];
  aliceSyndromes: number[];
  disclosureBits: number;
  attemptedCorrections: number;
}

/**
 * Alice announces three syndrome bits per seven-bit block. Bob corrects one
 * error per block; multiple errors can miscorrect, hence the separate check.
 */
export function reconcileSingleErrorBlocks(alice: readonly Bit[], bob: readonly Bit[]): Reconciliation {
  if (alice.length !== bob.length || alice.length === 0) throw new Error('equal, nonempty strings required');
  assertBits(alice, 'Alice');
  assertBits(bob, 'Bob');
  const bobCorrected = [...bob];
  const aliceSyndromes: number[] = [];
  let attemptedCorrections = 0;
  for (let start = 0; start < alice.length; start += 7) {
    const end = Math.min(start + 7, alice.length);
    const aliceSyndrome = syndrome(alice.slice(start, end));
    aliceSyndromes.push(aliceSyndrome);
    const difference = aliceSyndrome ^ syndrome(bobCorrected.slice(start, end));
    if (difference > 0 && difference <= end - start) {
      bobCorrected[start + difference - 1] = (1 - bobCorrected[start + difference - 1]) as Bit;
      attemptedCorrections += 1;
    }
  }
  return {
    bobCorrected,
    aliceSyndromes,
    disclosureBits: aliceSyndromes.length * 3,
    attemptedCorrections,
  };
}

/** A publicly seeded random linear hash; collision probability is 2^-rows. */
export function linearTag(bits: readonly Bit[], seed: readonly Bit[], rows = VERIFICATION_BITS): Bit[] {
  if (seed.length !== rows * bits.length || rows < 1) throw new Error('invalid verification seed size');
  assertBits(bits, 'input');
  assertBits(seed, 'verification seed');
  return Array.from({ length: rows }, (_, row) => {
    let value = 0;
    for (let col = 0; col < bits.length; col += 1) value ^= bits[col] & seed[row * bits.length + col];
    return value as Bit;
  });
}

/** A two-universal Toeplitz matrix with n + outputBits - 1 public seed bits. */
export function toeplitzExtract(bits: readonly Bit[], seed: readonly Bit[], outputBits: number): Bit[] {
  if (!Number.isInteger(outputBits) || outputBits < 0) throw new Error('invalid output length');
  if (outputBits === 0) return [];
  if (bits.length === 0 || seed.length !== bits.length + outputBits - 1) throw new Error('invalid Toeplitz seed size');
  assertBits(bits, 'input');
  assertBits(seed, 'Toeplitz seed');
  return Array.from({ length: outputBits }, (_, row) => {
    let value = 0;
    for (let col = 0; col < bits.length; col += 1) value ^= bits[col] & seed[row - col + bits.length - 1];
    return value as Bit;
  });
}

export interface PostprocessResult extends Reconciliation {
  verificationPassed: boolean;
  /** Simulator-only oracle; Alice and Bob do not learn this by comparing secret strings. */
  actuallyAgreed: boolean;
  publicDisclosureBits: number;
  assumedMinEntropyBits: number;
  leftoverMarginBits: number;
  budgetCapBits: number;
  outputBits: number;
  aliceExtracted: Bit[];
  bobExtracted: Bit[];
}

export function postprocessTeachingRun(
  alice: readonly Bit[], bob: readonly Bit[], assumedMinEntropyBits: number,
  secrecyError = 1 / 16,
  seeds: { verification?: Bit[]; extraction?: Bit[] } = {},
): PostprocessResult {
  if (!Number.isInteger(assumedMinEntropyBits) || assumedMinEntropyBits < 0 || assumedMinEntropyBits > alice.length) {
    throw new Error('assumed conditional min-entropy must be between zero and the retained length');
  }
  if (!(secrecyError > 0 && secrecyError < 1)) throw new Error('invalid secrecy error');
  const reconciled = reconcileSingleErrorBlocks(alice, bob);
  const verificationSeed = seeds.verification ?? randomBits(VERIFICATION_BITS * alice.length);
  const aliceTag = linearTag(alice, verificationSeed);
  const bobTag = linearTag(reconciled.bobCorrected, verificationSeed);
  const verificationPassed = aliceTag.every((bit, i) => bit === bobTag[i]);
  const actuallyAgreed = alice.every((bit, i) => bit === reconciled.bobCorrected[i]);
  const publicDisclosureBits = reconciled.disclosureBits + VERIFICATION_BITS;
  // Conservative round-down form of the leftover-hash budget for an assumed
  // H_min(A|E) before these public messages. This is not a QKD security proof.
  const leftoverMarginBits = Math.ceil(2 * Math.log2(1 / secrecyError));
  const budgetCapBits = Math.max(0, Math.min(alice.length, assumedMinEntropyBits - publicDisclosureBits - leftoverMarginBits));
  const outputBits = verificationPassed ? budgetCapBits : 0;
  const extractionSeed = outputBits > 0
    ? (seeds.extraction ?? randomBits(alice.length + outputBits - 1)) : [];
  return {
    ...reconciled,
    verificationPassed,
    actuallyAgreed,
    publicDisclosureBits,
    assumedMinEntropyBits,
    leftoverMarginBits,
    budgetCapBits,
    outputBits,
    aliceExtracted: verificationPassed ? toeplitzExtract(alice, extractionSeed, outputBits) : [],
    bobExtracted: verificationPassed ? toeplitzExtract(reconciled.bobCorrected, extractionSeed, outputBits) : [],
  };
}

export type AnnouncementOrder = 'receipt-first' | 'bases-first';

/** Exact enumeration of the ideal four-state full intercept-resend model. */
export function orderingExperiment(order: AnnouncementOrder): {
  siftedCases: number; bobErrors: number; eveGuessCorrect: number; eveKnown: number;
} {
  let siftedCases = 0;
  let bobErrors = 0;
  let eveGuessCorrect = 0;
  let eveKnown = 0;
  // Extra random outcomes are enumerated even when unused, keeping all cases
  // equally weighted without a Monte Carlo variance or hidden fixed sample.
  for (const aliceBit of [0, 1]) for (const aliceBasis of [0, 1]) {
    for (const eveGuess of [0, 1]) for (const wrongBasisOutcome of [0, 1]) {
      for (const bobWrongBasisOutcome of [0, 1]) {
        const eveBasis = order === 'bases-first' ? aliceBasis : eveGuess;
        const eveBit = eveBasis === aliceBasis ? aliceBit : wrongBasisOutcome;
        const bobBit = eveBasis === aliceBasis ? eveBit : bobWrongBasisOutcome;
        siftedCases += 1; // Bob's matching-basis rounds, after sifting.
        if (bobBit !== aliceBit) bobErrors += 1;
        if (eveBit === aliceBit) eveGuessCorrect += 1;
        if (eveBasis === aliceBasis) eveKnown += 1;
      }
    }
  }
  return { siftedCases, bobErrors, eveGuessCorrect, eveKnown };
}
