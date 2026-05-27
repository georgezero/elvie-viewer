import assert from 'node:assert/strict';
import {
  normalizeImagePlane,
  patientPointToPixel,
  pixelToPatientPoint,
  computeReferenceLinePixels
} from '../dicomReferenceGeometry.mjs';

function near(a, b, eps = 1e-5) {
  return Math.abs(a - b) <= eps;
}

function vecNear(a, b, eps = 1e-5) {
  return near(a[0], b[0], eps) && near(a[1], b[1], eps) && near(a[2], b[2], eps);
}

const axial = normalizeImagePlane({
  frameOfReferenceUID: 'FOR-1',
  imagePositionPatient: [0, 0, 0],
  imageOrientationPatient: [1, 0, 0, 0, 1, 0],
  rowPixelSpacing: 1,
  columnPixelSpacing: 1,
  rows: 100,
  columns: 100
});
assert.equal(axial.ok, true);

const sagittal = normalizeImagePlane({
  frameOfReferenceUID: 'FOR-1',
  imagePositionPatient: [50, 0, 0],
  imageOrientationPatient: [0, 1, 0, 0, 0, 1],
  rowPixelSpacing: 1,
  columnPixelSpacing: 1,
  rows: 100,
  columns: 100
});
assert.equal(sagittal.ok, true);

const line = computeReferenceLinePixels(sagittal, axial);
assert.equal(line.ok, true, line.reason);
assert(near(line.pixelA[0], 50));
assert(near(line.pixelB[0], 50));
assert(near(Math.min(line.pixelA[1], line.pixelB[1]), 0));
assert(near(Math.max(line.pixelA[1], line.pixelB[1]), 99));

const p = pixelToPatientPoint([10, 20], axial);
assert(vecNear(p, [10, 20, 0]));
const pix = patientPointToPixel(p, axial);
assert(near(pix[0], 10));
assert(near(pix[1], 20));

const mismatch = computeReferenceLinePixels(
  { ...sagittal, frameOfReferenceUID: 'FOR-2' },
  axial
);
assert.equal(mismatch.ok, false);
assert.equal(mismatch.reason, 'frame_of_reference_mismatch');

const nearParallel = computeReferenceLinePixels(axial, {
  ...axial,
  imagePositionPatient: [0, 0, 30]
});
assert.equal(nearParallel.ok, false);
assert.equal(nearParallel.reason, 'near_parallel_planes');

const missingIppIop = computeReferenceLinePixels(
  {
    frameOfReferenceUID: 'FOR-1',
    rows: 100,
    columns: 100,
    rowPixelSpacing: 1,
    columnPixelSpacing: 1
  },
  axial
);
assert.equal(missingIppIop.ok, false);
assert.equal(missingIppIop.reason, 'source_missing_ipp_iop');

const obliqueSource = normalizeImagePlane({
  frameOfReferenceUID: 'FOR-1',
  imagePositionPatient: [5, 10, -8],
  imageOrientationPatient: [0.8660254, 0.5, 0, -0.353553, 0.612372, 0.7071068],
  rowPixelSpacing: 0.8,
  columnPixelSpacing: 0.8,
  rows: 128,
  columns: 160
});
const obliqueTarget = normalizeImagePlane({
  frameOfReferenceUID: 'FOR-1',
  imagePositionPatient: [0, 0, 0],
  imageOrientationPatient: [1, 0, 0, 0, 0.9396926, 0.3420201],
  rowPixelSpacing: 0.9,
  columnPixelSpacing: 0.7,
  rows: 192,
  columns: 256
});
const obliqueLine = computeReferenceLinePixels(obliqueSource, obliqueTarget);
assert.equal(obliqueLine.ok, true, obliqueLine.reason);
for (const p of [obliqueLine.pixelA, obliqueLine.pixelB]) {
  assert(Number.isFinite(p[0]) && Number.isFinite(p[1]));
  assert(p[0] >= -1e-4 && p[0] <= obliqueTarget.columns - 1 + 1e-4);
  assert(p[1] >= -1e-4 && p[1] <= obliqueTarget.rows - 1 + 1e-4);
}

console.log('dicomReferenceGeometry tests passed');
