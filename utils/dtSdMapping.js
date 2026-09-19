/**
 * DT Playbook step → related System Design concept + why it connects.
 */
const DT_SD_MAP = [
  {
    match: /problem identification/i,
    sd: "Requirements & Problem Framing",
    why: "Both start by clarifying who is affected, what fails today, and what 'done' means before designing components.",
  },
  {
    match: /similar products/i,
    sd: "Competitive Architecture Scan",
    why: "Studying similar products maps to surveying existing system approaches and spotting gaps your design must fill.",
  },
  {
    match: /my ideas/i,
    sd: "Design Alternatives & Trade-offs",
    why: "Brainstorming ideas mirrors listing architecture options before converging on one approach.",
  },
  {
    match: /audience|persona|empathy/i,
    sd: "User Journeys & Client-Side Concerns",
    why: "Personas and empathy maps drive which clients, latency, and UX constraints the system must serve.",
  },
  {
    match: /focus/i,
    sd: "MVP Scope & Non-Goals",
    why: "A focus statement is the system’s MVP boundary — what must ship now vs what stays out of v1.",
  },
  {
    match: /tech stack/i,
    sd: "Technology Choices & Constraints",
    why: "Stack suggestions are early system design decisions: language, UI, and storage for this problem.",
  },
  {
    match: /process flow/i,
    sd: "Message Queues & Stream Processing",
    why: "Process flows and queues both sequence steps and move work between components reliably.",
  },
  {
    match: /pitch among peers/i,
    sd: "Architecture Narratives & Diagrams",
    why: "Pitching clarity maps to explaining your system diagram and defending design choices under questions.",
  },
  {
    match: /user actions/i,
    sd: "API Endpoints & Use Cases",
    why: "Each user action becomes a use case or API the system must support.",
  },
  {
    match: /app state/i,
    sd: "State Management & Data Models",
    why: "App state changes map to how the system stores and transitions entity state.",
  },
  {
    match: /features/i,
    sd: "Service Boundaries & Modules",
    why: "Grouping features foreshadows how you split services or modules in the architecture.",
  },
  {
    match: /inclusion/i,
    sd: "Reliability, Edge Cases & Accessibility",
    why: "Edge-case users map to failure modes, degraded networks, and inclusive system behaviour.",
  },
  {
    match: /ui\/ux|sketch|storyboard|refine behaviour|design style|figma/i,
    sd: "Client Architecture & Interaction Flows",
    why: "Screens and interactions define the client layer and how it talks to backend services.",
  },
  {
    match: /mvc/i,
    sd: "MVC / Layered Architecture",
    why: "MVC is a classic system pattern: Models (data), Views (UI), Controllers (actions).",
  },
  {
    match: /prepare test|observation|interview|reiterate|app pitch/i,
    sd: "Observability, Feedback Loops & Iteration",
    why: "Usability tests mirror production feedback loops — measure behaviour, then improve the system.",
  },
  {
    match: /bmc|sales pitch|final pitch/i,
    sd: "Capacity, Cost & Business Constraints",
    why: "Business model constraints shape scale, cost, and what the architecture must support commercially.",
  },
];

function resolveSdForDtStep(dtStep, fallbackTitle = "") {
  const step = String(dtStep?.step || "");
  const stage = String(dtStep?.stage || "");
  const hay = `${step} ${stage}`;
  for (const row of DT_SD_MAP) {
    if (row.match.test(hay)) {
      return {
        title: row.sd,
        why: row.why,
        dtStep: step || null,
      };
    }
  }
  return {
    title: fallbackTitle || "High-level components for today's problem",
    why: step
      ? `Today's DT step "${step}" needs a matching system idea so the project architecture stays aligned with the playbook.`
      : "System Design today supports the same problem piece you are learning in the DT Playbook.",
    dtStep: step || null,
  };
}

module.exports = { DT_SD_MAP, resolveSdForDtStep };
