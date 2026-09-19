/**
 * System Design for beginners — lessons + references from RAG when available.
 * Falls back to a tiny emergency overview only if RAG pack is missing.
 */

const { pickResourcesForTopic, markResourceLines } = require("./learningResources");
const { getSdLessonFromPack, emergencyLessons } = require("./enrichSystemDesignCurriculumRag");

function softClip(text, n = 160) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const slice = t.slice(0, n);
  const sp = slice.lastIndexOf(" ");
  return `${(sp > 40 ? slice.slice(0, sp) : slice).trim()}`;
}

function projectHint(theme) {
  const p = softClip(theme?.project || theme?.problem || "", 90);
  return p || "your problem";
}

function extractMainTopic(systemDesignText, dayIdx = 0) {
  const raw = String(systemDesignText || "").trim();
  if (!raw) return "System Design basics";
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-–—*▶•\d\.\)\s]+/, "").trim())
    .filter((l) => l.length >= 8 && l.length <= 120);
  if (lines.length) {
    return softClip(lines[Math.max(0, dayIdx) % lines.length], 90);
  }
  return softClip(raw.split(/(?<=[.!?])\s+/)[0] || "System Design basics", 90);
}

function lessonForDay(dayIdx, lessonPack = null) {
  const fromRag = getSdLessonFromPack(lessonPack, dayIdx);
  if (fromRag) return fromRag;
  const fb = emergencyLessons(Math.max(12, Number(dayIdx) + 1));
  return fb[Math.max(0, Number(dayIdx) || 0) % fb.length];
}

/**
 * Beginner System Design block — RAG curriculum + best topic links.
 */
function buildSystemDesignLesson(theme = {}, daySlice = null, opts = {}) {
  const dayIdx = Number(opts.dayIdx || 0);
  const project = projectHint(theme);
  const uploadedSd = String(opts.inputs?.systemDesign || theme.systemDesign || "").trim();
  const lessonPack =
    opts.sdLessonPack ||
    opts.inputs?._systemDesignLessonPack ||
    opts.sdRagPack?._lessonPack ||
    null;
  const dtStep = opts.dtStep || null;

  const { resolveSdForDtStep } = require("./dtSdMapping");
  const mapped = resolveSdForDtStep(dtStep, "");
  let lesson = lessonForDay(dayIdx, lessonPack);
  // Prefer DT-linked title when playbook step is present
  if (dtStep?.step && mapped?.title) {
    lesson = {
      ...lesson,
      title: mapped.title,
      learn: lesson.learn || mapped.title,
      note: lesson.note || mapped.why,
    };
  }

  const uploadHint = uploadedSd
    ? softClip(
        uploadedSd
          .split(/\r?\n/)
          .map((l) => l.replace(/^[-–—*▶•\d\.\)\s]+/, "").trim())
          .filter((l) => l.length >= 12)[dayIdx % 5] || "",
        140
      )
    : "";

  const dayNum = dayIdx + 1;
  const isOverview = dayIdx === 0 || /overview/i.test(String(lesson.title || ""));

  // Chapter transition when SD title changes from previous day
  const prevLesson = dayIdx > 0 ? lessonForDay(dayIdx - 1, lessonPack) : null;
  const prevTitle = dayIdx > 0 && dtStep
    ? resolveSdForDtStep(
        { step: String(opts.prevDtStep?.step || prevLesson?.title || "") },
        prevLesson?.title || ""
      ).title
    : prevLesson?.title;
  const transition =
    dayIdx > 0 &&
    prevTitle &&
    lesson.title &&
    String(prevTitle).toLowerCase() !== String(lesson.title).toLowerCase()
      ? `▶ Transition: You have finished "${softClip(prevTitle, 60)}". Today we move to "${softClip(lesson.title, 60)}" because ${softClip(mapped.why || "it is the next building block for your problem", 120)}.`
      : null;

  let refs;
  if (lesson.web?.url && lesson.youtube?.url) {
    refs = { web: lesson.web, youtube: lesson.youtube };
  } else {
    refs = pickResourcesForTopic(
      lesson.title || "system design",
      isOverview
        ? "system design overview high-level architecture scalability"
        : `${lesson.title} system design architecture beginner`
    );
  }

  const linkLines = markResourceLines(
    [
      { kind: "Website", title: refs.web.title, url: refs.web.url },
      { kind: "YouTube", title: refs.youtube.title, url: refs.youtube.url },
    ],
    opts.inputs || {}
  );

  const applyLine = isOverview
    ? `▶ Apply to your problem: In notes/system-design.md write how "${softClip(project, 70)}" fits Client → Logic → Store (3 labeled boxes).`
    : `▶ Apply to your problem: In notes/system-design.md under Day ${dayNum}, write where "${lesson.title}" shows up in "${softClip(project, 70)}" (2 bullets).`;

  const whyConnect =
    mapped?.why ||
    `Today's DT work and this System Design idea both support the same problem piece: "${softClip(project, 70)}".`;

  return [
    isOverview
      ? `▶ Heading: System Design overview — start here after reading today's problem`
      : `▶ Heading: ${lesson.title}`,
    dtStep?.step ? `▶ DT Playbook Step today: ${dtStep.step}` : null,
    `▶ Why this connects: ${whyConnect}`,
    transition,
    `▶ Today's lesson: ${lesson.title}`,
    `▶ What to learn: ${lesson.learn}`,
    `▶ In plain words: ${lesson.note}`,
    applyLine,
    `▶ Read / watch:`,
    `   ${lesson.doc}`,
    `▶ Do now: ${lesson.doNow}`,
    uploadHint
      ? `▶ Extra hint from your System Design notes: ${uploadHint}`
      : null,
    `▶ Helpful links:`,
    ...linkLines,
    isOverview
      ? `▶ Done when: notes/system-design.md exists with a Day 1 heading AND 3 labeled boxes (Client / Logic / Store) for your problem.`
      : `▶ Done when: notes/system-design.md has a heading for Day ${dayNum} AND includes 2 bullets linking "${softClip(lesson.title, 40)}" to your project.`,
  ].filter(Boolean).join("\n");
}

module.exports = {
  buildSystemDesignLesson,
  extractMainTopic,
  lessonForDay,
};
