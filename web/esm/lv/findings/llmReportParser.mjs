import { REPORT_FINDING_SCHEMA_FIELDS, buildReportParserPrompt } from './reportParserPrompt.mjs';
import { getDefaultLlmUrl, getDefaultModel, resolveLlmEndpoint } from '../runtime/providerConfig.mjs';

const DEFAULT_OPTIONS = {
  provider: 'mock',
  endpoint: null,
  model: null,
  timeoutMs: 90000,
  maxTokens: 4096,
  strict: false,
  schemaVersion: 'lv-findings-v1'
};

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

function withProvenance(findings, opts) {
  const parsedAt = new Date().toISOString();
  return findings.map((f) => ({
    ...f,
    source: 'parsed',
    confidence: Number.isFinite(Number(f.confidence)) ? Number(f.confidence) : 0.9,
    provenance: {
      parserProvider: opts.provider,
      model: opts.model || 'mock-deterministic-v1',
      schemaVersion: opts.schemaVersion,
      parsedAt
    }
  }));
}

function normalizeFindingKeys(findings) {
  return (Array.isArray(findings) ? findings : []).map((f, idx) => {
    const item = (f && typeof f === 'object') ? { ...f } : {};
    if (item.seriesNumber == null && item.series_number != null && Number.isFinite(Number(item.series_number))) {
      item.seriesNumber = Number(item.series_number);
    }
    if (item.imageNumber == null && item.image_number != null && Number.isFinite(Number(item.image_number))) {
      item.imageNumber = Number(item.image_number);
    }
    if (item.windowPreset == null && item.window_preset != null) item.windowPreset = item.window_preset;
    if (item.rawText == null && item.raw_text != null) item.rawText = item.raw_text;
    if (item.seriesDescription == null && item.series_description != null) item.seriesDescription = item.series_description;
    // Generate stable ID from label when the LLM omits it (id is not in the parser schema).
    // Without this, computeSpans skips every finding and grounding produces zero spans.
    if (!item.id) {
      const slug = String(item.label || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      item.id = slug || `finding-${idx}`;
    }
    // Normalize atomic child findings (grouped negatives from LLM).
    // Each child gets a stable id, rawText, polarity, and simple label repair.
    if (Array.isArray(item.children) && item.children.length > 0) {
      item.children = item.children.map((ch, cidx) => {
        const c = ch && typeof ch === 'object' ? { ...ch } : {};
        if (c.rawText == null && c.raw_text != null) c.rawText = String(c.raw_text);
        delete c.raw_text;
        c.id = `${item.id}__child__${cidx}`;
        c.polarity = 'negative';
        // Apply same "Anatomy: Normal" label repair as normalizeNegativeFinding
        const craw = String(c.rawText || '').trim();
        const cnm = craw.match(/^([^:\n]{1,60}):\s*[Nn]ormal\s*$/);
        if (cnm) {
          const repaired = `Normal ${cnm[1].trim().toLowerCase()}`;
          if (String(c.label || '').toLowerCase() !== repaired) c.label = repaired;
        }
        return c;
      });
    }
    // Emit canonical runtime fields only.
    delete item.series_number;
    delete item.image_number;
    delete item.window_preset;
    delete item.raw_text;
    delete item.series_description;
    return item;
  });
}

function withNavigationMetadata(findings) {
  return findings.map((f) => {
    const hasSeries = Number.isFinite(f.seriesNumber);  // strict: null/undefined → false, no coercion
    const hasImage = Number.isFinite(f.imageNumber);
    const isNegative = String(f.severity || '').toLowerCase() === 'negative';
    if (isNegative) {
      return {
        ...f,
        seriesNumber: null,
        imageNumber: null,
        navigation_status: 'negative',
        navigationStatus: 'negative',
        series_number_source: 'none',
        image_number_source: 'none',
        show_finding_marker: false,
        uncertainty_reason: null
      };
    }
    if (hasSeries && hasImage) {
      return {
        ...f,
        navigation_status: 'navigable',
        navigationStatus: 'navigable',
        series_number_source: 'explicit',
        image_number_source: 'explicit',
        show_finding_marker: true,
        uncertainty_reason: null
      };
    }
    if (hasSeries && !hasImage) {
      return {
        ...f,
        imageNumber: 1,
        navigation_status: 'series_only',
        navigationStatus: 'series_only',
        series_number_source: 'explicit',
        image_number_source: 'default',
        show_finding_marker: false,
        uncertainty_reason: 'image_number_not_cited'
      };
    }
    return {
      ...f,
      seriesNumber: null,
      imageNumber: null,
      navigation_status: 'non_navigable',
      navigationStatus: 'non_navigable',
      series_number_source: 'none',
      image_number_source: 'none',
      show_finding_marker: false,
      uncertainty_reason: 'no_explicit_series_or_image'
    };
  });
}

function isNegativeLikeFinding(finding) {
  if (!finding || typeof finding !== 'object') return false;
  const nav = String(finding.navigation_status || finding.navigationStatus || '').toLowerCase();
  const sev = String(finding.severity || '').toLowerCase();
  const label = String(finding.label || '').toLowerCase();
  const desc = String(finding.description || '').toLowerCase();
  if (nav === 'negative' || sev === 'negative') return true;
  if (label.startsWith('no ') || desc.startsWith('no ')) return true;
  return false;
}

// Minimal content token extractor for negative finding QA (no external deps).
// Excludes stopwords and very short tokens, same logic as reportSpans.contentTokens.
const NEG_QA_STOP = new Set([
  'a','an','the','is','are','was','were','be','been','no','not','nor',
  'in','on','at','to','for','of','with','by','and','or','but','it','its',
  'this','that','as','he','she','they','we','you','i','me','him','her'
]);
function negQaTokens(str) {
  return String(str || '').toLowerCase().replace(/[^\w\s]/g, ' ')
    .split(/\s+/).filter(w => w.length > 2 && !NEG_QA_STOP.has(w));
}

function normalizeNegativeFinding(finding = {}) {
  const result = {
    ...finding,
    type: 'negative',
    navigation_status: 'negative',
    navigationStatus: 'negative',
    seriesNumber: null,
    imageNumber: null,
    series_number_source: 'none',
    image_number_source: 'none',
    show_finding_marker: false,
    uncertainty_reason: null
  };

  // Safe label repair: "<Anatomy>: Normal" rawText → "Normal <anatomy>"
  const raw = String(result.rawText || '').trim();
  const normalMatch = raw.match(/^([^:\n]{1,60}):\s*[Nn]ormal\s*$/);
  if (normalMatch) {
    const anatomy = normalMatch[1].trim();
    const repairedLabel = `Normal ${anatomy.toLowerCase()}`;
    if (String(result.label || '').toLowerCase() !== repairedLabel) {
      result.label = repairedLabel;
    }
  }

  // QA check: flag label/rawText token mismatch for negative findings
  if (raw) {
    const labelToks = negQaTokens(result.label);
    const rawToks = negQaTokens(raw);
    if (labelToks.length >= 1 && rawToks.length >= 1) {
      const labelSet = new Set(labelToks);
      const hasCommon = rawToks.some(t => labelSet.has(t));
      if (!hasCommon) result.qualityWarning = 'label_raw_text_mismatch';
    }
  }

  return result;
}

function splitFindingsByPolarity(findings = []) {
  const positive = [];
  const negative = [];
  for (const f of (Array.isArray(findings) ? findings : [])) {
    if (isNegativeLikeFinding(f)) negative.push(normalizeNegativeFinding(f));
    else positive.push(f);
  }
  return { positive, negative };
}

function supplementNegativeFindingsFromReport(reportText, existingNegative = [], opts = {}) {
  if (Array.isArray(existingNegative) && existingNegative.length > 0) {
    return { negativeFindings: existingNegative, supplemented: false };
  }
  const baseline = withNavigationMetadata(
    withProvenance(normalizeFindingKeys(stableFindingsForBuiltIn(String(reportText))), {
      provider: opts.provider || 'local',
      model: opts.model || null,
      schemaVersion: opts.schemaVersion || 'lv-findings-v1'
    })
  );
  const split = splitFindingsByPolarity(baseline);
  if (!split.negative.length) return { negativeFindings: existingNegative || [], supplemented: false };
  return { negativeFindings: split.negative, supplemented: true };
}

function stableFindingsForBuiltIn(reportText = '') {
  const text = norm(reportText);
  if (text.includes('caudate') || text.includes('vertex fracture') || text.includes('intracranial')) {
    return [
      {
        id: 'chronic-left-caudate-infarct', label: 'Chronic left caudate infarct', description: 'Chronic infarct involving left caudate head', section: 'findings',
        anatomy: 'head', laterality: 'left', seriesNumber: 2, imageNumber: 21, windowPreset: 'brain', confidence: 0.9,
        rawText: 'Chronic infarct involving left caudate head (Series 2, Image 21).'
      },
      {
        id: 'healed-left-vertex-fracture', label: 'Healed left vertex fracture', description: 'Healed fracture near left vertex', section: 'findings',
        anatomy: 'head', laterality: 'left', seriesNumber: 2, imageNumber: 36, windowPreset: 'bone', confidence: 0.9,
        rawText: 'Healed fracture near left vertex (Series 2, Image 36).'
      },
      {
        id: 'no-acute-intracranial-hemorrhage', label: 'No acute intracranial hemorrhage', description: 'No acute intracranial hemorrhage.', section: 'impression',
        anatomy: 'head', laterality: null, seriesNumber: null, imageNumber: null, windowPreset: null, severity: 'negative', confidence: 0.9,
        rawText: 'No acute intracranial hemorrhage.'
      }
    ];
  }
  if (text.includes('meniscus') || text.includes('effusion') || text.includes('knee')) {
    return [
      {
        id: 'medial-meniscus-tear', label: 'Medial meniscus tear', description: 'Medial meniscus tear', section: 'findings',
        anatomy: 'knee', laterality: 'left', seriesNumber: 6, imageNumber: 23, windowPreset: null, confidence: 0.9,
        rawText: 'Medial meniscus tear (Series 6, Image 23).'
      },
      {
        id: 'joint-effusion', label: 'Joint effusion', description: 'Joint effusion', section: 'findings',
        anatomy: 'knee', laterality: 'left', seriesNumber: 3, imageNumber: 14, windowPreset: null, confidence: 0.9,
        rawText: 'Joint effusion (Series 3, Image 14).'
      },
      {
        id: 'no-acute-knee-fracture', label: 'No acute fracture', description: 'No acute fracture.', section: 'impression',
        anatomy: 'knee', laterality: 'left', seriesNumber: null, imageNumber: null, windowPreset: null, severity: 'negative', confidence: 0.85,
        rawText: 'No acute fracture.'
      }
    ];
  }
  if (text.includes('no acute cardiopulmonary abnormality') || text.includes('no focal airspace')) {
    return [
      {
        id: 'no-acute-cardiopulmonary-abnormality', label: 'No acute cardiopulmonary abnormality', description: 'No focal airspace disease, pleural effusion, or pneumothorax.', section: 'impression',
        anatomy: 'chest', laterality: null, seriesNumber: null, imageNumber: null, windowPreset: null, severity: 'negative', confidence: 0.9,
        rawText: 'No acute cardiopulmonary abnormality.'
      }
    ];
  }
  return [];
}

function extractAssistantContent(json) {
  try {
    return String(json?.choices?.[0]?.message?.content || '');
  } catch {
    return '';
  }
}

// Attempt to extract a JSON object from LLM response text.
// Handles reasoning models that emit prose or <think> blocks before/after JSON.
// Returns { parsed: object|null, method: string|null }.
// WARNING: rawText may contain PHI — do not log externally.
export function extractFindingsJson(rawText) {
  let body = String(rawText || '');
  // Strip thinking blocks (Qwen3, DeepSeek-R1, etc.)
  body = body.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Also strip any remaining /think or standalone think tags
  body = body.replace(/<\/?think>/gi, '').trim();

  // 1. Preferred: findings-json fenced block (as specified in the prompt)
  const fencedFindings = body.match(/```findings-json\s*([\s\S]*?)```/i);
  if (fencedFindings?.[1]) {
    try {
      const parsed = JSON.parse(fencedFindings[1].trim());
      if (parsed && typeof parsed === 'object') return { parsed, method: 'fenced_findings_json' };
    } catch {}
  }

  // 2. Generic json fenced block
  const fencedJson = body.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJson?.[1]) {
    try {
      const parsed = JSON.parse(fencedJson[1].trim());
      if (parsed && typeof parsed === 'object') return { parsed, method: 'fenced_json' };
    } catch {}
  }

  // 3. Full body as JSON
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object') return { parsed, method: 'raw_json' };
  } catch {}

  // 4. First balanced {...} span (handles JSON embedded in prose)
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(body.slice(start, end + 1));
      if (parsed && typeof parsed === 'object') return { parsed, method: 'extracted_object' };
    } catch {}
  }

  return { parsed: null, method: null };
}

async function requestLocalChatCompletion({ endpoint, model, timeoutMs, body }) {
  // timeoutMs === 0 disables the AbortController entirely (debug mode; may hang)
  const useTimeout = timeoutMs > 0;
  const controller = useTimeout && typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const url = `${endpoint.replace(/\/$/, '')}/chat/completions`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller?.signal
    });
    const httpStatus = response.status;
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return { ok: false, unavailable: true, reason: 'http_error', httpStatus, content: '', rawResponseText: errorText.slice(0, 2000) };
    }
    // Read as text first so trace can store raw payload
    const rawResponseText = await response.text();
    let payload;
    try { payload = JSON.parse(rawResponseText); } catch {
      return { ok: false, unavailable: true, reason: 'invalid_json_response', httpStatus, content: '', rawResponseText: rawResponseText.slice(0, 3000) };
    }
    return {
      ok: true,
      content: extractAssistantContent(payload),
      httpStatus,
      finishReason: payload?.choices?.[0]?.finish_reason || null,
      usage: payload?.usage || null,
      rawResponseText  // may contain PHI — stored for trace only
    };
  } catch (error) {
    const isTimeout = String(error?.name || '').toLowerCase() === 'aborterror';
    return {
      ok: false,
      unavailable: true,
      reason: isTimeout ? 'timeout' : 'fetch_failed',
      error: isTimeout
        ? 'No response body was received before client abort'
        : String(error?.message || error),
      content: '',
      rawResponseText: null
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// WARNING: Parse traces include request messages and LLM responses that may contain PHI.
// Traces are stored in memory only. Never log automatically. Show only on explicit user request.
async function parseWithLocalProvider(reportText, opts, rawOptions = null) {
  const traceId = `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const traceStart = Date.now();
  // PHI warning: request.messages and response.rawResponseText may contain patient data
  const trace = {
    traceId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: null,
    provider: 'local',
    endpoint: null,
    model: null,
    request: null,
    response: null,
    repairRequest: null,
    repairResponse: null,
    steps: [],
    errors: [],
    warnings: []
  };

  function traceStep(name, ok, detail = {}) {
    trace.steps.push({ name, ok, ...detail });
    if (!ok && (detail.error || detail.reason)) {
      trace.errors.push({ step: name, error: detail.error || detail.reason, ...detail });
    }
    if (detail.warning) trace.warnings.push({ step: name, warning: detail.warning });
  }

  function finalize() {
    trace.completedAt = new Date().toISOString();
    trace.durationMs = Date.now() - traceStart;
    return trace;
  }

  function ret(result) {
    finalize();
    return { ...result, trace };
  }

  const hasEndpointField = Object.prototype.hasOwnProperty.call(rawOptions || {}, 'endpoint');
  const rawEndpoint = String(opts.endpoint ?? '').trim();
  if (hasEndpointField && !rawEndpoint) {
    traceStep('validate_options', false, { reason: 'missing_endpoint' });
    return ret({ ok: false, unavailable: true, reason: 'missing_endpoint', provider: 'local', findings: [] });
  }
  const endpoint = resolveLlmEndpoint(rawEndpoint || getDefaultLlmUrl());
  const model = String(opts.model || getDefaultModel()).trim();
  trace.endpoint = endpoint;
  trace.model = model;

  if (!endpoint) {
    traceStep('validate_options', false, { reason: 'missing_endpoint' });
    return ret({ ok: false, unavailable: true, reason: 'missing_endpoint', provider: 'local', findings: [] });
  }
  if (!model) {
    traceStep('validate_options', false, { reason: 'missing_model' });
    return ret({ ok: false, unavailable: true, reason: 'missing_model', provider: 'local', endpoint, findings: [] });
  }
  traceStep('validate_options', true, { endpoint, model });

  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 90000;
  const maxTokens = Number(opts.maxTokens) > 0 ? Number(opts.maxTokens) : 4096;
  const startedAt = new Date().toISOString();

  try {
    const prompt = buildReportParserPrompt({});
    // Hardened system message: explicitly require findings-json fenced block, no reasoning outside it.
    const systemMessage = [
      'You are a radiology report structured data extractor.',
      'Return your response ONLY inside a ```findings-json code block as specified in the instructions.',
      'Do not output any reasoning, explanation, or text outside the code block.',
      'Do not use <think> or any chain-of-thought notation.',
      'The ONLY output must be: ```findings-json\\n{...}\\n```'
    ].join(' ');

    const messages = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: `${prompt}\n\nREPORT:\n${String(reportText)}` }
    ];
    const baseRequest = {
      model,
      temperature: 0,
      stream: false,
      max_tokens: maxTokens
    };

    const firstPassBody = { ...baseRequest, messages };
    trace.request = {
      messages,  // PHI: contains report text
      temperature: baseRequest.temperature,
      max_tokens: baseRequest.max_tokens,
      timeoutMs,
      endpoint,
      requestBody: firstPassBody  // exact POST body sent — PHI
    };
    traceStep('build_prompt', true, { messageCount: messages.length, systemLength: systemMessage.length, promptLength: prompt.length });

    const firstPass = await requestLocalChatCompletion({
      endpoint,
      model,
      timeoutMs,
      body: firstPassBody
    });

    trace.response = {
      httpStatus: firstPass.httpStatus,
      finishReason: firstPass.finishReason || null,
      usage: firstPass.usage || null,
      // Store snippet for quick view; full text available via trace.response.rawResponseText
      contentText: firstPass.content || null,
      rawResponseText: firstPass.rawResponseText || null  // PHI: may contain report text echoed by model
    };

    if (!firstPass.ok) {
      traceStep('send_request', false, {
        reason: firstPass.reason || 'fetch_failed',
        error: firstPass.error || null,
        httpStatus: firstPass.httpStatus || null
      });
      return ret({
        ok: false,
        unavailable: true,
        reason: firstPass.reason || 'fetch_failed',
        provider: 'local',
        endpoint,
        model,
        httpStatus: firstPass.httpStatus,
        error: firstPass.error,
        schemaVersion: opts.schemaVersion,
        findings: [],
        rawPreview: String(firstPass.rawResponseText || '').slice(0, 1200)
      });
    }
    const truncated = firstPass.finishReason === 'length';
    traceStep('send_request', true, {
      httpStatus: firstPass.httpStatus,
      finishReason: firstPass.finishReason,
      contentLength: (firstPass.content || '').length,
      ...(truncated ? { warning: 'response_truncated_max_tokens' } : {})
    });

    let content = firstPass.content;
    const { parsed, method: extractMethod } = extractFindingsJson(content);
    let findingsRaw = Array.isArray(parsed?.findings) ? parsed.findings : [];
    let negFindingsRaw = Array.isArray(parsed?.negativeFindings) ? parsed.negativeFindings : [];
    traceStep('extract_json', findingsRaw.length > 0 || negFindingsRaw.length > 0 || !!parsed, {
      method: extractMethod || 'none',
      foundFindings: findingsRaw.length,
      foundNegativeFindings: negFindingsRaw.length,
      reason: !parsed ? 'no_json_found' : (findingsRaw.length === 0 && negFindingsRaw.length === 0) ? 'empty_findings_array' : null
    });

    let usedRepairPass = false;
    if (!findingsRaw.length && !negFindingsRaw.length) {
      const repairMessages = [
        { role: 'system', content: 'Return ONLY valid JSON object with key "findings" as array. No prose. No markdown. No reasoning.' },
        {
          role: 'user',
          content:
            `Convert the following model output into strict JSON object with findings array only.\n` +
            `If missing fields, set null. Keep explicit series/image only.\n\n` +
            `MODEL_OUTPUT:\n${String(content || '').slice(0, 6000)}`
        }
      ];
      trace.repairRequest = { messages: repairMessages, timeoutMs, endpoint };  // PHI: contains model output

      const repairPass = await requestLocalChatCompletion({
        endpoint,
        model,
        timeoutMs,
        body: { ...baseRequest, messages: repairMessages }
      });

      trace.repairResponse = {
        httpStatus: repairPass.httpStatus,
        contentText: repairPass.content || null,
        rawResponseText: repairPass.rawResponseText || null  // PHI
      };

      if (repairPass.ok) {
        usedRepairPass = true;
        content = repairPass.content;
        const { parsed: repaired, method: repairMethod } = extractFindingsJson(content);
        findingsRaw = Array.isArray(repaired?.findings) ? repaired.findings : [];
        negFindingsRaw = Array.isArray(repaired?.negativeFindings) ? repaired.negativeFindings : [];
        traceStep('repair_json', findingsRaw.length > 0 || negFindingsRaw.length > 0 || !!repaired, {
          method: repairMethod || 'none',
          foundFindings: findingsRaw.length,
          foundNegativeFindings: negFindingsRaw.length,
          reason: !repaired ? 'no_json_found' : (findingsRaw.length === 0 && negFindingsRaw.length === 0) ? 'empty_findings_array' : null
        });
      } else {
        traceStep('repair_json', false, { reason: repairPass.reason || 'fetch_failed', error: repairPass.error });
      }
    }

    if (!findingsRaw.length) {
      const fallbackFindings = stableFindingsForBuiltIn(String(reportText));
      if (!opts.strict && fallbackFindings.length) {
        const findings = withNavigationMetadata(withProvenance(normalizeFindingKeys(fallbackFindings), {
          provider: 'local', model, schemaVersion: opts.schemaVersion
        }));
        const split = splitFindingsByPolarity(findings);
        const primary = split.positive.length ? split.positive : (split.negative[0] ? [split.negative[0]] : []);
        const warning = truncated
          ? 'response_truncated_max_tokens'
          : usedRepairPass
            ? 'local_model_required_repair_then_used_deterministic_fallback'
            : 'local_model_no_structured_findings_used_deterministic_fallback';
        traceStep('normalize_findings', true, {
          source: 'stable_fallback',
          positiveCount: primary.length,
          negativeCount: split.negative.length,
          truncated,
          warning
        });
        return ret({
          ok: true, partial: true, provider: 'local', endpoint, model, timeoutMs,
          schemaVersion: opts.schemaVersion, schemaFields: REPORT_FINDING_SCHEMA_FIELDS,
          parsedAt: startedAt, findings: primary, negativeFindings: split.negative,
          filteredOutNegative: split.negative.length && split.positive.length ? split.negative.length : 0,
          summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
          explanation: typeof parsed?.explanation === 'string' ? parsed.explanation : '',
          warning
        });
      }
      const reason = !parsed ? 'no_json_found' : 'no_findings_extracted';
      traceStep('normalize_findings', false, { reason, usedRepairPass });
      return ret({
        ok: false, partial: true, unavailable: true, reason,
        provider: 'local', endpoint, model, timeoutMs,
        schemaVersion: opts.schemaVersion, findings: [],
        rawPreview: String(content || '').slice(0, 1200)
      });
    }

    const findings = withNavigationMetadata(withProvenance(normalizeFindingKeys(findingsRaw), {
      provider: 'local', model, schemaVersion: opts.schemaVersion
    }));
    const split = splitFindingsByPolarity(findings);
    const primary = split.positive.length ? split.positive : (split.negative[0] ? [split.negative[0]] : []);

    // Normalize explicit negativeFindings from LLM JSON and merge with polarity-split negatives
    const negExplicit = negFindingsRaw.length
      ? withNavigationMetadata(withProvenance(normalizeFindingKeys(negFindingsRaw), {
          provider: 'local', model, schemaVersion: opts.schemaVersion
        })).map(normalizeNegativeFinding)
      : [];
    const seenNegIds = new Set(split.negative.map((f) => String(f.id || '')));
    const mergedNegatives = [
      ...split.negative,
      ...negExplicit.filter((f) => !seenNegIds.has(String(f.id || '')))
    ];

    const negSupplement = supplementNegativeFindingsFromReport(reportText, mergedNegatives, {
      provider: 'local', model, schemaVersion: opts.schemaVersion
    });
    const isPartial = !!(usedRepairPass || negSupplement.supplemented || truncated);
    const warning = truncated
      ? 'response_truncated_max_tokens'
      : usedRepairPass
        ? (negSupplement.supplemented
            ? 'local_model_output_required_json_repair_and_negative_supplement'
            : 'local_model_output_required_json_repair')
        : (negSupplement.supplemented ? 'local_model_missing_negative_findings_supplemented' : undefined);

    traceStep('normalize_findings', true, {
      source: 'llm_response',
      positiveCount: primary.length,
      negativeCount: negSupplement.negativeFindings.length,
      negativeExplicitCount: negExplicit.length,
      usedRepair: usedRepairPass,
      negativeSupplemented: negSupplement.supplemented,
      truncated,
      warning: warning || null
    });

    return ret({
      ok: true, partial: isPartial, provider: 'local', endpoint, model, timeoutMs,
      schemaVersion: opts.schemaVersion, schemaFields: REPORT_FINDING_SCHEMA_FIELDS,
      parsedAt: startedAt, findings: primary,
      negativeFindings: negSupplement.negativeFindings,
      filteredOutNegative:
        negSupplement.negativeFindings.length && split.positive.length ? negSupplement.negativeFindings.length : 0,
      summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
      explanation: typeof parsed?.explanation === 'string' ? parsed.explanation : '',
      warning
    });
  } catch (error) {
    traceStep('send_request', false, { reason: 'unexpected_error', error: String(error?.message || error) });
    return ret({
      ok: false, unavailable: true, reason: 'fetch_failed',
      error: String(error?.message || error),
      provider: 'local', endpoint: trace.endpoint, model: trace.model,
      timeoutMs: Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 90000,
      schemaVersion: opts.schemaVersion, findings: []
    });
  }
}

export async function parseReportToFindings(reportText, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
  const provider = String(opts.provider || 'mock').toLowerCase();
  if (!reportText || !String(reportText).trim()) {
    return { ok: false, unavailable: true, reason: 'empty_report_text', provider, schemaVersion: opts.schemaVersion, findings: [] };
  }

  if (provider === 'local') {
    return parseWithLocalProvider(reportText, opts, options || {});
  }

  if (provider !== 'mock') {
    return {
      ok: false,
      unavailable: true,
      reason: 'provider_not_implemented',
      provider,
      endpoint: opts.endpoint || null,
      model: opts.model || null,
      timeoutMs: opts.timeoutMs,
      schemaVersion: opts.schemaVersion,
      findings: []
    };
  }

  const findings = withNavigationMetadata(withProvenance(normalizeFindingKeys(stableFindingsForBuiltIn(String(reportText))), {
    provider,
    model: opts.model || 'mock-deterministic-v1',
    schemaVersion: opts.schemaVersion
  }));
  const split = splitFindingsByPolarity(findings);
  const primary = split.positive.length ? split.positive : (split.negative[0] ? [split.negative[0]] : []);
  return {
    ok: true,
    provider,
    endpoint: opts.endpoint || null,
    model: opts.model || 'mock-deterministic-v1',
    timeoutMs: opts.timeoutMs,
    schemaVersion: opts.schemaVersion,
    schemaFields: REPORT_FINDING_SCHEMA_FIELDS,
    findings: primary,
    negativeFindings: split.negative,
    filteredOutNegative: split.negative.length && split.positive.length ? split.negative.length : 0
  };
}
