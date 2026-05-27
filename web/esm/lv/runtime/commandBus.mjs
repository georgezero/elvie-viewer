import {
  createLvRunCommandEnvelope,
  isSupportedLvRunCommand,
  normalizeLvRunCommandType
} from './schema.mjs';
import { getViewerStateSnapshot } from './stateSnapshot.mjs';
import { executeLvRunPlaybook, getBuiltinPlaybook, listBuiltinPlaybooks } from './playbooks.mjs';
import { resolveHangingProtocol } from './hangingProtocolResolver.mjs';
import { createCommandHistory, summarizeResult } from './commandHistory.mjs';
import { getFinding, getReport, getReportText, listFindings, listReports, upsertReportFindings } from '../findings/reportRegistry.mjs';
import { resolveFinding } from '../findings/findingResolver.mjs';
import { parseReportToFindings } from '../findings/llmReportParser.mjs';
import {
  applyHangingProtocol,
  getHangingProtocol,
  getHangingProtocolState,
  listHangingProtocols
} from './hangingProtocols.mjs';
import { createNavigationTrace } from '../report/navigationTrace.mjs';

/**
 * Translate an AgentViewerCommand `openFinding` into low-level viewer actions.
 *
 * `openFinding` uses the AgentViewerCommand envelope shape — top-level fields,
 * not wrapped in `payload` — so it is handled before the LvRun envelope path.
 *
 * @param {object} command  - The raw openFinding command from createOpenFindingCommand
 * @param {object} actionsRef - The actions object from createLvRunCommandBus
 * @param {object} runtimeRef - The runtime object (for viewer state snapshot)
 * @returns {Promise<{ok: boolean, reason?: string, operations?: object[]}>}
 */
/**
 * Resolve which pane to target for openFinding.
 *
 * Checks whether any pane already has the target series loaded (via a prior
 * hanging protocol or playbook). If so, routes to that pane; otherwise falls
 * back to the viewer's active pane.
 *
 * @param {number|null} seriesNumber
 * @param {object} snapshot - From getViewerStateSnapshot
 * @returns {{ targetPaneId: number, playbookApplied: boolean }}
 */
function resolveTargetPane(seriesNumber, snapshot) {
  const activePaneId = snapshot?.viewer?.activePaneId ?? 0;
  if (seriesNumber != null && Number.isFinite(Number(seriesNumber))) {
    const target = Number(seriesNumber);
    const panes = Array.isArray(snapshot?.panes) ? snapshot.panes : [];
    const match = panes.find((p) => Number.isFinite(Number(p.seriesNumber)) && Number(p.seriesNumber) === target);
    if (match != null) {
      return { targetPaneId: match.paneId, playbookApplied: true };
    }
  }
  return { targetPaneId: activePaneId, playbookApplied: false };
}

async function executeOpenFinding(command, actionsRef, runtimeRef, traceOverrides = {}) {
  const accession   = command?.accession  ?? null;
  const findingId   = command?.findingId  ?? null;
  const viewPreset  = command?.viewPreset ?? null;

  const imageRef = command?.imageReference;
  if (!imageRef) {
    const trace = createNavigationTrace({ commandType: 'openFinding', accession, findingId, ok: false, reason: 'openFinding: missing imageReference', ...traceOverrides });
    return { ok: false, reason: 'openFinding: missing imageReference', trace };
  }
  if (imageRef.type !== 'series-image') {
    const reason = `openFinding: unsupported imageReference type '${imageRef.type}'`;
    const trace = createNavigationTrace({ commandType: 'openFinding', accession, findingId, ok: false, reason, ...traceOverrides });
    return { ok: false, reason, trace };
  }

  const seriesNumber = imageRef.seriesNumber;
  const imageNumber = imageRef.imageNumber;

  if (seriesNumber == null && imageNumber == null) {
    const reason = 'openFinding: imageReference has no seriesNumber or imageNumber';
    const trace = createNavigationTrace({ commandType: 'openFinding', accession, findingId, ok: false, reason, ...traceOverrides });
    return { ok: false, reason, trace };
  }

  const snapshot = getViewerStateSnapshot(runtimeRef);
  const { targetPaneId, playbookApplied } = resolveTargetPane(seriesNumber, snapshot);

  const operations = [];

  if (seriesNumber != null && Number.isFinite(Number(seriesNumber))) {
    if (typeof actionsRef.loadSeriesInPane !== 'function') {
      const op = { op: 'loadSeriesInPane', paneId: targetPaneId, seriesNumber, result: { ok: false, unsupported: true } };
      const reason = 'loadSeriesInPane action not available';
      const trace = createNavigationTrace({ commandType: 'openFinding', accession, findingId, ok: false, reason, operations: [op], playbookApplied, targetPaneId, seriesNumber, imageNumber: imageNumber ?? null, ...traceOverrides });
      return { ok: false, reason, operations: [op], playbookApplied, targetPaneId, seriesNumber, imageNumber: imageNumber ?? null, trace };
    }
    const result = await actionsRef.loadSeriesInPane(targetPaneId, { seriesNumber: Number(seriesNumber) });
    operations.push({ op: 'loadSeriesInPane', paneId: targetPaneId, seriesNumber, result });
    if (result?.ok === false) {
      const reason = result.reason || 'loadSeriesInPane failed';
      const trace = createNavigationTrace({ commandType: 'openFinding', accession, findingId, ok: false, reason, operations, playbookApplied, viewPresetApplied: false, targetPaneId, seriesNumber, imageNumber: imageNumber ?? null, ...traceOverrides });
      return { ok: false, reason, operations, playbookApplied, viewPresetApplied: false, targetPaneId, seriesNumber, imageNumber: imageNumber ?? null, trace };
    }
  }

  // Apply WL preset after series load, before scroll.
  // Failure is non-fatal: viewPresetApplied:false but navigation continues.
  let viewPresetApplied = false;
  if (viewPreset?.type === 'ct-window' && typeof actionsRef.applyViewPreset === 'function') {
    const presetResult = await actionsRef.applyViewPreset(targetPaneId, viewPreset);
    operations.push({ op: 'applyViewPreset', paneId: targetPaneId, viewPreset, result: presetResult });
    viewPresetApplied = presetResult?.ok !== false;
  }

  if (imageNumber != null && Number.isFinite(Number(imageNumber))) {
    if (typeof actionsRef.scrollPaneToImageNumber === 'function') {
      const result = await actionsRef.scrollPaneToImageNumber(targetPaneId, imageNumber);
      operations.push({ op: 'scrollPaneToImageNumber', paneId: targetPaneId, imageNumber, result });
      if (result?.ok === false) {
        const reason = result.reason || 'scrollPaneToImageNumber failed';
        const trace = createNavigationTrace({ commandType: 'openFinding', accession, findingId, ok: false, reason, operations, playbookApplied, viewPresetApplied, targetPaneId, seriesNumber: seriesNumber ?? null, imageNumber, ...traceOverrides });
        return { ok: false, reason, operations, playbookApplied, viewPresetApplied, targetPaneId, seriesNumber: seriesNumber ?? null, imageNumber, trace };
      }
    } else {
      const imageIndex = Math.max(0, Math.trunc(Number(imageNumber)) - 1);
      if (typeof actionsRef.scrollPaneToIndex !== 'function') {
        const op = { op: 'scrollPaneToIndex', paneId: targetPaneId, imageIndex, result: { ok: false, unsupported: true } };
        const reason = 'scrollPaneToIndex action not available';
        const trace = createNavigationTrace({ commandType: 'openFinding', accession, findingId, ok: false, reason, operations: [...operations, op], playbookApplied, targetPaneId, seriesNumber: seriesNumber ?? null, imageNumber, ...traceOverrides });
        return { ok: false, reason, operations: [...operations, op], playbookApplied, targetPaneId, seriesNumber: seriesNumber ?? null, imageNumber, trace };
      }
      const result = await actionsRef.scrollPaneToIndex(targetPaneId, imageIndex);
      operations.push({ op: 'scrollPaneToIndex', paneId: targetPaneId, imageIndex, result });
      if (result?.ok === false) {
        const reason = result.reason || 'scrollPaneToIndex failed';
        const trace = createNavigationTrace({ commandType: 'openFinding', accession, findingId, ok: false, reason, operations, playbookApplied, viewPresetApplied, targetPaneId, seriesNumber: seriesNumber ?? null, imageNumber, ...traceOverrides });
        return { ok: false, reason, operations, playbookApplied, viewPresetApplied, targetPaneId, seriesNumber: seriesNumber ?? null, imageNumber, trace };
      }
    }
  }

  const trace = createNavigationTrace({ commandType: 'openFinding', accession, findingId, ok: true, operations, playbookApplied, viewPresetApplied, targetPaneId, seriesNumber: seriesNumber ?? null, imageNumber: imageNumber ?? null, ...traceOverrides });
  return { ok: true, operations, playbookApplied, viewPresetApplied, targetPaneId, seriesNumber: seriesNumber ?? null, imageNumber: imageNumber ?? null, trace };
}


/**
 * Orchestration handler for `openStudyThenFinding`.
 *
 * Primary path (when navigateToFindingFull action is available — native viewer):
 *   Puts the target series in the top-left pane (pane 0) and fills remaining
 *   panes with non-scout series in series-number order. Matches old demo behavior.
 *   Skips this path if the target series is already in a pane (uses resolveTargetPane
 *   instead, to preserve pane routing after the layout is established).
 *
 * Fallback path (navigateToFindingFull unavailable OR target already in a pane):
 *   1. If study not loaded: loads catalog + applies HP for layout/slot initialization.
 *   2. Delegates to executeOpenFinding for pane routing and scroll.
 *
 * @param {object} command
 * @param {object} actionsRef
 * @param {object} runtimeRef
 * @param {Function} dispatchViewerCommand - For HP application
 * @returns {Promise<object>}
 */
async function executeOpenStudyThenFinding(command, actionsRef, runtimeRef, dispatchViewerCommand) {
  const accession = command?.accession ?? null;
  const findingId = command?.findingId ?? null;

  const imageRef = command?.imageReference;
  if (!imageRef) {
    const reason = 'openStudyThenFinding: missing imageReference';
    const trace = createNavigationTrace({ commandType: 'openStudyThenFinding', accession, findingId, ok: false, reason });
    return { ok: false, reason, trace };
  }
  if (imageRef.type !== 'series-image') {
    const reason = `openStudyThenFinding: unsupported imageReference type '${imageRef.type}'`;
    const trace = createNavigationTrace({ commandType: 'openStudyThenFinding', accession, findingId, ok: false, reason });
    return { ok: false, reason, trace };
  }

  const snapshot = getViewerStateSnapshot(runtimeRef);
  const studyLoaded = Array.isArray(snapshot.seriesCatalog) && snapshot.seriesCatalog.length > 0;

  let studyOpened = false;
  let hpApplied = false;

  if (!studyLoaded) {
    studyOpened = true;

    // Load the study catalog. skipDefaultLoad=true prevents a racing navToFinding
    // from starting while the HP or navigateToFindingFull is about to set up the viewer.
    if (typeof actionsRef.loadStudyByAccession === 'function' && accession) {
      const loadResult = await actionsRef.loadStudyByAccession(accession);
      if (!loadResult?.ok) {
        const reason = loadResult?.reason || 'study_not_found_or_not_loaded';
        const trace = createNavigationTrace({ commandType: 'openStudyThenFinding', accession, findingId, ok: false, reason, studyOpened });
        return { ok: false, reason, studyOpened, playbookApplied: false, trace };
      }
    }
  }

  // ── Primary path: navigateToFindingFull ────────────────────────────────────
  // Put target in pane 0 (TL), fill remaining panes with non-scout series in
  // series-number order. Skip if target is already in a pane so subsequent finding
  // clicks use resolveTargetPane to route to the pre-assigned pane.
  const seriesNumber = imageRef.seriesNumber;
  const snapshotForPaneCheck = getViewerStateSnapshot(runtimeRef);
  // Only skip navigateToFindingFull if the target series is already in TL (pane 0).
  // If it's in any other pane, re-run the full layout so target is always in TL.
  const targetAlreadyInPane = seriesNumber != null && Number.isFinite(Number(seriesNumber))
    && Array.isArray(snapshotForPaneCheck.panes)
    && snapshotForPaneCheck.panes.some(
        (p) => Number.isFinite(Number(p.seriesNumber)) && Number(p.seriesNumber) === Number(seriesNumber)
          && Number(p.paneId) === 0
      );

  if (typeof actionsRef.navigateToFindingFull === 'function' && !targetAlreadyInPane) {
    // Resolve HP to get the intended layout (e.g. '2x2' for mr-knee).
    const hpResolution = resolveHangingProtocol({ accession });
    const hpProto = hpResolution.ok ? getHangingProtocol(hpResolution.protocolId) : null;
    const targetLayout = hpProto?.layout || null;

    const navResult = await actionsRef.navigateToFindingFull({
      seriesNumber: imageRef.seriesNumber,
      imageNumber: imageRef.imageNumber,
      seriesDescription: imageRef.seriesDescription ?? null,
      viewPreset: command.viewPreset ?? null,
      layout: targetLayout
    });

    hpApplied = true; // navigateToFindingFull serves as layout initialization

    // Belt-and-suspenders: scroll pane 0 to the exact image after grid render.
    // navigateToFindingFull calls setStack(imageIds, index) which sets the initial
    // position, but a subsequent scrollPaneToIndex ensures the correct image is
    // visible even if a non-target pane timed out and interrupted the flow.
    const targetPaneId = navResult?.targetPaneId ?? 0;
    if (imageRef.imageNumber != null && Number.isFinite(Number(imageRef.imageNumber))) {
      if (typeof actionsRef.scrollPaneToImageNumber === 'function') {
        try { await actionsRef.scrollPaneToImageNumber(targetPaneId, imageRef.imageNumber); } catch {}
      } else if (typeof actionsRef.scrollPaneToIndex === 'function') {
        const scrollIdx = Math.max(0, Math.trunc(Number(imageRef.imageNumber)) - 1);
        try { await actionsRef.scrollPaneToIndex(targetPaneId, scrollIdx); } catch {}
      }
    }

    const navOk = navResult?.ok !== false;
    const trace = createNavigationTrace({
      commandType: 'openStudyThenFinding',
      accession,
      findingId,
      studyOpened,
      playbookApplied: hpApplied,
      targetPaneId,
      seriesNumber: navResult?.seriesNumber ?? (seriesNumber ?? null),
      imageNumber: imageRef.imageNumber ?? null,
      operations: navResult?.operations || [],
      ok: navOk,
      ...(navOk === false && { reason: navResult?.reason })
    });

    return {
      ok: navOk,
      studyOpened,
      playbookApplied: hpApplied,
      targetPaneId,
      seriesNumber: navResult?.seriesNumber ?? (seriesNumber ?? null),
      imageNumber: imageRef.imageNumber ?? null,
      operations: navResult?.operations || [],
      trace,
      ...(navOk === false && { reason: navResult?.reason })
    };
  }

  // ── Fallback path: HP + resolveTargetPane ─────────────────────────────────
  // Used when navigateToFindingFull is unavailable (non-native viewer) or when
  // the target series is already in a pane (pane routing is already established).
  if (!studyLoaded) {
    const hpResolution = resolveHangingProtocol({ accession });
    if (hpResolution.ok) {
      await dispatchViewerCommand({ type: 'applyHangingProtocol', payload: { protocolId: hpResolution.protocolId } });
      hpApplied = true;
    }
  }

  const findingCommand = {
    type: 'openFinding',
    accession,
    findingId,
    imageReference: command.imageReference,
    viewPreset: command.viewPreset ?? null
  };
  const traceOverrides = { commandType: 'openStudyThenFinding', studyOpened };
  const findingResult = await executeOpenFinding(findingCommand, actionsRef, runtimeRef, traceOverrides);

  const playbookApplied = hpApplied || !!findingResult.playbookApplied;
  const trace = createNavigationTrace({
    commandType: 'openStudyThenFinding',
    accession,
    findingId,
    studyOpened,
    playbookApplied,
    targetPaneId: findingResult.targetPaneId ?? null,
    seriesNumber: findingResult.seriesNumber ?? null,
    imageNumber: findingResult.imageNumber ?? null,
    operations: findingResult.operations,
    ok: findingResult.ok,
    ...(findingResult.ok === false && { reason: findingResult.reason })
  });

  return {
    ok: findingResult.ok,
    studyOpened,
    playbookApplied,
    targetPaneId: findingResult.targetPaneId ?? null,
    seriesNumber: findingResult.seriesNumber ?? null,
    imageNumber: findingResult.imageNumber ?? null,
    operations: findingResult.operations,
    trace,
    ...(findingResult.ok === false && { reason: findingResult.reason })
  };
}

function asFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function classifyStatus(result) {
  if (result && typeof result === 'object') {
    if (result.status === 'failed' || result.ok === false) return 'failed';
    if (result.status === 'partial' || result.partial === true) return 'partial';
  }
  return 'success';
}

export function createLvRunCommandBus({ actions, runtime = {} } = {}) {
  if (!actions) throw new Error('createLvRunCommandBus requires actions');

  const lvRunState = {
    hangingProtocol: {
      activeProtocolId: null,
      lastAppliedAt: null,
      lastStatus: null,
      lastResult: null
    },
    playbookHistory: [],
    commandHistory: createCommandHistory(200)
  };

  function pushPlaybookHistory(entry) {
    lvRunState.playbookHistory.push(entry);
    if (lvRunState.playbookHistory.length > 100) {
      lvRunState.playbookHistory.splice(0, lvRunState.playbookHistory.length - 100);
    }
  }

  async function executeCanonical(type, payload, options = {}) {
    switch (type) {
      case 'getViewerState':
        return { ok: true, state: getViewerStateSnapshot(runtime) };
      case 'getSeriesCatalog':
        return { ok: true, seriesCatalog: getViewerStateSnapshot(runtime).seriesCatalog };
      case 'getViewportCatalog':
        return { ok: true, viewportCatalog: getViewerStateSnapshot(runtime).panes };
      case 'getWindowLevelPresets':
        return { ok: true, windowLevelPresets: getViewerStateSnapshot(runtime).windowLevelPresets };
      case 'getCommandHistory':
        return { ok: true, history: lvRunState.commandHistory.list() };
      case 'parseReport': {
        const accession = String(payload.accession || '').trim();
        const reportText = String(payload.reportText || getReportText(accession) || '');
        const parseResult = await parseReportToFindings(reportText, payload.options || {});
        if (!parseResult?.ok) return parseResult;
        if (accession) {
          upsertReportFindings(accession, parseResult.findings, {
            provider: parseResult.provider,
            schemaVersion: parseResult.schemaVersion,
            model: parseResult.model,
            negativeFindings: parseResult.negativeFindings || []
          }, 'parsed');
        }
        return { ok: true, accession: accession || null, ...parseResult };
      }
      case 'parseReportLocal': {
        const accession = String(payload.accession || '').trim();
        const reportText = String(payload.reportText || getReportText(accession) || '');
        const localOptions = { provider: 'local' };
        if (Object.prototype.hasOwnProperty.call(payload, 'endpoint')) localOptions.endpoint = payload.endpoint;
        if (Object.prototype.hasOwnProperty.call(payload, 'model')) localOptions.model = payload.model;
        if (Object.prototype.hasOwnProperty.call(payload, 'timeoutMs')) localOptions.timeoutMs = payload.timeoutMs;
        if (Object.prototype.hasOwnProperty.call(payload, 'strict')) localOptions.strict = !!payload.strict;
        const parseResult = await parseReportToFindings(reportText, {
          ...localOptions
        });
        if (!parseResult?.ok) return parseResult;
        const includeNegative = !!payload.includeNegative;
        const findings = Array.isArray(parseResult.findings) ? parseResult.findings : [];
        const negativeFindings = Array.isArray(parseResult.negativeFindings) ? parseResult.negativeFindings : [];
        const mergedFindings = includeNegative ? [...findings, ...negativeFindings] : findings;
        if (accession) {
          upsertReportFindings(accession, findings, {
            provider: parseResult.provider,
            schemaVersion: parseResult.schemaVersion,
            model: parseResult.model,
            negativeFindings
          }, 'parsed');
        }
        return {
          ok: true,
          accession: accession || null,
          ...parseResult,
          findings: mergedFindings,
          negativeFindings,
          includeNegative
        };
      }
      case 'upsertFindings': {
        const accession = String(payload.accession || '').trim();
        const source = String(payload.source || 'user').trim().toLowerCase();
        return upsertReportFindings(accession, payload.findings || [], payload.provenance || null, source);
      }
      case 'listReports':
        return { ok: true, reports: listReports() };
      case 'getReport': {
        const report = getReport(payload.accession);
        if (!report) return { ok: false, unavailable: true, reason: 'report_not_found' };
        return { ok: true, report };
      }
      case 'listFindings':
        return { ok: true, findings: listFindings(payload.accession) };
      case 'getFinding': {
        const finding = getFinding({ accession: payload.accession, findingId: payload.findingId });
        if (!finding) return { ok: false, unavailable: true, reason: 'finding_not_found' };
        return { ok: true, finding };
      }
      case 'resolveFinding':
        return resolveFinding(payload);
      case 'listHangingProtocols':
        return { ok: true, protocols: listHangingProtocols() };
      case 'listPlaybooks':
        return { ok: true, playbooks: listBuiltinPlaybooks() };
      case 'getPlaybook': {
        const playbook = getBuiltinPlaybook(payload.playbookId || payload.id);
        if (!playbook) return { ok: false, unavailable: true, reason: 'playbook_not_found' };
        return { ok: true, playbook };
      }
      case 'getPlaybookHistory':
        return { ok: true, history: lvRunState.playbookHistory.slice() };
      case 'getHangingProtocolState':
        return {
          ok: true,
          state: getHangingProtocolState({
            getViewerStateSnapshot: () => getViewerStateSnapshot(runtime),
            hangingProtocolState: lvRunState.hangingProtocol
          })
        };

      case 'setLayout': return actions.setLayout(payload.layoutId);
      case 'loadView': return actions.setLayout(payload.layoutId || payload.viewId);

      case 'setActivePane': return actions.setActivePane(payload.paneId);
      case 'scrollPaneBy': return actions.scrollPaneBy(payload.paneId, payload.delta);
      case 'scrollPaneToIndex': return actions.scrollPaneToIndex(payload.paneId, payload.imageIndex);
      case 'scrollPaneToImageNumber':
        if (typeof actions.scrollPaneToImageNumber === 'function') {
          return actions.scrollPaneToImageNumber(payload.paneId, payload.imageNumber);
        }
        return actions.scrollPaneToIndex(payload.paneId, Math.max(0, Math.trunc(asFiniteNumber(payload.imageNumber, 1)) - 1));
      case 'scrollPaneToPatientPoint': return actions.scrollPaneToPatientPoint(payload.paneId, payload.pointMm);
      case 'jumpToFinding': return actions.jumpToFinding(payload.findingId);
      case 'loadSeriesInPane':
        if (typeof actions.loadSeriesInPane !== 'function') return { ok: false, unsupported: true };
        return actions.loadSeriesInPane(payload.paneId, payload);
      case 'replayFindingPreview':
        if (typeof actions.replayFindingPreview !== 'function') return { ok: false, unsupported: true };
        return actions.replayFindingPreview(payload.findingId);

      case 'setWindowPreset': return actions.setWindowPreset(payload.paneId, payload.presetId);
      case 'setWindowLevel':
        if (typeof actions.setWindowLevel !== 'function') return { ok: false, unsupported: true };
        return actions.setWindowLevel(payload.paneId, payload.windowWidth, payload.windowCenter);
      case 'zoomPane':
        if (typeof actions.zoomPane !== 'function') return { ok: false, unsupported: true };
        return actions.zoomPane(payload.paneId, payload.zoomDelta);
      case 'panPane':
        if (typeof actions.panPane !== 'function') return { ok: false, unsupported: true };
        return actions.panPane(payload.paneId, payload.dx, payload.dy);
      case 'resetPaneCamera': return actions.resetPaneCamera(payload.paneId);
      case 'resetViewer': return actions.resetViewer();
      case 'cinePane':
        if (typeof actions.cinePane !== 'function') return { ok: false, unsupported: true };
        return actions.cinePane(payload.paneId, payload.mode, payload.fps);

      case 'setLinkedScrollEnabled':
        if (typeof actions.setLinkedScrollEnabled !== 'function') return { ok: false, unsupported: true };
        return actions.setLinkedScrollEnabled(payload.enabled);
      case 'setReferenceLinesEnabled':
        if (typeof actions.setReferenceLinesEnabled !== 'function') return { ok: false, unsupported: true };
        return actions.setReferenceLinesEnabled(payload.enabled);
      case 'setCrosshairEnabled': return actions.setCrosshairEnabled(payload.enabled);
      case 'toggleCrosshairEnabled':
        if (typeof actions.toggleCrosshairEnabled !== 'function') return { ok: false, unsupported: true };
        return actions.toggleCrosshairEnabled();
      case 'syncPanesToPoint': return actions.syncPanesToPoint(payload.sourcePaneId, payload.pointMm);
      case 'executePlaybook': {
        const result = await executeLvRunPlaybook({ ...runtime, dispatchViewerCommand }, payload.playbook || payload, options);
        pushPlaybookHistory({
          timestamp: Date.now(),
          playbookId: result?.playbookId || String(payload?.playbookId || payload?.id || ''),
          status: result?.status || (result?.ok ? 'success' : 'failed'),
          steps_total: Number(result?.steps_total || 0),
          steps_completed: Number(result?.steps_completed || 0),
          findingsVisited: Array.isArray(result?.findingsVisited) ? result.findingsVisited : [],
          warnings: Array.isArray(result?.warnings) ? result.warnings : [],
          errors: Array.isArray(result?.errors) ? result.errors : [],
          results: Array.isArray(result?.results) ? result.results : []
        });
        return result;
      }
      case 'applyHangingProtocol': {
        const result = await applyHangingProtocol(
          {
            dispatchViewerCommand,
            getViewerStateSnapshot: () => getViewerStateSnapshot(runtime)
          },
          payload
        );
        lvRunState.hangingProtocol.activeProtocolId = result?.protocolId || null;
        lvRunState.hangingProtocol.lastAppliedAt = result?.completedAt || Date.now();
        lvRunState.hangingProtocol.lastStatus = result?.status || (result?.ok ? 'success' : 'failed');
        lvRunState.hangingProtocol.lastResult = result || null;
        lvRunState.hangingProtocol.lastErrors = Array.isArray(result?.errors) ? result.errors : [];
        lvRunState.hangingProtocol.lastWarnings = Array.isArray(result?.warnings) ? result.warnings : [];
        return result;
      }
      default:
        if (!isSupportedLvRunCommand(type)) {
          throw new Error(`Unknown LV Run command: ${type || '(empty)'}`);
        }
        return { ok: false, unsupported: true, type };
    }
  }

  async function dispatchViewerCommand(command = {}, options = {}) {
    const started = Date.now();

    // AgentViewerCommand types use a different envelope shape (top-level fields,
    // no `payload` wrapper). Handle them before the LvRun envelope normalization.
    if (command?.type === 'openFinding') {
      const result = await executeOpenFinding(command, actions, runtime);
      lvRunState.commandHistory.push({
        timestamp: started,
        originalCommand: 'openFinding',
        canonicalCommand: 'openFinding',
        payload: { findingId: command.findingId, accession: command.accession, imageReference: command.imageReference },
        status: classifyStatus(result),
        durationMs: Date.now() - started,
        unavailable: false,
        error: result?.ok === false ? (result.reason || null) : null,
        resultSummary: summarizeResult(result)
      });
      return result;
    }

    if (command?.type === 'openStudyThenFinding') {
      const result = await executeOpenStudyThenFinding(command, actions, runtime, dispatchViewerCommand);
      lvRunState.commandHistory.push({
        timestamp: started,
        originalCommand: 'openStudyThenFinding',
        canonicalCommand: 'openStudyThenFinding',
        payload: { findingId: command.findingId, accession: command.accession, studyInstanceUID: command.studyInstanceUID ?? null, imageReference: command.imageReference },
        status: classifyStatus(result),
        durationMs: Date.now() - started,
        unavailable: false,
        error: result?.ok === false ? (result.reason || null) : null,
        resultSummary: summarizeResult(result)
      });
      return result;
    }

    const envelope = createLvRunCommandEnvelope(command, options?.defaults || {});
    const type = normalizeLvRunCommandType(envelope.type);
    const payload = envelope.payload || {};

    try {
      const result = await executeCanonical(type, payload, options);
      lvRunState.commandHistory.push({
        timestamp: started,
        originalCommand: String(command?.type || ''),
        canonicalCommand: type,
        payload,
        status: classifyStatus(result),
        durationMs: Date.now() - started,
        unavailable: !!(result && typeof result === 'object' && (result.unavailable || result.unsupported)),
        error: result && typeof result === 'object' ? (result.error || null) : null,
        resultSummary: summarizeResult(result)
      });
      return result;
    } catch (error) {
      lvRunState.commandHistory.push({
        timestamp: started,
        originalCommand: String(command?.type || ''),
        canonicalCommand: type,
        payload,
        status: 'failed',
        durationMs: Date.now() - started,
        unavailable: false,
        error: String(error?.message || error),
        resultSummary: null
      });
      throw error;
    }
  }

  return {
    dispatchViewerCommand
  };
}
