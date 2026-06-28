# crypto-lab-bb84

## What It Is

Browser-based simulation of the BB84 Quantum Key Distribution protocol (Bennett & Brassard, 1984). BB84 is the first quantum cryptography protocol and the only key-exchange method whose security is guaranteed by physics — specifically the no-cloning theorem — rather than by computational hardness assumptions. This demo simulates the complete six-step protocol classically: photon preparation, measurement, basis sifting, QBER error estimation, SHA-256 privacy amplification, and AES-256-GCM encryption with the derived key. Eve's eavesdropping is detectable via the ~25% QBER she introduces.

## When to Use It

- **Understanding QKD vs. post-quantum cryptography** — BB84 security is information-theoretic (physics-based), while ML-KEM/ML-DSA security is computational (math-based)
- **Teaching the no-cloning theorem** — the demo makes eavesdropper detection tangible by showing how Eve's measurement collapses photon states
- **Seeing QBER-based eavesdropper detection** — run with and without Eve to compare error rates directly
- **Comparing security models** — the built-in table contrasts RSA, ECDSA, AES-256, ML-KEM, and BB84 side by side
- **Do NOT use as a production QKD implementation** — this simulates the protocol classically using `crypto.getRandomValues`, not actual photons or quantum hardware

## Live Demo

**[systemslibrarian.github.io/crypto-lab-bb84](https://systemslibrarian.github.io/crypto-lab-bb84/)**

Run the BB84 protocol with or without an eavesdropper (Eve) and watch photons animate through the quantum channel in real time. Adjust the number of photons (64–512), channel noise rate, and QBER detection threshold with sliders. After key exchange completes, the demo automatically encrypts and decrypts a user-supplied message with AES-256-GCM using the BB84-derived key.

## What Can Go Wrong

- **Unauthenticated classical channel:** BB84 needs an authenticated public channel for basis reconciliation; without authentication an active attacker can mount a man-in-the-middle on the sifting step.
- **Channel noise vs. eavesdropping:** real QBER mixes natural noise with any eavesdropping, so the detection threshold trades false alarms against missed detection.
- **Hardware side channels:** real photon sources leak — multi-photon pulses enable photon-number-splitting attacks, and detector-blinding attacks have broken deployed QKD links.
- **Classical post-processing still matters:** error correction and privacy amplification must be done correctly, or the final key is not secret even when the QBER looks fine.
- **This is a classical simulation:** it models the protocol with a CSPRNG, not real quantum states, so it cannot provide the physical security guarantees of true QKD hardware.

## Real-World Usage

- Commercial QKD systems are sold by vendors such as ID Quantique and Toshiba for point-to-point fiber links.
- Metropolitan QKD testbed networks have been deployed to connect data centers and government sites.
- Satellite QKD has been demonstrated, most notably by China's Micius satellite for long-distance key distribution.
- QKD is positioned as a niche complement to — not a replacement for — post-quantum cryptography, since it requires dedicated hardware and an authenticated channel.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-bb84
cd crypto-lab-bb84
npm install
npm run dev
```

## Related Demos

- [crypto-lab-e91](https://systemslibrarian.github.io/crypto-lab-e91/) — entanglement-based QKD with a CHSH/Bell test.
- [crypto-lab-shor](https://systemslibrarian.github.io/crypto-lab-shor/) — the quantum algorithm that motivates post-quantum migration.
- [crypto-lab-key-exchange](https://systemslibrarian.github.io/crypto-lab-key-exchange/) — classical Diffie–Hellman/ECDH and ML-KEM key agreement.
- [crypto-lab-kyber-vault](https://systemslibrarian.github.io/crypto-lab-kyber-vault/) — ML-KEM, the computational post-quantum KEM.

---

*One of 120+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
