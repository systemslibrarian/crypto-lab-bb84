## What It Is

Browser-based simulation of BB84 Quantum Key Distribution — the first
quantum cryptography protocol (Bennett & Brassard, 1984) and the only
key exchange method in the crypto-lab suite whose security is guaranteed
by physics rather than mathematics.

While every post-quantum algorithm (ML-KEM, FALCON, SPHINCS+) relies on
mathematical problems believed to be hard for quantum computers, BB84
relies on the no-cloning theorem and the observer effect. A quantum computer
running Shor's algorithm cannot break it — not because the math is harder,
but because there is no math to attack.

Simulates the complete six-step protocol: photon preparation, measurement,
basis sifting, QBER error estimation, privacy amplification, and AES-256-GCM
encryption with the derived key. Eve's eavesdropping attempt is detectable
via the ~25% QBER she introduces. No backends. No simulated math — only
simulated physics.

## When to Use It

- Understanding why QKD is fundamentally different from post-quantum
  cryptography — one is computational, one is physical
- Seeing exactly how eavesdropper detection works via QBER
- Teaching the no-cloning theorem in a tangible, interactive context
- Comparing information-theoretic security (BB84) vs. computational
  security (everything else in the suite)
- Do NOT use as a production QKD implementation — this simulates the
  protocol classically using pseudo-random bits, not actual photons

## Live Demo

https://systemslibrarian.github.io/crypto-lab-bb84/

## What Can Go Wrong

- **QBER threshold too high:** If you set the threshold above 25%, Eve
  can intercept all photons and remain undetected — the protocol breaks
- **Short key after amplification:** With few photons and high sacrifice
  rate, privacy amplification may produce a key too short for AES-256.
  Use at least 256 photons for reliable 256-bit final keys
- **Side-channel attacks:** Real QKD implementations can leak via timing,
  photon number splitting, or detector blinding. This simulation assumes
  a perfect implementation — the no-cloning theorem protects the quantum
  channel, not the hardware around it
- **Authentication gap:** BB84 requires an authenticated classical channel
  to prevent man-in-the-middle attacks. This demo assumes authentication
  is provided — without it, Eve could impersonate Bob entirely

## Real-World Usage

QKD networks are operational in China (2,000km Beijing–Shanghai backbone,
Micius satellite), Europe (EuroQCI), South Korea, Japan, and Singapore.
The technology is deployed for high-value government and financial
communications where the infrastructure cost is justified.

For most applications, NIST-standardized post-quantum cryptography
(ML-KEM, ML-DSA) is more practical — it runs on existing infrastructure
and scales globally. QKD and PQC are complementary, not competing.
