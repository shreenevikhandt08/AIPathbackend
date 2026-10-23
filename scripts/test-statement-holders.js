/* Run: node scripts/test-statement-holders.js  (no database needed) */
const assert = require("assert");
const { findStatementHolders, yearLabel } = require("../services/statementHolders");
const { fingerprintStatement } = require("../utils/problemStatementFingerprint");

const q = (rows) => {
  const c = { sort: () => c, limit: () => c, lean: async () => rows };
  return c;
};
const matchQ = (rows, filter) => rows.filter((r) => Object.entries(filter).every(([k, v]) => (v && v.$in ? v.$in.map(String).includes(String(r[k])) : String(r[k]) === String(v))));
function fake({ statements = [], members = [], users = [], planner = [] }) {
  return {
    ProblemStatement: { find: (f) => q(Object.keys(f || {}).length ? matchQ(statements, f) : statements) },
    TeamMember: { find: (f) => q(matchQ(members, f)) },
    User: { find: (f) => q(matchQ(users, f)) },
    PlannerInput: { find: (f) => q(matchQ(planner, f)) },
  };
}
const TEXT = "Build an AI assistant that helps rural farmers detect crop disease from phone photos and get treatment advice in Tamil";
const fp = fingerprintStatement(TEXT);

(async () => {
  assert.strictEqual(yearLabel({ collegeYear: 2 }), "2nd year");
  assert.strictEqual(yearLabel({ collegeYear: 3 }), "3rd year");
  assert.strictEqual(yearLabel({ collegeYear: 1 }), "1st year");
  assert.strictEqual(yearLabel({ collegeYear: null, schoolGrade: 10 }), "Grade 10");
  assert.strictEqual(yearLabel({}), "");

  // 1. exact, held by another user's team
  let r = await findStatementHolders({ text: TEXT, currentUserId: "me" }, fake({
    statements: [{ _id: "s1", userId: "u1", fingerprint: fp, title: "Crop AI", createdAt: new Date() }],
    members: [
      { problemStatementId: "s1", name: "Priya", department: "CSE", collegeYear: 3, teamName: "Agri", college: "SNS Tech" },
      { problemStatementId: "s1", name: "Karan", department: "IT", collegeYear: 2, teamName: "Agri" },
    ],
    users: [{ _id: "u1", name: "Priya" }],
  }));
  assert(r.exists && r.exact && !r.yours);
  assert.strictEqual(r.holders.length, 2);
  assert.deepStrictEqual([r.holders[0].name, r.holders[0].department, r.holders[0].yearLabel], ["Priya", "CSE", "3rd year"]);
  assert(!("userId" in r.holders[0]) && !("email" in r.holders[0]), "no private fields leaked");

  // 2. similar (reworded) statement
  const reworded = "Build an AI assistant helping rural farmers detect crop disease from phone photos with treatment advice in Tamil language";
  r = await findStatementHolders({ text: reworded, currentUserId: "me" }, fake({
    statements: [{ _id: "s1", userId: "u1", fingerprint: fp, title: "Crop AI", createdAt: new Date() }],
    members: [{ problemStatementId: "s1", name: "Priya", department: "CSE", collegeYear: 3 }],
  }));
  assert(r.exists && !r.exact && r.holders[0].matchType === "similar");

  // 3. only I have it → reminder is about myself, not "others"
  r = await findStatementHolders({ text: TEXT, currentUserId: "me" }, fake({
    statements: [{ _id: "s2", userId: "me", fingerprint: fp, title: "Mine" }],
    members: [{ problemStatementId: "s2", name: "Me", department: "CSE", collegeYear: 2 }],
  }));
  assert(!r.exists && r.yours && r.holders[0].isYou);

  // 4. owner with no profile → account fallback (name + department, year unknown)
  r = await findStatementHolders({ text: TEXT, currentUserId: "me" }, fake({
    statements: [{ _id: "s3", userId: "u9", fingerprint: fp }],
    users: [{ _id: "u9", name: "Anitha", department: "ECE" }],
  }));
  assert.strictEqual(r.holders[0].name, "Anitha");
  assert.strictEqual(r.holders[0].department, "ECE");
  assert.strictEqual(r.holders[0].yearLabel, "");

  // 5. planner profile used when still on the same problem; ignored when changed
  const planner = (problem) => ({ userId: "u1", textInputs: { problem }, team: { linkedPsId: "zzz", teamName: "T", members: [{ name: "Divya", department: "AI&DS", collegeYear: 4 }] } });
  r = await findStatementHolders({ text: TEXT, currentUserId: "me" }, fake({ statements: [{ _id: "s1", userId: "u1", fingerprint: fp }], planner: [planner(TEXT)] }));
  assert.strictEqual(r.holders[0].name, "Divya");
  assert.strictEqual(r.holders[0].yearLabel, "4th year");
  r = await findStatementHolders({ text: TEXT, currentUserId: "me" }, fake({ statements: [{ _id: "s1", userId: "u1", fingerprint: fp }], users: [{ _id: "u1", name: "Owner" }], planner: [planner("Something totally different about hospitals and billing")] }));
  assert.strictEqual(r.holders[0].name, "Owner");

  // 6. no match / too short
  assert(!(await findStatementHolders({ text: TEXT, currentUserId: "me" }, fake({ statements: [] }))).exists);
  assert(!(await findStatementHolders({ text: "hi", currentUserId: "me" }, fake({}))).exists);
  console.log("statement holders: all tests passed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
