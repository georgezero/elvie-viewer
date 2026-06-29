// Local presentation preview overlay — "Preview".
//
// Renders a deck-style view from a PresentationManifest. Each section becomes one
// slide; the primary actions are Play V1 / Play V2 (the rendered MP4s). Negative
// findings are excluded by the manifest builder.
//
// The package-export path still exists internally (onExport → downloadManifest)
// but is no longer surfaced as a button in this production UI.
//
// Options accepted by openPresentationPreview:
//   onExport()      — programmatic package export (retained; no UI control)
//   onCreateVideo() — called with a style ('v1'|'v2') to render/retry an MP4
//   videoStates     — per-style playback state used to render the Play buttons
//
// DOM: fixed overlay on document.body. Keyboard: Escape closes; ← → navigate.

const OVERLAY_ID = 'lv-presentation-preview';

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function norm(v) { return String(v == null ? '' : v).trim(); }

const EVIDENCE_LABELS = {
  skipped_non_navigable: 'Text-only — no image navigation coordinates for this finding.',
  no_viewer:    'Viewer not loaded with DICOM data — no image captured.',
  no_canvas:    'Viewer canvas not available.',
  canvas_empty: 'Viewer canvas was empty.',
  capture_failed: 'Image capture failed.'
};

function evidenceHtml(section) {
  const evArr = Array.isArray(section?.imageEvidence) ? section.imageEvidence : [];
  const captured = evArr.find(e => e?.status === 'captured' && e?.dataUrl);
  if (captured) {
    return `<img data-testid="preview-evidence-img"
      src="${esc(captured.dataUrl)}" alt="Finding evidence at ${esc(norm(section.title))}"
      style="max-width:100%;max-height:260px;object-fit:contain;border-radius:4px;
             border:1px solid #2d2d4a;display:block;background:#000;">`;
  }
  const status = evArr[0]?.status ?? (section.navigable ? 'no_viewer' : 'skipped_non_navigable');
  const isTextOnly = status === 'skipped_non_navigable';
  const label = EVIDENCE_LABELS[status] ?? 'No image evidence available.';
  return `<div data-testid="preview-evidence-placeholder"
    style="background:#0b0b1c;border:1px dashed ${isTextOnly ? '#6b5000' : '#2a2a40'};
           border-radius:4px;padding:30px 16px;text-align:center;
           color:${isTextOnly ? '#a07820' : '#44445a'};font-size:13px;line-height:1.6;">
    ${isTextOnly ? '📝 ' : ''}${esc(label)}
  </div>`;
}

function navBtn(testid, label, disabled) {
  return `<button data-testid="${testid}"
    style="background:#1a1a30;border:1px solid #3a3a54;
           color:${disabled ? '#444' : '#bbc'};border-radius:4px;
           padding:6px 14px;cursor:${disabled ? 'not-allowed' : 'pointer'};font-size:13px;"
    ${disabled ? 'disabled' : ''}>${esc(label)}</button>`;
}

// Style-aware MP4 playback row — shows one chip per known style (V1, V2).
// videoStates: { v1: { status, videoUrl, canRender }, v2: { status, videoUrl, canRender } }
// A missing style entry renders as a "not rendered" note for that style.
function mp4ButtonsHtml(videoStates = {}) {
  function styleChip(style, state = {}) {
    const { status = 'none', videoUrl = null, canRender = false } = state;
    const tag = style.toUpperCase();
    const baseStyle =
      'display:inline-flex;align-items:center;gap:6px;border-radius:5px;' +
      'padding:7px 13px;font-size:13px;font-weight:600;';

    if (status === 'complete' && videoUrl) {
      return `<a data-testid="preview-mp4-${style}-link" href="${esc(videoUrl)}"
        target="_blank" rel="noopener"
        style="${baseStyle}background:#0b2a16;border:1px solid #1f6b3a;color:#4ade80;
               text-decoration:none;">&#9654; Play ${tag}</a>`;
    }
    if (status === 'rendering') {
      return `<button disabled data-testid="preview-mp4-${style}-rendering"
        style="${baseStyle}background:#16203a;border:1px solid #243a66;color:#7f93bd;
               cursor:not-allowed;">&#8987; ${tag} rendering…</button>`;
    }
    if (status === 'failed') {
      return `<button data-testid="preview-retry-${style}-btn"
        style="${baseStyle}background:#2a1414;border:1px solid #5a2a2a;color:#f0a0a0;
               cursor:pointer;">&#8635; Retry ${tag}</button>`;
    }
    if (canRender) {
      return `<button data-testid="preview-create-${style}-btn"
        style="${baseStyle}background:#0d1e33;border:1px solid #2d4fa8;color:#93c5fd;
               cursor:pointer;">&#9654; Create ${tag} (MP4)</button>`;
    }
    return `<span data-testid="preview-mp4-${style}-missing"
      style="font-size:11px;color:#4a5070;line-height:1.5;padding:2px 0;">
      ${tag}: not rendered &mdash;
      <code style="color:#6a7a9a;">--style ${style}</code></span>`;
  }

  const chips = [styleChip('v1', videoStates.v1), styleChip('v2', videoStates.v2)].join('\n');
  return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
    ${chips}
  </div>`;
}

function slideHtml(manifest, section, idx, total, { videoStates }) {
  const loc = section.navigable
    ? `<div data-testid="preview-location"
        style="font-size:12px;color:#7ab8f5;margin-bottom:10px;">
        Series&nbsp;${esc(String(section.seriesNumber ?? ''))},&nbsp;Image&nbsp;${esc(String(section.imageNumber ?? ''))}
       </div>`
    : `<div data-testid="preview-non-navigable-badge"
        style="font-size:12px;color:#f59e0b;margin-bottom:10px;">
        &#9888; Text-only &mdash; no image location available
       </div>`;

  // Review block: what the finding looks like in the video. Shows the clinical
  // sentence and, when present, the patient-friendly explanation (this is the copy
  // that appears in the V2 presentation). The "For patients" section is omitted
  // entirely — header and all — when no explanation exists.
  const clinicalText = norm(section.text);
  const patientText = norm(section.patientFriendlyExplanation);
  const subLabel = 'font-size:10px;text-transform:uppercase;letter-spacing:.06em;';
  const patientBlock = patientText
    ? `<div style="margin-top:9px;">
        <div style="${subLabel}color:#5a7da8;margin-bottom:3px;">For patients</div>
        <div data-testid="preview-patient-explanation"
          style="font-size:12px;color:#9fb4d0;line-height:1.6;">${esc(patientText)}</div>
       </div>`
    : '';
  const review = (clinicalText || patientText)
    ? `<div data-testid="preview-finding-review"
        style="border-top:1px solid #1e1e32;padding-top:10px;margin-bottom:14px;">
        <div style="${subLabel}color:#444;margin-bottom:6px;">Finding ${idx + 1} of ${total}</div>
        ${clinicalText ? `<div>
          <div style="${subLabel}color:#556;margin-bottom:3px;">Clinical</div>
          <div data-testid="preview-clinical-text"
            style="font-size:12px;color:#aab;line-height:1.6;">${esc(clinicalText)}</div>
         </div>` : ''}
        ${patientBlock}
       </div>`
    : '';

  return `
<div data-testid="preview-slide" data-slide-index="${idx}"
  style="background:#111126;color:#dde;border-radius:10px;
         width:min(800px,93vw);max-height:90vh;overflow-y:auto;
         padding:24px 28px 20px;box-shadow:0 12px 48px rgba(0,0,0,0.7);">

  <!-- deck identity bar -->
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.1em;
              color:#333;margin-bottom:10px;">Preview</div>

  <div style="display:flex;justify-content:space-between;align-items:flex-start;
              margin-bottom:16px;gap:12px;">
    <div style="min-width:0;">
      <div data-testid="preview-study-label"
        style="font-size:10px;color:#444;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px;">
        ${esc(norm(manifest.studyLabel))}</div>
      <div data-testid="preview-title"
        style="font-size:13px;color:#7aade8;font-weight:600;
               white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${esc(norm(manifest.presentationTitle))}</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
      <span data-testid="preview-slide-counter"
        style="font-size:12px;color:#444;">${idx + 1} / ${total}</span>
      <button data-testid="preview-close-btn" title="Close preview"
        style="background:#1a1a30;border:1px solid #3a3a54;color:#888;border-radius:4px;
               width:26px;height:26px;cursor:pointer;font-size:14px;line-height:1;padding:0;">&#x2715;</button>
    </div>
  </div>

  <div data-testid="preview-finding-title"
    style="font-size:22px;font-weight:700;color:#fff;margin-bottom:7px;line-height:1.3;">
    ${esc(norm(section.title))}</div>
  <div data-testid="preview-finding-text"
    style="font-size:14px;color:#aab;line-height:1.6;margin-bottom:10px;">
    ${esc(norm(section.text))}</div>

  ${loc}

  <div data-testid="preview-evidence-area" style="margin-bottom:16px;">
    ${evidenceHtml(section)}
  </div>

  ${review}

  <div style="display:flex;justify-content:space-between;align-items:center;
              gap:14px;flex-wrap:wrap;border-top:1px solid #1a1a30;padding-top:16px;">
    <div style="display:flex;gap:8px;flex-shrink:0;">
      ${navBtn('preview-prev-btn', '← Prev', idx === 0)}
      ${navBtn('preview-next-btn', 'Next →', idx === total - 1)}
    </div>
    ${mp4ButtonsHtml(videoStates)}
  </div>
</div>`;
}

function emptyHtml(manifest) {
  return `
<div data-testid="preview-slide" data-slide-index="0"
  style="background:#111126;color:#dde;border-radius:10px;
         width:min(580px,93vw);padding:40px 36px;
         box-shadow:0 12px 48px rgba(0,0,0,0.7);text-align:center;">
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.1em;
              color:#333;margin-bottom:16px;">Preview</div>
  <div data-testid="preview-title"
    style="font-size:14px;color:#7aade8;margin-bottom:18px;">
    ${esc(norm(manifest?.presentationTitle))}</div>
  <div style="font-size:36px;margin-bottom:12px;">&#x1F4CB;</div>
  <div style="font-size:16px;color:#555;margin-bottom:26px;">
    No positive findings available for this presentation.</div>
  <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
    <button data-testid="preview-close-btn"
      style="background:#1a1a30;border:1px solid #3a3a54;color:#888;
             border-radius:4px;padding:7px 18px;cursor:pointer;font-size:13px;">
      Close</button>
  </div>
</div>`;
}

/**
 * Open the local presentation preview overlay ("Preview").
 *
 * This is an Elvie-local view. Primary actions are Play V1 / Play V2.
 *
 * @param {object} manifest - PresentationManifest from buildPresentationManifest
 * @param {object} [options]
 * @param {function} [options.onExport]      - programmatic package export (retained; no UI control)
 * @param {function} [options.onCreateVideo] - called with style string ('v1'|'v2') when render/retry requested
 * @param {string}   [options.manifestUrl]   - published manifest URL (accepted; not displayed)
 * @param {object}   [options.videoStates]   - { v1: { status, videoUrl, canRender }, v2: {...} }
 */
export function openPresentationPreview(manifest, { onExport, onCreateVideo, manifestUrl, videoStates } = {}) {
  closePresentationPreview();

  const sections = Array.isArray(manifest?.sections) ? manifest.sections : [];
  let current = 0;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('data-testid', 'presentation-preview');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.83);' +
    'display:flex;align-items:center;justify-content:center;';

  const ctx = { videoStates: videoStates || {} };

  function mount() {
    overlay.innerHTML = sections.length
      ? slideHtml(manifest, sections[current], current, sections.length, ctx)
      : emptyHtml(manifest);

    overlay.querySelector('[data-testid="preview-close-btn"]')
      ?.addEventListener('click', closePresentationPreview);

    if (onExport) {
      overlay.querySelector('[data-testid="preview-export-btn"]')
        ?.addEventListener('click', onExport);
    }
    if (onCreateVideo) {
      for (const style of ['v1', 'v2']) {
        overlay.querySelector(`[data-testid="preview-create-${style}-btn"]`)
          ?.addEventListener('click', () => onCreateVideo(style));
        overlay.querySelector(`[data-testid="preview-retry-${style}-btn"]`)
          ?.addEventListener('click', () => onCreateVideo(style));
      }
    }
    if (sections.length) {
      overlay.querySelector('[data-testid="preview-prev-btn"]')
        ?.addEventListener('click', () => { if (current > 0) { current--; mount(); } });
      overlay.querySelector('[data-testid="preview-next-btn"]')
        ?.addEventListener('click', () => { if (current < sections.length - 1) { current++; mount(); } });
    }
  }

  mount();
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closePresentationPreview(); });

  function onKey(e) {
    if (e.key === 'Escape') { closePresentationPreview(); }
    else if (e.key === 'ArrowRight' && current < sections.length - 1) { current++; mount(); }
    else if (e.key === 'ArrowLeft' && current > 0) { current--; mount(); }
  }
  document.addEventListener('keydown', onKey);
  overlay._cleanup = () => document.removeEventListener('keydown', onKey);
}

/** Close and remove the preview overlay if open. */
export function closePresentationPreview() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) { el._cleanup?.(); el.remove(); }
}
