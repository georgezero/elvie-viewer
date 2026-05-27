// Report ingestion pipeline.
// Supports: demo reports, paste/manual text, api-style, and parsed (async LLM) ingestion.
// Does not require Orthanc or DICOM access.

import { getDemoReport } from './reportDemoData.mjs';
import { createReportDocument } from './reportDocument.mjs';
import { computeSpans } from './reportSpans.mjs';
import { defaultFindingRegistryAdapter } from './findingRegistryAdapter.mjs';
import { parseReportToFindings } from '../findings/llmReportParser.mjs';

function norm(value) {
  return String(value || '').trim();
}

function gatherFindings(accession, registry = defaultFindingRegistryAdapter) {
  const positive = registry.listFindings(accession);
  const negative = registry.listNegativeFindings(accession);
  return [...positive, ...negative];
}

// Try to extract an accession number from common radiology report header patterns.
function extractAccessionFromText(text) {
  const match = text.match(/ACCESSION[:\s#]*([A-Za-z0-9][\w\-]{2,29})/i);
  return match ? match[1].trim() : null;
}

// Mark each finding with grounded status, groundingStatus, and groundingAttempts from the computed span.
// groundingDetails: Map<findingId, groundFinding result> for diagnostics (includes ungrounded attempts).
function markGrounded(findings, spans, groundingDetails) {
  const spanMap = new Map(spans.map((s) => [s.findingId, s]));
  return findings.map((f) => {
    const fid = String(f.id || '');
    const span = spanMap.get(fid);
    const detail = groundingDetails?.get(fid);
    const result = {
      ...f,
      grounded: !!span,
      groundingStatus: span?.groundingStatus || 'ungrounded',
      groundingScore: span?.groundingScore ?? 0,
      groundingAttempts: span?.groundingAttempts ?? detail?.attempts ?? []
    };
    // Propagate grounding status to atomic children.
    if (Array.isArray(f.children)) {
      result.children = f.children.map((c) => {
        const cid = String(c.id || '');
        const cspan = spanMap.get(cid);
        return {
          ...c,
          grounded: !!cspan,
          groundingStatus: cspan?.groundingStatus || 'ungrounded',
          groundingScore: cspan?.groundingScore ?? 0
        };
      });
    }
    return result;
  });
}

export function ingestDemoReport(accession, { findingRegistry } = {}) {
  const demo = getDemoReport(norm(accession));
  if (!demo) return { ok: false, reason: 'demo_report_not_found', accession: norm(accession) };

  const doc = createReportDocument({
    accession: demo.accession,
    text: demo.reportText,
    sourceType: 'demo',
    sectionDefs: demo.sections || [],
    imageAvailability: 'unknown'
  });

  const registry = findingRegistry || defaultFindingRegistryAdapter;
  const findings = gatherFindings(demo.accession, registry);
  const { spans, groundingDetails } = computeSpans(doc.originalText, findings, demo.findingSpanHints || []);
  const groundedFindings = markGrounded(findings, spans, groundingDetails);

  return {
    ok: true,
    document: doc,
    findings: groundedFindings,
    spans,
    title: demo.title,
    modality: demo.modality
  };
}

export function ingestPastedReport({ accession, text, findingRegistry } = {}) {
  const reportText = norm(text);
  if (!reportText) return { ok: false, reason: 'empty_text' };

  const doc = createReportDocument({
    accession: norm(accession) || null,
    text: reportText,
    sourceType: 'paste',
    sectionDefs: [],
    imageAvailability: 'unknown'
  });

  const registry = findingRegistry || defaultFindingRegistryAdapter;
  const findings = accession ? gatherFindings(norm(accession), registry) : [];
  const { spans } = computeSpans(doc.originalText, findings, []);

  return { ok: true, document: doc, findings, spans };
}

export function ingestApiReport({ accession, text, sourceType = 'api', findingRegistry } = {}) {
  const reportText = norm(text);
  if (!reportText) return { ok: false, reason: 'empty_text' };

  const doc = createReportDocument({
    accession: norm(accession) || null,
    text: reportText,
    sourceType: norm(sourceType) || 'api',
    sectionDefs: [],
    imageAvailability: 'unknown'
  });

  const registry = findingRegistry || defaultFindingRegistryAdapter;
  const findings = accession ? gatherFindings(norm(accession), registry) : [];
  const { spans } = computeSpans(doc.originalText, findings, []);

  return { ok: true, document: doc, findings, spans };
}

// Async: ingest pasted report and run the LLM parse pipeline.
// - Does NOT auto-fallback to mock for pasted reports; exposes local failure details instead.
// - Returns findings annotated with grounded:bool (true = rawText found in originalText).
// - Never throws; graceful on parser failure.
// - onProgress(event): optional callback, receives { stage, ...extra } at key steps.
//   Stages: parsing | waiting_llm | received | unavailable | grounding | complete
export async function parseAndIngestReport({
  accession,
  text,
  provider,
  endpoint,
  model,
  timeoutMs,
  maxTokens,
  findingRegistry,   // accepted for interface symmetry; LLM parse path uses LLM findings, not registry
  onProgress
} = {}) {
  const emit = (stage, extra = {}) => {
    if (typeof onProgress === 'function') {
      try { onProgress({ stage, ...extra }); } catch { /* ignore callback errors */ }
    }
  };

  const reportText = norm(text);
  if (!reportText) return { ok: false, reason: 'empty_text' };

  const detectedAccession = norm(accession) || extractAccessionFromText(reportText) || null;
  const accKey = detectedAccession || `paste-${Date.now().toString(36)}`;

  const doc = createReportDocument({
    accession: accKey,
    text: reportText,
    sourceType: 'paste',
    sectionDefs: [],
    imageAvailability: 'unknown'
  });

  // Build parse options
  const chosenProvider = norm(provider) || 'local';
  const parseOpts = { provider: chosenProvider };
  // Only set endpoint key when explicitly provided; absence lets provider use its own default.
  if (endpoint !== undefined) parseOpts.endpoint = String(endpoint || '');
  if (model) parseOpts.model = String(model);
  if (timeoutMs != null) parseOpts.timeoutMs = Number(timeoutMs);
  if (maxTokens != null) parseOpts.maxTokens = Number(maxTokens);

  const localAttempted = chosenProvider !== 'mock';
  let localError = null;
  let localErrorDetail = null;
  let localRawResponseSnippet = null;
  let localParseWarning = null;

  emit('parsing', { provider: chosenProvider });
  if (localAttempted) emit('waiting_llm', { provider: chosenProvider });

  const parseResult = await parseReportToFindings(reportText, parseOpts);
  let parseSource = chosenProvider;

  if (!parseResult.ok) {
    // Preserve local failure details; do NOT silently fall back to mock.
    localError = parseResult.reason || 'parse_failed';
    localErrorDetail = parseResult.error || null;
    localRawResponseSnippet = parseResult.rawPreview || null;
    localParseWarning = parseResult.warning || null;
    parseSource = parseResult.unavailable ? 'unavailable' : 'error';
    emit('unavailable', { reason: localError });
  } else {
    if (localAttempted) emit('received', { provider: chosenProvider });
    if (parseResult.warning) localParseWarning = parseResult.warning;
  }

  emit('grounding');

  const rawFindings = parseResult.ok ? (parseResult.findings || []) : [];
  const rawNeg = parseResult.ok ? (parseResult.negativeFindings || []) : [];
  const allRaw = [...rawFindings, ...rawNeg];
  const { spans, groundingDetails } = computeSpans(doc.originalText, allRaw, []);

  // Annotate each finding with grounded status and per-attempt diagnostics
  const findings = markGrounded(rawFindings, spans, groundingDetails);
  const negativeFindings = markGrounded(rawNeg, spans, groundingDetails);
  const totalFindings = findings.length + negativeFindings.length;

  // 'empty' = parse succeeded but LLM returned zero findings (distinct from failure)
  const parseStatus = !parseResult.ok
    ? (parseResult.unavailable ? 'unavailable' : 'error')
    : totalFindings === 0
    ? 'empty'
    : parseResult.partial
    ? 'partial'
    : 'success';

  // Attach ground_spans step to the trace if one exists
  const parseTrace = parseResult.trace || null;
  if (parseTrace) {
    const allGrounded = [...findings, ...negativeFindings];
    const groundedCount = allGrounded.filter((f) => f.grounded).length;
    const exactCount = allGrounded.filter((f) => f.groundingStatus === 'exact' || f.groundingStatus === 'normalized').length;
    const approximateCount = allGrounded.filter((f) => f.groundingStatus === 'approximate').length;
    parseTrace.steps.push({
      name: 'ground_spans',
      ok: true,
      totalFindings,
      groundedCount,
      exactCount,
      approximateCount,
      ungroundedCount: totalFindings - groundedCount,
      spanCount: spans.length
    });
  }

  const result = {
    ok: true,
    document: doc,
    // Merge positive + negative into findings for the viewer's filter pass
    findings: [...findings, ...negativeFindings],
    negativeFindings,
    spans,
    parseResult,
    parseSource,
    parseStatus,
    parseTrace,
    parseWarning: parseResult.warning || localParseWarning || null,
    localAttempted,
    localError,
    localErrorDetail,
    localRawResponseSnippet,
    localParseWarning,
    fallbackUsed: false,
    fallbackReason: null,
    accessionDetected: !!detectedAccession && !norm(accession)
  };

  emit('complete', { parseSource, parseStatus });
  return result;
}
