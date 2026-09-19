/**
 * Assessment bank SHAPE / config only.
 * Content comes from RAG (enrichAssessmentBanksRag) — not inbuilt lists.
 * Arrays kept empty so callers never silently fall back to hardcoded questions.
 */
const PM_QUESTIONS = [];
const LEETCODE_TOP = [];
const CASE_STUDIES = [];

const DEFAULT_ASSESSMENT_CONFIG = {
  banks: {
    pm: true,
    leetcode: true,
    cases: true,
    iae: false,
    company: true,
    certifications: false,
    analyticsVidhya: false,
    agentWorkbench: true,
  },
  avCourseNotes: "",
  agentWorkbenchNotes: "",
  enrichFromLinks: true,
};

function getAssessmentBanks(ragPack = null) {
  const pm = Array.isArray(ragPack?.pm) ? ragPack.pm : [];
  const leetcode = Array.isArray(ragPack?.leetcode) ? ragPack.leetcode : [];
  const cases = Array.isArray(ragPack?.cases) ? ragPack.cases : [];
  return {
    pmQuestions: pm,
    leetcode,
    caseStudies: cases,
    sdLeetcode: Array.isArray(ragPack?.sdLeetcode) ? ragPack.sdLeetcode : [],
    meta: {
      pmCount: pm.length,
      leetcodeCount: leetcode.length,
      caseCount: cases.length,
      source:
        ragPack?.mode
          ? `RAG (${ragPack.mode}) — real items from web / uploaded PDF. No inbuilt seed bank.`
          : "No RAG pack yet — generate a plan to fetch LeetCode / PM / cases via RAG.",
    },
  };
}

module.exports = {
  PM_QUESTIONS,
  LEETCODE_TOP,
  CASE_STUDIES,
  DEFAULT_ASSESSMENT_CONFIG,
  getAssessmentBanks,
};
