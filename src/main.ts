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

const resultBanner = $<HTMLDivElement>('result-banner');
const photonGroup = $<SVGGElement>('photon-group');
const eveNode     = $<SVGGElement>('eve-node');
const gaugeSvg    = $<SVGSVGElement>('gauge-svg');
const gaugeNeedle = $<SVGLineElement>('gauge-needle');
const gaugeLabel  = $<SVGTextElement>('gauge-label');

const channelCaption  = $<HTMLParagraphElement>('channel-caption');
const photonInspector = $<HTMLParagraphElement>('photon-inspector');
const siftBlock       = document.querySelector('.sift-block') as HTMLDivElement;
const siftSampleNote  = $<HTMLParagraphElement>('sift-sample-note');
const siftRowIdx      = $<HTMLTableRowElement>('sift-row-idx');
const siftRowABit     = $<HTMLTableRowElement>('sift-row-abit');
const siftRowABasis   = $<HTMLTableRowElement>('sift-row-abasis');
const siftRowBBasis   = $<HTMLTableRowElement>('sift-row-bbasis');
const siftRowOutcome  = $<HTMLTableRowElement>('sift-row-outcome');
const minimap         = $<HTMLDivElement>('minimap');
const minimapTitle    = $<HTMLSpanElement>('minimap-title');

// ── State ──────────────────────────────────────────────────
let running = false;
let amplifiedKey: Uint8Array | null = null;
// Count of wrong-basis Eve interceptions seen so far in the animated sample,
// plus how many of those actually flipped Bob's bit — this is the running,
// visible origin of the QBER during an Eve run.
let eveWrongBasisSeen = 0;
let eveInducedErrorsSeen = 0;

// ── Slider labels ──────────────────────────────────────────
slPhotons.addEventListener('input', () => { lblPhotons.textContent = slPhotons.value; });
slNoise.addEventListener('input', () => { lblNoise.textContent = slNoise.value + '%'; });
slThreshold.addEventListener('input', () => { lblThreshold.textContent = slThreshold.value + '%'; });

// Theme toggling is owned by the shared Crypto Lab header (#cl-theme-toggle),
// which sets data-theme and persists it. No in-page toggle is needed.

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

// Alice's ORIGINAL polarization angle (degrees) for a photon, before any Eve
// interception overwrites p.polarization. This is the physical carrier the
// decoder legend explains.
function aliceAngleDeg(p: Photon): number {
  if (p.aliceBasis === 'rectilinear') return p.aliceBit === 0 ? 0 : 90;
  return p.aliceBit === 0 ? 45 : 135;
}

function angleDegFor(bit: number, basis: string): number {
  if (basis === 'rectilinear') return bit === 0 ? 0 : 90;
  return bit === 0 ? 45 : 135;
}

// ── Live per-step caption ──────────────────────────────────
function setCaption(html: string): void {
  channelCaption.innerHTML = html;
}

// ── Photon inspector (click a landed photon to freeze its reading) ──
function setInspector(html: string): void {
  photonInspector.innerHTML = html;
}

function describePhoton(p: Photon, evePresent: boolean): string {
  const bit = p.aliceBit;
  const sym = basisSymbol(p.aliceBasis);
  const deg = aliceAngleDeg(p);
  let s = `<strong>Alice sent:</strong> bit ${bit}, ${sym} basis, ${deg}° polarization.`;
  if (evePresent && p.eveBasis && p.eveBasis !== p.aliceBasis) {
    const eDeg = p.eveBit !== undefined ? angleDegFor(p.eveBit, p.eveBasis) : deg;
    s += ` <span class="ins-eve">Eve guessed ${basisSymbol(p.eveBasis)} (wrong) → resent at ${eDeg}° → Bob may misread.</span>`;
  }
  const bobSym = basisSymbol(p.bobBasis);
  s += ` <strong>Bob measured in ${bobSym}</strong> — ${p.basesMatch ? 'bases match, KEEP.' : 'bases differ, DISCARD.'}`;
  return s;
}

// ── Sifting table + minimap ────────────────────────────────
// Rows: index / Alice bit / Alice basis / Bob basis / outcome. Built for the
// exact same sample the animation plays, so highlighting column j as photon j
// lands lines up visually.
function clearSiftTable(): void {
  for (const row of [siftRowIdx, siftRowABit, siftRowABasis, siftRowBBasis, siftRowOutcome]) {
    // Keep the leading <th> row header; drop the data cells.
    while (row.children.length > 1) row.removeChild(row.lastChild!);
  }
  siftBlock.classList.remove('has-data');
}

interface SamplePhoton { photon: Photon; index: number; }

function buildSiftTable(sample: SamplePhoton[]): void {
  clearSiftTable();
  sample.forEach(({ photon, index }, j) => {
    const idxTd = document.createElement('td');
    idxTd.textContent = String(index + 1);
    idxTd.dataset.col = String(j);
    siftRowIdx.appendChild(idxTd);

    const bitTd = document.createElement('td');
    bitTd.textContent = String(photon.aliceBit);
    bitTd.dataset.col = String(j);
    siftRowABit.appendChild(bitTd);

    const aBasisTd = document.createElement('td');
    aBasisTd.className = 'cell-basis';
    aBasisTd.textContent = basisSymbol(photon.aliceBasis);
    aBasisTd.dataset.col = String(j);
    siftRowABasis.appendChild(aBasisTd);

    const bBasisTd = document.createElement('td');
    bBasisTd.className = 'cell-basis';
    bBasisTd.textContent = basisSymbol(photon.bobBasis);
    bBasisTd.dataset.col = String(j);
    siftRowBBasis.appendChild(bBasisTd);

    const outTd = document.createElement('td');
    outTd.dataset.col = String(j);
    if (photon.basesMatch) {
      outTd.className = 'cell-keep';
      outTd.textContent = '✓ KEEP';
    } else {
      outTd.className = 'cell-discard';
      outTd.textContent = '✕ DROP';
    }
    siftRowOutcome.appendChild(outTd);
  });
  siftBlock.classList.add('has-data');
}

function highlightSiftColumn(col: number): void {
  siftBlock.querySelectorAll('td.col-active').forEach(td => td.classList.remove('col-active'));
  siftBlock.querySelectorAll(`td[data-col="${col}"]`).forEach(td => td.classList.add('col-active'));
}

function clearSiftHighlight(): void {
  siftBlock.querySelectorAll('td.col-active').forEach(td => td.classList.remove('col-active'));
}

// One tick per photon across ALL N, so the sampled detail views reconcile with
// the aggregate counters. A photon is an "error" tick only when it was a
// sacrificed sifted bit that came out wrong (the errors the QBER actually sees).
function renderMinimap(photons: Photon[]): void {
  minimap.textContent = '';
  const frag = document.createDocumentFragment();
  let kept = 0, discarded = 0, errors = 0;
  for (const p of photons) {
    const tick = document.createElement('span');
    tick.className = 'mm-tick';
    if (p.sacrificed && p.isError) {
      tick.classList.add('t-err');
      errors += 1;
    } else if (p.basesMatch) {
      tick.classList.add('t-key');
      kept += 1;
    } else {
      tick.classList.add('t-discard');
      discarded += 1;
    }
    frag.appendChild(tick);
  }
  minimap.appendChild(frag);
  minimap.setAttribute(
    'aria-label',
    `Overview of ${photons.length} photons: ${kept} kept, ${discarded} discarded, ${errors} sacrificed bits in error.`
  );
  minimapTitle.textContent = `All ${photons.length} photons at a glance`;
}

function clearMinimap(): void {
  minimap.innerHTML = '<div class="minimap-empty" id="minimap-empty">Run the protocol to map every photon\'s outcome.</div>';
  minimapTitle.textContent = 'All photons at a glance';
}

// Transient on-canvas annotation for a single wrong-basis Eve interception, plus
// a running tally in the inspector line tying the count to the growing QBER.
function showEveAnnotation(p: Photon): void {
  eveWrongBasisSeen += 1;
  // Bob "misreads" precisely when this sifted (bases-match) photon errs: Alice's
  // and Bob's bits disagree despite matching bases. On a full-intercept Eve run
  // that happens ~half the time she guessed wrong → the ~25% QBER.
  const bobMisread = p.basesMatch && p.aliceBit !== p.bobBit;
  if (bobMisread) eveInducedErrorsSeen += 1;

  const ns = 'http://www.w3.org/2000/svg';
  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', '500');
  text.setAttribute('y', '105');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('fill', '#ff6688');
  text.setAttribute('font-family', 'Courier New,monospace');
  text.setAttribute('font-size', '11');
  text.setAttribute('font-weight', 'bold');
  text.textContent = `Eve guessed ${basisSymbol(p.eveBasis!)}, Alice used ${basisSymbol(p.aliceBasis)} → rotated`;
  photonGroup.appendChild(text);
  setTimeout(() => { if (text.parentNode) text.parentNode.removeChild(text); }, 600);

  setInspector(
    `<span class="ins-eve">Eve wrong-basis intercepts: ${eveWrongBasisSeen}</span> · ` +
    `Bob misreads so far: <strong>${eveInducedErrorsSeen}</strong> — each wrong guess resends a rotated photon that Bob reads wrong ~50% of the time. This is what drives the QBER up.`
  );
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

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function setGauge(qber: number, threshold = 0.11): void {
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
  gaugeSvg.setAttribute('aria-label', `QBER gauge: ${pct} percent`);

  // Color the needle/value against the SAME threshold the run uses, so the
  // gauge never contradicts the result banner: red once QBER crosses the
  // threshold (detected), amber as it approaches, green when comfortably clear.
  // Colors come from CSS so they track the active theme.
  let color = cssVar('--gauge-green') || '#00ff88';
  if (clamped > threshold) color = cssVar('--gauge-red') || '#ff3366';
  else if (clamped > threshold * 0.6) color = cssVar('--gauge-amber') || '#ffaa00';
  gaugeNeedle.setAttribute('stroke', color);
  gaugeLabel.setAttribute('fill', color);
}

function setResultBanner(state: 'clean' | 'detected' | 'hidden', text = ''): void {
  resultBanner.classList.remove('clean', 'detected');
  if (state === 'hidden') {
    resultBanner.hidden = true;
    resultBanner.textContent = '';
    return;
  }
  resultBanner.hidden = false;
  resultBanner.classList.add(state);
  resultBanner.textContent = text;
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

// The sample is indexed so column j in the sifting table corresponds to the
// jth animated photon. Landing photon j highlights sift column j.
async function animatePhotons(sample: SamplePhoton[], evePresent: boolean): Promise<void> {
  clearPhotons();
  eveNode.style.display = evePresent ? 'block' : 'none';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) return;

  const total = sample.length;
  const batchSize = Math.min(total, MAX_VISIBLE);

  for (let i = 0; i < total; i += batchSize) {
    const batch = sample.slice(i, i + batchSize);
    const promises = batch.map((sp, j) =>
      animateSinglePhoton(sp.photon, j * BATCH_DELAY_MS, evePresent, i + j));
    await Promise.all(promises);
    clearPhotons();
  }
  clearSiftHighlight();
}

// evePresent stays a param for clarity; sampleCol is the photon's column in the
// sifting table (also its global sample index) so we can highlight + inspect it.
function animateSinglePhoton(p: Photon, delayMs: number, evePresent: boolean, sampleCol: number): Promise<void> {
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

      // Make the landed photon inspectable: click / tap / keyboard-activate it
      // to freeze its decoded reading in the inspector line.
      const wrongBasisEve = !!(evePresent && p.eveBasis && p.eveBasis !== p.aliceBasis);
      g.setAttribute('data-inspectable', 'true');
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      const bit = p.aliceBit;
      const deg = aliceAngleDeg(p);
      g.setAttribute('aria-label',
        `Photon ${sampleCol + 1}: Alice bit ${bit}, ${p.aliceBasis} basis, ${deg} degrees.` +
        (wrongBasisEve ? ' Eve intercepted in the wrong basis.' : ''));
      const inspect = (): void => {
        setInspector(describePhoton(p, evePresent));
        highlightSiftColumn(sampleCol);
      };
      g.addEventListener('click', inspect);
      g.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') { e.preventDefault(); inspect(); }
      });

      let annotated = false;

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
          // Sync the sifting table: light up this photon's column as it lands.
          highlightSiftColumn(sampleCol);
          setTimeout(() => {
            if (g.parentNode) g.parentNode.removeChild(g);
            resolve();
          }, 120);
          return;
        }

        // Eve intercept color change + inline wrong-basis annotation. When Eve
        // guesses the wrong basis for THIS photon, briefly caption the causal
        // chain right at the interception point so the QBER contribution is
        // legible rather than an asserted number.
        if (evePresent && t >= 0.45 && t < 0.55) {
          dot.setAttribute('fill', '#ff3366');
          line.setAttribute('stroke', '#ff3366');
          if (wrongBasisEve && !annotated) {
            annotated = true;
            showEveAnnotation(p);
          }
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

  try {
    // Reset steps
    for (let i = 1; i <= 6; i++) {
      setStepState(i, 'idle');
      setStepContent(i, '');
    }
    updateCounters(0, 0, 0, 0);
    setGauge(0);
    setResultBanner('hidden');
    clearSiftTable();
    clearMinimap();
    eveWrongBasisSeen = 0;
    eveInducedErrorsSeen = 0;
    setInspector('Click a photon as it lands to read what Alice encoded on it.');

    const nPhotons = parseInt(slPhotons.value, 10);
    const noiseRate = parseFloat(slNoise.value) / 100;
    const qberThreshold = parseFloat(slThreshold.value) / 100;
    const sacrificeRate = 0.5;

    // Step 1 — Alice prepares
    setCaption(
      evePresent
        ? `<strong>Step 1 — Alice</strong> encodes each bit as a photon polarized in a random basis (⊕ or ⊗). Eve is listening on the line.`
        : `<strong>Step 1 — Alice</strong> encodes each bit as a photon polarized in a random basis (⊕ or ⊗). The line angle on each dot IS the bit + basis.`
    );
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
    setCaption(
      `<strong>Step 2 — Bob</strong> picks his own random basis for each photon — he has no idea which one Alice used. He keeps whatever his detector reads.`
    );
    setStepState(2, 'active');
    setStepContent(2, `Bob randomly selects measurement basis for each incoming photon...`);

    // Animate a sample of photons (max 64 for performance). Keep the ORIGINAL
    // index so the sifting table, minimap sample, and animation all line up.
    const sampleSize = Math.min(64, nPhotons);
    const step = Math.max(1, Math.floor(nPhotons / sampleSize));
    const animSample: SamplePhoton[] = [];
    for (let i = 0; i < result.photons.length && animSample.length < sampleSize; i += step) {
      animSample.push({ photon: result.photons[i], index: i });
    }

    // Build the per-photon sifting table for a compact readable slice (first ~14
    // of the animated sample). This is the BB84 mental model: keep-if-match.
    const tableSample = animSample.slice(0, 14);
    buildSiftTable(tableSample);
    siftSampleNote.textContent =
      `Showing ${tableSample.length} of ${nPhotons} photons. Bob picks his basis independently and at random, with no knowledge of Alice's — so bases agree about half the time, and only those become key bits.`;

    await animatePhotons(animSample, evePresent);

    setStepContent(2, `${nPhotons} measurements complete.`);
    setStepState(2, 'done');
    updateCounters(nPhotons, 0, 0, 0);
    renderMinimap(result.photons);

    // Step 3 — Basis sifting
    setCaption(
      `<strong>Step 3 — Sifting.</strong> Alice and Bob publicly compare only their BASES (never the bits). Where the ⊕/⊗ symbols match they keep the bit; where they differ they throw it away. Watch the table above: green KEEP, grey DROP.`
    );
    setStepState(3, 'active');
    const aliceBases = result.photons.slice(0, 12).map(p => basisSymbol(p.aliceBasis)).join(',');
    const bobBases = result.photons.slice(0, 12).map(p => basisSymbol(p.bobBasis)).join(',');
    const siftedLen = result.siftedIndices.length;
    const survivalPct = ((siftedLen / nPhotons) * 100).toFixed(1);

    setStepContent(3,
      `Bases (first 12 of ${nPhotons}):\n` +
      `Alice announces: [${aliceBases},...]\nBob announces:   [${bobBases},...]\n` +
      `Matching positions: ${result.siftedIndices.slice(0, 8).join(', ')}...\n` +
      `Sifted key length: ${siftedLen} bits (${survivalPct}% survival rate)`
    );
    setStepState(3, 'done');
    updateCounters(nPhotons, siftedLen, 0, 0);
    await delay(300);

    // Step 4 — Error estimation
    setCaption(
      `<strong>Step 4 — Error check.</strong> They sacrifice some kept bits to measure the QBER — the fraction that disagree. Natural noise is small; an eavesdropper forced to guess bases pushes it toward ~25%.`
    );
    setStepState(4, 'active');
    const sacrificedCount = result.sacrificedBits;
    const errorCount = result.photons.filter(p => p.sacrificed && p.isError).length;
    const qberPct = (result.qber * 100).toFixed(2);
    const threshPct = (qberThreshold * 100).toFixed(1);

    setGauge(result.qber, qberThreshold);
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
      setResultBanner('detected', `✗ EAVESDROPPER DETECTED — QBER ${qberPct}% exceeds ${threshPct}% threshold. Key discarded.`);
      setCaption(
        `<strong>Eve detected.</strong> QBER ${qberPct}% is above the ${threshPct}% threshold — the errors you watched Eve inject add up. Alice and Bob throw the key away and try again. That detectability is the whole point of BB84.`
      );
      updateCounters(nPhotons, siftedLen, errorCount, 0);
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
    setResultBanner('clean', `✓ CHANNEL CLEAN — QBER ${qberPct}% below ${threshPct}% threshold. Proceeding to key derivation.`);
    setCaption(
      `<strong>Channel clean.</strong> QBER ${qberPct}% is under the ${threshPct}% threshold — no eavesdropper detectable. Alice and Bob keep the sifted key and finish deriving a shared secret.`
    );
    updateCounters(nPhotons, siftedLen, errorCount, result.rawFinalKey.length);
    await delay(300);

    // Step 5 — Privacy amplification
    setCaption(
      `<strong>Step 5 — Privacy amplification.</strong> Even a clean-looking key can leak a few bits to Eve. Hashing the whole key with SHA-256 crushes any partial knowledge into a uniformly-secret 256-bit key.`
    );
    setStepState(5, 'active');
    setStepContent(5, `Applying SHA-256 to raw key (${result.rawFinalKey.length} bits remaining after sacrifice)...`);
    await delay(200);

    amplifiedKey = result.finalKey;
    const keyHex = hexEncode(amplifiedKey);

    // Privacy-amplification visual: map the raw sifted key against the final
    // key. Widths are proportional to the LARGER of the two so the comparison is
    // honest. When the raw key is long, hashing squeezes it DOWN (crushing out
    // Eve's partial info); when few photons were sent, a 256-bit floor keeps the
    // key usable for AES-256, so the caption adapts to what actually happened.
    const rawBits = result.rawFinalKey.length;
    const finalBits = amplifiedKey.length * 8;
    const scale = Math.max(rawBits, finalBits, 1);
    const rawPct = Math.max(6, (rawBits / scale) * 100);
    const finalPct = Math.max(6, (finalBits / scale) * 100);
    const shrank = rawBits > finalBits;
    const finalNote = shrank
      ? `Final key: ${finalBits} bits — SHA-256 squeezes the raw key down, crushing Eve's partial info out`
      : `Final key: ${finalBits} bits — SHA-256 distills the raw bits into a uniform secret (256-bit floor for AES-256)`;
    setStepContent(5,
      `<div class="pa-visual">` +
      `<div class="pa-bar" style="width:${rawPct.toFixed(1)}%"></div>` +
      `<div class="pa-bar-label">Raw sifted key: ${rawBits} bits — Eve may know a few of them</div>` +
      `<div class="pa-bar pa-final" style="width:${finalPct.toFixed(1)}%"></div>` +
      `<div class="pa-bar-label">${finalNote}</div>` +
      `</div>` +
      `Key: ${keyHex.slice(0, 32)}...`
    );
    setStepState(5, 'done');
    updateCounters(nPhotons, siftedLen, errorCount, amplifiedKey.length * 8);
    await delay(200);

    // Step 6 — Auto-encrypt with AES-256-GCM
    setCaption(
      `<strong>Step 6 — Use the key.</strong> The 256-bit shared secret now keys real AES-256-GCM to encrypt (and authenticate) a message — end to end, in your browser.`
    );
    setStepState(6, 'active');
    const autoMessage = msgInput.value || 'Hello from BB84';

    if (amplifiedKey.length < 32) {
      setStepContent(6, 'Key too short for AES-256. Run with more photons.');
      setStepState(6, 'error');
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
  } catch (err) {
    // Any unexpected failure (e.g. WebCrypto unavailable) must not leave the
    // UI permanently disabled — surface it and let the finally block recover.
    console.error('BB84 run failed:', err);
    setResultBanner('detected', `⚠ Unexpected error — ${escapeHtml(String(err))}`);
  } finally {
    running = false;
    setButtons(true);
  }
}

// ── Encrypt handler ────────────────────────────────────────
async function handleEncrypt(): Promise<void> {
  if (!amplifiedKey || amplifiedKey.length < 32) {
    setStepContent(6, 'Error: key too short for AES-256. Run with more photons.');
    setStepState(6, 'error');
    return;
  }

  const message = msgInput.value || 'Hello from BB84';
  setStepContent(6, `Encrypting: "${escapeHtml(message)}"...`);

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
  setResultBanner('hidden');
  clearPhotons();
  eveNode.style.display = 'none';
  clearSiftTable();
  clearMinimap();
  eveWrongBasisSeen = 0;
  eveInducedErrorsSeen = 0;
  setInspector('Click a photon as it lands to read what Alice encoded on it.');
  setCaption('Press <strong>Run Without Eve</strong> or <strong>Run With Eve</strong> to send photons down the channel.');
}

// ── Wire up buttons ────────────────────────────────────────
btnClean.addEventListener('click', () => { resetAll(); runProtocol(false); });
btnEve.addEventListener('click', () => { resetAll(); runProtocol(true); });
btnReset.addEventListener('click', resetAll);
btnEncrypt.addEventListener('click', handleEncrypt);
