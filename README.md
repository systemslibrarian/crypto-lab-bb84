## What It Is

Browser-based simulation of the BB84 Quantum Key Distribution protocol (Bennett & Brassard, 1984). BB84 is the first quantum cryptography protocol and the only key-exchange method whose security is guaranteed by physics — specifically the no-cloning theorem — rather than by computational hardness assumptions. This demo simulates the complete six-step protocol classically: photon preparation, measurement, basis sifting, QBER error estimation, SHA-256 privacy amplification, and AES-256-GCM encryption with the derived key. Eve's eavesdropping is detectable via the ~25% QBER she introduces.

## When to Use It

- **Understanding QKD vs. post-quantum cryptography** — BB84 security is information-theoretic (physics-based), while ML-KEM/ML-DSA security is computational (math-based)
- **Teaching the no-cloning theorem** — the demo makes eavesdropper detection tangible by showing how Eve's measurement collapses photon states
- **Seeing QBER-based eavesdropper detection** — run with and without Eve to compare error rates directly
- **Comparing security models** — the built-in table contrasts RSA, ECDSA, AES-256, ML-KEM, and BB84 side by side
- **Do NOT use as a production QKD implementation** — this simulates the protocol classically using `crypto.getRandomValues`, not actual photons or quantum hardware

## Live Demo

[https://systemslibrarian.github.io/crypto-lab-bb84/](https://systemslibrarian.github.io/crypto-lab-bb84/)

Run the BB84 protocol with or without an eavesdropper (Eve) and watch photons animate through the quantum channel in real time. Adjust the number of photons (64–512), channel noise rate, and QBER detection threshold with sliders. After key exchange completes, the demo automatically encrypts and decrypts a user-supplied message with AES-256-GCM using the BB84-derived key.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-bb84
cd crypto-lab-bb84
npm install
npm run dev
```

## Part of the Crypto-Lab Suite

> One of 60+ live browser demos at
> [systemslibrarian.github.io/crypto-lab](https://systemslibrarian.github.io/crypto-lab/)
> — spanning Atbash (600 BCE) through NIST FIPS 203/204/205 (2024).

---

*"Whether you eat or drink, or whatever you do, do all to the glory of God." — 1 Corinthians 10:31*
