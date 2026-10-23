/**
 * "Who already has this problem statement?"
 *
 * A repeated statement is a REMINDER, not an error. This service finds every statement that is the
 * same (or very similar) and resolves the people behind it: name, department, year.
 *
 * Sources, most reliable first:
 *   1. TeamMember rows saved against the matching statements (name, department, year, team)
 *   2. The owner's saved Planner inputs, when they still point at that statement
 *   3. The owner's account (name + department; year unknown)
 *
 * Deliberately NOT returned: email, roll number, phone.
 */
const { fingerprintStatement, statementsOverlap, fingerprintFromParts } = require("../utils/problemStatementFingerprint");

const MIN_FP_LENGTH = 12;
const SIMILAR_SCAN_LIMIT = 800;
const MAX_HOLDERS = 25;

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 < 4 ? n % 10 : 0]}`;
}

/** "2nd year" / "Grade 10" / "" — school grade wins when it is set and no college year is. */
function yearLabel({ collegeYear, schoolGrade } = {}) {
  const y = Number(collegeYear);
  const g = Number(schoolGrade);
  if (Number.isFinite(y) && y >= 1 && y <= 8) return `${ordinal(y)} year`;
  if (Number.isFinite(g) && g >= 1 && g <= 12) return `Grade ${g}`;
  return "";
}

function defaultModels() {
  return {
    ProblemStatement: require("../models/Problemstatement"),
    TeamMember: require("../models/TeamMember"),
    User: require("../models/User"),
    PlannerInput: require("../models/PlannerInput"),
  };
}

const sid = (v) => (v == null ? "" : String(v));

/**
 * @param {{text?:string, fingerprint?:string, currentUserId?:string, limit?:number}} params
 * @param {object} [models] injectable for tests
 */
async function findStatementHolders(params = {}, models = defaultModels()) {
  const { ProblemStatement, TeamMember, User, PlannerInput } = models;
  const me = sid(params.currentUserId);
  const fp = fingerprintStatement(params.fingerprint || params.text);
  const empty = { exists: false, exact: false, yours: false, holders: [], statements: [], fingerprint: fp };
  if (!fp || fp.length < MIN_FP_LENGTH) return empty;

  const proj = { fingerprint: 1, title: 1, description: 1, userId: 1, createdAt: 1 };
  const exactDocs = (await ProblemStatement.find({ fingerprint: fp }, proj).lean()) || [];
  const exactIds = new Set(exactDocs.map((d) => sid(d._id)));

  // Similar + legacy rows that never got a fingerprint
  const pool =
    (await ProblemStatement.find({}, proj).sort({ createdAt: -1 }).limit(SIMILAR_SCAN_LIMIT).lean()) || [];
  const matched = exactDocs.map((d) => ({ doc: d, matchType: "exact" }));
  pool.forEach((d) => {
    if (exactIds.has(sid(d._id))) return;
    const existing = d.fingerprint || fingerprintFromParts(d.title, d.description);
    if (!existing) return;
    if (existing === fp) matched.push({ doc: d, matchType: "exact" });
    else if (statementsOverlap(existing, fp)) matched.push({ doc: d, matchType: "similar" });
  });
  if (!matched.length) return empty;

  const statementIds = matched.map((m) => m.doc._id);
  const statementById = new Map(matched.map((m) => [sid(m.doc._id), m]));
  const userIds = Array.from(new Set(matched.map((m) => sid(m.doc.userId)).filter(Boolean)));

  const [users, teamRows, plannerRows] = await Promise.all([
    User.find({ _id: { $in: userIds } }, { name: 1, department: 1, institutionName: 1 }).lean(),
    TeamMember.find(
      { problemStatementId: { $in: statementIds } },
      { name: 1, department: 1, collegeYear: 1, schoolGrade: 1, semester: 1, college: 1, teamName: 1, problemStatementId: 1 }
    ).lean(),
    PlannerInput.find({ userId: { $in: userIds } }, { userId: 1, team: 1, textInputs: 1 }).lean(),
  ]);
  const userById = new Map((users || []).map((u) => [sid(u._id), u]));

  const holders = new Map(); // key: userId|name → holder
  const put = (h) => {
    const key = `${h.userId}|${String(h.name || "").trim().toLowerCase()}`;
    const prev = holders.get(key);
    // Keep the richest record for the same person
    if (!prev || (!prev.yearLabel && h.yearLabel) || (!prev.department && h.department)) {
      holders.set(key, { ...(prev || {}), ...h });
    }
  };

  // 1) saved team members
  (teamRows || []).forEach((t) => {
    const m = statementById.get(sid(t.problemStatementId));
    if (!m) return;
    put({
      userId: sid(m.doc.userId),
      name: t.name,
      department: t.department || "",
      yearLabel: yearLabel(t),
      semester: t.semester || null,
      college: t.college || "",
      teamName: t.teamName || "",
      role: "member",
      matchType: m.matchType,
      statementId: sid(m.doc._id),
      statementTitle: m.doc.title || "",
      since: m.doc.createdAt || null,
    });
  });

  // 2) the owner's planner profile, only while it still points at this statement
  (plannerRows || []).forEach((row) => {
    const uid = sid(row.userId);
    const mine = matched.find((m) => sid(m.doc.userId) === uid);
    if (!mine) return;
    const linked = statementById.has(sid(row.team && row.team.linkedPsId));
    const problemFp = fingerprintStatement(row.textInputs && row.textInputs.problem);
    const stillSame = problemFp && (problemFp === fp || statementsOverlap(problemFp, fp));
    if (!linked && !stillSame) return;
    (row.team && Array.isArray(row.team.members) ? row.team.members : []).forEach((mem) => {
      if (!mem || !String(mem.name || "").trim()) return;
      put({
        userId: uid,
        name: String(mem.name).trim(),
        department: mem.department || "",
        yearLabel: yearLabel(mem),
        semester: mem.semester || null,
        college: mem.college || "",
        teamName: (row.team && row.team.teamName) || mem.teamName || "",
        role: "member",
        matchType: mine.matchType,
        statementId: sid(mine.doc._id),
        statementTitle: mine.doc.title || "",
        since: mine.doc.createdAt || null,
      });
    });
  });

  // 3) owners with no profile data at all → fall back to their account
  matched.forEach((m) => {
    const uid = sid(m.doc.userId);
    const has = Array.from(holders.values()).some((h) => h.userId === uid);
    if (has) return;
    const u = userById.get(uid);
    put({
      userId: uid,
      name: (u && u.name) || "Unknown user",
      department: (u && u.department) || "",
      yearLabel: "",
      semester: null,
      college: (u && u.institutionName) || "",
      teamName: "",
      role: "owner",
      matchType: m.matchType,
      statementId: sid(m.doc._id),
      statementTitle: m.doc.title || "",
      since: m.doc.createdAt || null,
    });
  });

  const list = Array.from(holders.values())
    .map((h) => {
      const { userId, ...rest } = h; // never leak internal user ids
      return { ...rest, isYou: !!me && userId === me };
    })
    .sort((a, b) => {
      if (a.isYou !== b.isYou) return a.isYou ? 1 : -1;
      if (a.matchType !== b.matchType) return a.matchType === "exact" ? -1 : 1;
      return new Date(b.since || 0) - new Date(a.since || 0);
    })
    .slice(0, params.limit || MAX_HOLDERS);

  const others = list.filter((h) => !h.isYou);
  return {
    exists: others.length > 0,
    exact: others.some((h) => h.matchType === "exact"),
    yours: list.some((h) => h.isYou) || matched.some((m) => sid(m.doc.userId) === me),
    holders: list,
    statements: matched.map((m) => ({
      id: sid(m.doc._id),
      title: m.doc.title || "",
      matchType: m.matchType,
      isYours: sid(m.doc.userId) === me,
    })),
    fingerprint: fp,
  };
}

module.exports = { findStatementHolders, yearLabel };
