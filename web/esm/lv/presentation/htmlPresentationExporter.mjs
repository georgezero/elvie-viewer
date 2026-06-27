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
//   TitleScene    exam name, accession, indication over a blurred CT backdrop
//   SummaryScene  one-line study summary, animated in
//   FindingScene  (localized findings only) report sentence with a reading-sweep
//                 highlight that hands off into the CT image; viewer-style framing,
//                 a STATIC image (no camera movement — the anatomy never moves),
//                 a pointer that appears/pulses/fades, and a minimal metadata card
//   ClosingScene  impression bullets (staggered), gentle fade to black
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
  title:        3.2,
  summary:      4.2,
  findingText:  4.2,   // beat A — report sentence
  findingImage: 6.2,   // beat B — CT image + pointer + metadata
  closing:      6.2,
  xfade:        0.8,   // cross-dissolve overlap
  pause:        0.45,  // brief hold between scenes (room for future narration)
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
function highlightSentence(sentence, phrase, sweepId) {
  const s = norm(sentence);
  const p = norm(phrase);
  if (!s) return '';
  if (!p) return esc(s);
  const i = s.toLowerCase().indexOf(p.toLowerCase());
  if (i < 0) return esc(s);
  return `${esc(s.slice(0, i))}<span class="hl" id="${sweepId}">${esc(s.slice(i, i + p.length))}</span>${esc(s.slice(i + p.length))}`;
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

export function buildTitleScene({ manifest, start, backdropUrl }) {
  const study = manifest.study || {};
  const exam = esc(norm(study.examName) || norm(manifest.presentationTitle) || 'STUDY');
  const acc = esc(norm(study.accession || manifest.accession));
  const date = norm(study.studyDate);
  const indication = norm(study.clinicalIndication);
  const dur = T.title + T.xfade;
  const id = 'sc-title';

  const backdrop = backdropUrl
    ? `<div id="${id}-bg" style="position:absolute;inset:0;background-image:url('${esc(backdropUrl)}');
         background-size:cover;background-position:center;filter:blur(26px) brightness(.26) saturate(.6);transform:scale(1.15);"></div>
       <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(6,6,16,.5) 0%,rgba(4,4,12,.93) 80%);"></div>`
    : `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#06060f 0%,#0c0c1e 60%,#0a0a18 100%);"></div>`;

  const metaRows = [
    acc ? `Accession ${acc}` : '',
    date ? `Study date ${esc(date)}` : '',
    indication ? `Indication: ${esc(indication)}` : '',
  ].filter(Boolean).map(r =>
    `<div style="font-size:18px;color:#5b6f9c;letter-spacing:.04em;margin-top:8px;">${r}</div>`
  ).join('');

  const inner = `
    ${backdrop}
    <div id="${id}-body" style="position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;opacity:0;">
      <div style="font-size:84px;font-weight:700;color:#eef3ff;letter-spacing:.01em;text-align:center;
        line-height:1.05;text-shadow:0 2px 40px rgba(0,0,0,.6);">${exam}</div>
      <div style="margin-top:26px;text-align:center;">${metaRows}</div>
    </div>`;

  // The blurred backdrop holds a fixed scale(1.15) to hide blur-edge bleed, but
  // it is NOT animated — no push-in. Only the title text fades in.
  const tl = [
    `tl.to("#${id}", { opacity: 1, duration: 0.5 }, ${f2(start)});`,
    `tl.to("#${id}-body", { opacity: 1, duration: 0.9, ease: "power2.out" }, ${f2(start + 0.3)});`,
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
  // Full-height glass panel: finding title, series/image coordinates, radiologist
  // description, and optional patient-friendly explanation. Designed to
  // accommodate multi-line clinical findings without shrinking font or layout.
  const leftPanel = `
    <div id="${idB}-panel" style="position:absolute;left:0;top:0;bottom:0;width:38%;
      background:rgba(6,8,18,.65);backdrop-filter:blur(14px);
      border-right:1px solid rgba(70,90,140,.18);overflow:hidden;opacity:0;">
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;
        justify-content:center;padding:52px 40px 52px 52px;overflow:hidden;">
        <div style="font-size:11px;color:#3a5080;text-transform:uppercase;
          letter-spacing:.28em;margin-bottom:16px;">Finding ${findingNumber}</div>
        <div style="font-size:24px;font-weight:600;color:#eef3ff;line-height:1.3;
          margin-bottom:${metaLines.length || winLabel ? '12px' : '22px'};">${title}</div>
        ${metaLines.length ? `<div style="font-family:monospace;font-size:13px;color:#8fb0dd;letter-spacing:.02em;
          margin-bottom:${winLabel ? '8px' : '22px'};">${metaLines.join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</div>` : ''}
        ${winLabel ? `<div style="font-size:11px;color:#46587e;margin-bottom:22px;">${winLabel}</div>` : ''}
        <div style="width:32px;height:1px;background:rgba(70,90,140,.35);margin-bottom:22px;flex-shrink:0;"></div>
        ${findingBodyText ? `<div style="font-size:15px;color:#b8c8e0;line-height:1.70;
          margin-bottom:${patientText ? '28px' : '0'};flex-shrink:0;">${esc(findingBodyText)}</div>` : ''}
        ${patientText ? `
          <div style="font-size:11px;color:#2b3f5c;text-transform:uppercase;letter-spacing:.22em;
            margin-bottom:10px;flex-shrink:0;">For patients</div>
          <div style="font-size:14px;color:#556b80;line-height:1.70;font-style:italic;
            flex-shrink:0;">${esc(patientText)}</div>` : ''}
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
  const dur = T.closing + 0.8;
  const items = Array.isArray(impression) ? impression : [];
  const bullets = items.map((b, i) => `
    <div id="${id}-b${i}" style="display:flex;align-items:flex-start;gap:18px;opacity:0;margin-bottom:22px;">
      <div style="width:9px;height:9px;border-radius:50%;background:#5a9aff;margin-top:18px;flex:0 0 auto;box-shadow:0 0 12px rgba(90,160,255,.6);"></div>
      <div style="font-size:38px;color:#dfe7fb;line-height:1.3;">${esc(norm(b))}</div>
    </div>`).join('');

  const inner = `
    <div style="position:absolute;inset:0;background:linear-gradient(160deg,#070712 0%,#090916 100%);"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 200px;">
      <div style="font-size:13px;color:#3a5080;text-transform:uppercase;letter-spacing:.28em;margin-bottom:38px;">Impression</div>
      ${bullets}
    </div>
    <div id="${id}-fade" style="position:absolute;inset:0;background:#000;opacity:0;"></div>`;

  const tl = [`tl.to("#${id}", { opacity: 1, duration: 0.6 }, ${f2(start)});`];
  items.forEach((_, i) => {
    tl.push(`tl.fromTo("#${id}-b${i}", { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.7, ease: "power2.out" }, ${f2(start + 0.6 + i * 0.55)});`);
  });
  tl.push(`tl.to("#${id}-fade", { opacity: 1, duration: 1.1, ease: "power2.in" }, ${f2(start + T.closing - 0.3)});`);

  return { html: clip(id, start, dur, inner), tl, duration: T.closing };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a cinematic HyperFrames HTML composition from a PresentationManifest.
 * @param {object} manifest
 * @param {object} [options]
 * @param {string} [options.projectDir]
 * @param {("data-url"|"relative"|"absolute-file")} [options.assetMode="data-url"]
 * @param {function} [options.readAsset]
 * @returns {string} complete HTML
 */
export function exportHtmlComposition(manifest, { projectDir, assetMode = 'data-url', readAsset } = {}) {
  const sections = Array.isArray(manifest?.sections) ? manifest.sections : [];
  const compositionId = esc(norm(manifest?.accession || 'presentation'));
  const resolveOpts = { assetMode, projectDir, readAsset };

  // Data-driven: only findings with captured image evidence get an image scene.
  const imageSections = sections
    .map((section, idx) => ({ section, findingNumber: idx + 1 }))
    .filter(({ section }) => sectionHasImage(section));

  const backdropUrl = imageSections.map(({ section }) => resolveEvidenceUrl(section, resolveOpts)).find(Boolean) || null;

  const scenes = [];
  let cursor = 0;
  const advance = (scene) => { scenes.push(scene); cursor += scene.duration; };

  advance(buildTitleScene({ manifest, start: cursor, backdropUrl }));
  advance(buildSummaryScene({ summary: manifest.summary, start: cursor }));
  imageSections.forEach(({ section, findingNumber }, sceneIndex) => {
    advance(buildFindingScene({ section, findingNumber, sceneIndex, start: cursor, resolveOpts }));
  });
  advance(buildClosingScene({ impression: manifest.impression, start: cursor }));

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
