// ReportDocument — immutable model for a loaded radiology report.

const IMAGE_AVAILABILITY_STATES = new Set([
  'unknown', 'not_available', 'querying', 'retrieving', 'available', 'loaded', 'failed'
]);

function parseSections(text, sectionDefs = []) {
  if (!sectionDefs.length) {
    return [{ label: 'REPORT', charStart: 0, charEnd: text.length, text }];
  }
  const positions = sectionDefs
    .map((def) => {
      const idx = text.indexOf(def.startKeyword);
      return idx >= 0 ? { label: def.label, charStart: idx, keyword: def.startKeyword } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.charStart - b.charStart);

  return positions.map((pos, i) => {
    const bodyStart = pos.charStart + pos.keyword.length;
    const charEnd = i + 1 < positions.length ? positions[i + 1].charStart : text.length;
    const sectionText = text.slice(bodyStart, charEnd).trim();
    return {
      label: pos.label,
      charStart: pos.charStart,
      charEnd,
      text: sectionText
    };
  });
}

export function createReportDocument({
  accession,
  text,
  sourceType = 'demo',
  sectionDefs = [],
  imageAvailability = 'unknown'
} = {}) {
  if (!text || typeof text !== 'string') throw new Error('ReportDocument requires non-empty text');
  if (!IMAGE_AVAILABILITY_STATES.has(imageAvailability)) {
    imageAvailability = 'unknown';
  }
  const originalText = text;
  const sections = parseSections(originalText, sectionDefs);
  return Object.freeze({
    accession: String(accession || '').trim() || null,
    originalText,
    sourceType: String(sourceType || 'demo'),
    sections,
    immutable: true,
    imageAvailability,
    createdAt: new Date().toISOString()
  });
}

export function updateImageAvailability(doc, status) {
  if (!IMAGE_AVAILABILITY_STATES.has(status)) throw new Error(`Invalid imageAvailability: ${status}`);
  return Object.freeze({ ...doc, imageAvailability: status });
}

export const IMAGE_AVAILABILITY = Object.freeze({
  UNKNOWN: 'unknown',
  NOT_AVAILABLE: 'not_available',
  QUERYING: 'querying',
  RETRIEVING: 'retrieving',
  AVAILABLE: 'available',
  LOADED: 'loaded',
  FAILED: 'failed'
});
