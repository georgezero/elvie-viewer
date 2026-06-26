// Local presentation preview overlay — "Preview Deck".
//
// Renders a deck-style view from a PresentationManifest. This is an Elvie-local
// preview — it is NOT the Hyperframes experience. The "Open in Hyperframes"
// button inside this overlay triggers the actual external Hyperframes launch
// using the published manifest URL.
//
// Each section in manifest.sections becomes one slide. Negative findings are
// excluded by the manifest builder.
//
// Options accepted by openPresentationPreview:
//   onLaunch(manifestUrl)  — called when user clicks "Open in Hyperframes"
//   onExport()             — called when user clicks "Export JSON"
//   manifestUrl            — used to compute and display the transport status note
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

// Integration status note — always shown.
// HyperFrames (hyperframes.heygen.com) is an HTML-to-video CLI framework;
// it ignores the manifest= parameter and has no slide rendering endpoint.
const INTEGRATION_STATUS_NOTE =
  '⚠️ External handoff unverified — HyperFrames (hyperframes.heygen.com) ' +
  'is an HTML-to-video CLI tool and does not accept a manifest= JSON URL. ' +
  'Use “Export JSON” to inspect or forward the prepared manifest.';

function integrationStatusHtml() {
  return `<div data-testid="preview-integration-status"
    style="font-size:11px;color:#92400e;background:#1c0f00;border:1px solid #78350f;
           border-radius:4px;padding:7px 10px;margin-top:10px;line-height:1.55;">
    ${esc(INTEGRATION_STATUS_NOTE)}
  </div>`;
}

function transportNoteHtml(manifestUrl) {
  if (!manifestUrl) return '';
  let msg;
  if (/^blob:/.test(manifestUrl)) {
    msg = 'Manifest: session-scoped blob URL — not fetchable cross-origin.';
  } else if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(manifestUrl)) {
    msg = 'Manifest: hosted at localhost via service worker (not reachable from the public internet).';
  } else if (/^https:/.test(manifestUrl)) {
    msg = 'Manifest: published at a publicly fetchable HTTPS URL.';
  } else {
    return '';
  }
  return `<div data-testid="preview-transport-note"
    style="font-size:11px;color:#4a4a62;margin-top:6px;line-height:1.5;">
    ${esc(msg)}</div>`;
}

function slideHtml(manifest, section, idx, total, { manifestUrl, hasExport, hasLaunch }) {
  const loc = section.navigable
    ? `<div data-testid="preview-location"
        style="font-size:12px;color:#7ab8f5;margin-bottom:10px;">
        Series&nbsp;${esc(String(section.seriesNumber ?? ''))},&nbsp;Image&nbsp;${esc(String(section.imageNumber ?? ''))}
       </div>`
    : `<div data-testid="preview-non-navigable-badge"
        style="font-size:12px;color:#f59e0b;margin-bottom:10px;">
        &#9888; Text-only &mdash; no image location available
       </div>`;

  const notes = norm(section.speakerNotes)
    ? `<div data-testid="preview-speaker-notes"
        style="font-size:12px;color:#555;border-top:1px solid #1e1e32;
               padding-top:10px;margin-bottom:14px;line-height:1.6;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;
                    color:#444;margin-bottom:3px;">Speaker notes</div>
        ${esc(norm(section.speakerNotes))}
       </div>`
    : '';

  const launchBtn = hasLaunch
    ? `<button data-testid="preview-launch-btn"
        style="background:#1e3a8a;border:1px solid #2d4fa8;color:#93c5fd;
               border-radius:4px;padding:6px 16px;cursor:pointer;font-size:13px;">
        Open external Hyperframes &#8599;
       </button>`
    : '';
  const exportBtn = hasExport
    ? `<button data-testid="preview-export-btn"
        style="background:#1a1a30;border:1px solid #3a3a54;color:#888;
               border-radius:4px;padding:6px 14px;cursor:pointer;font-size:13px;">
        Export JSON &#8595;
       </button>`
    : '';

  return `
<div data-testid="preview-slide" data-slide-index="${idx}"
  style="background:#111126;color:#dde;border-radius:10px;
         width:min(800px,93vw);max-height:90vh;overflow-y:auto;
         padding:24px 28px 20px;box-shadow:0 12px 48px rgba(0,0,0,0.7);">

  <!-- deck identity bar -->
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.1em;
              color:#333;margin-bottom:10px;">Preview Deck</div>

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

  ${notes}

  <div style="display:flex;justify-content:space-between;align-items:center;
              gap:8px;flex-wrap:wrap;border-top:1px solid #1a1a30;padding-top:14px;">
    <div style="display:flex;gap:8px;">
      ${navBtn('preview-prev-btn', '← Prev', idx === 0)}
      ${navBtn('preview-next-btn', 'Next →', idx === total - 1)}
      ${exportBtn}
    </div>
    ${launchBtn}
  </div>
  ${integrationStatusHtml()}
  ${transportNoteHtml(manifestUrl)}
</div>`;
}

function emptyHtml(manifest, { manifestUrl, hasExport, hasLaunch }) {
  const launchBtn = hasLaunch
    ? `<button data-testid="preview-launch-btn"
        style="background:#1e3a8a;border:1px solid #2d4fa8;color:#93c5fd;
               border-radius:4px;padding:7px 18px;cursor:pointer;font-size:13px;">
        Open in Hyperframes &#8599;</button>`
    : '';
  const exportBtn = hasExport
    ? `<button data-testid="preview-export-btn"
        style="background:#1a1a30;border:1px solid #3a3a54;color:#888;
               border-radius:4px;padding:7px 18px;cursor:pointer;font-size:13px;">
        Export JSON &#8595;</button>`
    : '';
  return `
<div data-testid="preview-slide" data-slide-index="0"
  style="background:#111126;color:#dde;border-radius:10px;
         width:min(580px,93vw);padding:40px 36px;
         box-shadow:0 12px 48px rgba(0,0,0,0.7);text-align:center;">
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.1em;
              color:#333;margin-bottom:16px;">Preview Deck</div>
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
    ${exportBtn}
    ${launchBtn}
  </div>
  ${integrationStatusHtml()}
  ${transportNoteHtml(manifestUrl)}
</div>`;
}

/**
 * Open the local presentation preview overlay ("Preview Deck").
 *
 * This is an Elvie-local view — NOT the Hyperframes experience.
 * "Open in Hyperframes" inside the overlay triggers the actual external launch.
 *
 * @param {object} manifest - PresentationManifest from buildPresentationManifest
 * @param {object} [options]
 * @param {function} [options.onLaunch]    - called when "Open in Hyperframes" is clicked
 * @param {function} [options.onExport]    - called when "Export JSON" is clicked
 * @param {string}   [options.manifestUrl] - published manifest URL for transport status note
 */
export function openPresentationPreview(manifest, { onLaunch, onExport, manifestUrl } = {}) {
  closePresentationPreview();

  const sections = Array.isArray(manifest?.sections) ? manifest.sections : [];
  let current = 0;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('data-testid', 'presentation-preview');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.83);' +
    'display:flex;align-items:center;justify-content:center;';

  const ctx = { manifestUrl, hasExport: !!onExport, hasLaunch: !!onLaunch };

  function mount() {
    overlay.innerHTML = sections.length
      ? slideHtml(manifest, sections[current], current, sections.length, ctx)
      : emptyHtml(manifest, ctx);

    overlay.querySelector('[data-testid="preview-close-btn"]')
      ?.addEventListener('click', closePresentationPreview);

    if (onLaunch) {
      overlay.querySelector('[data-testid="preview-launch-btn"]')
        ?.addEventListener('click', onLaunch);
    }
    if (onExport) {
      overlay.querySelector('[data-testid="preview-export-btn"]')
        ?.addEventListener('click', onExport);
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
