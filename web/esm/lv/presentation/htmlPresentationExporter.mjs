// HTML presentation exporter — cinematic radiology case video.
//
// Converts a PresentationManifest (presentation-manifest-v1) into a HyperFrames
// HTML composition for the CLI HTML-to-MP4 renderer:  npx hyperframes render <dir>
//
// The composition is built from reusable SCENE BUILDERS, each emitting one
// timeline segment (HTML clip(s) + GSAP tweens at absolute times):
//
//   TitleScene    exam name, accession, indication over a blurred CT backdrop
//   SummaryScene  one-line AI study summary, animated in
//   FindingScene  beat A: report sentence with the key phrase highlighted
//                 beat B: cross-dissolve to the captured CT image with a slow
//                         Ken Burns zoom, an animated pointer, and a metadata card
//   ClosingScene  impression bullets, gentle fade to black
//
// Cinematic language: every clip starts at opacity:0 and is faded/cross-dissolved
// via GSAP; images get a continuous Ken Burns transform; the pointer pulses.
//
// Evidence is untouched: images come straight from the manifest's imageEvidence
// (the exact Preview Deck bytes). assetMode controls how that image is referenced
// (see resolveEvidenceUrl). The module stays free of fs/path imports.

// ── Scene timing (seconds) ──────────────────────────────────────────────────
const T = {
  title:        3.0,
  summary:      4.0,
  findingText:  3.0,   // beat A — report sentence
  findingImage: 6.0,   // beat B — CT image + pointer + metadata
  closing:      5.0,
  xfade:        0.8,   // cross-dissolve overlap
};

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function norm(v) { return String(v == null ? '' : v).trim(); }
function f2(n) { return Number(n).toFixed(2); }

// Resolve an evidence image to a usable <img src> value, honouring assetMode.
function resolveEvidenceUrl(section, { assetMode, projectDir, readAsset }) {
  const evArr = Array.isArray(section?.imageEvidence) ? section.imageEvidence : [];
  const captured = evArr.find(e => e?.status === 'captured' && (e?.dataUrl || e?.assetPath));
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

// Wrap the first occurrence of `phrase` in `sentence` with a highlight span.
function highlightSentence(sentence, phrase) {
  const s = norm(sentence);
  const p = norm(phrase);
  if (!s) return '';
  if (!p) return esc(s);
  const i = s.toLowerCase().indexOf(p.toLowerCase());
  if (i < 0) return esc(s);
  const before = esc(s.slice(0, i));
  const match = esc(s.slice(i, i + p.length));
  const after = esc(s.slice(i + p.length));
  return `${before}<span class="hl">${match}</span>${after}`;
}

// A full-frame clip shell. Starts hidden (opacity:0); GSAP fades it in/out.
function clip(id, start, duration, inner, extraStyle = '') {
  return `
  <div id="${id}" class="clip" data-start="${f2(start)}" data-duration="${f2(duration)}"
    style="opacity:0;position:absolute;inset:0;background:#06060e;${extraStyle}">
${inner}
  </div>`;
}

// ── Scene builders ───────────────────────────────────────────────────────────
// Each returns { html, tl: string[], duration }. tl entries are GSAP statements
// with absolute composition times.

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
         background-size:cover;background-position:center;filter:blur(26px) brightness(.28) saturate(.6);
         transform:scale(1.15);"></div>
       <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(6,6,16,.55) 0%,rgba(4,4,12,.92) 80%);"></div>`
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
    <div style="position:absolute;top:44px;left:56px;font-size:12px;letter-spacing:.28em;
      color:#33415f;text-transform:uppercase;">Elvie Radiology</div>
    <div id="${id}-body" style="position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;opacity:0;">
      <div style="font-size:13px;color:#3a5080;text-transform:uppercase;letter-spacing:.3em;
        margin-bottom:26px;">Case Presentation</div>
      <div style="font-size:84px;font-weight:700;color:#eef3ff;letter-spacing:.01em;
        text-align:center;line-height:1.05;text-shadow:0 2px 40px rgba(0,0,0,.6);">${exam}</div>
      <div style="margin-top:26px;text-align:center;">${metaRows}</div>
    </div>`;

  const tl = [
    `tl.to("#${id}", { opacity: 1, duration: 0.5 }, ${f2(start)});`,
    `tl.to("#${id}-body", { opacity: 1, duration: 0.9, ease: "power2.out" }, ${f2(start + 0.3)});`,
    // slow push-in on the backdrop for life
    backdropUrl ? `tl.fromTo("#${id}-bg", { scale: 1.15 }, { scale: 1.24, duration: ${f2(dur)}, ease: "none" }, ${f2(start)});` : '',
    `tl.to("#${id}", { opacity: 0, duration: ${f2(T.xfade)} }, ${f2(start + T.title)});`,
  ].filter(Boolean);

  return { html: clip(id, start, dur, inner), tl, duration: T.title };
}

export function buildSummaryScene({ summary, start }) {
  const id = 'sc-summary';
  const dur = T.summary + T.xfade;
  const text = esc(norm(summary) || 'Study summary unavailable.');
  const inner = `
    <div style="position:absolute;inset:0;background:linear-gradient(160deg,#080814 0%,#0a0a18 100%);"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;
      padding:0 200px;">
      <div style="font-size:13px;color:#3a5080;text-transform:uppercase;letter-spacing:.28em;
        margin-bottom:30px;">Summary</div>
      <div id="${id}-text" style="font-size:46px;font-weight:600;color:#dfe7fb;line-height:1.4;
        opacity:0;letter-spacing:-.005em;">${text}</div>
      <div id="${id}-rule" style="height:2px;width:0;margin-top:40px;
        background:linear-gradient(90deg,#2d4fa8,transparent);"></div>
    </div>`;
  const tl = [
    `tl.to("#${id}", { opacity: 1, duration: ${f2(T.xfade)} }, ${f2(start)});`,
    `tl.fromTo("#${id}-text", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1.0, ease: "power2.out" }, ${f2(start + 0.3)});`,
    `tl.to("#${id}-rule", { width: 360, duration: 1.2, ease: "power2.out" }, ${f2(start + 0.8)});`,
    `tl.to("#${id}", { opacity: 0, duration: ${f2(T.xfade)} }, ${f2(start + T.summary)});`,
  ];
  return { html: clip(id, start, dur, inner), tl, duration: T.summary };
}

export function buildFindingScene({ section, index, start, resolveOpts }) {
  const n = index + 1;
  const idA = `sc-find-${index}-a`;   // report sentence beat
  const idB = `sc-find-${index}-b`;   // image beat
  const sentence = norm(section.reportSentence) || norm(section.text);
  const highlighted = highlightSentence(sentence, section.highlightPhrase);
  const title = esc(norm(section.title));
  const imgUrl = resolveEvidenceUrl(section, resolveOpts);
  const pointer = section.pointer;

  const textDur = T.findingText + T.xfade;
  const imgStart = start + T.findingText;          // beats overlap by xfade
  const imgDur = T.findingImage + T.xfade;

  // ── Beat A: report sentence ──
  const beatA = clip(idA, start, textDur, `
    <div style="position:absolute;inset:0;background:linear-gradient(160deg,#080814 0%,#0a0a18 100%);"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 190px;">
      <div style="font-size:13px;color:#3a5080;text-transform:uppercase;letter-spacing:.28em;margin-bottom:26px;">
        Finding ${n} &nbsp;·&nbsp; Report</div>
      <div id="${idA}-line" style="font-size:50px;font-weight:600;color:#54607e;line-height:1.45;opacity:0;">
        ${highlighted}</div>
    </div>`);

  // ── Beat B: CT image (Ken Burns) + pointer + metadata card ──
  const imagePanel = imgUrl
    ? `<img id="${idB}-img" src="${esc(imgUrl)}" alt="${title} — CT evidence"
         style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;">`
    : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
         color:#2a2a40;font-size:16px;">No image captured</div>`;

  // Pointer overlay sits in the same transformed stage so it tracks the zoom.
  let pointerHtml = '';
  if (pointer && imgUrl) {
    const px = (Number(pointer.x) * 100).toFixed(1);
    const py = (Number(pointer.y) * 100).toFixed(1);
    pointerHtml = `
      <div id="${idB}-ptr" style="position:absolute;left:${px}%;top:${py}%;
        width:120px;height:120px;margin:-60px 0 0 -60px;opacity:0;">
        <div id="${idB}-ring" style="position:absolute;inset:0;border-radius:50%;
          border:3px solid rgba(120,190,255,.9);box-shadow:0 0 22px rgba(90,160,255,.55),inset 0 0 14px rgba(90,160,255,.35);"></div>
        <div style="position:absolute;inset:34px;border-radius:50%;border:2px solid rgba(150,205,255,.55);"></div>
      </div>`;
  }

  const card = `
    <div id="${idB}-card" style="position:absolute;left:80px;bottom:80px;opacity:0;
      background:rgba(8,10,20,.66);backdrop-filter:blur(8px);border:1px solid #1c2b48;
      border-radius:12px;padding:22px 28px;max-width:560px;">
      <div style="font-size:12px;color:#3a5080;text-transform:uppercase;letter-spacing:.18em;margin-bottom:8px;">
        Finding ${n}</div>
      <div style="font-size:34px;font-weight:700;color:#fff;line-height:1.15;margin-bottom:14px;">${title}</div>
      ${section.navigable ? `<div style="display:inline-flex;gap:18px;font-family:monospace;font-size:15px;color:#7ab8f5;">
        <span><span style="color:#3a6090;">SERIES</span> ${esc(String(section.seriesNumber ?? ''))}</span>
        <span><span style="color:#3a6090;">IMAGE</span> ${esc(String(section.imageNumber ?? ''))}</span>
      </div>` : `<div style="font-size:14px;color:#b07830;">Text-only finding</div>`}
    </div>`;

  const beatB = clip(idB, imgStart, imgDur, `
    <div style="position:absolute;inset:0;background:#04040a;"></div>
    <div id="${idB}-stage" style="position:absolute;inset:0;transform-origin:55% 42%;">
      ${imagePanel}
      ${pointerHtml}
    </div>
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 60% 45%,transparent 40%,rgba(2,2,8,.55) 100%);"></div>
    ${card}`);

  // ── Timeline ──
  const tl = [
    // Beat A in/out
    `tl.to("#${idA}", { opacity: 1, duration: ${f2(T.xfade)} }, ${f2(start)});`,
    `tl.fromTo("#${idA}-line", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.9, ease: "power2.out" }, ${f2(start + 0.25)});`,
    `tl.to("#${idA}", { opacity: 0, duration: ${f2(T.xfade)} }, ${f2(imgStart)});`,
    // Beat B cross-dissolve in, Ken Burns, hold, fade out
    `tl.to("#${idB}", { opacity: 1, duration: ${f2(T.xfade)} }, ${f2(imgStart)});`,
    `tl.fromTo("#${idB}-stage", { scale: 1.0 }, { scale: 1.14, duration: ${f2(imgDur)}, ease: "none" }, ${f2(imgStart)});`,
    `tl.fromTo("#${idB}-card", { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, ${f2(imgStart + 0.5)});`,
    `tl.to("#${idB}", { opacity: 0, duration: ${f2(T.xfade)} }, ${f2(imgStart + T.findingImage)});`,
  ];
  if (pointer && imgUrl) {
    tl.push(`tl.fromTo("#${idB}-ptr", { opacity: 0, scale: 1.6 }, { opacity: 1, scale: 1.0, duration: 0.7, ease: "back.out(2)" }, ${f2(imgStart + 0.9)});`);
    // Gentle pulse on the ring. Finite repeat (HyperFrames seeks to exact frame
    // times — an infinite repeat:-1 is non-deterministic). Half-cycle 1.1s, yoyo;
    // fill the remainder of the image beat.
    const pulseCycle = 1.1;
    const pulseWindow = T.findingImage - 1.3 + T.xfade;
    const pulseRepeat = Math.max(1, Math.floor(pulseWindow / pulseCycle) - 1);
    tl.push(`tl.fromTo("#${idB}-ring", { scale: 0.86 }, { scale: 1.06, duration: ${f2(pulseCycle)}, ease: "sine.inOut", repeat: ${pulseRepeat}, yoyo: true }, ${f2(imgStart + 1.3)});`);
  }

  return { html: `${beatA}\n${beatB}`, tl, duration: T.findingText + T.findingImage };
}

export function buildClosingScene({ impression, start }) {
  const id = 'sc-closing';
  const dur = T.closing + 0.6;
  const bullets = (Array.isArray(impression) ? impression : []).map((b, i) => `
    <div id="${id}-b${i}" style="display:flex;align-items:flex-start;gap:18px;opacity:0;margin-bottom:22px;">
      <div style="width:9px;height:9px;border-radius:50%;background:#5a9aff;margin-top:18px;flex:0 0 auto;
        box-shadow:0 0 12px rgba(90,160,255,.6);"></div>
      <div style="font-size:38px;color:#dfe7fb;line-height:1.3;">${esc(norm(b))}</div>
    </div>`).join('');

  const inner = `
    <div style="position:absolute;inset:0;background:linear-gradient(160deg,#070712 0%,#090916 100%);"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 200px;">
      <div style="font-size:13px;color:#3a5080;text-transform:uppercase;letter-spacing:.28em;margin-bottom:38px;">
        Impression</div>
      ${bullets}
    </div>
    <div id="${id}-fade" style="position:absolute;inset:0;background:#000;opacity:0;"></div>`;

  const tl = [`tl.to("#${id}", { opacity: 1, duration: 0.6 }, ${f2(start)});`];
  (Array.isArray(impression) ? impression : []).forEach((_, i) => {
    tl.push(`tl.fromTo("#${id}-b${i}", { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.7, ease: "power2.out" }, ${f2(start + 0.6 + i * 0.5)});`);
  });
  // gentle fade to black at the very end
  tl.push(`tl.to("#${id}-fade", { opacity: 1, duration: 1.0, ease: "power2.in" }, ${f2(start + T.closing - 0.4)});`);

  return { html: clip(id, start, dur, inner), tl, duration: T.closing };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a cinematic HyperFrames HTML composition from a PresentationManifest.
 *
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

  // Backdrop for the title = the first captured finding image (blurred/darkened).
  const backdropUrl = sections.map(s => resolveEvidenceUrl(s, resolveOpts)).find(Boolean) || null;

  const scenes = [];
  let cursor = 0;

  scenes.push(buildTitleScene({ manifest, start: cursor, backdropUrl }));
  cursor += scenes[scenes.length - 1].duration;

  scenes.push(buildSummaryScene({ summary: manifest.summary, start: cursor }));
  cursor += scenes[scenes.length - 1].duration;

  sections.forEach((section, idx) => {
    const scene = buildFindingScene({ section, index: idx, start: cursor, resolveOpts });
    scenes.push(scene);
    cursor += scene.duration;
  });

  scenes.push(buildClosingScene({ impression: manifest.impression, start: cursor }));
  cursor += scenes[scenes.length - 1].duration;

  const totalDuration = Math.ceil(cursor + 0.5);
  const clipsHtml = scenes.map(s => s.html).join('\n');
  const tlLines = scenes.flatMap(s => s.tl).map(l => '    ' + l).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=1920, height=1080"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"/>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:1920px; height:1080px; overflow:hidden; background:#06060e; font-family:'Inter', sans-serif; }
    .hl { color:#eef3ff; font-weight:700; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="${compositionId}" data-start="0"
    data-duration="${totalDuration}" data-width="1920" data-height="1080">
${clipsHtml}
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
