/**
 * 30+ unique motivation quotes tagged by theme + week band.
 */
const MOTIVATION_QUOTES = [
  { text: "Start with clarity: one problem sentence beats ten vague goals.", theme: "learning", week: 1 },
  { text: "Today's job is understanding — not finishing the whole product.", theme: "learning", week: 1 },
  { text: "Write the assumption down. Guessing silently is how projects drift.", theme: "confidence", week: 1 },
  { text: "If you can teach today's idea in 4 lines, you own it.", theme: "learning", week: 1 },
  { text: "Small notes today become tomorrow's architecture.", theme: "delivery", week: 1 },
  { text: "Ask the awkward question early — silence costs more later.", theme: "teamwork", week: 1 },
  { text: "Progress is a clearer problem statement than yesterday.", theme: "persistence", week: 1 },
  { text: "Curiosity first, code second — especially on Empathize days.", theme: "learning", week: 1 },
  { text: "Name the user. 'Everyone' is not a customer.", theme: "confidence", week: 1 },
  { text: "A messy sketch beats a blank page.", theme: "delivery", week: 1 },
  { text: "You are building momentum — keep the next brick small.", theme: "persistence", week: 2 },
  { text: "Ship a slice you can demo, not a dream you cannot show.", theme: "delivery", week: 2 },
  { text: "When stuck, shrink the task until it fits in 25 minutes.", theme: "persistence", week: 2 },
  { text: "Pair for five minutes — a second brain finds the gap faster.", theme: "teamwork", week: 2 },
  { text: "Trade-offs are adult design. Pick one and write why.", theme: "confidence", week: 2 },
  { text: "Your diagram is a promise: keep it honest and labeled.", theme: "delivery", week: 2 },
  { text: "Reuse yesterday's output — that is how weeks compound.", theme: "learning", week: 2 },
  { text: "Bugs are feedback in work clothes. Log one, fix one.", theme: "persistence", week: 2 },
  { text: "Make the happy path work before decorating the edges.", theme: "delivery", week: 2 },
  { text: "Confidence grows when you finish the checklist, not when you scroll.", theme: "confidence", week: 2 },
  { text: "Finish the loop: detect → decide → show a result.", theme: "delivery", week: 3 },
  { text: "Polish the demo path. Reviewers remember the story.", theme: "delivery", week: 3 },
  { text: "Cut one feature so the core feature can shine.", theme: "confidence", week: 3 },
  { text: "Document what broke — future you is a teammate.", theme: "teamwork", week: 3 },
  { text: "A working minute of demo beats an hour of slides.", theme: "delivery", week: 3 },
  { text: "Close open questions or park them with owners.", theme: "persistence", week: 3 },
  { text: "Practice the pitch once out loud — clarity is a skill.", theme: "confidence", week: 3 },
  { text: "Ship the evidence: files, screens, and a honest limitation list.", theme: "delivery", week: 3 },
  { text: "Celebrate the boring win: tests pass, notes saved, peer checked.", theme: "teamwork", week: 3 },
  { text: "End strong: one improvement for next week, written down.", theme: "persistence", week: 3 },
  { text: "Learning compounds when you connect SD, DT, and code the same day.", theme: "learning", week: 2 },
  { text: "Your project domain is the best teacher — stay inside it.", theme: "learning", week: 2 },
];

function pickMotivationQuote(dayIdx = 0, weekNum = 1, usedTexts = [], themeHint = "") {
  const week = Math.max(1, Math.min(3, Number(weekNum) || 1));
  const used = new Set((usedTexts || []).map(String));
  const theme = String(themeHint || "").toLowerCase();
  let pool = MOTIVATION_QUOTES.filter((q) => q.week === week && !used.has(q.text));
  if (theme) {
    const themed = pool.filter((q) => q.theme === theme || theme.includes(q.theme));
    if (themed.length) pool = themed;
  }
  if (!pool.length) {
    pool = MOTIVATION_QUOTES.filter((q) => !used.has(q.text));
  }
  if (!pool.length) pool = MOTIVATION_QUOTES.slice();
  const pick = pool[Math.max(0, Number(dayIdx) || 0) % pool.length];
  return pick.text;
}

module.exports = { MOTIVATION_QUOTES, pickMotivationQuote };
