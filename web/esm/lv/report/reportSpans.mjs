// ReportSpan — character offset mapping from finding to source report text.
// Multi-stage approximate grounding: exact → normalized → punctuation-stripped → sentence-overlap.
// Inspired by LangExtract's source grounding model.
// Spans are computed once from immutable originalText; never modify the original.

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
function escRe(s) { return s.replace(ESCAPE_RE, '\\$&'); }

// Content tokens for semantic overlap: exclude stopwords and very short tokens
const STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might',
  'in','on','at','to','for','of','with','by','from','up','about','into','through',
  'and','or','but','not','no','nor','so','yet','both','either','neither','each',
  'few','more','most','other','some','such','than','too','very',
  'its','this','that','these','those','it','he','she','they','we','you','i','me',
  'him','her','us','them','what','which','who','whom','whose','when','where','why',
  'how','all','any','can','as','also','then','there','if','without','within','between',
  's','t','re','ll','ve'
]);

function contentTokens(str) {
  return str.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function jaccardScore(tokA, tokB) {
  if (!tokA.length || !tokB.length) return 0;
  const sa = new Set(tokA);
  const sb = new Set(tokB);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Split report text into sentences/clauses with their character offsets.
function splitSentences(text) {
  const out = [];
  // Capture clauses that end at sentence terminators or newlines
  const re = /[^.!?\n;]+(?:[.!?\n;]+|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const trimmed = raw.trim();
    if (trimmed.length >= 5) {
      const leadWS = raw.length - raw.trimStart().length;
      out.push({ text: trimmed, start: m.index + leadWS, end: m.index + raw.length });
    }
  }
  return out;
}

// Multi-stage grounding: tries increasingly approximate strategies.
// groundingStatus: 'exact' | 'normalized' | 'approximate' | 'ungrounded'
// Returns { status, score, charStart, charEnd, matchedText, attempts[] }
// attempts[]: each strategy tried, whether it matched, and diagnostic preview.
export function groundFinding(reportText, rawText) {
  const attempts = [];

  if (!rawText || !reportText) return { status: 'ungrounded', score: 0, attempts };
  const trimmed = rawText.trim();
  if (!trimmed) return { status: 'ungrounded', score: 0, attempts };

  // Stage A: exact verbatim match
  // If reportText.includes(rawText) is true, indexOf MUST succeed — they use the same algorithm.
  const idxA = reportText.indexOf(trimmed);
  if (idxA >= 0) {
    attempts.push({ strategy: 'exact', matched: true, score: 1.0 });
    return { status: 'exact', score: 1.0, charStart: idxA, charEnd: idxA + trimmed.length, matchedText: trimmed, attempts };
  }
  attempts.push({ strategy: 'exact', matched: false, candidatePreview: trimmed.slice(0, 80) });

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (!words.length) return { status: 'ungrounded', score: 0, attempts };

  // Stage B: case-insensitive + flexible whitespace normalization (words in same order)
  try {
    const reB = new RegExp(words.map(escRe).join('\\s+'), 'i');
    const mB = reB.exec(reportText);
    if (mB) {
      attempts.push({ strategy: 'normalized_whitespace_case', matched: true, score: 0.95, candidatePreview: mB[0].slice(0, 80) });
      return { status: 'normalized', score: 0.95, charStart: mB.index, charEnd: mB.index + mB[0].length, matchedText: mB[0], attempts };
    }
    attempts.push({ strategy: 'normalized_whitespace_case', matched: false, candidatePreview: words.join(' ').slice(0, 80) });
  } catch { attempts.push({ strategy: 'normalized_whitespace_case', matched: false, error: 'bad_regex' }); }

  // Stage C: strip leading/trailing punctuation from rawText, retry B
  const stripped = trimmed.replace(/^[\s\W]+|[\s\W]+$/g, '').trim();
  if (stripped.length > 0 && stripped !== trimmed) {
    const wordsC = stripped.split(/\s+/).filter(Boolean);
    if (wordsC.length > 0) {
      try {
        const reC = new RegExp(wordsC.map(escRe).join('\\s+'), 'i');
        const mC = reC.exec(reportText);
        if (mC) {
          attempts.push({ strategy: 'strip_punctuation', matched: true, score: 0.90, candidatePreview: mC[0].slice(0, 80) });
          return { status: 'normalized', score: 0.90, charStart: mC.index, charEnd: mC.index + mC[0].length, matchedText: mC[0], attempts };
        }
        attempts.push({ strategy: 'strip_punctuation', matched: false, candidatePreview: stripped.slice(0, 80) });
      } catch { attempts.push({ strategy: 'strip_punctuation', matched: false, error: 'bad_regex' }); }
    }
  }

  // Stage C2: internal punctuation stripped (allows limited punctuation between words)
  // [\s.,;:\-]* is bounded enough to not match across unrelated regions
  if (words.length >= 2) {
    const wordsNP = trimmed.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (wordsNP.length >= 2) {
      try {
        const reCP = new RegExp(wordsNP.map(escRe).join('[\\s.,;:\\-]*'), 'i');
        const mCP = reCP.exec(reportText);
        if (mCP) {
          attempts.push({ strategy: 'strip_internal_punct', matched: true, score: 0.85, candidatePreview: mCP[0].slice(0, 80) });
          return { status: 'approximate', score: 0.85, charStart: mCP.index, charEnd: mCP.index + mCP[0].length, matchedText: mCP[0], attempts };
        }
        attempts.push({ strategy: 'strip_internal_punct', matched: false, candidatePreview: wordsNP.join(' ').slice(0, 80) });
      } catch { attempts.push({ strategy: 'strip_internal_punct', matched: false, error: 'bad_regex' }); }
    }
  }

  // Stage D: word-subsequence match — handles extra preamble/context in rawText.
  // Slide a window over rawText words; require >= 60% of total words to be present.
  if (words.length >= 4) {
    const minLen = Math.max(3, Math.ceil(words.length * 0.6));
    let stageD_matched = false;
    outer:
    for (let start = 0; start < Math.min(words.length - minLen + 1, 4); start++) {
      for (let len = words.length - start; len >= minLen; len--) {
        const sub = words.slice(start, start + len);
        try {
          const reSub = new RegExp(sub.map(escRe).join('\\s+'), 'i');
          const mSub = reSub.exec(reportText);
          if (mSub) {
            const score = (len / words.length) * 0.80;
            attempts.push({ strategy: 'word_subsequence', matched: true, score, candidatePreview: mSub[0].slice(0, 80), subWords: sub.join(' ') });
            stageD_matched = true;
            return { status: 'approximate', score, charStart: mSub.index, charEnd: mSub.index + mSub[0].length, matchedText: mSub[0], attempts };
            break outer;
          }
        } catch { /* skip bad regex */ }
      }
    }
    if (!stageD_matched) {
      attempts.push({ strategy: 'word_subsequence', matched: false, candidatePreview: words.slice(0, 3).join(' ') + '...' });
    }
  }

  // Stage E: sentence-level token overlap (semantic / paraphrase matching).
  // Require: rawText has >= 2 content tokens; Jaccard >= 0.40; >= 2 tokens in common.
  // This prevents single-word or stopword-dominated rawText from false-matching.
  const rawTokens = contentTokens(trimmed);
  if (rawTokens.length >= 2) {
    const sentences = splitSentences(reportText);
    const THRESHOLD = 0.40;
    const MIN_COMMON = 2;
    let bestScore = 0;
    let bestSent = null;

    for (const sent of sentences) {
      const sentTokens = contentTokens(sent.text);
      const score = jaccardScore(rawTokens, sentTokens);
      if (score > bestScore) {
        const rawSet = new Set(rawTokens);
        let inter = 0;
        for (const t of sentTokens) if (rawSet.has(t)) inter++;
        if (score >= THRESHOLD && inter >= MIN_COMMON) {
          bestScore = score;
          bestSent = sent;
        }
      }
    }

    if (bestSent) {
      attempts.push({ strategy: 'sentence_overlap', matched: true, score: bestScore, candidatePreview: bestSent.text.slice(0, 80), candidateStart: bestSent.start, candidateEnd: bestSent.end });
      return {
        status: 'approximate',
        score: bestScore,
        charStart: bestSent.start,
        charEnd: bestSent.end,
        matchedText: reportText.slice(bestSent.start, bestSent.end),
        attempts
      };
    }
    attempts.push({ strategy: 'sentence_overlap', matched: false, bestScore, rawTokens: rawTokens.slice(0, 6) });
  }

  return { status: 'ungrounded', score: 0, attempts };
}

// Returns { spans, groundingDetails } where groundingDetails is a Map<findingId, groundingResult>
// for all findings (including ungrounded — useful for debugging and parse details display).
// Pass { detailed: true } to include attempts in the spans and details map.
export function computeSpans(originalText, findings, spanHints = []) {
  const text = String(originalText || '');
  const spans = [];
  const groundingDetails = new Map(); // findingId → groundFinding result

  // Build polarity lookup from findings so hints without explicit polarity inherit correctly.
  const findingPolarityMap = new Map((findings || []).map((f) => [
    String(f.id || ''),
    String(f.navigationStatus || f.navigation_status || '').toLowerCase() === 'negative' ? 'negative' : 'positive'
  ]));

  for (const hint of spanHints) {
    const rawText = String(hint.rawText || '').trim();
    if (!rawText) continue;
    const g = groundFinding(text, rawText);
    if (g.status === 'ungrounded') continue;
    const fid = String(hint.findingId || '');
    spans.push({
      id: `span-${fid}`,
      findingId: fid,
      charStart: g.charStart,
      charEnd: g.charEnd,
      text: g.matchedText,
      type: 'primary',
      polarity: hint.polarity || findingPolarityMap.get(fid) || 'positive',
      groundingStatus: g.status,
      groundingScore: g.score,
      groundingAttempts: g.attempts
    });
  }

  // Fall back: try to locate via finding rawText if not covered by hints
  for (const finding of (findings || [])) {
    const findingId = String(finding.id || '');
    if (!findingId) continue;
    if (spans.some((s) => s.findingId === findingId)) continue;
    const rawText = String(finding.rawText || '').trim();
    if (!rawText) {
      groundingDetails.set(findingId, { status: 'ungrounded', score: 0, reason: 'no_rawText', attempts: [] });
      continue;
    }
    const isNeg = String(finding.navigationStatus || finding.navigation_status || '').toLowerCase() === 'negative';
    const g = groundFinding(text, rawText);
    groundingDetails.set(findingId, { ...g, rawText });
    if (g.status === 'ungrounded') continue;
    spans.push({
      id: `span-${findingId}`,
      findingId,
      charStart: g.charStart,
      charEnd: g.charEnd,
      text: g.matchedText,
      type: 'primary',
      polarity: isNeg ? 'negative' : 'positive',
      groundingStatus: g.status,
      groundingScore: g.score,
      groundingAttempts: g.attempts
    });

    // Compute spans for atomic children of grouped negative findings.
    if (Array.isArray(finding.children)) {
      for (const child of finding.children) {
        const cid = String(child.id || '');
        if (!cid || spans.some((s) => s.findingId === cid)) continue;
        const crawText = String(child.rawText || '').trim();
        if (!crawText) continue;
        const cg = groundFinding(text, crawText);
        if (cg.status === 'ungrounded') continue;
        spans.push({
          id: `span-${cid}`,
          findingId: cid,
          charStart: cg.charStart,
          charEnd: cg.charEnd,
          text: cg.matchedText,
          type: 'child',
          polarity: 'negative',
          parentFindingId: findingId,
          groundingStatus: cg.status,
          groundingScore: cg.score,
          groundingAttempts: cg.attempts
        });
      }
    }
  }

  return { spans: spans.sort((a, b) => a.charStart - b.charStart), groundingDetails };
}

export function getSpanForFinding(spans, findingId) {
  return spans.find((s) => s.findingId === String(findingId || '')) || null;
}

export function segmentText(originalText, spans) {
  const text = String(originalText || '');
  const segments = [];
  let cursor = 0;

  for (const span of spans) {
    if (span.charStart > cursor) {
      segments.push({ type: 'text', text: text.slice(cursor, span.charStart) });
    }
    segments.push({ type: 'span', text: span.text, span });
    cursor = span.charEnd;
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', text: text.slice(cursor) });
  }
  return segments;
}
