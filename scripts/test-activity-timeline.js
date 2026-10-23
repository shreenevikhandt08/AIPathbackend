/* Run: node scripts/test-activity-timeline.js */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const T = require("../utils/activityTimeline");

const m = T.hhmmToMin;
const defaults = [
  ["standup", "09:00", "09:15"], ["problem", "09:15", "09:45"], ["learning", "09:45", "11:00"],
  ["break", "11:00", "11:15"], ["sysdesign", "11:15", "12:15"], ["lunch", "12:15", "13:00"],
  ["coding", "13:00", "14:00"], ["project", "14:00", "15:30"], ["speak", "15:30", "16:00"],
  ["placement", "16:00", "16:30"], ["agent", "16:30", "17:00"], ["game", "17:00", "17:15"],
  ["profile", "17:15", "17:45"], ["close", "17:45", "18:00"],
];
const periods = () => defaults.map(([id, start, end], i) => ({ order: i + 1, id, title: id, start, end, clock: "x" }));

// 1. stale default layout + Basics 8:30–16:30, lunch 12:30–13:15, break 10:45–11:00 → re-fitted
let inputs = {
  _dailyStart: "08:30", _dailyEnd: "16:30", _lunchStart: "12:30", _lunchEnd: "13:15",
  _breaks: JSON.stringify([{ start: "10:45", end: "11:00" }]),
  _dayTemplate: JSON.stringify(periods()),
};
let r = T.enforceBasicsTiming(inputs);
assert(r.changed, "stale layout must be re-fitted");
let out = JSON.parse(inputs._dayTemplate);
const by = Object.fromEntries(out.map((p) => [p.id, p]));
assert.deepStrictEqual([by.lunch.start, by.lunch.end], ["12:30", "13:15"]);
assert.deepStrictEqual([by.break.start, by.break.end], ["10:45", "11:00"]);
const rows = out.map((p) => ({ id: p.id, start: m(p.start), end: m(p.end) }));
const insp = T.inspectLayout({ dayStart: m("08:30"), dayEnd: m("16:30"), rows });
assert.strictEqual(insp.overlaps.length + insp.outside.length + insp.idle.length, 0, JSON.stringify(insp));
assert.strictEqual(typeof inputs._dayTemplate, "string", "keeps string type");

// 2. already-correct layout is left alone
const again = JSON.stringify(out);
r = T.enforceBasicsTiming(inputs);
assert(!r.changed && inputs._dayTemplate === again, "correct layout must not change");

// 3. default day, nothing in Basics → untouched
inputs = { _dailyStart: "09:00", _dailyEnd: "18:00", _dayTemplate: JSON.stringify(periods()) };
assert(!T.enforceBasicsTiming(inputs).changed);

// 4. no template / junk → no crash
assert(!T.enforceBasicsTiming({}).changed);
assert(!T.enforceBasicsTiming({ _dayTemplate: "not json", _dailyStart: "09:00", _dailyEnd: "18:00" }).changed);

// 5. activity outside the day only
inputs = { _dailyStart: "09:00", _dailyEnd: "15:00", _dayTemplate: JSON.stringify(periods()) };
assert(T.enforceBasicsTiming(inputs).changed);
assert(JSON.parse(inputs._dayTemplate).every((p) => m(p.end) <= m("15:00") && m(p.start) >= m("09:00")));

// 6. parity with the frontend algorithm (same source) — catches drift
const fePath = path.join(__dirname, "../../AIPathfrontend/src/utils/dayLayout.js");
if (fs.existsSync(fePath)) {
  const feSrc = fs.readFileSync(fePath, "utf8");
  const cjs = feSrc.replace(/export const/g, "const").replace(/export function/g, "function") +
    "\nmodule.exports={flowIntoGaps,planRestBlocks};";
  const mod = { exports: {} };
  new Function("module", "exports", cjs)(mod, mod.exports);
  const items = periods().map((p) => (p.id === "lunch" ? { id: p.id, fixed: true, start: m("13:00"), end: m("13:45") } : { id: p.id, weight: m(p.end) - m(p.start) }));
  const a = T.flowIntoGaps({ dayStart: m("08:30"), dayEnd: m("17:00"), items });
  const b = mod.exports.flowIntoGaps({ dayStart: m("08:30"), dayEnd: m("17:00"), items });
  assert.deepStrictEqual(a.placed, b.placed, "frontend/backend layout drift");
}
console.log("activity timeline: all tests passed");
