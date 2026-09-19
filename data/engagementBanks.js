/**
 * Engagement bank SHAPE only.
 * Products / project breakdown come from RAG (enrichAssessmentBanksRag).
 * Refresh games stay as fixed classroom activities (not inventable content).
 */
const DAILY_PRODUCTS = [];
const PROJECT_BREAKDOWN = [];

/** Short 8–12 min refreshers — Hollywood-style classroom games */
const REFRESH_GAMES = [
  {
    name: "Hollywood (Tech Edition)",
    minutes: 10,
    how:
      "One student thinks of a tech product/movie title. Others ask YES/NO questions only (max 12). " +
      "Guess the title. Losing team does a 20-sec victory dance for the winners.",
  },
  {
    name: "Bollywood One-Word",
    minutes: 8,
    how:
      "Faculty gives a theme (e.g. 'comeback'). Teams shout one Bollywood movie fitting the theme. " +
      "No repeats. Fastest valid answer scores. End with: what product 'comeback' story did we learn?",
  },
  {
    name: "Pictionary — Product Features",
    minutes: 10,
    how:
      "Draw a product feature (search bar, cart, login, notification) without letters. Team guesses in 60s. " +
      "Then name where that feature appears in YOUR project.",
  },
  {
    name: "Two Truths & A Bug",
    minutes: 8,
    how:
      "Each student states 2 true facts about today's work and 1 fake 'bug'. Others spot the fake. " +
      "Builds listening + debugging instinct.",
  },
  {
    name: "60-Second Pitch Relay",
    minutes: 10,
    how:
      "Team stands in a line. Person 1 starts pitching today's problem (20s), next continues, no notes. " +
      "Goal: coherent pitch by the end. Confidence builder.",
  },
  {
    name: "Emoji Empathy",
    minutes: 8,
    how:
      "Show 5 emojis that represent your user's day. Peers guess the pain point. " +
      "Connect the winning guess to today's DT step.",
  },
  {
    name: "Stack Shuffle",
    minutes: 10,
    how:
      "Cards/words: Frontend, Backend, DB, Auth, Deploy. Race to order them for YOUR project pipeline. " +
      "Explain why in one sentence each.",
  },
  {
    name: "Yes/No Hot Seat",
    minutes: 8,
    how:
      "One student is the 'product'. Class asks yes/no about target user until they guess the persona. " +
      "Then the hot-seat student reveals their real persona from the problem statement.",
  },
];

module.exports = { DAILY_PRODUCTS, REFRESH_GAMES, PROJECT_BREAKDOWN };
