#!/usr/bin/env node
// Generic HyperFrames build: export evidence, then render the MP4.
// Works for any accession — no per-study script.
//
// Usage:
//   node scripts/build-hyperframes.mjs --accession <accession>
//   node scripts/build-hyperframes.mjs ct-head        (alias)
//   npm run build:hyperframes -- --accession <accession>

import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const { resolveTarget } = await import(`${ROOT}/scripts/lib/resolveTarget.mjs`);

const { accession, label } = resolveTarget(process.argv.slice(2));
console.log(`\n### build:hyperframes — ${label} (${accession})\n`);

function step(name, script) {
  console.log(`\n### ${name}\n`);
  const r = spawnSync('node', [resolve(ROOT, 'scripts', script), '--accession', accession],
    { stdio: 'inherit', cwd: ROOT });
  if ((r.status ?? 1) !== 0) {
    console.error(`\n${name} failed (exit ${r.status}).`);
    process.exit(r.status ?? 1);
  }
}

step('Export evidence', 'export-hyperframes-evidence.mjs');
step('Render MP4', 'render-hyperframes-video.mjs');

console.log(`\n### build:hyperframes complete — ${accession}\n`);
