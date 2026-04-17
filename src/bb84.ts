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
  rawFinalKey: Bit[];
  finalKey: Uint8Array;
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
 * Privacy amplification: hash the raw key to eliminate Eve's partial info.
 * Uses SHA-256 via WebCrypto, truncated to desired output length.
 * Output length = floor(rawKey.length * (1 - qber * 2)) bits minimum 256.
 */
export async function privacyAmplification(rawKey: Bit[], qber: number): Promise<Uint8Array> {
  const targetBits = Math.max(256, Math.floor(rawKey.length * (1 - qber * 2)));
  const targetBytes = Math.ceil(targetBits / 8);
  const keyMaterial = bitsToBytes(rawKey, 16);
  const digest = await crypto.subtle.digest('SHA-256', keyMaterial.buffer as ArrayBuffer);
  const hash = new Uint8Array(digest);

  if (targetBytes <= hash.length) {
    return hash.slice(0, targetBytes);
  }

  const output = new Uint8Array(targetBytes);
  for (let i = 0; i < targetBytes; i += 1) {
    output[i] = hash[i % hash.length];
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
  const finalKey = await privacyAmplification(rawFinalKey, qber);

  return {
    photons,
    siftedKey,
    siftedIndices,
    sacrificedBits: sacrificedCount,
    qber,
    eveDetected,
    rawFinalKey,
    finalKey,
    keyLengthBits: finalKey.length * 8,
  };
}
