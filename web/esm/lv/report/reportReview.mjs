// Review state per finding/span.
// Stored separately from the immutable ReportDocument.

const VALID_STATUSES = new Set(['agree', 'disagree', 'maybe', null]);

export function createReviewState() {
  const statusMap = new Map();
  const noteMap = new Map();

  function validateStatus(status) {
    if (status !== null && !VALID_STATUSES.has(status)) {
      throw new Error(`Invalid review status: ${status}. Must be agree, disagree, maybe, or null.`);
    }
  }

  return {
    setReview(findingId, status) {
      const id = String(findingId || '');
      if (!id) throw new Error('findingId required');
      validateStatus(status);
      if (status === null) statusMap.delete(id);
      else statusMap.set(id, status);
    },
    getReview(findingId) {
      return statusMap.get(String(findingId || '')) || null;
    },
    setNote(findingId, text) {
      const id = String(findingId || '');
      if (!id) throw new Error('findingId required');
      const trimmed = String(text || '').trim();
      if (trimmed) noteMap.set(id, trimmed);
      else noteMap.delete(id);
    },
    getNote(findingId) {
      return noteMap.get(String(findingId || '')) || '';
    },
    getAllReviews() {
      const result = {};
      for (const [id, status] of statusMap.entries()) {
        result[id] = { status, note: noteMap.get(id) || '' };
      }
      for (const [id, note] of noteMap.entries()) {
        if (!result[id]) result[id] = { status: null, note };
      }
      return result;
    },
    clear() {
      statusMap.clear();
      noteMap.clear();
    }
  };
}

export const REVIEW_STATUS = Object.freeze({
  AGREE: 'agree',
  DISAGREE: 'disagree',
  MAYBE: 'maybe',
  NONE: null
});
