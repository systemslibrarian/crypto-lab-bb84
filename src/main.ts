import './style.css';
import { runBB84 } from './bb84';
import type { Photon } from './bb84';
import { encryptWithBB84Key, decryptWithBB84Key } from './encrypt';

// ── DOM refs ───────────────────────────────────────────────
function $<T extends Element>(id: string): T {
  return document.getElementById(id) as unknown as T;
}

const btnClean    = $<HTMLButtonElement>('btn-run-clean');
const btnEve      = $<HTMLButtonElement>('btn-run-eve');
const btnReset    = $<HTMLButtonElement>('btn-reset');
const btnEncrypt  = $<HTMLButtonElement>('btn-encrypt');
const msgInput    = $<HTMLInputElement>('msg-input');

const slPhotons   = $<HTMLInputElement>('sl-photons');
const slNoise     = $<HTMLInputElement>('sl-noise');
const slThreshold = $<HTMLInputElement>('sl-threshold');
const lblPhotons  = $('lbl-photons');
const lblNoise    = $('lbl-noise');
const lblThreshold= $('lbl-threshold');

const cntSent     = $('cnt-sent');
const cntSifted   = $('cnt-sifted');
const cntSiftPct  = $('cnt-sift-pct');
const cntErrors   = $('cnt-errors');
const cntErrorPct = $('cnt-error-pct');
const cntKey      = $('cnt-key');

const photonGroup = $<SVGGElement>('photon-group');
const eveNode     = $<SVGGElement>('eve-node');
const gaugeNeedle = $<SVGLineElement>('gauge-needle');
const gaugeLabel  = $<SVGTextElement>('gauge-label');

const themeToggle = $<HTMLButtonElement>('theme-toggle');

// ── State ──────────────────────────────────────────────────
let running = false;
let amplifiedKey: Uint8Array | null = null;

// ── Slider labels ──────────────────────────────────────────
slPhotons.addEventListener('input', () => { lblPhotons.textContent = slPhotons.value; });
slNoise.addEventListener('input', () => { lblNoise.textContent = slNoise.value + '%'; });
slThreshold.addEventListener('input', () => { lblThreshold.textContent = slThreshold.value + '%'; });

// ── Theme toggle ───────────────────────────────────────────
function updateThemeIcon(): void {
  const current = document.documentElement.getAttribute('data-theme');
  themeToggle.textContent = current === 'dark' ? '🌙' : '☀️';
}

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cv-theme', next);
  updateThemeIcon();
});

updateThemeIcon();

// ── Step accordion ─────────────────────────────────────────
document.querySelectorAll('.step-header').forEach(header => {
  const toggle = (): void => {
    const step = header.parentElement!;
    const isOpen = step.classList.contains('open');
    step.classList.toggle('open', !isOpen);
    header.setAttribute('aria-expanded', String(!isOpen));
  };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
});

// Explainer accordion
document.querySelectorAll('.explainer-header').forEach(header => {
  const toggle = (): void => {
    const el = header.parentElement!;
    const isOpen = el.classList.contains('open');
    el.classList.toggle('open', !isOpen);
    header.setAttribute('aria-expanded', String(!isOpen));
  };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
});

// ── Helpers ────────────────────────────────────────────────
function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function basisSymbol(b: string): string {
  return b === 'rectilinear' ? '⊕' : '⊗';
}

function setStepState(n: number, state: 'active' | 'done' | 'error' | 'idle'): void {
  const step = $(`step-${n}`);
  step.classList.remove('active', 'done', 'error-step');
  if (state === 'active') {
    step.classList.add('active', 'open');
    step.querySelector('.step-header')!.setAttribute('aria-expanded', 'true');
  } else if (state === 'done') {
    step.classList.add('done');
  } else if (state === 'error') {
    step.classList.add('error-step', 'open');
    step.querySelector('.step-header')!.setAttribute('aria-expanded', 'true');
  }
}

function setStepContent(n: number, html: string): void {
  $(`step-${n}-body`).innerHTML = html;
}

function updateCounters(sent: number, sifted: number, errors: number, keyBits: number): void {
  cntSent.textContent = String(sent);
  cntSifted.textContent = String(sifted);
  cntSiftPct.textContent = sent > 0 ? ((sifted / sent) * 100).toFixed(0) : '0';
  cntErrors.textContent = String(errors);
  cntErrorPct.textContent = sifted > 0 ? ((errors / sifted) * 100).toFixed(1) : '0';
  cntKey.textContent = String(keyBits);
}

function setGauge(qber: number): void {
  // Map 0-0.5 to angle 180° (left) to 0° (right)
  const clamped = Math.min(0.5, Math.max(0, qber));
  const angle = Math.PI - (clamped / 0.5) * Math.PI;
  const cx = 100, cy = 100, r = 75;
  const x = cx + r * Math.cos(angle);
  const y = cy - r * Math.sin(angle);
  gaugeNeedle.setAttribute('x2', String(x));
  gaugeNeedle.setAttribute('y2', String(y));

  const pct = (clamped * 100).toFixed(1);
  gaugeLabel.textContent = pct + '%';
  gaugeLabel.setAttribute('aria-label', `QBER gauge showing ${pct} percent`);

  let color = '#00ff88';
  if (clamped > 0.25) color = '#ff3366';
  else if (clamped > 0.11) color = '#ffaa00';
  gaugeNeedle.setAttribute('stroke', color);
  gaugeLabel.setAttribute('fill', color);
}

function clearPhotons(): void {
  while (photonGroup.firstChild) photonGroup.removeChild(photonGroup.firstChild);
}

function setButtons(enabled: boolean): void {
  btnClean.disabled = !enabled;
  btnEve.disabled = !enabled;
  slPhotons.disabled = !enabled;
  slNoise.disabled = !enabled;
  slThreshold.disabled = !enabled;
}

// ── Photon Animation ───────────────────────────────────────
const CHAN_X_START = 135;
const CHAN_X_END   = 865;
const CHAN_Y       = 140;
const PHOTON_TRAVEL_MS = 800;
const BATCH_DELAY_MS = 100;
const MAX_VISIBLE = 8;

function photonColor(p: Photon): string {
  if (p.basesMatch && p.isError) return '#ff3366';
  if (p.basesMatch) return '#ffd700';
  return '#444444';
}

async function animatePhotons(photons: Photon[], evePresent: boolean): Promise<void> {
  clearPhotons();
  eveNode.style.display = evePresent ? 'block' : 'none';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) return;

  const total = photons.length;
  const batchSize = Math.min(total, MAX_VISIBLE);

  for (let i = 0; i < total; i += batchSize) {
    const batch = photons.slice(i, i + batchSize);
    const promises = batch.map((p, j) => animateSinglePhoton(p, j * BATCH_DELAY_MS, evePresent));
    await Promise.all(promises);
    clearPhotons();
  }
}

function animateSinglePhoton(p: Photon, delayMs: number, evePresent: boolean): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      const ns = 'http://www.w3.org/2000/svg';
      const g = document.createElementNS(ns, 'g');

      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('r', '5');
      dot.setAttribute('fill', '#00d4ff');
      dot.setAttribute('cy', String(CHAN_Y));

      const line = document.createElementNS(ns, 'line');
      // Compute Alice's ORIGINAL polarization (before Eve overwrites p.polarization)
      const alicePol = p.aliceBit === 0
        ? (p.aliceBasis === 'rectilinear' ? 0 : 45)
        : (p.aliceBasis === 'rectilinear' ? 90 : 135);
      const aliceAngle = alicePol * (Math.PI / 180);
      // If Eve intercepted with a different basis, the resent photon has a different angle
      let postEveAngle = aliceAngle;
      if (evePresent && p.eveBasis && p.eveBasis !== p.aliceBasis) {
        const evePol = p.eveBit === 0
          ? (p.eveBasis === 'rectilinear' ? 0 : 45)
          : (p.eveBasis === 'rectilinear' ? 90 : 135);
        postEveAngle = evePol * (Math.PI / 180);
      }
      let currentAngle = aliceAngle;
      const len = 8;
      line.setAttribute('stroke', '#00d4ff');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-linecap', 'round');

      g.appendChild(dot);
      g.appendChild(line);
      photonGroup.appendChild(g);

      const midX = evePresent ? 500 : CHAN_X_END;
      const totalDuration = PHOTON_TRAVEL_MS;
      const start = performance.now();

      function frame(now: number): void {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / totalDuration);

        let x: number;
        if (evePresent) {
          if (t < 0.45) {
            x = CHAN_X_START + (midX - CHAN_X_START) * (t / 0.45);
          } else if (t < 0.55) {
            x = midX;
            // Switch to Eve's resent polarization angle at interception point
            currentAngle = postEveAngle;
          } else {
            x = midX + (CHAN_X_END - midX) * ((t - 0.55) / 0.45);
            currentAngle = postEveAngle;
          }
        } else {
          x = CHAN_X_START + (CHAN_X_END - CHAN_X_START) * t;
        }

        dot.setAttribute('cx', String(x));
        const dx = len * Math.cos(currentAngle);
        const dy = len * Math.sin(currentAngle);
        line.setAttribute('x1', String(x - dx));
        line.setAttribute('y1', String(CHAN_Y - dy));
        line.setAttribute('x2', String(x + dx));
        line.setAttribute('y2', String(CHAN_Y + dy));

        // Change color on arrival
        if (t >= 1) {
          const color = photonColor(p);
          dot.setAttribute('fill', color);
          line.setAttribute('stroke', color);
          setTimeout(() => {
            if (g.parentNode) g.parentNode.removeChild(g);
            resolve();
          }, 120);
          return;
        }

        // Eve intercept color change
        if (evePresent && t >= 0.45 && t < 0.55) {
          dot.setAttribute('fill', '#ff3366');
          line.setAttribute('stroke', '#ff3366');
        } else if (evePresent && t >= 0.55) {
          dot.setAttribute('fill', '#ffaa00');
          line.setAttribute('stroke', '#ffaa00');
        }

        requestAnimationFrame(frame);
      }

      requestAnimationFrame(frame);
    }, delayMs);
  });
}

// ── Protocol Run ───────────────────────────────────────────
async function runProtocol(evePresent: boolean): Promise<void> {
  if (running) return;
  running = true;
  setButtons(false);
  btnEncrypt.disabled = true;
  amplifiedKey = null;

  // Reset steps
  for (let i = 1; i <= 6; i++) {
    setStepState(i, 'idle');
    setStepContent(i, '');
  }
  updateCounters(0, 0, 0, 0);
  setGauge(0);

  const nPhotons = parseInt(slPhotons.value, 10);
  const noiseRate = parseFloat(slNoise.value) / 100;
  const qberThreshold = parseFloat(slThreshold.value) / 100;
  const sacrificeRate = 0.5;

  // Step 1 — Alice prepares
  setStepState(1, 'active');
  setStepContent(1, `Randomly choosing basis (⊕ or ⊗) and bit value for each photon...\n<div class="progress-bar"><div class="progress-fill" id="pf1"></div></div>`);
  await delay(200);
  const pf1 = document.getElementById('pf1');
  if (pf1) pf1.style.width = '100%';
  await delay(400);

  const result = await runBB84(nPhotons, evePresent, noiseRate, qberThreshold, sacrificeRate);

  const recCount = result.photons.filter(p => p.aliceBasis === 'rectilinear').length;
  const diagCount = nPhotons - recCount;
  setStepContent(1, `${nPhotons} photons prepared. ${recCount} rectilinear (⊕), ${diagCount} diagonal (⊗).`);
  setStepState(1, 'done');

  // Step 2 — Bob measures + animate
  setStepState(2, 'active');
  setStepContent(2, `Bob randomly selects measurement basis for each incoming photon...`);

  // Animate a sample of photons (max 64 for performance)
  const sampleSize = Math.min(64, nPhotons);
  const step = Math.max(1, Math.floor(nPhotons / sampleSize));
  const samplePhotons = result.photons.filter((_, i) => i % step === 0).slice(0, sampleSize);
  await animatePhotons(samplePhotons, evePresent);

  setStepContent(2, `${nPhotons} measurements complete.`);
  setStepState(2, 'done');
  updateCounters(nPhotons, 0, 0, 0);

  // Step 3 — Basis sifting
  setStepState(3, 'active');
  const aliceBases = result.photons.slice(0, 12).map(p => basisSymbol(p.aliceBasis)).join(',');
  const bobBases = result.photons.slice(0, 12).map(p => basisSymbol(p.bobBasis)).join(',');
  const siftedLen = result.siftedIndices.length;
  const survivalPct = ((siftedLen / nPhotons) * 100).toFixed(1);

  setStepContent(3,
    `Alice announces: [${aliceBases},...]\nBob announces:   [${bobBases},...]\n` +
    `Matching positions: ${result.siftedIndices.slice(0, 8).join(', ')}...\n` +
    `Sifted key length: ${siftedLen} bits (${survivalPct}% survival rate)`
  );
  setStepState(3, 'done');
  updateCounters(nPhotons, siftedLen, 0, 0);
  await delay(300);

  // Step 4 — Error estimation
  setStepState(4, 'active');
  const sacrificedCount = result.sacrificedBits;
  const errorCount = result.photons.filter(p => p.sacrificed && p.isError).length;
  const qberPct = (result.qber * 100).toFixed(2);
  const threshPct = (qberThreshold * 100).toFixed(1);

  setGauge(result.qber);
  await delay(500);

  if (result.eveDetected) {
    setStepContent(4,
      `Sacrificing ${sacrificedCount} sifted bits for QBER check...\n` +
      `Errors found: ${errorCount} of ${sacrificedCount} sacrificed bits\n` +
      `QBER: ${qberPct}%\n` +
      `Threshold: ${threshPct}%\n` +
      `Status: ✗ EAVESDROPPER DETECTED — Abort. Key discarded.\n` +
      `Reason: QBER exceeds threshold. Eve introduced errors by\n` +
      `        measuring photons in random bases.\n` +
      `        (Eve's random basis choices cause ~25% QBER on full intercept)`
    );
    setStepState(4, 'error');
    updateCounters(nPhotons, siftedLen, errorCount, 0);
    running = false;
    setButtons(true);
    return;
  }

  setStepContent(4,
    `Sacrificing ${sacrificedCount} sifted bits for QBER check...\n` +
    `Errors found: ${errorCount}\n` +
    `QBER: ${qberPct}%\n` +
    `Threshold: ${threshPct}%\n` +
    `Status: ✓ CHANNEL CLEAN — No eavesdropper detected`
  );
  setStepState(4, 'done');
  updateCounters(nPhotons, siftedLen, errorCount, result.rawFinalKey.length);
  await delay(300);

  // Step 5 — Privacy amplification
  setStepState(5, 'active');
  setStepContent(5, `Applying SHA-256 to raw key (${result.rawFinalKey.length} bits remaining after sacrifice)...`);
  await delay(200);

  amplifiedKey = result.finalKey;
  const keyHex = hexEncode(amplifiedKey);

  setStepContent(5,
    `Final key: ${amplifiedKey.length * 8} bits\n` +
    `Key: ${keyHex.slice(0, 32)}...`
  );
  setStepState(5, 'done');
  updateCounters(nPhotons, siftedLen, errorCount, amplifiedKey.length * 8);
  await delay(200);

  // Step 6 — Auto-encrypt with AES-256-GCM
  setStepState(6, 'active');
  const autoMessage = msgInput.value || 'Hello from BB84';

  if (amplifiedKey.length < 32) {
    setStepContent(6, 'Key too short for AES-256. Run with more photons.');
    setStepState(6, 'error');
    running = false;
    setButtons(true);
    return;
  }

  try {
    const enc = await encryptWithBB84Key(amplifiedKey, autoMessage);
    const dec = await decryptWithBB84Key(amplifiedKey, enc.ciphertext, enc.iv);

    setStepContent(6,
      `Message: "${escapeHtml(autoMessage)}"\n` +
      `Key: ${keyHex.slice(0, 32)}...\n` +
      `IV: ${enc.iv}\n` +
      `Ciphertext: ${enc.ciphertext.slice(0, 40)}...\n` +
      `Auth Tag: ${enc.authTag}\n` +
      `✓ Decrypted: "${escapeHtml(dec)}"`
    );
    setStepState(6, 'done');
  } catch (err) {
    setStepContent(6, `Encryption failed: ${escapeHtml(String(err))}`);
    setStepState(6, 'error');
  }

  btnEncrypt.disabled = false;
  running = false;
  setButtons(true);
}

// ── Encrypt handler ────────────────────────────────────────
async function handleEncrypt(): Promise<void> {
  if (!amplifiedKey || amplifiedKey.length < 32) {
    setStepContent(6, 'Error: key too short for AES-256. Run with more photons.');
    setStepState(6, 'error');
    return;
  }

  const message = msgInput.value || 'Hello from BB84';
  setStepContent(6, `Encrypting: "${message}"...`);

  try {
    const enc = await encryptWithBB84Key(amplifiedKey, message);
    const dec = await decryptWithBB84Key(amplifiedKey, enc.ciphertext, enc.iv);

    setStepContent(6,
      `Message: "${escapeHtml(message)}"\n` +
      `Key: ${hexEncode(amplifiedKey).slice(0, 32)}...\n` +
      `IV: ${enc.iv}\n` +
      `Ciphertext: ${enc.ciphertext.slice(0, 40)}...\n` +
      `Auth Tag: ${enc.authTag}\n` +
      `✓ Decrypted: "${escapeHtml(dec)}"`
    );
    setStepState(6, 'done');
  } catch (err) {
    setStepContent(6, `Encryption failed: ${escapeHtml(String(err))}`);
    setStepState(6, 'error');
  }
}

// ── Reset ──────────────────────────────────────────────────
function resetAll(): void {
  if (running) return;
  amplifiedKey = null;
  btnEncrypt.disabled = true;

  for (let i = 1; i <= 6; i++) {
    setStepState(i, 'idle');
    setStepContent(i, '');
    const step = $(`step-${i}`);
    step.classList.remove('open');
    step.querySelector('.step-header')!.setAttribute('aria-expanded', 'false');
  }

  updateCounters(0, 0, 0, 0);
  setGauge(0);
  clearPhotons();
  eveNode.style.display = 'none';
}

// ── Wire up buttons ────────────────────────────────────────
btnClean.addEventListener('click', () => { resetAll(); runProtocol(false); });
btnEve.addEventListener('click', () => { resetAll(); runProtocol(true); });
btnReset.addEventListener('click', resetAll);
btnEncrypt.addEventListener('click', handleEncrypt);
