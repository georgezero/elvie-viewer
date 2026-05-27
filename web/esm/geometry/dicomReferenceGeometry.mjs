const EPS = 1e-6;

function isFiniteNumber(v) {
  return Number.isFinite(Number(v));
}

function toVec3(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const x = Number(v[0]);
  const y = Number(v[1]);
  const z = Number(v[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function norm(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
  const n = norm(v);
  if (n < EPS) return null;
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function normalizeImagePlane(planeLike) {
  const origin = toVec3(planeLike?.imagePositionPatient);
  const iop = Array.isArray(planeLike?.imageOrientationPatient) ? planeLike.imageOrientationPatient : null;
  if (!origin || !iop || iop.length < 6) {
    return { ok: false, reason: 'missing_ipp_iop' };
  }

  const row = normalize(toVec3(iop.slice(0, 3)));
  const col = normalize(toVec3(iop.slice(3, 6)));
  if (!row || !col) return { ok: false, reason: 'invalid_iop_vectors' };

  const rowSpacing = Number(planeLike?.rowPixelSpacing);
  const colSpacing = Number(planeLike?.columnPixelSpacing);
  const rows = Number(planeLike?.rows);
  const columns = Number(planeLike?.columns);
  if (!isFiniteNumber(rowSpacing) || !isFiniteNumber(colSpacing) || rowSpacing <= 0 || colSpacing <= 0) {
    return { ok: false, reason: 'missing_pixel_spacing' };
  }
  if (!isFiniteNumber(rows) || !isFiniteNumber(columns) || rows < 1 || columns < 1) {
    return { ok: false, reason: 'missing_dimensions' };
  }

  const normal = normalize(cross(row, col));
  if (!normal) return { ok: false, reason: 'invalid_plane_normal' };

  return {
    ok: true,
    frameOfReferenceUID: String(planeLike?.frameOfReferenceUID || '').trim() || null,
    origin,
    row,
    col,
    normal,
    rowPixelSpacing: rowSpacing,
    columnPixelSpacing: colSpacing,
    rows,
    columns
  };
}

export function patientPointToPixel(pointLps, targetPlane) {
  const d = sub(pointLps, targetPlane.origin);
  const x = dot(d, targetPlane.row) / targetPlane.columnPixelSpacing;
  const y = dot(d, targetPlane.col) / targetPlane.rowPixelSpacing;
  return [x, y];
}

export function pixelToPatientPoint(pixel, plane) {
  return add(
    plane.origin,
    add(
      mul(plane.row, pixel[0] * plane.columnPixelSpacing),
      mul(plane.col, pixel[1] * plane.rowPixelSpacing)
    )
  );
}

export function clipLineToImageRect2D(point2D, direction2D, columns, rows) {
  const xmin = 0;
  const xmax = columns - 1;
  const ymin = 0;
  const ymax = rows - 1;
  let t0 = -Infinity;
  let t1 = Infinity;

  const p = [-direction2D[0], direction2D[0], -direction2D[1], direction2D[1]];
  const q = [point2D[0] - xmin, xmax - point2D[0], point2D[1] - ymin, ymax - point2D[1]];

  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < EPS) {
      if (q[i] < 0) return null;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }

  const a = [point2D[0] + t0 * direction2D[0], point2D[1] + t0 * direction2D[1]];
  const b = [point2D[0] + t1 * direction2D[0], point2D[1] + t1 * direction2D[1]];
  return { a, b };
}

export function computeReferenceLinePixels(sourcePlaneIn, targetPlaneIn, opts = {}) {
  const nearParallelDot = Number(opts.nearParallelDot ?? 0.999);

  const source = sourcePlaneIn?.ok ? sourcePlaneIn : normalizeImagePlane(sourcePlaneIn);
  const target = targetPlaneIn?.ok ? targetPlaneIn : normalizeImagePlane(targetPlaneIn);

  if (!source.ok) return { ok: false, reason: `source_${source.reason}` };
  if (!target.ok) return { ok: false, reason: `target_${target.reason}` };
  if (!source.frameOfReferenceUID || !target.frameOfReferenceUID) return { ok: false, reason: 'missing_frame_of_reference_uid' };
  if (source.frameOfReferenceUID !== target.frameOfReferenceUID) return { ok: false, reason: 'frame_of_reference_mismatch' };

  const nDot = Math.abs(dot(source.normal, target.normal));
  if (nDot >= nearParallelDot) return { ok: false, reason: 'near_parallel_planes', normalDot: nDot };

  // Line direction in patient space is perpendicular to both plane normals.
  const lineDir3 = normalize(cross(source.normal, target.normal));
  if (!lineDir3) return { ok: false, reason: 'invalid_intersection_direction' };

  // Intersect infinite source line with target 2D system by solving source plane equation in target pixel param.
  const w = sub(target.origin, source.origin);
  const a = dot(source.normal, mul(target.row, target.columnPixelSpacing));
  const b = dot(source.normal, mul(target.col, target.rowPixelSpacing));
  const c = -dot(source.normal, w);
  const s = [a, b];
  if (Math.hypot(s[0], s[1]) < EPS) return { ok: false, reason: 'degenerate_target_projection' };

  // One point on the line in target pixel coordinates.
  const p0 = [s[0] * c / (s[0] * s[0] + s[1] * s[1]), s[1] * c / (s[0] * s[0] + s[1] * s[1])];

  // Direction in target pixel coordinates from 3D line direction projected onto target row/col axes.
  const d2 = [
    dot(lineDir3, target.row) / target.columnPixelSpacing,
    dot(lineDir3, target.col) / target.rowPixelSpacing
  ];
  if (Math.hypot(d2[0], d2[1]) < EPS) return { ok: false, reason: 'degenerate_line_projection' };

  const clipped = clipLineToImageRect2D(p0, d2, target.columns, target.rows);
  if (!clipped) return { ok: false, reason: 'line_outside_target_image' };

  const patientA = pixelToPatientPoint(clipped.a, target);
  const patientB = pixelToPatientPoint(clipped.b, target);

  return {
    ok: true,
    source,
    target,
    normalDot: nDot,
    pixelA: clipped.a,
    pixelB: clipped.b,
    patientA,
    patientB
  };
}
