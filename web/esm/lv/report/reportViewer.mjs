// Report viewer UI — renders report text with span highlights and findings panel.
// Works without DICOM/Orthanc/LLM.

import { segmentText, getSpanForFinding } from './reportSpans.mjs';
import { REVIEW_STATUS } from './reportReview.mjs';
import { normalizeFindingImageReference } from './imageLinkProvider.mjs';

function esc(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Returns true when a finding has enough location data for direct image navigation.
 *
 * @param {object} finding
 * @returns {boolean}
 */
export function isImageNavigable(finding) {
  const status = String(finding?.navigationStatus || '').toLowerCase();
  if (status === 'negative' || status === 'non_navigable') return false;
  const ref = normalizeFindingImageReference(finding);
  if (ref.seriesNumber == null) return false;
  if (ref.imageNumber == null) return false;
  return true;
}

function navStatusPill(finding) {
  const nav = String(finding.navigationStatus || '').toLowerCase();
  if (nav === 'navigable') {
    return `<span class="nav-status-dot nav-status-navigable">⊕ Nav</span>`;
  }
  if (nav === 'series_only') {
    return `<span class="nav-status-dot nav-status-inferred">⊕ Inferred</span>`;
  }
  if (nav === 'non_navigable') {
    return `<span class="nav-status-dot nav-status-report-only">Report Only</span>`;
  }
  return '';
}

function openInViewerButton(finding) {
  if (!isImageNavigable(finding)) return '';
  const id = esc(finding.id || '');
  return `<button class="nav-open-btn" data-finding-id="${id}" title="Open series ${finding.seriesNumber} image ${finding.imageNumber} in viewer">Open in Viewer</button>`;
}

function navBadge(finding) {
  const nav = String(finding.navigationStatus || '').toLowerCase();
  if (nav === 'navigable') {
    return `<span class="nav-badge navigable">Ser ${finding.seriesNumber} / Im ${finding.imageNumber}</span>`;
  }
  if (nav === 'series_only') {
    return `<span class="nav-badge series-only">Ser ${finding.seriesNumber}</span>`;
  }
  if (nav === 'negative') {
    return `<span class="nav-badge negative">Negative</span>`;
  }
  return `<span class="nav-badge non-nav">No location</span>`;
}

function confidencePill(finding) {
  const conf = finding.confidence;
  if (conf == null) return '';
  const pct = Math.round(Number(conf) * 100);
  const cls = pct >= 80 ? 'conf-high' : pct >= 60 ? 'conf-mid' : 'conf-low';
  return `<span class="conf-pill ${cls}">${pct}%</span>`;
}

function reviewButtons(findingId, currentStatus) {
  return ['agree', 'disagree', 'maybe'].map((s) => {
    const active = currentStatus === s ? ' active' : '';
    return `<button class="review-btn${active}" data-finding-id="${esc(findingId)}" data-status="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</button>`;
  }).join('');
}

export function renderReportText(container, originalText, spans) {
  const segments = segmentText(originalText, spans);
  const parts = segments.map((seg) => {
    if (seg.type === 'text') {
      return `<span class="rpt-text">${esc(seg.text)}</span>`;
    }
    const gs = seg.span.groundingStatus || 'exact';
    const polarity = seg.span.polarity || 'positive';
    const approxClass = gs === 'approximate' ? ' approx' : '';
    const polarityClass = polarity === 'negative' ? ' negative' : '';
    return `<mark class="rpt-span${approxClass}${polarityClass}" data-finding-id="${esc(seg.span.findingId)}" data-span-id="${esc(seg.span.id)}" data-grounding-status="${esc(gs)}" data-finding-polarity="${esc(polarity)}" tabindex="0" role="button" aria-label="Finding: ${esc(seg.span.findingId)}">${esc(seg.text)}</mark>`;
  });
  container.innerHTML = parts.join('');
}

function anatomyDiseaseMeta(finding) {
  const anatomy = String(finding.anatomy || '').trim() || null;
  const disease = String(finding.disease || '').trim() || null;
  if (!anatomy && !disease) return '';
  const parts = [];
  if (anatomy) parts.push(`<span class="fc-anatomy">${esc(anatomy)}</span>`);
  if (disease) parts.push(`<span class="fc-sep">·</span><span class="fc-disease">${esc(disease)}</span>`);
  return `<div class="finding-anatomy-row">${parts.join('')}</div>`;
}

function localizationDetails(finding) {
  const target = String(finding.localization_target || finding.anatomy || '').trim() || null;
  const modality = String(finding.modality_hint || finding.modality || '').trim() || null;
  const view = String(finding.view_hint || '').trim() || null;
  if (!target && !modality && !view) return '';
  const items = [];
  if (target) items.push(`<span class="fc-loc-item"><span class="fc-loc-lbl">target</span>${esc(target)}</span>`);
  if (modality) items.push(`<span class="fc-loc-item"><span class="fc-loc-lbl">modality</span>${esc(modality)}</span>`);
  if (view) items.push(`<span class="fc-loc-item"><span class="fc-loc-lbl">view</span>${esc(view)}</span>`);
  return `<details class="fc-loc-details"><summary class="fc-loc-summary">AI Localize</summary><div class="fc-loc-body">${items.join('')}</div></details>`;
}

function qualityWarningBadge(finding) {
  if (finding.qualityWarning === 'label_raw_text_mismatch') {
    return `<span class="quality-warn-badge" title="Label may not match extracted text — check rawText">label≠span</span>`;
  }
  return '';
}

function groundingBadge(finding) {
  const gs = finding.groundingStatus || (finding.grounded ? 'exact' : 'ungrounded');
  if (gs === 'approximate') {
    return `<span class="approx-badge" title="Finding approximately matched to report text (semantic overlap)">approx span</span>`;
  }
  if (!finding.grounded) {
    return `<span class="ungrounded-badge" title="Finding text not found in report — no highlight available">no span</span>`;
  }
  return '';
}

function renderChildFindings(children) {
  if (!Array.isArray(children) || !children.length) return '';
  const rows = children.map((c) => {
    const gs = c.groundingStatus || (c.grounded ? 'exact' : 'ungrounded');
    const gsClass = gs === 'ungrounded' ? ' child-ungrounded' : '';
    return `<div class="finding-child${gsClass}" data-child-id="${esc(c.id || '')}">
      <span class="child-label">${esc(c.label || '')}</span>
      ${c.rawText ? `<span class="child-raw">${esc(String(c.rawText).slice(0, 60))}</span>` : ''}
    </div>`;
  }).join('');
  return `<div class="finding-children">${rows}</div>`;
}

export function renderFindingCard(finding, reviewState, opts = {}) {
  const id = String(finding.id || '');
  const status = reviewState.getReview(id);
  const note = reviewState.getNote(id);
  const source = String(finding.source || '').toLowerCase();
  const gs = finding.groundingStatus || (finding.grounded ? 'exact' : 'ungrounded');
  const isNeg = opts.forceNegative || String(finding.navigationStatus || finding.navigation_status || '').toLowerCase() === 'negative';
  const cardClass = (gs === 'ungrounded' ? ' ungrounded' : gs === 'approximate' ? ' approx-grounded' : '')
    + (isNeg ? ' negative-finding' : '');
  return `
    <div class="finding-card${cardClass}" data-finding-id="${esc(id)}" data-finding-polarity="${isNeg ? 'negative' : 'positive'}" tabindex="0">
      <div class="finding-header">
        <span class="finding-label">${esc(finding.label)}</span>
        <div class="finding-header-right">
          ${source && source !== 'seeded' ? `<span class="finding-source src-${esc(source)}">${esc(source)}</span>` : ''}
          ${openInViewerButton(finding)}
        </div>
      </div>
      <div class="rp-card-body">
        ${anatomyDiseaseMeta(finding)}
        <div class="finding-meta">
          ${navBadge(finding)}
          ${navStatusPill(finding)}
          ${confidencePill(finding)}
          ${groundingBadge(finding)}
          ${qualityWarningBadge(finding)}
        </div>
        ${renderChildFindings(finding.children)}
        ${localizationDetails(finding)}
        <div class="rp-card-explanation" style="display:none;"></div>
        <div class="finding-review-row">
          ${reviewButtons(id, status)}
        </div>
        <div class="finding-note-row">
          <input type="text" class="note-input" data-finding-id="${esc(id)}"
            placeholder="Add note…"
            value="${esc(note)}"
            aria-label="Note for finding ${esc(finding.label)}">
        </div>
      </div>
    </div>`;
}

export function renderFindingsList(container, findings, negativeFindings, reviewState) {
  const allFindings = [...(findings || []), ...(negativeFindings || [])];
  if (!allFindings.length) {
    container.innerHTML = '<div class="no-findings">No findings loaded.</div>';
    return;
  }
  const pos = (findings || []);
  const neg = (negativeFindings || []);
  let html = '';
  if (pos.length) {
    html += `<div class="findings-group-label" data-group="positive">Findings (${pos.length})</div>`;
    html += pos.map((f) => renderFindingCard(f, reviewState)).join('');
  }
  if (neg.length) {
    html += `<details class="neg-section-collapse" data-group="negative">
      <summary class="findings-group-label negative-group">Negative / Normal (${neg.length})</summary>
      ${neg.map((f) => renderFindingCard(f, reviewState, { forceNegative: true })).join('')}
    </details>`;
  }
  container.innerHTML = html;
}

export function selectFinding(findingId, spans, reportTextContainer, findingsListContainer) {
  const id = String(findingId || '');

  // Deselect all
  findingsListContainer.querySelectorAll('.finding-card.selected').forEach((el) => {
    el.classList.remove('selected', 'negative-selected');
  });
  reportTextContainer.querySelectorAll('.rpt-span.selected').forEach((el) => el.classList.remove('selected'));

  if (!id) return;

  // Select finding card — if id is a child id (contains __child__), fall back to parent card.
  let card = findingsListContainer.querySelector(`.finding-card[data-finding-id="${CSS.escape(id)}"]`);
  if (!card && id.includes('__child__')) {
    const parentId = id.split('__child__')[0];
    card = findingsListContainer.querySelector(`.finding-card[data-finding-id="${CSS.escape(parentId)}"]`);
  }
  if (card) {
    card.classList.add('selected');
    if (card.dataset.findingPolarity === 'negative') card.classList.add('negative-selected');
    const cardTop = card.getBoundingClientRect().top;
    const containerTop = findingsListContainer.getBoundingClientRect().top;
    findingsListContainer.scrollTop = findingsListContainer.scrollTop + (cardTop - containerTop);
  }

  // Select span in report text
  const span = getSpanForFinding(spans, id);
  if (span) {
    const mark = reportTextContainer.querySelector(`.rpt-span[data-finding-id="${CSS.escape(id)}"]`);
    if (mark) {
      mark.classList.add('selected');
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

export function renderAccessionMeta(container, doc, title, modality, parseInfo = {}) {
  const avail = String(doc.imageAvailability || 'unknown');
  const availClass = {
    unknown: 'avail-unknown',
    not_available: 'avail-none',
    querying: 'avail-querying',
    retrieving: 'avail-retrieving',
    available: 'avail-ok',
    loaded: 'avail-ok',
    failed: 'avail-fail'
  }[avail] || 'avail-unknown';

  const parseSource = parseInfo.parseSource;
  const parseStatusBadge = parseSource
    ? (() => {
        const cls = (parseSource === 'unavailable' || parseSource === 'error') ? 'parse-unavail'
          : parseSource === 'mock-fallback' ? 'parse-fallback'
          : parseSource === 'mock' ? 'parse-mock'
          : 'parse-ok';
        const label = parseSource === 'unavailable' ? 'local unavailable'
          : parseSource === 'error' ? 'local parse error'
          : parseSource === 'mock-fallback' ? 'mock fallback'
          : parseSource === 'mock' ? 'mock parsed'
          : `parsed via ${parseSource}`;
        return `<span class="parse-badge ${cls}" title="${esc(parseInfo.parseWarning || '')}">${esc(label)}</span>`;
      })()
    : '';

  container.innerHTML = `
    <div class="report-meta-inner">
      <span class="report-accession">${esc(doc.accession || '—')}</span>
      ${modality ? `<span class="report-modality">${esc(modality)}</span>` : ''}
      ${title ? `<span class="report-title">${esc(title)}</span>` : ''}
      <span class="report-source-badge src-${esc(doc.sourceType)}">${esc(doc.sourceType)}</span>
      ${parseStatusBadge}
      <span class="image-avail ${availClass}" title="Image availability">${avail.replace(/_/g, ' ')}</span>
    </div>`;
}
