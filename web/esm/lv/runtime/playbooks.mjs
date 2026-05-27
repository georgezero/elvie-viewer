function asNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isOk(result) {
  if (!result || typeof result !== 'object') return !!result;
  if (result.ok === false) return false;
  return true;
}

function summarizeError(error) {
  return String(error?.message || error || 'unknown error');
}

function normalizeNestedStatus(result, ok) {
  const status = typeof result?.status === 'string' ? String(result.status).toLowerCase() : '';
  if (status === 'success' || status === 'partial' || status === 'failed') return status;
  if (result?.unavailable || result?.unsupported) return 'partial';
  return ok ? 'success' : 'failed';
}

function mapHpPartialSlotWarnings(result) {
  const mapped = [];
  if (!result || typeof result !== 'object') return mapped;
  if (String(result.status || '').toLowerCase() !== 'partial') return mapped;
  const slots = Array.isArray(result.slots) ? result.slots : [];
  for (const slot of slots) {
    const paneId = Number.isFinite(asNumber(slot?.paneId, NaN)) ? Math.trunc(asNumber(slot.paneId, NaN)) : null;
    if (!slot?.matchedSeries) {
      mapped.push({ type: 'hangingProtocol', reason: 'hp_slot_no_matched_series', paneId });
    }
    if (slot?.seriesLoadResult && !isOk(slot.seriesLoadResult)) {
      mapped.push({
        type: 'hangingProtocol',
        reason: 'hp_slot_load_series_failed',
        paneId,
        unavailable: !!(slot.seriesLoadResult?.unavailable || slot.seriesLoadResult?.unsupported),
        error: slot.seriesLoadResult?.error || null
      });
    }
    if (slot?.windowPresetResult && !isOk(slot.windowPresetResult)) {
      mapped.push({
        type: 'hangingProtocol',
        reason: 'hp_slot_set_window_preset_failed',
        paneId,
        unavailable: !!(slot.windowPresetResult?.unavailable || slot.windowPresetResult?.unsupported),
        error: slot.windowPresetResult?.error || null
      });
    }
  }
  if (result?.layoutResult && !isOk(result.layoutResult)) {
    mapped.push({
      type: 'hangingProtocol',
      reason: 'hp_layout_convergence_or_apply_failed',
      unavailable: !!(result.layoutResult?.unavailable || result.layoutResult?.unsupported),
      error: result.layoutResult?.error || null
    });
  }
  return mapped;
}

const BUILTIN_PLAYBOOKS = [
  {
    id: 'ct-head-report-findings-demo',
    name: 'CT Head Report Findings Demo',
    accession: 'NI9f7ff9',
    steps: [
      { type: 'command', command: { type: 'applyHangingProtocol', payload: { protocolId: 'ct-head-1x1' } } },
      { type: 'reportFinding', finding: { findingId: 0, labelContains: 'caudate infarct', seriesNumber: 2, imageNumber: 21 }, windowPreset: 'brain' },
      { type: 'wait', ms: 500 },
      { type: 'reportFinding', finding: { findingId: 1, labelContains: 'vertex fracture', seriesNumber: 2, imageNumber: 36 }, windowPreset: 'bone' }
    ]
  },
  {
    id: 'mr-knee-report-findings-demo',
    name: 'MR Knee Report Findings Demo',
    accession: '3852755662087132',
    steps: [
      { type: 'command', command: { type: 'applyHangingProtocol', payload: { protocolId: 'mr-knee-2x2' } } },
      { type: 'reportFinding', finding: { findingId: 0, labelContains: 'medial meniscus tear', seriesNumber: 6, imageNumber: 23 } },
      { type: 'wait', ms: 500 },
      { type: 'reportFinding', finding: { findingId: 1, labelContains: 'joint effusion', seriesNumber: 3, imageNumber: 14 } }
    ]
  },
  {
    id: 'xr-chest-report-demo',
    name: 'XR Chest Report Demo',
    accession: 'CXR-88997',
    steps: [
      { type: 'command', command: { type: 'applyHangingProtocol', payload: { protocolId: 'xr-chest-1x1' } } },
      { type: 'reportFinding', finding: { labelContains: 'no acute cardiopulmonary abnormality' }, includeNegative: true, allowUnavailable: true }
    ]
  }
];

export function listBuiltinPlaybooks() {
  return BUILTIN_PLAYBOOKS.map((p) => ({
    id: p.id,
    name: p.name,
    accession: p.accession,
    stepCount: Array.isArray(p.steps) ? p.steps.length : 0,
    reportFindingSteps: Array.isArray(p.steps)
      ? p.steps
          .filter((s) => s?.type === 'reportFinding')
          .map((s) => ({
            findingId: Number.isFinite(asNumber(s?.finding?.findingId, NaN)) ? Math.trunc(asNumber(s.finding.findingId, NaN)) : null,
            labelContains: s?.finding?.labelContains || null,
            seriesNumber: Number.isFinite(asNumber(s?.finding?.seriesNumber, NaN)) ? Math.trunc(asNumber(s.finding.seriesNumber, NaN)) : null,
            imageNumber: Number.isFinite(asNumber(s?.finding?.imageNumber, NaN)) ? Math.trunc(asNumber(s.finding.imageNumber, NaN)) : null
          }))
      : []
  }));
}

export function findPlaybookForAccession(accession) {
  const acc = String(accession || '').trim();
  if (!acc) return null;
  const found = BUILTIN_PLAYBOOKS.find((p) => p.accession === acc);
  if (!found) return null;
  return {
    id: found.id,
    name: found.name,
    accession: found.accession,
    steps: Array.isArray(found.steps) ? found.steps.map((s) => ({ ...s })) : []
  };
}

export function getBuiltinPlaybook(playbookId) {
  const id = String(playbookId || '').trim();
  if (!id) return null;
  const found = BUILTIN_PLAYBOOKS.find((p) => p.id === id);
  if (!found) return null;
  return {
    id: found.id,
    name: found.name,
    accession: found.accession,
    steps: Array.isArray(found.steps) ? found.steps.map((s) => ({ ...s })) : []
  };
}

function resolvePlaybook(requested = {}) {
  const id = String(requested?.playbookId || requested?.id || '').trim();
  if (id) {
    const builtIn = BUILTIN_PLAYBOOKS.find((p) => p.id === id);
    if (builtIn) return builtIn;
  }
  if (Array.isArray(requested?.steps)) return requested;
  return null;
}

async function executeReportFindingStep(runtime, dispatch, step, options, playbook) {
  const selector = step?.finding || {};
  const accession = String(step?.accession || playbook?.accession || options?.accession || '').trim();
  const findingSource = String(options?.findingSource || step?.findingSource || 'auto').trim().toLowerCase();
  const resolveResult = await dispatch({
    type: 'resolveFinding',
    payload: {
      accession,
      findingId: selector.findingId,
      labelIncludes: selector.labelContains || selector.labelIncludes || selector.label,
      textIncludes: selector.textContains || selector.textIncludes || selector.text,
      seriesNumber: selector.seriesNumber,
      imageNumber: selector.imageNumber,
      includeNegative: !!step?.includeNegative,
      findingSource: findingSource === 'auto' ? undefined : findingSource
    }
  }, options);
  let finding = resolveResult?.finding || null;
  let resolvedBy = resolveResult?.resolvedBy || null;
  let resolveDetails = resolveResult;
  if (!finding && accession) {
    // Registry-first; if empty/unavailable, run deterministic mock parsing for demo reports.
    const parseResult = await dispatch({
      type: 'parseReport',
      payload: { accession, options: { provider: 'mock' } }
    }, options);
    if (parseResult?.ok) {
      resolveDetails = await dispatch({
        type: 'resolveFinding',
        payload: {
          accession,
          findingId: selector.findingId,
          labelIncludes: selector.labelContains || selector.labelIncludes || selector.label,
          textIncludes: selector.textContains || selector.textIncludes || selector.text,
          seriesNumber: selector.seriesNumber,
          imageNumber: selector.imageNumber,
          includeNegative: !!step?.includeNegative,
          findingSource: findingSource === 'auto' ? undefined : findingSource
        }
      }, options);
      finding = resolveDetails?.finding || null;
      resolvedBy = resolveDetails?.resolvedBy || resolvedBy;
    }
  }
  const details = {
    ok: true,
    type: 'reportFinding',
    accession,
    findingSelector: selector,
    findingSource,
    finding: finding,
    chosenFinding: finding,
    resolvedBy,
    alternativesCount: Array.isArray(resolveDetails?.alternatives) ? resolveDetails.alternatives.length : 0,
    confidence: finding?.confidence ?? null,
    source: finding?.source || null,
    navigationAttempted: false,
    navigationResult: null,
    windowPresetResult: null,
    operations: [],
    warnings: [],
    errors: []
  };
  const minFindingConfidence = Number.isFinite(asNumber(options?.minFindingConfidence, NaN))
    ? Math.max(0, Math.min(1, asNumber(options?.minFindingConfidence, 0.75)))
    : 0.75;

  if (!finding) {
    details.ok = false;
    details.unavailable = true;
    details.warnings.push({ reason: 'finding_unavailable', resolveResult: resolveDetails });
  } else {
    const source = String(finding?.source || '').toLowerCase();
    const confidence = Number.isFinite(asNumber(finding?.confidence, NaN))
      ? asNumber(finding?.confidence, NaN)
      : (source === 'seeded' || source === 'user' ? 1 : NaN);
    if (source === 'parsed' && Number.isFinite(confidence) && confidence < minFindingConfidence) {
      details.partial = true;
      details.navigationAttempted = false;
      details.navigationResult = {
        ok: false,
        skipped: true,
        reason: 'low_confidence_finding_skipped',
        confidence,
        minFindingConfidence
      };
      details.warnings.push({
        reason: 'low_confidence_finding_skipped',
        confidence,
        minFindingConfidence,
        findingId: finding?.id || null,
        source
      });
      return details;
    }
    const navStatus = String(finding?.navigationStatus || finding?.navigation_status || '').toLowerCase();
    if (navStatus === 'negative' || navStatus === 'non_navigable') {
      details.navigationAttempted = false;
      details.navigationResult = { ok: true, skipped: true, reason: navStatus };
      if (step?.windowPreset || finding?.windowPreset) {
        const windowResult = await dispatch({
          type: 'setWindowPreset',
          payload: { paneId: asNumber(step?.paneId, 0), presetId: String(step?.windowPreset || finding?.windowPreset) }
        }, options);
        details.operations.push({ op: 'setWindowPreset', result: windowResult });
        details.windowPresetResult = windowResult;
      }
      return details;
    }
    const jumpResult = await dispatch({ type: 'jumpToFinding', payload: { findingId: finding.id } }, options);
    details.operations.push({ op: 'jumpToFinding', result: jumpResult });
    details.navigationAttempted = true;
    details.navigationResult = jumpResult;
    if (!isOk(jumpResult) && (Number.isFinite(asNumber(finding?.seriesNumber, NaN)) || Number.isFinite(asNumber(finding?.imageNumber, NaN)))) {
      details.warnings.push({ reason: 'jump_unavailable_or_failed', result: jumpResult });
      const paneId = asNumber(step?.paneId, 0);
      const targetSeries = asNumber(selector.seriesNumber ?? finding?.seriesNumber, NaN);
      const imageSource = String(finding?.imageNumberSource || finding?.image_number_source || '').toLowerCase();
      const targetImage = imageSource === 'default'
        ? NaN
        : asNumber(selector.imageNumber ?? finding?.imageNumber, NaN);
      if (Number.isFinite(targetSeries)) {
        const loadResult = await dispatch({
          type: 'loadSeriesInPane',
          payload: { paneId, seriesNumber: targetSeries }
        }, options);
        details.operations.push({ op: 'loadSeriesInPane', result: loadResult });
      }
      if (Number.isFinite(targetImage)) {
        const scrollResult = await dispatch({
          type: 'scrollPaneToImageNumber',
          payload: { paneId, imageNumber: targetImage }
        }, options);
        details.operations.push({ op: 'scrollPaneToImageNumber', result: scrollResult });
      }
      details.navigationResult = details.operations.find((op) => op.op === 'scrollPaneToImageNumber')?.result
        || details.operations.find((op) => op.op === 'loadSeriesInPane')?.result
        || jumpResult;
    } else if (!isOk(jumpResult)) {
      details.warnings.push({ reason: 'finding_has_no_image_navigation' });
    }
    const preset = step?.windowPreset || finding?.windowPreset;
    if (preset) {
      const windowResult = await dispatch({
        type: 'setWindowPreset',
        payload: { paneId: asNumber(step?.paneId, 0), presetId: String(preset) }
      }, options);
      details.operations.push({ op: 'setWindowPreset', result: windowResult });
      details.windowPresetResult = windowResult;
    }
    if (step?.replayFindingPreview) {
      const replayResult = await dispatch({ type: 'replayFindingPreview', payload: { findingId: finding.id } }, options);
      details.operations.push({ op: 'replayFindingPreview', result: replayResult });
    }
  }

  if (!details.ok && !step?.allowUnavailable) {
    details.errors.push({ reason: 'reportFinding_failed' });
  }
  return details;
}

export async function executeLvRunPlaybook(runtime = {}, playbookInput = {}, options = {}) {
  const dispatch = runtime.dispatchViewerCommand;
  if (typeof dispatch !== 'function') throw new Error('LV Run playbook requires dispatchViewerCommand');

  const startedAt = Date.now();
  const playbook = resolvePlaybook(playbookInput || {});
  if (!playbook) {
    return {
      ok: false,
      status: 'failed',
      playbookId: String(playbookInput?.playbookId || playbookInput?.id || ''),
      steps_total: 0,
      steps_completed: 0,
      results: [],
      findingsVisited: [],
      warnings: [],
      errors: [{ reason: 'unknown_playbook' }],
      durationMs: 0
    };
  }

  const steps = Array.isArray(playbook?.steps) ? playbook.steps : [];
  const findingSource = String(playbookInput?.findingSource || options?.findingSource || 'auto').trim().toLowerCase();
  const minFindingConfidence = Number.isFinite(asNumber(playbookInput?.minFindingConfidence ?? options?.minFindingConfidence, NaN))
    ? Math.max(0, Math.min(1, asNumber(playbookInput?.minFindingConfidence ?? options?.minFindingConfidence, 0.75)))
    : 0.75;
  const results = [];
  const preflightResults = [];
  const warnings = [];
  const errors = [];
  const findingsVisited = [];
  let stepsCompleted = 0;
  let degraded = false;
  let aborted = false;
  let reportFindingPreflightDone = false;

  for (const step of steps) {
    if (!step || typeof step !== 'object') {
      results.push({ ok: false, type: 'unknown', skipped: true, unavailable: true });
      continue;
    }
    if (step.type === 'wait') {
      const ms = Math.max(0, Number(step.ms || step.duration_ms || 0) || 0);
      if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
      results.push({ ok: true, type: 'wait', ms });
      stepsCompleted += 1;
      continue;
    }
    if (step.type === 'repeat') {
      const times = Math.max(0, Math.trunc(asNumber(step.times, 0)));
      const nested = step.step || step.of || null;
      const repeatResults = [];
      let repeatOk = true;
      for (let i = 0; i < times; i += 1) {
        if (!nested || typeof nested !== 'object') {
          repeatOk = false;
          repeatResults.push({ ok: false, unavailable: true, reason: 'repeat_missing_step' });
          break;
        }
        if (nested.type === 'command' || nested.command) {
          const command = nested.command || nested.payload || {};
          try {
            const result = await dispatch(command, options);
            repeatResults.push({ ok: isOk(result), command: command.type || null, result });
          } catch (error) {
            repeatOk = false;
            repeatResults.push({ ok: false, error: summarizeError(error) });
          }
        } else {
          repeatOk = false;
          repeatResults.push({ ok: false, unavailable: true, reason: 'repeat_unsupported_nested_step' });
        }
      }
      results.push({ ok: repeatOk, type: 'repeat', times, results: repeatResults });
      if (repeatOk) {
        stepsCompleted += 1;
      } else if (step.on_error === 'continue') {
        stepsCompleted += 1;
        warnings.push({ type: 'repeat', reason: 'repeat_failed_continue' });
        degraded = true;
      } else {
        errors.push({ type: 'repeat', reason: 'repeat_failed' });
        aborted = true;
      }
      continue;
    }
    if (step.type === 'reportFinding') {
      if (!reportFindingPreflightDone) {
        reportFindingPreflightDone = true;
        const accession = String(step?.accession || playbook?.accession || options?.accession || '').trim();
        if (accession && (findingSource === 'parsed' || findingSource === 'auto')) {
          try {
            const reportRes = await dispatch({ type: 'getReport', payload: { accession } }, options);
            const parsedCount = Number(reportRes?.report?.parsedFindingsCount || 0);
            if (parsedCount <= 0) {
              const parseRes = await dispatch({
                type: 'parseReportLocal',
                payload: { accession }
              }, options);
              const preflightResult = {
                ok: !!parseRes?.ok,
                type: 'reportFindingPreflight',
                accession,
                findingSource,
                command: 'parseReportLocal',
                result: parseRes
              };
              preflightResults.push(preflightResult);
              if (!parseRes?.ok) {
                degraded = true;
                warnings.push({ type: 'reportFindingPreflight', reason: 'parse_report_local_unavailable', findingSource, accession });
                if (findingSource === 'parsed') {
                  errors.push({ type: 'reportFindingPreflight', reason: 'parsed_source_required_but_unavailable', accession });
                }
              }
            }
          } catch (error) {
            const err = summarizeError(error);
            preflightResults.push({
              ok: false,
              type: 'reportFindingPreflight',
              accession,
              findingSource,
              error: err
            });
            degraded = true;
            warnings.push({ type: 'reportFindingPreflight', reason: 'parse_report_local_exception', error: err, accession });
            if (findingSource === 'parsed') {
              errors.push({ type: 'reportFindingPreflight', reason: 'parsed_source_required_but_exception', error: err, accession });
            }
          }
        }
      }
      try {
        const reportResult = await executeReportFindingStep(runtime, dispatch, step, { ...options, findingSource, minFindingConfidence }, playbook);
        results.push(reportResult);
        if (reportResult.finding?.id) {
          findingsVisited.push({
            id: reportResult.finding.id,
            confidence: reportResult.finding.confidence ?? null,
            source: reportResult.finding.source || null
          });
        }
        if (reportResult.ok || reportResult.unavailable) stepsCompleted += 1;
        if (Array.isArray(reportResult.warnings) && reportResult.warnings.length) warnings.push(...reportResult.warnings);
        if (Array.isArray(reportResult.errors) && reportResult.errors.length) errors.push(...reportResult.errors);
        if (!reportResult.ok || reportResult.unavailable || (Array.isArray(reportResult.warnings) && reportResult.warnings.length > 0)) {
          degraded = true;
        }
      } catch (error) {
        results.push({ ok: false, type: 'reportFinding', error: summarizeError(error) });
        if (step.on_error === 'continue') {
          stepsCompleted += 1;
          warnings.push({ type: 'reportFinding', reason: 'reportFinding_failed_continue', error: summarizeError(error) });
          degraded = true;
        } else {
          errors.push({ type: 'reportFinding', error: summarizeError(error) });
          aborted = true;
        }
      }
      continue;
    }
    if (step.type === 'command' || step.command) {
      const command = step.command || step.payload || {};
      try {
        const result = await dispatch(command, options);
        const ok = isOk(result);
        const nestedStatus = normalizeNestedStatus(result, ok);
        const unavailable = !!(result?.unavailable || result?.unsupported);
        const commandStatus = ok ? (unavailable || nestedStatus === 'partial' ? 'partial' : 'success') : 'failed';
        results.push({
          ok,
          type: 'command',
          command: command.type || null,
          commandStatus,
          unavailable,
          nestedStatus,
          error: ok ? null : (result?.error || null),
          result
        });
        if (ok || result?.unavailable || result?.unsupported) {
          stepsCompleted += 1;
          if (!ok || unavailable || nestedStatus !== 'success') {
            warnings.push({ type: 'command', command: command.type || null, unavailable, nestedStatus });
            if (String(command.type || '') === 'applyHangingProtocol') {
              const hpWarnings = mapHpPartialSlotWarnings(result);
              if (hpWarnings.length) warnings.push(...hpWarnings);
            }
            degraded = true;
          }
        } else {
          errors.push({ type: 'command', command: command.type || null, result });
          if (step.on_error === 'continue') {
            stepsCompleted += 1;
            warnings.push({ type: 'command', command: command.type || null, reason: 'command_failed_continue', nestedStatus: 'failed' });
            degraded = true;
          } else {
            aborted = true;
          }
        }
      } catch (error) {
        results.push({
          ok: false,
          type: 'command',
          command: command.type || null,
          commandStatus: 'failed',
          unavailable: false,
          nestedStatus: 'failed',
          error: summarizeError(error)
        });
        if (step.on_error === 'continue') {
          stepsCompleted += 1;
          warnings.push({ type: 'command', command: command.type || null, reason: 'command_failed_continue', error: summarizeError(error) });
          degraded = true;
        } else {
          errors.push({ type: 'command', command: command.type || null, error: summarizeError(error) });
          aborted = true;
        }
      }
      continue;
    }
    results.push({ ok: false, type: step.type || 'unknown', skipped: true, unavailable: true });
    warnings.push({ type: step.type || 'unknown', reason: 'unsupported_step_type' });
    degraded = true;
  }

  const durationMs = Math.max(0, Date.now() - startedAt);
  const stepsTotal = steps.length;
  const allStepsCompleted = stepsCompleted === stepsTotal;
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const status = aborted
    ? 'failed'
    : (allStepsCompleted && !hasErrors && !hasWarnings && !degraded ? 'success' : (stepsCompleted > 0 ? 'partial' : 'failed'));
  return {
    ok: status !== 'failed',
    playbookId: playbook?.id || null,
    status,
    steps_total: stepsTotal,
    steps_completed: stepsCompleted,
    results,
    preflightResults,
    durationMs,
    findingsVisited,
    warnings,
    errors
  };
}
