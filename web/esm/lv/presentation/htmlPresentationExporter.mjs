// HTML presentation exporter.
//
// Converts a PresentationManifest (presentation-manifest-v1) into a
// self-contained HyperFrames HTML composition.
//
// Layout: split-screen, dark medical theme.
//   Left panel  — finding title, body text, series/image badge, speaker notes
//   Right panel — captured CT image (or styled placeholder)
//
// Image evidence resolution:
//   evidence.assetPath  → used in HyperFrames CLI renders (relative to project dir)
//   evidence.dataUrl    → used in browser preview (base64 inline)
//   Neither             → "No image captured" placeholder
//
// Rendering with HyperFrames CLI:
//   npx hyperframes render <project-dir>
//
// exportHtmlComposition(manifest, { projectDir })
//   projectDir is optional. When supplied, assetPath evidence is resolved to an
//   absolute file:// URL so the HyperFrames renderer can read the PNG from disk.

const SLIDE_DURATION  = 7;   // seconds per finding slide
const INTRO_DURATION  = 2;   // seconds for the title card

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function norm(v) { return String(v == null ? '' : v).trim(); }

// Resolve evidence image: returns a URL string or null.
function resolveEvidenceUrl(section, projectDir) {
  const evArr = Array.isArray(section?.imageEvidence) ? section.imageEvidence : [];
  const captured = evArr.find(e => e?.status === 'captured' && (e?.dataUrl || e?.assetPath));
  if (!captured) return null;
  if (captured.assetPath) {
    // HyperFrames CLI render: resolve to absolute file path so the renderer
    // can load the PNG even when its internal server sets the CWD elsewhere.
    if (projectDir) {
      // Use a path relative to the composition — HyperFrames serves the
      // project dir as its root, so bare relative paths like assets/finding-1.png work.
      return captured.assetPath;
    }
    return captured.assetPath;
  }
  return captured.dataUrl || null;
}

// ── Clip generators ───────────────────────────────────────────────────────────

function introClip(manifest) {
  const label = esc(norm(manifest.studyLabel || manifest.accession));
  const title = esc(norm(manifest.presentationTitle));
  const count = Array.isArray(manifest.sections) ? manifest.sections.length : 0;
  return `
  <!-- ░░ Intro card: 0 – ${INTRO_DURATION}s ░░ -->
  <div id="clip-intro" class="clip"
    data-start="0" data-duration="${INTRO_DURATION}" data-track-index="0"
    style="opacity:0;position:absolute;inset:0;
           display:flex;flex-direction:column;align-items:center;justify-content:center;
           background:linear-gradient(135deg,#06060f 0%,#0c0c1e 60%,#0a0a18 100%);">
    <div style="font-size:13px;color:#1e1e38;text-transform:uppercase;
                letter-spacing:.22em;margin-bottom:28px;">Elvie Radiology Viewer</div>
    <div style="font-size:18px;color:#3a5080;letter-spacing:.08em;margin-bottom:14px;
                font-variant-numeric:tabular-nums;">${label}</div>
    <div style="font-size:60px;font-weight:700;color:#e8eeff;
                max-width:1300px;text-align:center;line-height:1.15;
                letter-spacing:-.01em;">${title}</div>
    <div style="margin-top:32px;font-size:14px;color:#252540;">
      ${count} finding${count !== 1 ? 's' : ''}</div>
  </div>`;
}

function findingClip(section, idx, startTime, projectDir) {
  const slideId  = `clip-slide-${idx}`;
  const title    = esc(norm(section.title));
  const text     = esc(norm(section.text));
  const notes    = esc(norm(section.speakerNotes));
  const imgUrl   = resolveEvidenceUrl(section, projectDir);

  // Series/Image badge
  const locBadge = section.navigable
    ? `<div style="display:inline-flex;align-items:center;gap:8px;
                   background:#0d1e33;border:1px solid #1a3a5c;
                   border-radius:20px;padding:5px 14px;margin-bottom:28px;">
        <span style="font-size:10px;color:#3a6090;text-transform:uppercase;
                     letter-spacing:.1em;">Series</span>
        <span style="font-size:14px;color:#7ab8f5;font-family:monospace;
                     font-weight:600;">${esc(String(section.seriesNumber ?? ''))}</span>
        <span style="font-size:10px;color:#2a3a50;">·</span>
        <span style="font-size:10px;color:#3a6090;text-transform:uppercase;
                     letter-spacing:.1em;">Image</span>
        <span style="font-size:14px;color:#7ab8f5;font-family:monospace;
                     font-weight:600;">${esc(String(section.imageNumber ?? ''))}</span>
       </div>`
    : `<div style="display:inline-flex;align-items:center;gap:8px;
                   background:#1c1200;border:1px solid #3a2800;
                   border-radius:20px;padding:5px 14px;margin-bottom:28px;">
        <span style="font-size:12px;color:#b07830;">&#9888; Text-only finding</span>
       </div>`;

  // Right panel: image or placeholder
  const imagePanel = imgUrl
    ? `<div style="width:100%;height:100%;
                   display:flex;align-items:center;justify-content:center;">
        <img src="${esc(imgUrl)}" alt="${title} — CT evidence"
          style="max-width:100%;max-height:100%;object-fit:contain;
                 border-radius:4px;display:block;background:#000;">
       </div>`
    : `<div style="width:100%;height:100%;
                   display:flex;flex-direction:column;
                   align-items:center;justify-content:center;
                   border:1px dashed #1c1c30;border-radius:8px;
                   color:#2a2a40;font-size:14px;background:#090910;
                   gap:12px;">
        <div style="font-size:32px;opacity:.3;">&#x2395;</div>
        <div>No image captured</div>
        <div style="font-size:11px;opacity:.6;">
          Run export:hyperframes to capture</div>
       </div>`;

  const notesBar = notes
    ? `<div style="position:absolute;bottom:0;left:0;right:0;
                   font-size:13px;color:#38384e;line-height:1.6;
                   border-top:1px solid #111128;padding:12px 60px;
                   background:rgba(6,6,15,.9);">
        <span style="font-size:9px;text-transform:uppercase;letter-spacing:.1em;
                     color:#222230;margin-right:10px;">Notes</span>${notes}
       </div>`
    : '';

  return `
  <!-- ░░ Slide ${idx + 1}: ${section.title} · ${startTime}s – ${startTime + SLIDE_DURATION}s ░░ -->
  <div id="${slideId}" class="clip"
    data-start="${startTime}" data-duration="${SLIDE_DURATION}" data-track-index="${idx + 1}"
    style="opacity:0;position:absolute;inset:0;
           background:#08080f;
           display:grid;
           grid-template-columns:480px 1fr;
           grid-template-rows:1fr;">

    <!-- Left: text panel -->
    <div style="display:flex;flex-direction:column;justify-content:center;
                padding:70px 50px 70px 70px;
                background:linear-gradient(135deg,#0b0b1a 0%,#0a0a16 100%);
                border-right:1px solid #111128;">
      <div style="font-size:11px;color:#1e1e38;text-transform:uppercase;
                  letter-spacing:.15em;margin-bottom:10px;">
        Finding ${idx + 1}</div>
      <div style="font-size:32px;font-weight:700;color:#ffffff;
                  line-height:1.2;margin-bottom:16px;">${title}</div>
      <div style="font-size:16px;color:#6677aa;line-height:1.65;
                  margin-bottom:24px;">${text}</div>
      ${locBadge}
    </div>

    <!-- Right: image panel -->
    <div style="padding:48px;display:flex;align-items:center;justify-content:center;
                background:#06060e;">
      ${imagePanel}
    </div>

    ${notesBar}
  </div>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a HyperFrames HTML composition from a PresentationManifest.
 *
 * @param {object} manifest     - presentation-manifest-v1 object
 * @param {object} [options]
 * @param {string} [options.projectDir] - absolute path to the HyperFrames project dir;
 *                                        used to resolve assetPath evidence references
 * @returns {string} complete HTML string (write as index.html in the project dir)
 */
export function exportHtmlComposition(manifest, { projectDir } = {}) {
  const sections      = Array.isArray(manifest?.sections) ? manifest.sections : [];
  const totalDuration = INTRO_DURATION + sections.length * SLIDE_DURATION;
  const compositionId = esc(norm(manifest?.accession || 'presentation'));

  const clips = [introClip(manifest)];
  sections.forEach((section, idx) => {
    clips.push(findingClip(section, idx, INTRO_DURATION + idx * SLIDE_DURATION, projectDir));
  });

  // GSAP timeline: fade each clip in at its start time (elements begin at opacity:0).
  const gsapLines = [
    `  tl.to("#clip-intro", { opacity: 1, duration: 0.6 }, 0);`
  ];
  sections.forEach((_, idx) => {
    const start = INTRO_DURATION + idx * SLIDE_DURATION;
    gsapLines.push(`  tl.to("#clip-slide-${idx}", { opacity: 1, duration: 0.5 }, ${start});`);
  });

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
    html, body {
      width:1920px; height:1080px; overflow:hidden;
      background:#08080f;
      font-family:'Inter', sans-serif;
    }
  </style>
</head>
<body>
  <div id="root"
    data-composition-id="${compositionId}"
    data-start="0"
    data-duration="${totalDuration}"
    data-width="1920"
    data-height="1080">
${clips.join('\n')}
  </div>

  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
${gsapLines.join('\n')}
    window.__timelines["${compositionId}"] = tl;
  </script>
</body>
</html>`;
}
