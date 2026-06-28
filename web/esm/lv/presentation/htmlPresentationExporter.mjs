// HTML presentation exporter — cinematic radiology case video.
//
// Converts a PresentationManifest (presentation-manifest-v1) into a HyperFrames
// HTML composition for the CLI HTML-to-MP4 renderer:  npx hyperframes render <dir>
//
// Built from reusable SCENE BUILDERS, each emitting one timeline segment (HTML
// clip(s) + GSAP tweens at absolute times). The builders are designed as a small
// presentation engine — scene timing is data-driven and each scene is an isolated
// unit — so future capabilities (cine scrolling, camera paths, viewport replay,
// narrated playback) can be added as new scene/segment types without redesign.
//
//   brandLayer    persistent ELVIE wordmark (viewer styling, never animated)
//   TitleScene    exam name, accession, indication; backdrop slow-dissolves between
//                 blurred evidence slices; thin accent rule draws left→right
//   SummaryScene  one-line study summary, animated in
//   FindingScene  (localized findings only) report sentence with a reading-sweep
//                 highlight that hands off into the CT image; 38/62 split: left glass
//                 panel (title, meta, description, patient explanation) + right static
//                 image with pointer ring; no camera movement
//   ClosingScene  impression bullets staggered one-at-a-time, then cross-dissolves
//                 into the ELVIE end card
//   EndCardScene  ELVIE wordmark centered, fades to black
//
// presentationStyle option — passed to exportHtmlComposition:
//   "v1" (default) — finished, stable, byte-identical to prior renders
//   "v2"           — narrative-driven: faster report→finding transition, inverted
//                    hierarchy (patient explanation above clinical text), patient
//                    explanation in a card, delayed pointer, numbered closing items,
//                    multi-cycle backdrop, smaller end card wordmark
//
// Data-driven scene selection: a finding gets an image scene only when it has
// captured image evidence. Non-localized positives are still represented in the
// summary, impression, and narration — they simply get no image scene.
//
// Evidence is untouched: images come straight from the manifest's imageEvidence
// (the exact Preview Deck bytes). assetMode controls how that image is referenced.
// The module stays free of fs/path imports.

// ── Scene timing (seconds) ──────────────────────────────────────────────────
const T = {
  title:        5.0,   // extended for backdrop cross-dissolve
  summary:      4.2,
  findingText:  4.2,   // beat A — report sentence
  findingImage: 6.2,   // beat B — CT image + pointer + metadata
  closing:      6.2,   // dynamic — extends if many impression bullets
  endCard:      3.2,   // ELVIE end card hold
  xfade:        0.8,   // cross-dissolve overlap
  pause:        0.45,  // brief hold between scenes
};

// ── V2 scene timing (seconds) ───────────────────────────────────────────────
// Designed for a more narrative pace: faster report→finding bridge,
// longer image hold for the delayed pointer, more pause between closing items.
const TV2 = {
  title:        6.5,   // multi-cycle backdrop dissolve needs more time
  summary:      4.2,   // shared with V1
  findingText:  3.2,   // shorter — report is a bridge, not a slide
  findingImage: 7.5,   // longer — delayed pointer needs room
  closing:      7.0,   // numbered items with longer stagger
  endCard:      3.5,   // more negative space, slightly longer hold
  xfade:        0.8,
  pause:        0.45,
};

// ELVIE wordmark — matched to the viewer (.lv-logo): Bebas Neue, cyan #00d4e8,
// 0.12em tracking, ~20px. Persistent, ~45% opacity, upper-left, never animated.
const BRAND = { text: 'Elvie', color: '#00d4e8', font: "'Bebas Neue', sans-serif",
  size: 25, tracking: '0.12em', opacity: 0.45, margin: 32 };

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function norm(v) { return String(v == null ? '' : v).trim(); }
function f2(n) { return Number(n).toFixed(2); }

// ── Evidence helpers ─────────────────────────────────────────────────────────
function capturedEvidence(section) {
  const arr = Array.isArray(section?.imageEvidence) ? section.imageEvidence : [];
  return arr.find(e => e?.status === 'captured' && (e?.dataUrl || e?.assetPath)) || null;
}
export function sectionHasImage(section) { return !!capturedEvidence(section); }

function resolveEvidenceUrl(section, { assetMode, projectDir, readAsset }) {
  const captured = capturedEvidence(section);
  if (!captured) return null;
  if (captured.dataUrl) return captured.dataUrl;
  if (!captured.assetPath) return null;
  switch (assetMode) {
    case 'data-url':
      if (typeof readAsset === 'function') { const d = readAsset(captured.assetPath); if (d) return d; }
      return captured.assetPath;
    case 'absolute-file':
      return projectDir ? `file://${joinPath(projectDir, captured.assetPath)}` : captured.assetPath;
    case 'relative':
    default:
      return captured.assetPath;
  }
}
function joinPath(base, rel) {
  return `${String(base).replace(/\/+$/, '')}/${String(rel).replace(/^\/+/, '')}`;
}

const WINDOW_LABELS = {
  brain: 'Brain window', brain_stroke: 'Stroke window', brain_hemorrhage: 'Hemorrhage window',
  bone: 'Bone window', lung: 'Lung window', liver: 'Liver window', soft_tissue: 'Soft-tissue window',
};
function windowLabel(section) {
  const ev = capturedEvidence(section);
  const preset = norm(ev?.appliedPreset);
  return WINDOW_LABELS[preset] || '';
}

// Static vignette focus point (pointer when known, else centre). This is a fixed
// gradient position — the anatomy never moves. There is deliberately NO camera
// movement on radiology image scenes: a captured image is evidence and stays
// perfectly stationary. (Real motion — cine through slices, viewport replay —
// would be a distinct scene type representing an actual viewer interaction.)
function vignetteOrigin(section) {
  const p = section?.pointer;
  const ox = (p && Number.isFinite(Number(p.x))) ? (Number(p.x) * 100).toFixed(1) : '50';
  const oy = (p && Number.isFinite(Number(p.y))) ? (Number(p.y) * 100).toFixed(1) : '45';
  return `${ox}% ${oy}%`;
}

// Wrap the first occurrence of `phrase` in `sentence` with a reading-sweep span.
// `extraStyle` (optional) injects inline CSS on the span — used by V2 to enlarge
// the highlighted phrase. Omitted by V1 callers so V1 output is byte-identical.
function highlightSentence(sentence, phrase, sweepId, extraStyle = '') {
  const s = norm(sentence);
  const p = norm(phrase);
  if (!s) return '';
  if (!p) return esc(s);
  const i = s.toLowerCase().indexOf(p.toLowerCase());
  if (i < 0) return esc(s);
  const styleAttr = extraStyle ? ` style="${extraStyle}"` : '';
  return `${esc(s.slice(0, i))}<span class="hl" id="${sweepId}"${styleAttr}>${esc(s.slice(i, i + p.length))}</span>${esc(s.slice(i + p.length))}`;
}

// ── Persistent brand layer (outside clips; always visible) ───────────────────
function brandLayer() {
  return `
  <div style="position:absolute;top:${BRAND.margin}px;left:${BRAND.margin + 4}px;z-index:1000;
    opacity:${BRAND.opacity};font-family:${BRAND.font};font-size:${BRAND.size}px;
    letter-spacing:${BRAND.tracking};color:${BRAND.color};pointer-events:none;line-height:1;">${BRAND.text}</div>`;
}

// A full-frame clip shell. Starts hidden (opacity:0); GSAP fades it in/out.
function clip(id, start, duration, inner, extraStyle = '') {
  return `
  <div id="${id}" class="clip" data-start="${f2(start)}" data-duration="${f2(duration)}"
    style="opacity:0;position:absolute;inset:0;background:#06060e;${extraStyle}">
${inner}
  </div>`;
}

// ── Scene builders — each returns { html, tl: string[], duration } ───────────

export function buildTitleScene({ manifest, start, backdropUrls = [] }) {
  const study = manifest.study || {};
  const exam = esc(norm(study.examName) || norm(manifest.presentationTitle) || 'STUDY');
  const acc = esc(norm(study.accession || manifest.accession));
  const date = norm(study.studyDate);
  const indication = norm(study.clinicalIndication);
  const dur = T.title + T.xfade;
  const id = 'sc-title';

  // ── Background: slow cross-dissolve between blurred study slices ─────────────
  // Each evidence image becomes a full-frame blurred layer. Opacity cross-fades
  // slowly over 2s — viewer barely perceives motion but the frame feels alive.
  // Backdrop layers are NOT scaled or translated (no push-in, no Ken Burns).
  const bdLayers = backdropUrls.length > 0
    ? backdropUrls.map((url, i) => `
      <div id="${id}-bd${i}" style="position:absolute;inset:0;
        background-image:url('${esc(url)}');background-size:cover;background-position:center;
        filter:blur(28px) brightness(.20) saturate(.45);transform:scale(1.18);
        opacity:${i === 0 ? '1' : '0'};"></div>`).join('')
    : `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#06060f 0%,#0c0c1e 60%,#0a0a18 100%);"></div>`;

  // Dark radial vignette over all backdrop layers, focusing eye on the centre.
  const vignette = backdropUrls.length > 0
    ? `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(6,6,16,.55) 0%,rgba(4,4,12,.92) 80%);"></div>`
    : '';

  const metaRows = [
    acc ? `Accession ${acc}` : '',
    date ? `Study date ${esc(date)}` : '',
    indication ? `Indication: ${esc(indication)}` : '',
  ].filter(Boolean).map(r =>
    `<div style="font-size:30px;color:#5b6f9c;letter-spacing:.04em;margin-top:16px;">${r}</div>`
  ).join('');

  const inner = `
    ${bdLayers}
    ${vignette}
    <div id="${id}-body" style="position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;opacity:0;">
      <div style="font-size:96px;font-weight:700;color:#eef3ff;letter-spacing:.02em;text-align:center;
        line-height:1.05;text-shadow:0 4px 48px rgba(0,0,0,.7);">${exam}</div>
      <div id="${id}-rule" style="width:0;height:1.5px;margin-top:30px;
        background:linear-gradient(90deg,rgba(0,212,232,.55),rgba(0,212,232,.08));"></div>
      <div id="${id}-meta" style="margin-top:12px;text-align:center;opacity:0;">${metaRows}</div>
    </div>`;

  const tl = [
    `tl.to("#${id}", { opacity: 1, duration: 0.5 }, ${f2(start)});`,
    // Title fades in first
    `tl.to("#${id}-body", { opacity: 1, duration: 0.7, ease: "power2.out" }, ${f2(start + 0.2)});`,
    // Accent rule draws left→right
    `tl.to("#${id}-rule", { width: 200, duration: 0.8, ease: "power2.out" }, ${f2(start + 0.55)});`,
    // Metadata fades in ~200ms after rule starts
    `tl.to("#${id}-meta", { opacity: 1, duration: 0.7, ease: "power2.out" }, ${f2(start + 0.75)});`,
    // Backdrop: slow cross-dissolve between slices (if multiple images available)
    ...(backdropUrls.length > 1
      ? [`tl.to("#${id}-bd0", { opacity: 0, duration: 2.0, ease: "power1.inOut" }, ${f2(start + 1.8)});`,
         `tl.to("#${id}-bd1", { opacity: 1, duration: 2.0, ease: "power1.inOut" }, ${f2(start + 1.8)});`]
      : []),
    // Scene exit
    `tl.to("#${id}", { opacity: 0, duration: ${f2(T.xfade)} }, ${f2(start + T.title)});`,
    `tl.set("#${id}", { opacity: 0 }, ${f2(start + T.title + T.xfade)});`,
  ];

  return { html: clip(id, start, dur, inner), tl, duration: T.title + T.pause };
}

export function buildSummaryScene({ summary, start }) {
  const id = 'sc-summary';
  const dur = T.summary + T.xfade;
  const text = esc(norm(summary) || 'Study summary unavailable.');
  const inner = `
    <div style="position:absolute;inset:0;background:linear-gradient(160deg,#080814 0%,#0a0a18 100%);"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 200px;">
      <div style="font-size:13px;color:#3a5080;text-transform:uppercase;letter-spacing:.28em;margin-bottom:30px;">Summary</div>
      <div id="${id}-text" style="font-size:46px;font-weight:600;color:#dfe7fb;line-height:1.4;opacity:0;letter-spacing:-.005em;">${text}</div>
      <div id="${id}-rule" style="height:2px;width:0;margin-top:40px;background:linear-gradient(90deg,#2d4fa8,transparent);"></div>
    </div>`;
  const tl = [
    `tl.to("#${id}", { opacity: 1, duration: ${f2(T.xfade)} }, ${f2(start)});`,
    `tl.fromTo("#${id}-text", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1.0, ease: "power2.out" }, ${f2(start + 0.3)});`,
    `tl.to("#${id}-rule", { width: 360, duration: 1.2, ease: "power2.out" }, ${f2(start + 0.8)});`,
    `tl.to("#${id}", { opacity: 0, duration: ${f2(T.xfade)} }, ${f2(start + T.summary)});`,
    `tl.set("#${id}", { opacity: 0 }, ${f2(start + T.summary + T.xfade)});`,
  ];
  return { html: clip(id, start, dur, inner), tl, duration: T.summary + T.pause };
}

export function buildFindingScene({ section, findingNumber, sceneIndex, start, resolveOpts }) {
  const idA = `sc-find-${sceneIndex}-a`;   // report sentence beat
  const idB = `sc-find-${sceneIndex}-b`;   // image beat
  const sweepId = `${idA}-hl`;
  const sentence = norm(section.reportSentence) || norm(section.text);
  const highlighted = highlightSentence(sentence, section.highlightPhrase, sweepId);
  const title = esc(norm(section.title));
  const imgUrl = resolveEvidenceUrl(section, resolveOpts);
  const pointer = section.pointer;
  const orientation = esc(norm(section.orientation));
  const winLabel = esc(windowLabel(section));
  const vOrigin = vignetteOrigin(section);

  const textDur = T.findingText + T.xfade;
  const imgStart = start + T.findingText - 0.35;   // image fades in underneath as phrase hands off
  const imgDur = T.findingImage + T.xfade;

  // Beat B (image) emitted BEFORE beat A so the text sits on top and reveals the
  // image as it lifts away.
  const imageEl = imgUrl
    ? `<img class="evidence-img" id="${idB}-img" src="${esc(imgUrl)}" alt="${title} — evidence"
         style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;"/>`
    : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#2a2a40;font-size:16px;">No image captured</div>`;

  const orientLabel = orientation
    ? `<div style="position:absolute;top:52px;right:56px;font-family:monospace;font-size:13px;
        letter-spacing:.14em;color:#3a5575;opacity:.8;">${orientation}</div>`
    : '';

  let pointerHtml = '';
  if (pointer && imgUrl) {
    const px = (Number(pointer.x) * 100).toFixed(1);
    const py = (Number(pointer.y) * 100).toFixed(1);
    pointerHtml = `
      <div id="${idB}-ptr" style="position:absolute;left:${px}%;top:${py}%;width:120px;height:120px;margin:-60px 0 0 -60px;opacity:0;">
        <div id="${idB}-ring" style="position:absolute;inset:0;border-radius:50%;border:3px solid rgba(120,190,255,.9);
          box-shadow:0 0 22px rgba(90,160,255,.55),inset 0 0 14px rgba(90,160,255,.35);"></div>
        <div style="position:absolute;inset:34px;border-radius:50%;border:2px solid rgba(150,205,255,.5);"></div>
      </div>`;
  }

  const metaLines = [];
  if (section.navigable) {
    metaLines.push(`<span style="color:#46587e;">Series</span> ${esc(String(section.seriesNumber ?? ''))}`);
    metaLines.push(`<span style="color:#46587e;">Image</span> ${esc(String(section.imageNumber ?? ''))}`);
  }
  const findingBodyText = norm(section.text);
  const patientText = norm(section.patientFriendlyExplanation);

  // ── Left narrative panel (38% width) ─────────────────────────────────────────
  // Full-height glass panel. Typography for 1080p legibility at tablet distance:
  //   title 48px · metadata 22px · body 33px · patient 35px · nothing below 18px.
  // Long findings: body clamped at 4 lines, patient at 3 lines — normal slides
  // always render at the large sizes above.
  const leftPanel = `
    <div id="${idB}-panel" style="position:absolute;left:0;top:0;bottom:0;width:38%;
      background:rgba(6,8,18,.65);backdrop-filter:blur(14px);
      border-right:1px solid rgba(70,90,140,.18);overflow:hidden;opacity:0;">
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;
        justify-content:center;padding:52px 48px 52px 60px;overflow:hidden;">
        <div style="font-size:18px;color:#3a5080;text-transform:uppercase;
          letter-spacing:.20em;margin-bottom:18px;flex-shrink:0;">Finding ${findingNumber}</div>
        <div style="font-size:48px;font-weight:700;color:#eef3ff;line-height:1.2;
          margin-bottom:${metaLines.length || winLabel ? '20px' : '32px'};flex-shrink:0;">${title}</div>
        ${metaLines.length ? `<div style="font-family:monospace;font-size:22px;color:#a0bcd8;letter-spacing:.02em;
          margin-bottom:${winLabel ? '10px' : '32px'};flex-shrink:0;">${metaLines.join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</div>` : ''}
        ${winLabel ? `<div style="font-size:20px;color:#6080a0;margin-bottom:32px;flex-shrink:0;">${winLabel}</div>` : ''}
        <div style="width:40px;height:1px;background:rgba(80,110,160,.45);margin-bottom:34px;flex-shrink:0;"></div>
        ${findingBodyText ? `<div style="font-size:33px;color:#d8e8f8;line-height:1.55;
          margin-bottom:${patientText ? '36px' : '0'};flex-shrink:0;
          display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden;">${esc(findingBodyText)}</div>` : ''}
        ${patientText ? `
          <div style="font-size:18px;color:#3a5080;text-transform:uppercase;letter-spacing:.18em;
            margin-bottom:14px;flex-shrink:0;">For patients</div>
          <div style="font-size:35px;color:#d8e8f8;line-height:1.50;flex-shrink:0;
            display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;">${esc(patientText)}</div>` : ''}
      </div>
    </div>`;

  // ── Right image stage (62% width) — static, no transform, no Ken Burns ───────
  const rightStage = `
    <div id="${idB}-stage" style="position:absolute;left:38%;right:0;top:0;bottom:0;">
      ${imageEl}
      <div style="position:absolute;inset:0;pointer-events:none;
        background:radial-gradient(ellipse at center,transparent 44%,rgba(2,2,8,.50) 100%);"></div>
      ${pointerHtml}
      <div style="position:absolute;inset:28px;border:1px solid rgba(90,150,220,.09);border-radius:6px;
        box-shadow:0 30px 80px rgba(0,0,0,.45);pointer-events:none;"></div>
    </div>`;

  const beatB = clip(idB, imgStart, imgDur, `
    <div style="position:absolute;inset:0;background:#04040a;"></div>
    ${leftPanel}
    ${rightStage}
    ${orientLabel}`);

  const beatA = clip(idA, start, textDur, `
    <div style="position:absolute;inset:0;background:linear-gradient(160deg,#080814 0%,#0a0a18 100%);"></div>
    <div id="${idA}-wrap" style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 190px;">
      <div style="font-size:13px;color:#3a5080;text-transform:uppercase;letter-spacing:.28em;margin-bottom:26px;">Finding ${findingNumber} &nbsp;·&nbsp; Report</div>
      <div id="${idA}-line" style="font-size:50px;font-weight:600;color:#54607e;line-height:1.45;opacity:0;">${highlighted}</div>
    </div>`);

  const tl = [
    // Beat A appears
    `tl.to("#${idA}", { opacity: 1, duration: ${f2(T.xfade)} }, ${f2(start)});`,
    `tl.fromTo("#${idA}-line", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, ${f2(start + 0.25)});`,
  ];
  // Reading sweep across the highlighted phrase
  if (section.highlightPhrase && sentence.toLowerCase().includes(norm(section.highlightPhrase).toLowerCase())) {
    tl.push(`tl.fromTo("#${sweepId}", { backgroundPosition: "100% 0" }, { backgroundPosition: "0% 0", duration: 1.0, ease: "power1.inOut" }, ${f2(start + 0.9)});`);
  }
  // Hand-off: the phrase lifts and fades while the image cross-dissolves in underneath
  tl.push(`tl.to("#${idA}-wrap", { y: -60, scale: 0.92, opacity: 0, duration: ${f2(T.xfade + 0.2)}, ease: "power2.in" }, ${f2(imgStart - 0.1)});`);
  tl.push(`tl.to("#${idA}", { opacity: 0, duration: ${f2(T.xfade)} }, ${f2(imgStart)});`);
  tl.push(`tl.set("#${idA}", { opacity: 0 }, ${f2(imgStart + T.xfade)});`);
  // Beat B: image fades in (static — no camera move), narrative panel fades in, fade out.
  tl.push(`tl.to("#${idB}", { opacity: 1, duration: ${f2(T.xfade)} }, ${f2(imgStart)});`);
  tl.push(`tl.to("#${idB}-panel", { opacity: 1, duration: 0.9, ease: "power2.out" }, ${f2(imgStart + 0.3)});`);
  tl.push(`tl.to("#${idB}", { opacity: 0, duration: ${f2(T.xfade)} }, ${f2(imgStart + T.findingImage)});`);
  tl.push(`tl.set("#${idB}", { opacity: 0 }, ${f2(imgStart + T.findingImage + T.xfade)});`);

  // Pointer: appear → expand → pulse twice → hold → fade away (all finite).
  if (pointer && imgUrl) {
    const t0 = imgStart + 1.1;
    tl.push(`tl.fromTo("#${idB}-ptr", { opacity: 0, scale: 1.7 }, { opacity: 1, scale: 1.0, duration: 0.6, ease: "back.out(2)" }, ${f2(t0)});`);
    tl.push(`tl.fromTo("#${idB}-ring", { scale: 0.9 }, { scale: 1.08, duration: 0.55, ease: "sine.inOut", repeat: 3, yoyo: true }, ${f2(t0 + 0.5)});`);
    // hold, then fade away so it never distracts from the anatomy
    tl.push(`tl.to("#${idB}-ptr", { opacity: 0, duration: 0.8, ease: "power1.out" }, ${f2(imgStart + T.findingImage - 1.4)});`);
  }

  return { html: `${beatB}\n${beatA}`, tl, duration: T.findingText + T.findingImage + T.pause };
}

export function buildClosingScene({ impression, start }) {
  const id = 'sc-closing';
  const items = Array.isArray(impression) ? impression : [];

  // Each bullet appears individually with a clear pause before the next.
  const staggerGap  = 1.4;   // seconds between each bullet appearance
  const bulletFade  = 0.65;  // fade-in duration per bullet
  const holdAfterLast = 1.0; // hold after final bullet before scene exits
  // Extend beyond T.closing if there are many bullets.
  const activeDur = 0.5 + items.length * staggerGap + holdAfterLast;
  const closingDur = Math.max(T.closing, activeDur);
  const dur = closingDur + T.xfade;

  const bullets = items.map((b, i) => `
    <div id="${id}-b${i}" style="display:flex;align-items:flex-start;gap:28px;
      opacity:0;margin-bottom:44px;">
      <div style="width:12px;height:12px;border-radius:50%;background:#5a9aff;
        margin-top:24px;flex:0 0 auto;box-shadow:0 0 16px rgba(90,160,255,.7);"></div>
      <div style="font-size:52px;font-weight:600;color:#e8eefa;line-height:1.3;">${esc(norm(b))}</div>
    </div>`).join('');

  const inner = `
    <div style="position:absolute;inset:0;background:linear-gradient(160deg,#070712 0%,#090916 100%);"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;
      justify-content:center;padding:0 180px;">
      ${bullets}
    </div>`;

  const tl = [`tl.to("#${id}", { opacity: 1, duration: 0.6 }, ${f2(start)});`];
  // Bullets appear one at a time — each fades in individually.
  items.forEach((_, i) => {
    tl.push(`tl.to("#${id}-b${i}", { opacity: 1, duration: ${f2(bulletFade)}, ease: "power2.out" }, ${f2(start + 0.5 + i * staggerGap)});`);
  });
  // Scene exits cleanly — cross-dissolves into the ELVIE end card.
  tl.push(`tl.to("#${id}", { opacity: 0, duration: ${f2(T.xfade)} }, ${f2(start + closingDur)});`);
  tl.push(`tl.set("#${id}", { opacity: 0 }, ${f2(start + closingDur + T.xfade)});`);

  return { html: clip(id, start, dur, inner), tl, duration: closingDur + T.pause };
}

export function buildEndCardScene({ start }) {
  const id = 'sc-endcard';
  const dur = T.endCard + T.xfade;

  const inner = `
    <div style="position:absolute;inset:0;background:#04040a;"></div>
    <div id="${id}-wordmark" style="position:absolute;inset:0;display:flex;align-items:center;
      justify-content:center;opacity:0;">
      <div style="font-family:${BRAND.font};font-size:120px;letter-spacing:0.10em;
        color:${BRAND.color};line-height:1;">${BRAND.text.toUpperCase()}</div>
    </div>`;

  const tl = [
    `tl.to("#${id}", { opacity: 1, duration: ${f2(T.xfade)} }, ${f2(start)});`,
    `tl.to("#${id}-wordmark", { opacity: 1, duration: 0.9, ease: "power2.out" }, ${f2(start + 0.4)});`,
    `tl.to("#${id}", { opacity: 0, duration: ${f2(T.xfade)} }, ${f2(start + T.endCard)});`,
    `tl.set("#${id}", { opacity: 0 }, ${f2(start + T.endCard + T.xfade)});`,
  ];

  return { html: clip(id, start, dur, inner), tl, duration: T.endCard + T.pause };
}

// ── V2 scene builders ─────────────────────────────────────────────────────────
// V2 presentationStyle only. V1 functions above are untouched.

export function buildTitleSceneV2({ manifest, start, backdropUrls = [] }) {
  const study = manifest.study || {};
  const exam = esc(norm(study.examName) || norm(manifest.presentationTitle) || 'STUDY');
  const acc = esc(norm(study.accession || manifest.accession));
  const date = norm(study.studyDate);
  const indication = norm(study.clinicalIndication);
  const dur = TV2.title + TV2.xfade;
  const id = 'sc-title';

  // Backdrop: all available slices as stacked layers. Cross-dissolve cycles
  // through them (for 2 images: bd0→bd1→bd0). Barely perceptible on blurred
  // frames; creates life without motion.
  const n = Math.min(backdropUrls.length, 5);
  const bdLayers = n > 0
    ? backdropUrls.slice(0, n).map((url, i) => `
      <div id="${id}-bd${i}" style="position:absolute;inset:0;
        background-image:url('${esc(url)}');background-size:cover;background-position:center;
        filter:blur(30px) brightness(.18) saturate(.4);transform:scale(1.20);
        opacity:${i === 0 ? '1' : '0'};"></div>`).join('')
    : `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#05050e 0%,#0b0b1c 60%,#080816 100%);"></div>`;

  // Separate vignette layer — animated for a very slow breathing effect.
  const vignetteEl = n > 0
    ? `<div id="${id}-vignette" style="position:absolute;inset:0;
        background:radial-gradient(ellipse at center,rgba(6,6,16,.52) 0%,rgba(3,3,10,.94) 80%);"></div>`
    : '';

  const metaRows = [
    acc ? `Accession ${acc}` : '',
    date ? `Study date ${esc(date)}` : '',
    indication ? `Indication: ${esc(indication)}` : '',
  ].filter(Boolean).map(r =>
    `<div style="font-size:34px;color:#9fb6d8;letter-spacing:.04em;margin-top:20px;">${r}</div>`
  ).join('');

  const inner = `
    ${bdLayers}
    ${vignetteEl}
    <div id="${id}-body" style="position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;opacity:0;">
      <div style="font-size:96px;font-weight:700;color:#eef3ff;letter-spacing:.02em;text-align:center;
        line-height:1.05;text-shadow:0 4px 56px rgba(0,0,0,.8);">${exam}</div>
      <div id="${id}-rule" style="width:0;height:1.5px;margin-top:30px;
        background:linear-gradient(90deg,rgba(0,212,232,.55),rgba(0,212,232,.08));"></div>
      <div id="${id}-meta" style="margin-top:14px;text-align:center;opacity:0;">${metaRows}</div>
    </div>`;

  // Build backdrop cross-dissolve tweens for N images.
  // For 2 images: two dissolves (bd0→bd1 and back bd1→bd0).
  // For N>2: one dissolve per sequential pair (bd0→bd1→bd2…).
  function mkDissolves() {
    if (n <= 1) return [];
    const out = [];
    if (n === 2) {
      // Forward: t+1.5 over 2.0s
      out.push(`tl.to("#${id}-bd0", { opacity: 0, duration: 2.0, ease: "power1.inOut" }, ${f2(start + 1.5)});`);
      out.push(`tl.to("#${id}-bd1", { opacity: 1, duration: 2.0, ease: "power1.inOut" }, ${f2(start + 1.5)});`);
      // Reverse: t+4.6 over 1.7s (completes before exit at TV2.title)
      out.push(`tl.to("#${id}-bd1", { opacity: 0, duration: 1.7, ease: "power1.inOut" }, ${f2(start + 4.6)});`);
      out.push(`tl.to("#${id}-bd0", { opacity: 1, duration: 1.7, ease: "power1.inOut" }, ${f2(start + 4.6)});`);
    } else {
      // Spread N-1 dissolves evenly across [start+1.5, start+TV2.title-1.5]
      const window = TV2.title - 3.0;
      const interval = window / (n - 1);
      for (let i = 0; i < n - 1; i++) {
        const t = start + 1.5 + i * interval;
        const d = Math.min(1.8, interval * 0.85);
        out.push(`tl.to("#${id}-bd${i}", { opacity: 0, duration: ${f2(d)}, ease: "power1.inOut" }, ${f2(t)});`);
        out.push(`tl.to("#${id}-bd${i+1}", { opacity: 1, duration: ${f2(d)}, ease: "power1.inOut" }, ${f2(t)});`);
      }
    }
    return out;
  }

  const tl = [
    `tl.to("#${id}", { opacity: 1, duration: 0.5 }, ${f2(start)});`,
    // Title fades in first; rule draws; metadata follows
    `tl.to("#${id}-body", { opacity: 1, duration: 0.7, ease: "power2.out" }, ${f2(start + 0.2)});`,
    `tl.to("#${id}-rule", { width: 200, duration: 0.8, ease: "power2.out" }, ${f2(start + 0.55)});`,
    `tl.to("#${id}-meta", { opacity: 1, duration: 0.7, ease: "power2.out" }, ${f2(start + 0.75)});`,
    // Breathing vignette: barely perceptible single pulse over the scene hold
    ...(n > 0
      ? [`tl.to("#${id}-vignette", { opacity: 0.65, duration: 2.2, ease: "power1.inOut" }, ${f2(start + 1.5)});`,
         `tl.to("#${id}-vignette", { opacity: 1.0, duration: 2.0, ease: "power1.inOut" }, ${f2(start + 4.2)});`]
      : []),
    ...mkDissolves(),
    `tl.to("#${id}", { opacity: 0, duration: ${f2(TV2.xfade)} }, ${f2(start + TV2.title)});`,
    `tl.set("#${id}", { opacity: 0 }, ${f2(start + TV2.title + TV2.xfade)});`,
  ];

  return { html: clip(id, start, dur, inner), tl, duration: TV2.title + TV2.pause };
}

export function buildFindingSceneV2({ section, findingNumber, sceneIndex, start, resolveOpts }) {
  const idA = `sc-find-${sceneIndex}-a`;
  const idB = `sc-find-${sceneIndex}-b`;
  const sentence = norm(section.reportSentence) || norm(section.text);
  // The finding title comes straight from the finding object (same title the
  // following finding slide uses) — never extracted from the report sentence.
  const title = esc(norm(section.title));
  const imgUrl = resolveEvidenceUrl(section, resolveOpts);
  const pointer = section.pointer;
  const orientation = esc(norm(section.orientation));
  const winLabel = esc(windowLabel(section));
  const vOrigin = vignetteOrigin(section);

  const textDur = TV2.findingText + TV2.xfade;
  // Image starts earlier than V1 — more overlap so the transition feels like
  // the phrase is being extracted directly from the report into the image.
  const imgStart = start + TV2.findingText - 0.8;
  const imgDur = TV2.findingImage + TV2.xfade;

  // Beat B built first (sits underneath)
  const imageEl = imgUrl
    ? `<img class="evidence-img" id="${idB}-img" src="${esc(imgUrl)}" alt="${title} — evidence"
         style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;"/>`
    : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#2a2a40;font-size:16px;">No image captured</div>`;

  const orientLabel = orientation
    ? `<div style="position:absolute;top:52px;right:56px;font-family:monospace;font-size:13px;
        letter-spacing:.14em;color:#3a5575;opacity:.8;">${orientation}</div>`
    : '';

  let pointerHtml = '';
  if (pointer && imgUrl) {
    const px = (Number(pointer.x) * 100).toFixed(1);
    const py = (Number(pointer.y) * 100).toFixed(1);
    pointerHtml = `
      <div id="${idB}-ptr" style="position:absolute;left:${px}%;top:${py}%;width:120px;height:120px;margin:-60px 0 0 -60px;opacity:0;">
        <div id="${idB}-ring" style="position:absolute;inset:0;border-radius:50%;border:3px solid rgba(120,190,255,.9);
          box-shadow:0 0 22px rgba(90,160,255,.55),inset 0 0 14px rgba(90,160,255,.35);"></div>
        <div style="position:absolute;inset:34px;border-radius:50%;border:2px solid rgba(150,205,255,.5);"></div>
      </div>`;
  }

  const metaLines = [];
  if (section.navigable) {
    metaLines.push(`<span style="color:#6f88b4;">Series</span> ${esc(String(section.seriesNumber ?? ''))}`);
    metaLines.push(`<span style="color:#6f88b4;">Image</span> ${esc(String(section.imageNumber ?? ''))}`);
  }
  const findingBodyText = norm(section.text);
  const patientText = norm(section.patientFriendlyExplanation);
  // Patient text never truncates — scale down only past ~8 lines of TV-sized text.
  const patientFontPx = patientText.length <= 200 ? 46
    : patientText.length <= 320 ? 42 : 36;

  // ── V2 left narrative panel — TV-readable hierarchy ───────────────────────────
  // Optimized for an elderly viewer across a room: every element is large and
  // high-contrast. The patient explanation is the primary reading element (in an
  // elevated card, 42-48px, pure white). Patient text NEVER truncates — it wraps
  // freely and the card grows; only very long text scales the font down slightly.
  const patientCard = patientText ? `
    <div style="background:rgba(18,26,45,.85);border-radius:18px;
      padding:34px;border:1px solid rgba(0,212,232,.28);
      box-shadow:0 18px 50px rgba(0,0,0,.45);flex-shrink:0;">
      <div style="font-size:31px;font-weight:700;color:#2bd4e8;text-transform:uppercase;
        letter-spacing:.10em;margin-bottom:18px;">For patients</div>
      <div style="font-size:${patientFontPx}px;font-weight:600;color:#ffffff;line-height:1.42;
        overflow-wrap:break-word;">${esc(patientText)}</div>
    </div>` : '';

  const leftPanel = `
    <div id="${idB}-panel" style="position:absolute;left:0;top:0;bottom:0;width:38%;
      background:rgba(6,8,18,.65);backdrop-filter:blur(14px);
      border-right:1px solid rgba(70,90,140,.18);overflow:hidden;opacity:0;">
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;
        justify-content:center;padding:48px 46px 48px 58px;">
        <div style="font-size:31px;color:#2bd4e8;font-weight:700;text-transform:uppercase;
          letter-spacing:.10em;margin-bottom:18px;flex-shrink:0;">Finding ${findingNumber}</div>
        <div style="font-size:60px;font-weight:800;color:#eef3ff;line-height:1.14;
          margin-bottom:22px;flex-shrink:0;">${title}</div>
        ${metaLines.length ? `<div style="font-family:monospace;font-size:27px;color:#b8c8e0;letter-spacing:.02em;
          margin-bottom:${winLabel ? '10px' : '22px'};flex-shrink:0;">${metaLines.join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</div>` : ''}
        ${winLabel ? `<div style="font-size:25px;color:#9cb0d2;margin-bottom:22px;flex-shrink:0;">${winLabel}</div>` : ''}
        <div style="width:48px;height:2px;background:rgba(0,212,232,.45);margin-bottom:24px;flex-shrink:0;"></div>
        ${findingBodyText ? `<div style="font-size:36px;color:#c8d6ea;line-height:1.5;
          margin-bottom:${patientText ? '24px' : '0'};flex-shrink:0;overflow-wrap:break-word;">${esc(findingBodyText)}</div>` : ''}
        ${patientCard}
      </div>
    </div>`;

  const rightStage = `
    <div id="${idB}-stage" style="position:absolute;left:38%;right:0;top:0;bottom:0;">
      ${imageEl}
      <div style="position:absolute;inset:0;pointer-events:none;
        background:radial-gradient(ellipse at center,transparent 44%,rgba(2,2,8,.50) 100%);"></div>
      ${pointerHtml}
      <div style="position:absolute;inset:28px;border:1px solid rgba(90,150,220,.09);border-radius:6px;
        box-shadow:0 30px 80px rgba(0,0,0,.45);pointer-events:none;"></div>
    </div>`;

  const beatB = clip(idB, imgStart, imgDur, `
    <div style="position:absolute;inset:0;background:#04040a;"></div>
    ${leftPanel}
    ${rightStage}
    ${orientLabel}`);

  // Beat A is a bridge: the full report sentence (context) sits above the finding
  // title, which is the same headline the following finding slide carries. The
  // sentence dims slightly once the title lands so attention hands off cleanly.
  const beatA = clip(idA, start, textDur, `
    <div style="position:absolute;inset:0;background:linear-gradient(160deg,#080814 0%,#0a0a18 100%);"></div>
    <div id="${idA}-wrap" style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 170px;">
      <div style="font-size:31px;font-weight:700;color:#2bd4e8;text-transform:uppercase;letter-spacing:.12em;margin-bottom:30px;">Finding ${findingNumber} &nbsp;·&nbsp; Report</div>
      <div id="${idA}-line" style="font-size:34px;font-weight:500;color:#c8d6ea;line-height:1.5;opacity:0;">${esc(sentence)}</div>
      <div id="${idA}-title" style="font-size:68px;font-weight:800;color:#ffffff;line-height:1.08;text-transform:uppercase;letter-spacing:-.01em;margin-top:42px;opacity:0;">${title}</div>
    </div>`);

  const tl = [
    `tl.to("#${idA}", { opacity: 1, duration: ${f2(TV2.xfade)} }, ${f2(start)});`,
    `tl.fromTo("#${idA}-line", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, ${f2(start + 0.2)});`,
    `tl.fromTo("#${idA}-title", { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, ${f2(start + 1.1)});`,
    `tl.to("#${idA}-line", { opacity: 0.5, duration: 0.5, ease: "power1.out" }, ${f2(start + 1.1)});`,
  ];

  // Beat A lifts and fades; image cross-dissolves in with more overlap than V1.
  tl.push(`tl.to("#${idA}-wrap", { y: -50, scale: 0.93, opacity: 0, duration: ${f2(TV2.xfade + 0.2)}, ease: "power2.in" }, ${f2(imgStart - 0.1)});`);
  tl.push(`tl.to("#${idA}", { opacity: 0, duration: ${f2(TV2.xfade)} }, ${f2(imgStart)});`);
  tl.push(`tl.set("#${idA}", { opacity: 0 }, ${f2(imgStart + TV2.xfade)});`);

  // Beat B: image static — no camera move. Left panel delayed so image
  // registers first, then narrative context appears.
  tl.push(`tl.to("#${idB}", { opacity: 1, duration: ${f2(TV2.xfade)} }, ${f2(imgStart)});`);
  tl.push(`tl.to("#${idB}-panel", { opacity: 1, duration: 0.9, ease: "power2.out" }, ${f2(imgStart + 0.6)});`);
  tl.push(`tl.to("#${idB}", { opacity: 0, duration: ${f2(TV2.xfade)} }, ${f2(imgStart + TV2.findingImage)});`);
  tl.push(`tl.set("#${idB}", { opacity: 0 }, ${f2(imgStart + TV2.findingImage + TV2.xfade)});`);

  // Pointer: image fades in over 0.8s → hold 0.4s → pointer appears.
  // Total delay before pointer = 0.8 + 0.4 = 1.2s after imgStart, vs V1's 1.1s.
  // The extra wait lets viewers orient before attention is directed.
  if (pointer && imgUrl) {
    const t0 = imgStart + 1.4;
    tl.push(`tl.fromTo("#${idB}-ptr", { opacity: 0, scale: 1.7 }, { opacity: 1, scale: 1.0, duration: 0.6, ease: "back.out(2)" }, ${f2(t0)});`);
    tl.push(`tl.fromTo("#${idB}-ring", { scale: 0.9 }, { scale: 1.08, duration: 0.55, ease: "sine.inOut", repeat: 3, yoyo: true }, ${f2(t0 + 0.5)});`);
    tl.push(`tl.to("#${idB}-ptr", { opacity: 0, duration: 0.8, ease: "power1.out" }, ${f2(imgStart + TV2.findingImage - 1.4)});`);
  }

  return { html: `${beatB}\n${beatA}`, tl, duration: TV2.findingText + TV2.findingImage + TV2.pause };
}

export function buildClosingSceneV2({ impression, start }) {
  const id = 'sc-closing';
  const items = Array.isArray(impression) ? impression : [];

  // Longer stagger than V1 — each item is a standalone statement.
  const staggerGap    = 1.6;
  const itemFade      = 0.65;
  const holdAfterLast = 1.2;
  const activeDur = 0.5 + items.length * staggerGap + holdAfterLast;
  const closingDur = Math.max(TV2.closing, activeDur);
  const dur = closingDur + TV2.xfade;

  // Numbered items: number stacked above text (conference summary aesthetic).
  // TV-readable: bright cyan numbers, large high-weight text, generous spacing.
  const items_html = items.map((b, i) => `
    <div id="${id}-b${i}" style="opacity:0;margin-bottom:60px;">
      <div style="font-size:38px;font-weight:700;color:#2bd4e8;letter-spacing:.10em;
        margin-bottom:12px;">${i + 1}</div>
      <div style="font-size:60px;font-weight:700;color:#eef3ff;line-height:1.22;">${esc(norm(b))}</div>
    </div>`).join('');

  const inner = `
    <div style="position:absolute;inset:0;background:linear-gradient(160deg,#070712 0%,#090916 100%);"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;
      justify-content:center;padding:0 170px;">
      ${items_html}
    </div>`;

  const tl = [`tl.to("#${id}", { opacity: 1, duration: 0.6 }, ${f2(start)});`];
  items.forEach((_, i) => {
    tl.push(`tl.to("#${id}-b${i}", { opacity: 1, duration: ${f2(itemFade)}, ease: "power2.out" }, ${f2(start + 0.5 + i * staggerGap)});`);
  });
  tl.push(`tl.to("#${id}", { opacity: 0, duration: ${f2(TV2.xfade)} }, ${f2(start + closingDur)});`);
  tl.push(`tl.set("#${id}", { opacity: 0 }, ${f2(start + closingDur + TV2.xfade)});`);

  return { html: clip(id, start, dur, inner), tl, duration: closingDur + TV2.pause };
}

export function buildEndCardSceneV2({ start }) {
  const id = 'sc-endcard';
  const dur = TV2.endCard + TV2.xfade;

  // Wordmark ~17% smaller than V1 (100px vs 120px) — more negative space,
  // more breathing room, less visual weight.
  const inner = `
    <div style="position:absolute;inset:0;background:#04040a;"></div>
    <div id="${id}-wordmark" style="position:absolute;inset:0;display:flex;align-items:center;
      justify-content:center;opacity:0;">
      <div style="font-family:${BRAND.font};font-size:100px;letter-spacing:0.08em;
        color:${BRAND.color};line-height:1;">${BRAND.text.toUpperCase()}</div>
    </div>`;

  const tl = [
    `tl.to("#${id}", { opacity: 1, duration: ${f2(TV2.xfade)} }, ${f2(start)});`,
    `tl.to("#${id}-wordmark", { opacity: 1, duration: 0.9, ease: "power2.out" }, ${f2(start + 0.4)});`,
    `tl.to("#${id}", { opacity: 0, duration: ${f2(TV2.xfade)} }, ${f2(start + TV2.endCard)});`,
    `tl.set("#${id}", { opacity: 0 }, ${f2(start + TV2.endCard + TV2.xfade)});`,
  ];

  return { html: clip(id, start, dur, inner), tl, duration: TV2.endCard + TV2.pause };
}

// V2 summary — same layout/timing as the shared summary scene but with a larger,
// brighter "SUMMARY" label and higher-contrast body for TV readability. Kept
// separate so the shared buildSummaryScene (V1) stays byte-identical.
export function buildSummarySceneV2({ summary, start }) {
  const id = 'sc-summary';
  const dur = TV2.summary + TV2.xfade;
  const text = esc(norm(summary) || 'Study summary unavailable.');
  const inner = `
    <div style="position:absolute;inset:0;background:linear-gradient(160deg,#080814 0%,#0a0a18 100%);"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 180px;">
      <div style="font-size:31px;font-weight:700;color:#2bd4e8;text-transform:uppercase;letter-spacing:.12em;margin-bottom:32px;">Summary</div>
      <div id="${id}-text" style="font-size:50px;font-weight:600;color:#e6edfb;line-height:1.4;opacity:0;letter-spacing:-.005em;">${text}</div>
      <div id="${id}-rule" style="height:2px;width:0;margin-top:44px;background:linear-gradient(90deg,#2bd4e8,transparent);"></div>
    </div>`;
  const tl = [
    `tl.to("#${id}", { opacity: 1, duration: ${f2(TV2.xfade)} }, ${f2(start)});`,
    `tl.fromTo("#${id}-text", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1.0, ease: "power2.out" }, ${f2(start + 0.3)});`,
    `tl.to("#${id}-rule", { width: 360, duration: 1.2, ease: "power2.out" }, ${f2(start + 0.8)});`,
    `tl.to("#${id}", { opacity: 0, duration: ${f2(TV2.xfade)} }, ${f2(start + TV2.summary)});`,
    `tl.set("#${id}", { opacity: 0 }, ${f2(start + TV2.summary + TV2.xfade)});`,
  ];
  return { html: clip(id, start, dur, inner), tl, duration: TV2.summary + TV2.pause };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a cinematic HyperFrames HTML composition from a PresentationManifest.
 * @param {object} manifest
 * @param {object} [options]
 * @param {string} [options.projectDir]
 * @param {("data-url"|"relative"|"absolute-file")} [options.assetMode="data-url"]
 * @param {function} [options.readAsset]
 * @param {("v1"|"v2")} [options.presentationStyle="v1"]  style variant to use
 * @returns {string} complete HTML
 */
export function exportHtmlComposition(manifest, { projectDir, assetMode = 'data-url', readAsset, presentationStyle = 'v1' } = {}) {
  const sections = Array.isArray(manifest?.sections) ? manifest.sections : [];
  const compositionId = esc(norm(manifest?.accession || 'presentation'));
  const resolveOpts = { assetMode, projectDir, readAsset };

  // Data-driven: only findings with captured image evidence get an image scene.
  const imageSections = sections
    .map((section, idx) => ({ section, findingNumber: idx + 1 }))
    .filter(({ section }) => sectionHasImage(section));

  // All evidence URLs — used for the title backdrop cross-dissolve.
  const backdropUrls = imageSections
    .map(({ section }) => resolveEvidenceUrl(section, resolveOpts))
    .filter(Boolean);

  const scenes = [];
  let cursor = 0;
  const advance = (scene) => { scenes.push(scene); cursor += scene.duration; };

  if (presentationStyle === 'v2') {
    advance(buildTitleSceneV2({ manifest, start: cursor, backdropUrls }));
    advance(buildSummarySceneV2({ summary: manifest.summary, start: cursor }));
    imageSections.forEach(({ section, findingNumber }, sceneIndex) => {
      advance(buildFindingSceneV2({ section, findingNumber, sceneIndex, start: cursor, resolveOpts }));
    });
    advance(buildClosingSceneV2({ impression: manifest.impression, start: cursor }));
    advance(buildEndCardSceneV2({ start: cursor }));
  } else {
    advance(buildTitleScene({ manifest, start: cursor, backdropUrls }));
    advance(buildSummaryScene({ summary: manifest.summary, start: cursor }));
    imageSections.forEach(({ section, findingNumber }, sceneIndex) => {
      advance(buildFindingScene({ section, findingNumber, sceneIndex, start: cursor, resolveOpts }));
    });
    advance(buildClosingScene({ impression: manifest.impression, start: cursor }));
    advance(buildEndCardScene({ start: cursor }));
  }

  const totalDuration = Math.ceil(cursor + 0.5);
  const clipsHtml = scenes.map(s => s.html).join('\n');
  const tlLines = scenes.flatMap(s => s.tl).map(l => '    ' + l).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=1920, height=1080"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Bebas+Neue&display=swap" rel="stylesheet"/>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:1920px; height:1080px; overflow:hidden; background:#06060e; font-family:'Inter', sans-serif; }
    .hl {
      background:linear-gradient(90deg,#eef3ff 0%,#eef3ff 50%,#54607e 50%,#54607e 100%);
      background-size:200% 100%; background-position:100% 0;
      -webkit-background-clip:text; background-clip:text;
      -webkit-text-fill-color:transparent; color:transparent; font-weight:700;
    }
  </style>
</head>
<body>
  <div id="root" data-composition-id="${compositionId}" data-start="0"
    data-duration="${totalDuration}" data-width="1920" data-height="1080">
${clipsHtml}
${brandLayer()}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
${tlLines}
    window.__timelines["${compositionId}"] = tl;
  </script>
</body>
</html>`;
}
