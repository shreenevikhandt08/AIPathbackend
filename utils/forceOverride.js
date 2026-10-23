/**
 * Must-apply + surface prompt stacking.
 * Later items win: activity layout → content → Must apply (verbatim, last).
 *
 * Fields:
 *   manualPrompt / _forceInstructions — typed text
 *   _forceFileNotes — file extract (never merged into manualPrompt)
 *   _mustApplyText — typed + files combined (FE)
 *   _forceApply — "true" only when typed/uploaded
 *   instructions — may contain MUST APPLY (verbatim):
 *   _dtInstruction — trailing HARD USER OVERRIDE … ---END MUST APPLY---
 *   top-level generate-all: feedback + forceApply
 */

const {
  extractDtSurfaceBlocks,
  dailyCustomisationPromptSection,
  homeworkCustomisationPromptSection,
} = require("./scheduleOverrides");

const FORCE_HEADER = "HARD USER OVERRIDE — MUST APPLY";
const FORCE_HEADER_RE = /HARD\s+USER\s+OVERRIDE/i;
const END_MARKER = "---END MUST APPLY---";

function trimText(v) {
  return String(v || "").trim();
}

function hasTypedForce(inputs = {}) {
  return Boolean(
    trimText(inputs._mustApplyText) ||
      trimText(inputs.manualPrompt) ||
      trimText(inputs._forceInstructions)
  );
}

function hasFileForce(inputs = {}) {
  return Boolean(trimText(inputs._forceFileNotes));
}

function hasForceText(inputs = {}) {
  return hasTypedForce(inputs) || hasFileForce(inputs);
}

function forceApplyOn(inputs = {}) {
  const v = inputs._forceApply;
  if (v === true || v === "true" || v === 1 || v === "1") return hasForceText(inputs);
  // Top-level generate-all hint stored on inputs
  if (inputs._topForceApply === true || inputs._topForceApply === "true") {
    return hasForceText(inputs);
  }
  return false;
}

/**
 * Extract Must-apply verbatim from any of the FE fields / DT trailing block.
 */
function extractMustApplyVerbatim(inputs = {}) {
  const fromMust = trimText(inputs._mustApplyText);
  if (fromMust) return fromMust;

  const typed = trimText(inputs._forceInstructions) || trimText(inputs.manualPrompt);
  const fileNotes = trimText(inputs._forceFileNotes);
  if (typed || fileNotes) {
    const bits = [];
    if (typed) bits.push(typed);
    if (fileNotes) bits.push(fileNotes);
    return bits.join("\n\n");
  }

  const dt = String(inputs._dtInstruction || "");
  const endIdx = dt.search(/---END MUST APPLY---/i);
  if (endIdx >= 0) {
    const startIdx = dt.search(FORCE_HEADER_RE);
    if (startIdx >= 0 && startIdx < endIdx) {
      return dt.slice(startIdx, endIdx + END_MARKER.length).trim();
    }
    // Block without header — take from start of must section
    const before = dt.slice(0, endIdx).trim();
    const lastBlank = before.lastIndexOf("\n\n");
    return (lastBlank >= 0 ? before.slice(lastBlank) : before).trim() + `\n${END_MARKER}`;
  }

  const instr = String(inputs.instructions || "");
  const m = instr.match(/MUST APPLY\s*\(verbatim\)\s*:\s*([\s\S]+)/i);
  if (m) return trimText(m[1]);

  return "";
}

function buildForceBlock(inputs = {}) {
  if (!forceApplyOn(inputs) && !hasForceText(inputs)) return "";
  const verbatim = extractMustApplyVerbatim(inputs);
  if (!verbatim) return "";

  // If already a full HARD USER OVERRIDE block, keep verbatim
  if (FORCE_HEADER_RE.test(verbatim)) {
    return verbatim.includes(END_MARKER) ? verbatim : `${verbatim}\n${END_MARKER}`;
  }

  const typed = trimText(inputs._forceInstructions) || trimText(inputs.manualPrompt);
  const fileNotes = trimText(inputs._forceFileNotes);
  const bits = [];
  bits.push(`${FORCE_HEADER} TO THE ENTIRE PLAN.`);
  bits.push("Apply this text LAST, verbatim. It can change times, add/remove/rename periods, change days, and change content.");
  bits.push("If it conflicts with the activity blueprint, Must apply wins.");
  bits.push("If the user wrote nothing, invent nothing.");
  bits.push("");
  if (typed) bits.push(`USER MUST-APPLY TEXT (verbatim — do not rewrite):\n${typed}`);
  if (fileNotes) bits.push(`USER MUST-APPLY FILES (extracted — do not invent extra rules):\n${fileNotes}`);
  if (!typed && !fileNotes) bits.push(verbatim);
  bits.push(END_MARKER);
  return bits.join("\n");
}

/**
 * @param {object} inputs
 * @param {{ feedback?: string, forceApply?: boolean|string }} [top] — /generate-all top-level
 */
function normalizeForceOverride(inputs, top = {}) {
  const next = inputs && typeof inputs === "object" ? inputs : {};

  // Absorb /generate-all top-level feedback + forceApply
  if (top.forceApply === true || top.forceApply === "true" || top.forceApply === 1) {
    next._topForceApply = true;
    const fb = trimText(top.feedback);
    if (fb && !trimText(next._mustApplyText)) next._mustApplyText = fb;
    if (fb && !trimText(next._forceInstructions) && !trimText(next.manualPrompt)) {
      next._forceInstructions = fb;
    }
    next._forceApply = "true";
  }

  const typed =
    trimText(next._forceInstructions) ||
    trimText(next.manualPrompt) ||
    (trimText(next._mustApplyText) && !trimText(next._forceFileNotes)
      ? trimText(next._mustApplyText)
      : "");
  const fileNotes = trimText(next._forceFileNotes);
  const mustCombined = trimText(next._mustApplyText);

  if (fileNotes) next._forceFileNotes = fileNotes;
  else delete next._forceFileNotes;

  if (typed) {
    next.manualPrompt = trimText(next.manualPrompt) || typed;
    next._forceInstructions = typed;
    next._forceApply = "true";
  } else if (!mustCombined && !fileNotes) {
    delete next.manualPrompt;
    delete next._forceInstructions;
  }

  if (mustCombined) {
    next._mustApplyText = mustCombined;
    next._forceApply = "true";
  } else {
    delete next._mustApplyText;
  }

  if (fileNotes) next._forceApply = "true";

  if (!hasForceText(next) && !next._topForceApply) {
    delete next._forceApply;
    next._forceBlock = "";
    return next;
  }

  const forceBlock = buildForceBlock(next);
  next._forceBlock = forceBlock;
  if (!forceBlock) return next;

  const existingDt = trimText(next._dtInstruction);
  if (!existingDt) {
    next._dtInstruction = forceBlock;
  } else if (!FORCE_HEADER_RE.test(existingDt)) {
    // Append Must apply LAST (stack: later wins)
    next._dtInstruction = `${existingDt}\n\n${forceBlock}`.trim();
  } else if (!/---END MUST APPLY---/i.test(existingDt)) {
    next._dtInstruction = `${existingDt}\n${END_MARKER}`.trim();
  }

  return next;
}

/**
 * Must-apply text only. Empty / force off → invent nothing (returns "").
 * Callers should append this LAST in the full prompt.
 */
function mustApplyPromptSection(inputs = {}) {
  if (!forceApplyOn(inputs)) return "";
  const blocks = extractDtSurfaceBlocks(inputs._dtInstruction || "");
  const must = blocks.mustApply || trimText(inputs._forceBlock) || buildForceBlock(inputs);
  if (!trimText(must)) return "";
  return (
    `${FORCE_HEADER} (apply LAST — wins over activity blueprint / DT / DSA / timing; ` +
    `may change times or drop/add periods):\n${must}\n\n`
  );
}

/**
 * Prompt sections. Order: layout → homework → Must apply LAST.
 * Prefer appending mustApplyPromptSection() at the end of the full prompt.
 */
function forceOverridePromptSection(inputs = {}, surface = "all") {
  const parts = [];

  if (surface === "daily" || surface === "all") {
    const daily = dailyCustomisationPromptSection(inputs);
    if (daily) parts.push(daily.trim());
  }
  if (surface === "homework" || surface === "all") {
    const hw = homeworkCustomisationPromptSection(inputs);
    if (hw) parts.push(hw.trim());
  }

  // Must apply LAST within this bundle (also expose via mustApplyPromptSection)
  const must = mustApplyPromptSection(inputs).trim();
  if (must) parts.push(must);

  if (!parts.length) return "";
  return `${parts.join("\n\n")}\n\n`;
}

function forceOverrideSyllabusSection(inputs = {}) {
  if (!forceApplyOn(inputs)) return "";
  const block = trimText(inputs._forceBlock) || buildForceBlock(inputs);
  if (!block) return "";
  return `=== ${FORCE_HEADER} (apply LAST) ===\n${block}`;
}

function sliceForceField(v, max = 8000) {
  const s = String(v || "");
  return s.length > max ? s.slice(0, max) : s;
}

function mergeForceFromSnapshot(inputs, snapshot = {}) {
  const next = inputs && typeof inputs === "object" ? inputs : {};
  const snap = snapshot && typeof snapshot === "object" ? snapshot : {};
  if (!trimText(next.manualPrompt) && trimText(snap.manualPrompt)) {
    next.manualPrompt = snap.manualPrompt;
  }
  if (!trimText(next._forceInstructions) && trimText(snap._forceInstructions)) {
    next._forceInstructions = snap._forceInstructions;
  }
  if (!trimText(next._forceFileNotes) && trimText(snap._forceFileNotes)) {
    next._forceFileNotes = snap._forceFileNotes;
  }
  if (!trimText(next._mustApplyText) && trimText(snap._mustApplyText)) {
    next._mustApplyText = snap._mustApplyText;
  }
  if (snap._forceApply != null && next._forceApply == null) {
    next._forceApply = snap._forceApply;
  }
  if (!next._slotOverrides && snap._slotOverrides) {
    next._slotOverrides = snap._slotOverrides;
  }
  if (!next._activityBlueprint && snap._activityBlueprint) {
    next._activityBlueprint = snap._activityBlueprint;
  }
  if (!next._dayTemplate && snap._dayTemplate) {
    next._dayTemplate = snap._dayTemplate;
  }
  if (snap._useActivityLayout != null && next._useActivityLayout == null) {
    next._useActivityLayout = snap._useActivityLayout;
  }
  if (snap._cohortPhase != null && next._cohortPhase == null) {
    next._cohortPhase = snap._cohortPhase;
  }
  if (snap._snsAgentWorkbench != null && next._snsAgentWorkbench == null) {
    next._snsAgentWorkbench = snap._snsAgentWorkbench;
  }
  if (snap._requireLearningLinks != null && next._requireLearningLinks == null) {
    next._requireLearningLinks = snap._requireLearningLinks;
  }
  if (!next._dtPlaybookMap && snap._dtPlaybookMap) {
    next._dtPlaybookMap = snap._dtPlaybookMap;
  }
  if (!trimText(next._productStageBlock) && trimText(snap._productStageBlock)) {
    next._productStageBlock = snap._productStageBlock;
  }
  if (!next._timeFormat && snap._timeFormat) next._timeFormat = snap._timeFormat;
  if (!next._timezone && snap._timezone) next._timezone = snap._timezone;
  if (!next._homeworkOverrides && snap._homeworkOverrides) {
    next._homeworkOverrides = snap._homeworkOverrides;
  }
  return normalizeForceOverride(next);
}

module.exports = {
  FORCE_HEADER,
  END_MARKER,
  normalizeForceOverride,
  buildForceBlock,
  extractMustApplyVerbatim,
  forceApplyOn,
  mustApplyPromptSection,
  forceOverridePromptSection,
  forceOverrideSyllabusSection,
  sliceForceField,
  mergeForceFromSnapshot,
  hasForceText,
  hasTypedForce,
  hasFileForce,
};
