// Generic target resolution for the HyperFrames build scripts.
//
// Accepts an accession directly — no per-study implementation. A few friendly
// aliases are provided for the built-in demo reports, but any accession works:
//
//   --accession <acc>      (preferred, generic)
//   --accession=<acc>
//   <acc>                  (positional accession)
//   <alias>                (positional alias, e.g. ct-head)
//
// Returns { accession, label }.

const ALIASES = {
  'ct-head': 'NI9f7ff9',
  'mr-knee': '3852755662087132',
  'cxr':     'CXR-88997',
};

export function resolveTarget(argv = []) {
  let accession = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--accession' && argv[i + 1]) { accession = argv[i + 1]; break; }
    const m = /^--accession=(.+)$/.exec(a);
    if (m) { accession = m[1]; break; }
  }

  if (!accession) {
    const positional = argv.find(a => a && !a.startsWith('-'));
    if (positional) accession = ALIASES[positional] || positional;
  }

  if (!accession) {
    accession = ALIASES['ct-head']; // default for convenience
  }

  // A label for logs: reverse-alias if known, else the accession itself.
  const label = Object.entries(ALIASES).find(([, acc]) => acc === accession)?.[0] || accession;
  return { accession, label };
}
