export type Basis = 'rectilinear' | 'diagonal';
export type Bit = 0 | 1;
export type Polarization = '0°' | '90°' | '45°' | '135°';

export interface Photon {
  aliceBit: Bit;
  aliceBasis: Basis;
  polarization: Polarization;
  eveIntercepted?: boolean;
  eveBasis?: Basis;
  eveBit?: Bit;
  bobBasis: Basis;
  bobBit: Bit;
  basesMatch: boolean;
  sacrificed?: boolean;
  isError?: boolean;
}

export interface BB84Result {
  photons: Photon[];
  siftedKey: Bit[];
  siftedIndices: number[];
  sacrificedBits: number;
  qber: number;
  eveDetected: boolean;
  /** Bob's retained bits (his detector readings) after the QBER sacrifice. */
  rawFinalKey: Bit[];
  /** Alice's bits at the same retained positions. Equal to Bob's only where no error occurred. */
  rawFinalKeyAlice: Bit[];
  /**
   * How many retained positions Alice and Bob actually disagree on. Real BB84
   * removes these with an information-reconciliation (error-correction) pass
   * before privacy amplification; this demo does not implement one, so a
   * non-zero count here means the two sides end up with different keys.
   */
  residualErrors: number;
  /** Bob's amplified key. */
  finalKey: Uint8Array;
  /** Alice's amplified key, derived from her own bits by the identical process. */
  aliceFinalKey: Uint8Array;
  /** Whether the two amplified keys are in fact identical (computed, not assumed). */
  keysAgree: boolean;
  keyLengthBits: number;
}

const RECTILINEAR: Basis = 'rectilinear';
const DIAGONAL: Basis = 'diagonal';

function toBit(v: number): Bit {
  return (v & 1) as Bit;
}

function toBasis(v: number): Basis {
  return ((v >> 1) & 1) === 0 ? RECTILINEAR : DIAGONAL;
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomBitFromByte(byte: number): Bit {
  return toBit(byte);
}

function randomBasisFromByte(byte: number): Basis {
  return toBasis(byte);
}

function bitAndBasisToPolarization(bit: Bit, basis: Basis): Polarization {
  if (basis === RECTILINEAR) {
    return bit === 0 ? '0°' : '90°';
  }
  return bit === 0 ? '45°' : '135°';
}

function bitsToBytes(bits: Bit[], minBytes = 16): Uint8Array {
  const neededBytes = Math.max(minBytes, Math.ceil(bits.length / 8));
  const out = new Uint8Array(neededBytes);
  for (let i = 0; i < neededBytes; i += 1) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) {
      const idx = (i * 8 + j) % Math.max(bits.length, 1);
      const bit = bits.length === 0 ? 0 : bits[idx];
      byte = (byte << 1) | bit;
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Privacy amplification: compress the raw key with a cryptographic hash to
 * squeeze out the partial information an eavesdropper may hold.
 *
 * The target length models the secret-key rate: starting from the raw key we
 * subtract a leakage term that grows with the QBER (a simplified ~2·QBER
 * fraction standing in for error-correction + privacy-amplification leakage),
 * with a 256-bit floor so the output can key AES-256.
 *
 * That floor matters for honesty: with the 64-512 photons this demo offers, the
 * raw key is at most ~128 bits, so the floor always wins and SHA-256 is
 * *stretching* the key rather than compressing it. The output is 256 bits wide
 * but carries at most `rawKey.length` bits of entropy. A real deployment sends
 * orders of magnitude more photons, where the subtraction bites and privacy
 * amplification genuinely shrinks the key.
 *
 * Output is derived by SHA-256 in counter mode (H(0‖m) ‖ H(1‖m) ‖ …) so that
 * keys longer than one digest are still pseudo-random rather than a repeated
 * 32-byte block. For the photon counts used here the result is the single
 * 256-bit digest.
 */
export async function privacyAmplification(rawKey: Bit[], qber: number): Promise<Uint8Array> {
  const targetBits = Math.max(256, Math.floor(rawKey.length * (1 - qber * 2)));
  const targetBytes = Math.ceil(targetBits / 8);
  const keyMaterial = bitsToBytes(rawKey, 16);

  const output = new Uint8Array(targetBytes);
  let offset = 0;
  for (let counter = 0; offset < targetBytes; counter += 1) {
    // Prepend a 4-byte big-endian counter so each block has distinct input.
    const block = new Uint8Array(4 + keyMaterial.length);
    block[0] = (counter >>> 24) & 0xff;
    block[1] = (counter >>> 16) & 0xff;
    block[2] = (counter >>> 8) & 0xff;
    block[3] = counter & 0xff;
    block.set(keyMaterial, 4);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', block.buffer as ArrayBuffer));
    const take = Math.min(digest.length, targetBytes - offset);
    output.set(digest.subarray(0, take), offset);
    offset += take;
  }
  return output;
}

/**
 * Run the complete BB84 protocol simulation.
 */
export async function runBB84(
  nPhotons: number,
  evePresent: boolean,
  noiseRate: number,
  qberThreshold: number,
  sacrificeRate: number
): Promise<BB84Result> {
  const safeN = Math.max(1, Math.floor(nPhotons));
  const safeNoise = Math.min(1, Math.max(0, noiseRate));
  const safeThreshold = Math.min(1, Math.max(0, qberThreshold));
  const safeSacrifice = Math.min(1, Math.max(0, sacrificeRate));

  const aliceBitRandom = randomBytes(safeN);
  const aliceBasisRandom = randomBytes(safeN);
  const bobRandom = randomBytes(safeN);
  const eveRandom = evePresent ? randomBytes(safeN) : new Uint8Array(safeN);
  const mismatchedOutcomeRandom = randomBytes(safeN);
  const eveMismatchOutcomeRandom = evePresent ? randomBytes(safeN) : new Uint8Array(safeN);
  const noiseRandom = randomBytes(safeN);

  const photons: Photon[] = [];

  for (let i = 0; i < safeN; i += 1) {
    const aliceBit = randomBitFromByte(aliceBitRandom[i]);
    const aliceBasis = randomBasisFromByte(aliceBasisRandom[i]);
    let transmittedBit: Bit = aliceBit;
    let transmittedBasis: Basis = aliceBasis;

    const photon: Photon = {
      aliceBit,
      aliceBasis,
      polarization: bitAndBasisToPolarization(aliceBit, aliceBasis),
      bobBasis: randomBasisFromByte(bobRandom[i]),
      bobBit: 0,
      basesMatch: false,
    };

    if (evePresent) {
      photon.eveIntercepted = true;
      photon.eveBasis = randomBasisFromByte(eveRandom[i]);
      if (photon.eveBasis === aliceBasis) {
        photon.eveBit = aliceBit;
      } else {
        photon.eveBit = randomBitFromByte(eveMismatchOutcomeRandom[i]);
      }
      transmittedBit = photon.eveBit;
      transmittedBasis = photon.eveBasis;
      photon.polarization = bitAndBasisToPolarization(transmittedBit, transmittedBasis);
    }

    let bobBit: Bit;
    if (photon.bobBasis === transmittedBasis) {
      bobBit = transmittedBit;
    } else {
      bobBit = randomBitFromByte(mismatchedOutcomeRandom[i]);
    }

    if (noiseRandom[i] < safeNoise * 256) {
      bobBit = (1 - bobBit) as Bit;
    }

    photon.bobBit = bobBit;
    photon.basesMatch = photon.aliceBasis === photon.bobBasis;

    photons.push(photon);
  }

  const siftedIndices: number[] = [];
  const siftedKey: Bit[] = [];
  for (let i = 0; i < photons.length; i += 1) {
    if (photons[i].basesMatch) {
      siftedIndices.push(i);
      siftedKey.push(photons[i].bobBit);
    }
  }

  const sacrificedCount = Math.floor(siftedIndices.length * safeSacrifice);
  const sacrificedIndices = siftedIndices.slice(0, sacrificedCount);

  for (const index of sacrificedIndices) {
    photons[index].sacrificed = true;
  }

  let errors = 0;
  for (const pos of sacrificedIndices) {
    const isError = photons[pos].aliceBit !== photons[pos].bobBit;
    photons[pos].isError = isError;
    if (isError) {
      errors += 1;
    }
  }

  const qber = sacrificedIndices.length === 0 ? 0 : errors / sacrificedIndices.length;
  const eveDetected = qber > safeThreshold;

  const postSacrificeIndices = siftedIndices.slice(sacrificedCount);
  const rawFinalKey = postSacrificeIndices.map((idx) => photons[idx].bobBit);
  // Alice's side of the same retained positions. Deriving it is the only way to
  // tell whether the protocol actually produced a *shared* key: Bob's detector
  // readings differ from Alice's wherever noise or Eve flipped a bit, and this
  // demo runs no error-correction pass to repair those positions.
  const rawFinalKeyAlice = postSacrificeIndices.map((idx) => photons[idx].aliceBit);
  let residualErrors = 0;
  for (let i = 0; i < rawFinalKey.length; i += 1) {
    if (rawFinalKey[i] !== rawFinalKeyAlice[i]) {
      residualErrors += 1;
    }
  }

  const finalKey = await privacyAmplification(rawFinalKey, qber);
  const aliceFinalKey = await privacyAmplification(rawFinalKeyAlice, qber);
  const keysAgree =
    finalKey.length === aliceFinalKey.length &&
    finalKey.every((byte, i) => byte === aliceFinalKey[i]);

  return {
    photons,
    siftedKey,
    siftedIndices,
    sacrificedBits: sacrificedCount,
    qber,
    eveDetected,
    rawFinalKey,
    rawFinalKeyAlice,
    residualErrors,
    finalKey,
    aliceFinalKey,
    keysAgree,
    keyLengthBits: finalKey.length * 8,
  };
}
