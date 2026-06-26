// HTML presentation exporter.
//
// Converts a PresentationManifest (presentation-manifest-v1) into a
// self-contained HyperFrames HTML composition file.
//
// HyperFrames (hyperframes.heygen.com) is an HTML-to-MP4 CLI renderer.
// The generated HTML can be rendered to video with:
//   npx hyperframes render <project-dir>
//
// Composition design:
//   - 1920×1080, dark medical theme
//   - 2-second title/intro clip
//   - One clip per section (positive finding), each 6 seconds
//   - Image evidence embedded as base64 data URLs when available
//   - Text-only placeholder when no evidence captured
//   - GSAP fade-in on each clip
//   - Speaker notes shown as subtitle text at bottom

const SLIDE_DURATION = 6;   // seconds per finding slide
const INTRO_DURATION = 2;   // seconds for the study title card

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function norm(v) { return String(v == null ? '' : v).trim(); }

function sectionEvidence(section) {
  const evArr = Array.isArray(section?.imageEvidence) ? section.imageEvidence : [];
  const captured = evArr.find(e => e?.status === 'captured' && e?.dataUrl);
  return captured?.dataUrl || null;
}

function introClip(manifest) {
  const label = esc(norm(manifest.studyLabel || manifest.accession));
  const title = esc(norm(manifest.presentationTitle));
  return `
  <!-- Intro: 0 – ${INTRO_DURATION}s -->
  <div id="clip-intro" class="clip"
    data-start="0" data-duration="${INTRO_DURATION}" data-track-index="0"
    style="opacity:0;position:absolute;inset:0;display:flex;flex-direction:column;
           align-items:center;justify-content:center;
           background:linear-gradient(135deg,#080816 0%,#0f0f2a 100%);">
    <div style="font-size:16px;color:#3a3a5c;text-transform:uppercase;
                letter-spacing:.15em;margin-bottom:20px;">Elvie Medical Viewer</div>
    <div style="font-size:22px;color:#4a6a9a;letter-spacing:.06em;margin-bottom:12px;">
      ${label}</div>
    <div style="font-size:52px;font-weight:700;color:#e8eeff;
                max-width:1400px;text-align:center;line-height:1.2;">
      ${title}</div>
  </div>`;
}

function findingClip(section, idx, startTime) {
  const slideId = `clip-slide-${idx}`;
  const title = esc(norm(section.title));
  const text  = esc(norm(section.text));
  const notes = esc(norm(section.speakerNotes));
  const dataUrl = sectionEvidence(section);

  let locHtml = '';
  if (section.navigable) {
    locHtml = `<div style="font-size:18px;color:#5b9bd5;margin-bottom:20px;font-family:monospace;">
      Series ${esc(String(section.seriesNumber ?? ''))} · Image ${esc(String(section.imageNumber ?? ''))}</div>`;
  } else {
    locHtml = `<div style="font-size:16px;color:#a07820;margin-bottom:20px;">
      ⚠ Text-only — no image location available</div>`;
  }

  let evidenceHtml = '';
  if (dataUrl) {
    evidenceHtml = `<img src="${dataUrl}" alt="${title} evidence"
      style="max-width:700px;max-height:360px;object-fit:contain;
             border-radius:6px;border:1px solid #2d2d4a;display:block;
             margin-top:16px;background:#000;">`;
  } else {
    evidenceHtml = `<div style="width:560px;height:280px;border:1px dashed #2a2a40;
      border-radius:6px;display:flex;align-items:center;justify-content:center;
      margin-top:16px;color:#44445a;font-size:15px;background:#0b0b1c;">
      No image captured</div>`;
  }

  const notesHtml = notes
    ? `<div style="position:absolute;bottom:40px;left:80px;right:80px;
         font-size:16px;color:#44445a;line-height:1.6;border-top:1px solid #1a1a30;
         padding-top:12px;">${notes}</div>`
    : '';

  return `
  <!-- Slide ${idx + 1} / ${section.title}: ${startTime}s – ${startTime + SLIDE_DURATION}s -->
  <div id="${slideId}" class="clip"
    data-start="${startTime}" data-duration="${SLIDE_DURATION}" data-track-index="${idx + 1}"
    style="opacity:0;position:absolute;inset:0;
           background:linear-gradient(160deg,#0a0a18 0%,#0e0e25 100%);
           padding:60px 80px 100px;">

    <div style="font-size:14px;color:#2a2a44;text-transform:uppercase;
                letter-spacing:.1em;margin-bottom:6px;">Slide ${idx + 1}</div>
    <div style="font-size:36px;font-weight:700;color:#fff;margin-bottom:10px;line-height:1.2;">
      ${title}</div>
    <div style="font-size:20px;color:#8899bb;margin-bottom:16px;line-height:1.5;">
      ${text}</div>

    ${locHtml}
    ${evidenceHtml}
    ${notesHtml}
  </div>`;
}

/**
 * Generate a HyperFrames HTML composition from a PresentationManifest.
 *
 * @param {object} manifest - presentation-manifest-v1 object
 * @returns {string} complete HTML string ready to write as index.html
 */
export function exportHtmlComposition(manifest) {
  const sections = Array.isArray(manifest?.sections) ? manifest.sections : [];
  const totalDuration = INTRO_DURATION + sections.length * SLIDE_DURATION;

  const clips = [introClip(manifest)];
  sections.forEach((section, idx) => {
    clips.push(findingClip(section, idx, INTRO_DURATION + idx * SLIDE_DURATION));
  });

  // GSAP: fade in each clip at its start
  const gsapLines = sections.map((_, idx) => {
    const start = INTRO_DURATION + idx * SLIDE_DURATION;
    return `  tl.to("#clip-slide-${idx}", { opacity: 1, duration: 0.6 }, ${start});`;
  });
  gsapLines.unshift(`  tl.to("#clip-intro", { opacity: 1, duration: 0.5 }, 0);`);

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
      background:#080816;
      font-family:'Inter', sans-serif;
    }
  </style>
</head>
<body>
  <div id="root"
    data-composition-id="${esc(norm(manifest?.accession || 'presentation'))}"
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
    window.__timelines["${esc(norm(manifest?.accession || 'presentation'))}"] = tl;
  </script>
</body>
</html>`;
}
