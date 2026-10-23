/**
 * Who already holds a problem statement?
 *
 * A duplicate is no longer a hard error. We look up every stored statement
 * with the same fingerprint and describe who owns it (name, department, year)
 * so the UI can remind the user and let them decide: reuse the same problem
 * for their own plan, or pick a new one.
 */
const User = require("../models/User");
const TeamMember = require("../models/TeamMember");
const {
  fingerprintStatement,
  fingerprintFromParts,
  statementsOverlap,
} = require("./problemStatementFingerprint");

function yearLabel(member) {
  if (!member) return "";
  if (member.schoolGrade) return `Grade ${member.schoolGrade}`;
  const y = Number(member.collegeYear);
  if (!y) return "";
  const suffix = y === 1 ? "st" : y === 2 ? "nd" : y === 3 ? "rd" : "th";
  return `${y}${suffix} year`;
}

/** All statements (any user) that match this fingerprint exactly or closely. */
async function findAllMatches(ProblemStatement, textOrFp, { limit = 20 } = {}) {
  const fp = fingerprintStatement(textOrFp);
  if (!fp) return [];

  const exact = await ProblemStatement.find({ fingerprint: fp })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  const seen = new Set(exact.map((d) => String(d._id)));
  const out = exact.map((d) => ({ doc: d, exact: true }));

  // Near-duplicates + legacy rows saved before fingerprints existed
  const pool = await ProblemStatement.find(
    { _id: { $nin: Array.from(seen) } },
    { title: 1, description: 1, fingerprint: 1, userId: 1, createdAt: 1 }
  )
    .sort({ createdAt: -1 })
    .limit(800)
    .lean();

  for (const r of pool) {
    const existing = r.fingerprint || fingerprintFromParts(r.title, r.description);
    if (!existing) continue;
    if (existing === fp) out.push({ doc: r, exact: true });
    else if (statementsOverlap(existing, fp)) out.push({ doc: r, exact: false });
    if (out.length >= limit) break;
  }
  return out;
}

/** Turn raw matches into display rows: who, department, year, team. */
async function describeMatches(matches, viewerId) {
  if (!matches.length) return [];
  const userIds = Array.from(new Set(matches.map((m) => String(m.doc.userId))));
  const psIds = matches.map((m) => m.doc._id);

  const [users, members] = await Promise.all([
    User.find({ _id: { $in: userIds } }, { name: 1, department: 1, registerNumber: 1 }).lean(),
    TeamMember.find({ problemStatementId: { $in: psIds } }).sort({ createdAt: 1 }).lean(),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const membersByPs = new Map();
  members.forEach((m) => {
    const k = String(m.problemStatementId);
    if (!membersByPs.has(k)) membersByPs.set(k, []);
    membersByPs.get(k).push(m);
  });

  return matches.map(({ doc, exact }) => {
    const owner = userById.get(String(doc.userId)) || {};
    const team = membersByPs.get(String(doc._id)) || [];
    const lead = team[0] || null;
    const department = owner.department || lead?.department || "";
    const year = yearLabel(lead);
    return {
      statementId: String(doc._id),
      title: doc.title || "",
      exact,
      isMine: String(doc.userId) === String(viewerId),
      owner: {
        name: owner.name || lead?.name || "Unknown",
        department,
        year,
        registerNumber: owner.registerNumber || lead?.rollNumber || "",
      },
      teamName: lead?.teamName || "",
      members: team.map((m) => ({
        name: m.name,
        department: m.department || "",
        year: yearLabel(m),
        rollNumber: m.rollNumber || "",
      })),
      createdAt: doc.createdAt,
      createdYear: doc.createdAt ? new Date(doc.createdAt).getFullYear() : null,
    };
  });
}

async function lookupDuplicates(ProblemStatement, textOrFp, viewerId) {
  const matches = await findAllMatches(ProblemStatement, textOrFp);
  return describeMatches(matches, viewerId);
}

module.exports = { findAllMatches, describeMatches, lookupDuplicates, yearLabel };
