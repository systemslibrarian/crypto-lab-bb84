# crypto-lab-bb84

## What It Is

Browser-based simulation of the BB84 Quantum Key Distribution protocol (Bennett & Brassard, 1984). BB84 is the first quantum cryptography protocol, and one of a family of QKD key-exchange methods (E91, B92 and others followed) whose security proofs use quantum physics rather than computational hardness assumptions, under specified device and authenticated-channel models. The main demo simulates six steps classically: photon preparation, measurement, basis sifting, QBER error estimation, SHA-256 key derivation (an illustrative stand-in for privacy amplification), and AES-256-GCM encryption. Its full intercept-resend Eve produces about 25% QBER on an ideal noiseless channel; that number is not a universal eavesdropping signature.

The main run deliberately leaves out **information reconciliation** (error correction) and shows the result. Alice and Bob each derive their own key from their own bits, and step 6 encrypts under Alice's key and decrypts under Bob's — so whenever noise or an undetected Eve flipped a retained bit, the two keys differ and AES-GCM's tag check refuses the message. At the default 256 photons and 1% noise that happens in roughly half of runs (measured over 300 simulated runs); set noise to 0% and run without Eve and the keys agree every time. That failure is the lesson: sifting plus illustrative hashing alone does not give you a shared key over a real channel. The optional post-processing experiment below lets you explore an explicitly limited repair after the main run.

## When to Use It

- **Understanding QKD vs. post-quantum cryptography** — QKD can make information-theoretic secrecy claims under a specified security proof, while ML-KEM/ML-DSA rely on computational assumptions; the browser simulation itself proves neither claim
- **Teaching no-cloning and measurement disturbance** — no universal perfect copier can duplicate every arbitrary unknown quantum state. This does not rule out approximate cloning, entangling interactions or storage. This lab's *intercept-resend* Eve measures in a guessed basis; a wrong guess can disturb Bob's result
- **Seeing QBER-based eavesdropper detection** — run with and without Eve to compare error rates directly
- **Comparing security models** — the built-in table contrasts RSA, ECDSA, AES-256, ML-KEM, and BB84 side by side
- **Do NOT use as a production QKD implementation** — this simulates the protocol classically using `crypto.getRandomValues`, not actual photons or quantum hardware

## Live Demo

**[systemslibrarian.github.io/crypto-lab-bb84](https://systemslibrarian.github.io/crypto-lab-bb84/)**

Run the BB84 protocol with or without an eavesdropper (Eve) and watch photons animate through the quantum channel in real time. Adjust the number of photons (64–512), channel noise rate, and QBER detection threshold with sliders. After key exchange completes, the demo automatically encrypts a user-supplied message with AES-256-GCM under Alice's derived key and attempts to decrypt it under Bob's — a round trip that only succeeds when the two keys really are identical.

The retained-key length varies with the sampled bases; 16–128 retained bits is the expectation across the 64–512-photon settings, not a hard range. The SHA-256 output is 256 bits wide and has at most the smaller of 256 and the actual retained-bit count in entropy, potentially less given Eve's information. Hashing does not create secrecy. This step is illustrative key derivation, not proven QKD privacy amplification: the lab does not estimate conditional min-entropy or choose an extractor output length from a finite-key security bound. See [Renner and König, *Universally composable privacy amplification against quantum adversaries*](https://arxiv.org/abs/quant-ph/0403133).

To make the protocol's mechanics legible rather than decorative, the demo also shows:

1. **A polarization decoder** next to the channel that maps each photon's line angle to its (basis, bit) — and you can click any landed photon to freeze and read exactly what Alice encoded on it (e.g. "bit 1, ⊕ basis, 90°").
2. **A live per-photon sifting table** — Alice's bit, Alice's basis, Bob's independently-chosen basis, and the KEEP/DISCARD outcome — highlighting each column as its photon lands, so the ~50% survival rate reads as a coin-flip consequence rather than a magic number.
3. **Inline Eve annotations**: on an Eve run, each wrong-basis interception is captioned at the moment it happens ("Eve guessed ⊗, Alice used ⊕ → rotated"), and a running tally ties those interceptions to the QBER climbing toward ~25%.
4. **A per-step caption** above the channel that narrates the step in progress in plain language, and **a minimap** of every photon's outcome (kept / discarded / errored) so the sampled detail views reconcile with the aggregate counters.
5. **A key-derivation visual** comparing the retained-bit count with the 256-bit SHA-256 output width, while stating the entropy upper bound and the absence of a privacy-amplification security analysis.

Two optional experiments below the main panels extend the lesson without changing the six-step run:

1. **Public post-processing:** after an accepted run, Alice announces a three-bit Hamming syndrome per seven retained bits. Bob corrects at most one error in each block. An independent public random linear 16-bit tag checks agreement (a mismatched string has tag-collision probability `2^-16`), and a second independent public Toeplitz seed extracts only a length allowed by an **assumed** pre-disclosure lower bound on `H_min(Alice's retained bits | Eve)`. The display subtracts every syndrome and tag bit and a `ceil(2 log2(1/ε))` margin, with `ε = 1/16`; a negative budget becomes zero. The assumed bound starts at zero because the simulation cannot derive it from QBER. More than one error per block can miscorrect, the tag can collide, and this is **not** a finite-key proof. No extracted output is promoted to the AES-256 message step.
2. **Message ordering:** compare Bob confirming receipt before Alice reveals bases with a deliberately flawed schedule revealing bases first. Under the shown attack model (Eve can delay and store qubits, read bases, then forward), exhaustive enumeration of the ideal four-state intercept-resend model yields 0% induced QBER and complete sifted-bit knowledge for Eve in the flawed schedule. In the receipt-first schedule the simple full intercept-resend Eve knows half the positions with certainty, guesses correctly on 75%, and causes 25% QBER. This is a classical attack-model exercise, not an assertion that correct ordering alone proves BB84 secure.

The post-processing model illustrates Renner and König, [*Universally composable privacy amplification against quantum adversaries*](https://arxiv.org/abs/quant-ph/0403133) (TCC 2005), where a public two-universal hash is analyzed with quantum side information. For a fuller extractor exercise, see [Quantum Entropy](https://systemslibrarian.github.io/crypto-lab-quantum-entropy/). The ordering exercise follows Vidick and Wehner, [*Introduction to Quantum Cryptography*](https://doi.org/10.1017/9781009026208) (2023), §8.1.2.

## What Can Go Wrong

- **Unauthenticated classical channel:** BB84 needs an authenticated public channel for basis reconciliation; without authentication an active attacker can mount a man-in-the-middle on the sifting step.
- **Channel noise vs. eavesdropping:** real QBER mixes natural noise with any eavesdropping, so the detection threshold trades false alarms against missed detection.
- **Hardware side channels:** real photon sources leak — multi-photon pulses enable photon-number-splitting attacks, and detector-blinding attacks have broken deployed QKD links.
- **Classical post-processing still matters:** error correction and privacy amplification must be done correctly, or the final key is not secret even when the QBER looks fine. The main run hashes unreconciled bits and has no finite-key privacy-amplification proof. The optional small-code exercise assumes its entropy bound instead of estimating one, and its extracted bits are never used for the AES message. Retained-bit disagreement in the main run can leave Alice and Bob with different AES keys.
- **Early basis announcement:** if the protocol lets an attacker delay quantum delivery until after Alice reveals her bases, a quantum-memory Eve in this model learns the sifted bits without inducing QBER. The optional timeline compares that flaw with receipt-first ordering; authentication and timing assumptions still matter.
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
npm run dev      # start the dev server
npm test         # run the protocol + crypto unit tests
npm run build    # type-check and produce a production build
```

## Related Demos

- [crypto-lab-e91](https://systemslibrarian.github.io/crypto-lab-e91/) — entanglement-based QKD with a CHSH/Bell test.
- [crypto-lab-shor](https://systemslibrarian.github.io/crypto-lab-shor/) — the quantum algorithm that motivates post-quantum migration.
- [crypto-lab-key-exchange](https://systemslibrarian.github.io/crypto-lab-key-exchange/) — classical Diffie–Hellman/ECDH and ML-KEM key agreement.
- [crypto-lab-kyber-vault](https://systemslibrarian.github.io/crypto-lab-kyber-vault/) — ML-KEM, the computational post-quantum KEM.

---

*Part of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
