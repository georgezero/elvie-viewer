import assert from 'node:assert/strict';
import { createReportTour } from '../reportTourCommands.mjs';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NAV_A = {
  id: 'nav-a', label: 'Finding A',
  navigationStatus: 'navigable', seriesNumber: 2, imageNumber: 21,
  severity: 'abnormal', confidence: 0.95
};
const NAV_B = {
  id: 'nav-b', label: 'Finding B',
  navigationStatus: 'navigable', seriesNumber: 3, imageNumber: 14,
  severity: 'abnormal', confidence: 0.80
};
const NAV_C = {
  id: 'nav-c', label: 'Finding C',
  navigationStatus: 'navigable', seriesNumber: 6, imageNumber: 5,
  severity: 'chronic', confidence: 0.70
};
const NEGATIVE = {
  id: 'neg-a', label: 'No hemorrhage',
  navigationStatus: 'negative', seriesNumber: null, imageNumber: null,
  severity: 'negative', confidence: 0.95
};
const NON_NAV = {
  id: 'non-nav', label: 'Report only',
  navigationStatus: 'non_navigable', seriesNumber: null, imageNumber: null,
  severity: 'mild', confidence: 0.60
};

function makeTour(findings = [NAV_A, NAV_B, NAV_C]) {
  const dispatched = [];
  const mockProvider = {
    async navigateToFinding(f) {
      dispatched.push(f);
      return { ok: true, seriesNumber: f.seriesNumber, imageNumber: f.imageNumber };
    }
  };
  const tour = createReportTour({
    getFindings: () => findings,
    getProvider: () => mockProvider
  });
  return { tour, dispatched };
}

// ── T1: getReportTourStatus before start → active:false ───────────────────────

{
  const { tour } = makeTour();
  const status = tour.getReportTourStatus();
  assert.equal(status.active, false);
  assert.equal(status.index, -1);
  assert.equal(status.total, 0);
  assert.equal(status.currentFindingId, null);
  assert.equal(status.hasNext, false);
  assert.equal(status.hasPrevious, false);
}

// ── T2: startReportTour returns status with navigable total ───────────────────

{
  const { tour } = makeTour([NAV_A, NAV_B, NEGATIVE, NON_NAV]);
  const status = tour.startReportTour();
  assert.equal(status.active, true);
  assert.equal(status.total, 2, 'should include only navigable findings');
  assert.equal(status.index, -1);
  assert.equal(status.currentFindingId, null);
  assert.equal(status.hasNext, true);
  assert.equal(status.hasPrevious, false);
}

// ── T3: startReportTour with empty findings → active:true, total:0 ────────────

{
  const { tour } = makeTour([]);
  const status = tour.startReportTour();
  assert.equal(status.active, true);
  assert.equal(status.total, 0);
  assert.equal(status.hasNext, false);
}

// ── T4: startReportTour with no findings supplier → total:0 ──────────────────

{
  const tour = createReportTour({});
  const status = tour.startReportTour();
  assert.equal(status.active, true);
  assert.equal(status.total, 0);
}

// ── T5: nextReportFinding advances and returns findings in order ──────────────

{
  const { tour } = makeTour();
  tour.startReportTour();
  const f1 = tour.nextReportFinding();
  assert.equal(f1.id, 'nav-a');
  const f2 = tour.nextReportFinding();
  assert.equal(f2.id, 'nav-b');
  const f3 = tour.nextReportFinding();
  assert.equal(f3.id, 'nav-c');
  const f4 = tour.nextReportFinding();
  assert.equal(f4, null, 'null at end');
}

// ── T6: nextReportFinding before startReportTour returns null ─────────────────

{
  const { tour } = makeTour();
  assert.equal(tour.nextReportFinding(), null);
}

// ── T7: previousReportFinding retreats in order ───────────────────────────────

{
  const { tour } = makeTour();
  tour.startReportTour();
  tour.nextReportFinding(); // A
  tour.nextReportFinding(); // B
  tour.nextReportFinding(); // C
  const p1 = tour.previousReportFinding();
  assert.equal(p1.id, 'nav-b');
  const p2 = tour.previousReportFinding();
  assert.equal(p2.id, 'nav-a');
  const p3 = tour.previousReportFinding();
  assert.equal(p3, null, 'null before start');
}

// ── T8: previousReportFinding before startReportTour returns null ─────────────

{
  const { tour } = makeTour();
  assert.equal(tour.previousReportFinding(), null);
}

// ── T9: getReportTourStatus tracks index through tour ─────────────────────────

{
  const { tour } = makeTour([NAV_A, NAV_B]);
  tour.startReportTour();

  const s0 = tour.getReportTourStatus();
  assert.equal(s0.active, true);
  assert.equal(s0.index, -1);
  assert.equal(s0.currentFindingId, null);

  tour.nextReportFinding();
  const s1 = tour.getReportTourStatus();
  assert.equal(s1.index, 0);
  assert.equal(s1.currentFindingId, 'nav-a');
  assert.equal(s1.hasNext, true);
  assert.equal(s1.hasPrevious, false);

  tour.nextReportFinding();
  const s2 = tour.getReportTourStatus();
  assert.equal(s2.index, 1);
  assert.equal(s2.currentFindingId, 'nav-b');
  assert.equal(s2.hasNext, false);
  assert.equal(s2.hasPrevious, true);
}

// ── T10: openCurrentReportFinding before start → no_active_tour ──────────────

{
  const { tour } = makeTour();
  const result = await tour.openCurrentReportFinding();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_active_tour');
}

// ── T11: openCurrentReportFinding with no current finding → no_current_finding

{
  const { tour } = makeTour();
  tour.startReportTour(); // cursor=-1, no nextReportFinding yet
  const result = await tour.openCurrentReportFinding();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_current_finding');
}

// ── T12: openCurrentReportFinding delegates to provider ──────────────────────

{
  const { tour, dispatched } = makeTour();
  tour.startReportTour();
  tour.nextReportFinding(); // nav-a
  const result = await tour.openCurrentReportFinding();
  assert.equal(result.ok, true);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].id, 'nav-a');
}

// ── T13: openCurrentReportFinding does not advance cursor ────────────────────

{
  const { tour } = makeTour();
  tour.startReportTour();
  tour.nextReportFinding(); // nav-a (index=0)
  await tour.openCurrentReportFinding();
  await tour.openCurrentReportFinding();
  const status = tour.getReportTourStatus();
  assert.equal(status.index, 0, 'cursor should not advance from openCurrentReportFinding');
  assert.equal(status.currentFindingId, 'nav-a');
}

// ── T14: openCurrentReportFinding with no provider → no_provider ─────────────

{
  const tour = createReportTour({ getFindings: () => [NAV_A] });
  tour.startReportTour();
  tour.nextReportFinding();
  const result = await tour.openCurrentReportFinding();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_provider');
}

// ── T15: endReportTour resets to inactive ────────────────────────────────────

{
  const { tour } = makeTour();
  tour.startReportTour();
  tour.nextReportFinding();
  const endResult = tour.endReportTour();
  assert.equal(endResult.active, false);

  const status = tour.getReportTourStatus();
  assert.equal(status.active, false);
  assert.equal(status.total, 0);
  assert.equal(status.currentFindingId, null);
}

// ── T16: endReportTour then nextReportFinding returns null ────────────────────

{
  const { tour } = makeTour();
  tour.startReportTour();
  tour.endReportTour();
  assert.equal(tour.nextReportFinding(), null);
}

// ── T17: startReportTour restarts over existing session ──────────────────────

{
  const { tour } = makeTour([NAV_A, NAV_B]);
  tour.startReportTour();
  tour.nextReportFinding(); // advance
  tour.startReportTour();   // restart
  const status = tour.getReportTourStatus();
  assert.equal(status.index, -1, 'restart should reset cursor');
  assert.equal(status.total, 2);
}

// ── T18: options passed through to session filter ────────────────────────────

{
  const findings = [NAV_A, NAV_B, NAV_C];
  const tour = createReportTour({ getFindings: () => findings });
  tour.startReportTour({ minConfidence: 0.85 });
  const status = tour.getReportTourStatus();
  assert.equal(status.total, 1, 'minConfidence:0.85 should include only NAV_A (0.95)');
}

// ── T19: full demo flow ───────────────────────────────────────────────────────

{
  const { tour, dispatched } = makeTour([NAV_A, NAV_B]);

  tour.startReportTour();
  assert.equal(tour.getReportTourStatus().total, 2);

  const f1 = tour.nextReportFinding();
  assert.equal(f1.id, 'nav-a');
  await tour.openCurrentReportFinding();

  const f2 = tour.nextReportFinding();
  assert.equal(f2.id, 'nav-b');
  await tour.openCurrentReportFinding();

  assert.equal(tour.nextReportFinding(), null);
  assert.deepEqual(dispatched.map((d) => d.id), ['nav-a', 'nav-b']);

  tour.endReportTour();
  assert.equal(tour.getReportTourStatus().active, false);
}

console.log('reportTourCommands: all tests passed');
