import assert from 'node:assert/strict';
import fs from 'node:fs';

const htmlPath = new URL('../../../..//examples/agentv.html', import.meta.url);
const src = fs.readFileSync(htmlPath, 'utf8');

const fnStart = src.indexOf('function updateNativeReferenceLines()');
assert(fnStart >= 0, 'updateNativeReferenceLines function missing');
const fnBody = src.slice(fnStart, src.indexOf('\n}\n\nfunction updateNativeSeriesSelect', fnStart));

assert(fnBody.includes('if (csState.usingBuiltInReferenceLines)'), 'built-in tools preference branch missing');
assert(fnBody.includes('geom.computeReferenceLinePixels('), 'geometry fallback does not call computeReferenceLinePixels');
assert(fnBody.includes('worldToCanvas'), 'fallback must project to canvas coordinates');
assert(fnBody.includes('resetNativeReflineStyle('), 'stale refline style reset not used in updateNativeReferenceLines');
assert(fnBody.includes('resetNativeReflineLabel('), 'stale refline label reset not used in updateNativeReferenceLines');

console.log('native reference fallback integration test passed');
