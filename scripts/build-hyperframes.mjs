#!/usr/bin/env node
// Generic HyperFrames build: export evidence, then render the MP4.
// Works for any accession — no per-study script.
//
// Usage:
//   node scripts/build-hyperframes.mjs --accession <accession>
//   node scripts/build-hyperframes.mjs --accession <accession> --style v2
//   node scripts/build-hyperframes.mjs ct-head        (alias)
//   npm run build:hyperframes -- --accession <accession>
//   npm run build:hyperframes -- --accession <accession> --style v2

import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const { resolveTarget } = await import(`${ROOT}/scripts/lib/resolveTarget.mjs`);

const argv = process.argv.slice(2);
const { accession, label } = resolveTarget(argv);

// Presentation style — passed through to the render step only (evidence capture
// is style-agnostic). Accepts `--style v2` or `--style=v2`; defaults to v1.
function parseStyle(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--style' && args[i + 1]) return args[i + 1];
    const m = /^--style=(.+)$/.exec(args[i]);
    if (m) return m[1];
  }
  return 'v1';
}
const style = parseStyle(argv);

console.log(`\n### build:hyperframes — ${label} (${accession}) [style: ${style}]\n`);

function step(name, script, extraArgs = []) {
  console.log(`\n### ${name}\n`);
  const r = spawnSync('node',
    [resolve(ROOT, 'scripts', script), '--accession', accession, ...extraArgs],
    { stdio: 'inherit', cwd: ROOT });
  if ((r.status ?? 1) !== 0) {
    console.error(`\n${name} failed (exit ${r.status}).`);
    process.exit(r.status ?? 1);
  }
}

// Evidence capture is identical across styles — only the render selects the style.
step('Export evidence', 'export-hyperframes-evidence.mjs');
step('Render MP4', 'render-hyperframes-video.mjs', ['--style', style]);

console.log(`\n### build:hyperframes complete — ${accession} [style: ${style}]\n`);
