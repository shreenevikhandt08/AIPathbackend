/**
 * Learning links for a topic — prefers web RAG (best site + YouTube).
 * Ebook page hints still come only from student uploads.
 */
const {
  resolveBestResources,
  peekCachedResources,
  emergencyFallback,
} = require("./enrichLearningResourcesRag");

function clip(text, n = 400) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function ensureSeenSet(inputs = {}) {
  if (!inputs._seenResourceUrls) {
    inputs._seenResourceUrls = new Set();
  } else if (!(inputs._seenResourceUrls instanceof Set)) {
    inputs._seenResourceUrls = new Set(
      Array.isArray(inputs._seenResourceUrls) ? inputs._seenResourceUrls : []
    );
  }
  return inputs._seenResourceUrls;
}

/**
 * Label Website/YouTube lines — always emit a real clickable https URL.
 * Prefer curated hubs / public watch+playlist links (never invent article slugs).
 */
function markResourceLines(items = [], inputs = {}, topic = "") {
  const seen = ensureSeenSet(inputs);
  const lines = [];
  const topicLabel = String(topic || "today's topic").replace(/\s+/g, " ").trim().slice(0, 60);
  const {
    curatedOrDefault,
    curatedForTopic,
    isBlockedUrl,
    isAllowedHost,
    isPublicYoutube,
    gfgGuideForPattern,
  } = require("../data/curatedLearningLinks");

  const stableFallback = (kind, label) => {
    const fb = curatedForTopic(label) || curatedOrDefault(label);
    if (kind === "YouTube") {
      return {
        title: fb.youtube.title,
        url: fb.youtube.url,
      };
    }
    // Prefer a GFG hub/search over random DuckDuckGo for coding-ish topics
    if (/array|stack|queue|tree|graph|hash|sort|search|dp|dsa|algorithm|sql|link/i.test(label)) {
      const g = gfgGuideForPattern(label);
      return { title: g.title, url: g.url };
    }
    return {
      title: fb.web.title,
      url: fb.web.url,
    };
  };

  for (const item of items) {
    let url = String(item.url || "").trim();
    let title = String(item.title || item.kind || "Link").trim();
    const kind = String(item.kind || (/youtube|youtu\.be/i.test(url) ? "YouTube" : "Website"));

    const urlOk =
      url &&
      /^https?:\/\//i.test(url) &&
      !isBlockedUrl(url) &&
      (kind === "YouTube" ? isPublicYoutube(url) : isAllowedHost(url));

    if (!urlOk) {
      const fb = stableFallback(kind, topicLabel);
      url = fb.url;
      title = fb.title || title;
    }

    if (seen.has(url)) {
      const fb = curatedOrDefault(`${topicLabel} alternate`);
      const altUrl = kind === "YouTube" ? fb?.youtube?.url : fb?.web?.url;
      const altTitle = kind === "YouTube" ? fb?.youtube?.title : fb?.web?.title;
      if (altUrl && !seen.has(altUrl) && !isBlockedUrl(altUrl)) {
        url = altUrl;
        title = altTitle || title;
      } else {
        const s = stableFallback(kind, `${topicLabel} practice`);
        if (!seen.has(s.url)) {
          url = s.url;
          title = s.title;
        }
      }
    }

    seen.add(url);
    lines.push(`   · ${kind}: ${title} — ${url}`);
  }
  return lines;
}

/**
 * Sync pick — curated working links first; then verified RAG cache; never invent dead URLs.
 * Rotates by day/topic so the same pair is not always returned.
 */
function pickResourcesForTopic(topic, extra = "", pack = null, opts = {}) {
  const {
    sanitizeResourcePair,
    curatedOrDefault,
    pickVariedCuratedPair,
  } = require("../data/curatedLearningLinks");

  const dayIdx = Number(opts.dayIdx) || 0;
  const seen = opts.seenUrls || null;
  const varied = pickVariedCuratedPair(topic, { dayIdx, seenUrls: seen });
  if (varied?.web?.url) return varied;

  // Only trust packs that were live-verified (or curated-sourced)
  const packTrusted =
    pack &&
    (pack.verified ||
      /curated|verified/i.test(String(pack.source || "")) ||
      (pack.verified?.web && pack.verified?.youtube));
  if (packTrusted && pack?.web?.url && pack?.youtube?.url) {
    return sanitizeResourcePair(pack, topic, emergencyFallback);
  }

  const cached = peekCachedResources(topic, extra);
  if (cached?.web?.url && cached?.youtube?.url) {
    return sanitizeResourcePair(cached, topic, emergencyFallback);
  }
  const cachedTopic = peekCachedResources(topic, "");
  if (cachedTopic?.web?.url && cachedTopic?.youtube?.url) {
    return sanitizeResourcePair(cachedTopic, topic, emergencyFallback);
  }
  return curatedOrDefault(topic);
}

async function resolveResourcesForTopic(topic, extra = "", academicNote = "") {
  return resolveBestResources(topic, extra, academicNote);
}

/** True when the student actually uploaded ebook / syllabus / notes text. */
function hasUploadedEbook(inputs = {}) {
  const keys = ["instructions", "dsaSyllabus", "systemDesign", "syllabus", "questions"];
  return keys.some((k) => String(inputs[k] || "").trim().length >= 40);
}

/**
 * Ebook / notes page hints — ONLY when the student uploaded a file.
 * Plain student language (no jargon about "write page numbers for reopen").
 */
function ebookHintsFromUploads(inputs = {}, topic = {}) {
  if (!hasUploadedEbook(inputs)) return [];

  const sources = [
    { key: "instructions", label: "your uploaded notes / instructions PDF" },
    { key: "dsaSyllabus", label: "your uploaded DSA / coding PDF" },
    { key: "systemDesign", label: "your uploaded System Design PDF" },
    { key: "syllabus", label: "your uploaded syllabus PDF" },
    { key: "questions", label: "your uploaded question-bank PDF" },
  ];

  const topicWords = String(topic || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
    .slice(0, 6);

  const hints = [];

  for (const src of sources) {
    const text = String(inputs[src.key] || "");
    if (text.length < 40) continue;

    const pageHits = [...text.matchAll(/\b(?:pages?|pp\.?)\s*(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?/gi)];
    if (pageHits.length) {
      const first = pageHits[0];
      const a = first[1];
      const b = first[2];
      hints.push(
        b
          ? `▶ From ${src.label}: open pages ${a}–${b} and read the section about today's topic.`
          : `▶ From ${src.label}: start near page ${a}, then find the section about today's topic.`
      );
      continue;
    }

    if (topicWords.length) {
      const lower = text.toLowerCase();
      const hit = topicWords.find((w) => lower.includes(w));
      if (hit) {
        hints.push(
          `▶ From ${src.label}: press Ctrl+F (Find), search for "${hit}", and read that section for today's topic.`
        );
      }
    }
  }

  if (!hints.length) {
    const q = clip(topic, 40) || "today's topic";
    hints.push(
      `▶ From your upload: open the PDF you uploaded, press Ctrl+F, search for "${q}", and read that section.`
    );
  }

  return hints.slice(0, 2);
}

/**
 * Merge RAG / curated links with upload ebook hints.
 * Always varies website+video by day/topic; Tamil medium → Tamil YouTube only (English sites).
 */
function buildLearningLinkLines(topic, gap = {}, inputs = {}) {
  const dayIdx = Number(gap.dayIdx ?? inputs._dayIdx ?? 0) || 0;

  try {
    const { buildPersonaLinkLines } = require("./personaDevelopment");
    const { lines } = buildPersonaLinkLines(topic, inputs || {}, { dayIdx });
    return (lines || []).filter(Boolean).slice(0, 2);
  } catch (e) {
    console.warn("[buildLearningLinkLines] persona path skipped:", e.message);
  }

  const ragPack =
    gap.learnResourcePack ||
    inputs?._topicResourceCache?.[topic] ||
    null;
  const seen = inputs?._seenResourceUrls;
  const curated = pickResourcesForTopic(
    topic,
    `${gap.learnSubject || ""} ${(gap.subtopics || []).join(" ")}`,
    ragPack,
    { dayIdx, seenUrls: seen instanceof Set ? seen : null }
  );
  if (curated?.web?.url && seen instanceof Set) seen.add(curated.web.url);
  if (curated?.youtube?.url && seen instanceof Set) seen.add(curated.youtube.url);

  const lines = [
    ...markResourceLines(
      [
        { kind: "Website", title: curated.web.title, url: curated.web.url },
        { kind: "YouTube", title: curated.youtube.title, url: curated.youtube.url },
      ],
      inputs,
      topic
    ),
  ];

  const llmLinks = Array.isArray(gap.learnLinks) ? gap.learnLinks.filter(Boolean).slice(0, 2) : [];
  const { isBlockedUrl, isPublicYoutube, isAllowedHost, curatedOrDefault } = require("../data/curatedLearningLinks");
  for (const link of llmLinks) {
    const s = String(link).trim();
    if (!s) continue;
    if (/youtube\.com|youtu\.be/i.test(s)) {
      if (isBlockedUrl(s) || !isPublicYoutube(s)) {
        const fb = curatedOrDefault(topic);
        lines.push(
          ...markResourceLines(
            [{ kind: "YouTube", title: fb.youtube.title, url: fb.youtube.url }],
            inputs,
            topic
          )
        );
        continue;
      }
      lines.push(...markResourceLines([{ kind: "YouTube", title: "Extra video", url: s }], inputs, topic));
    } else if (/^https?:\/\//i.test(s)) {
      if (isBlockedUrl(s) || !isAllowedHost(s)) {
        const fb = curatedOrDefault(topic);
        lines.push(
          ...markResourceLines(
            [{ kind: "Website", title: fb.web.title, url: fb.web.url }],
            inputs,
            topic
          )
        );
        continue;
      }
      lines.push(...markResourceLines([{ kind: "Website", title: "Extra article", url: s }], inputs, topic));
    } else if (/^search:/i.test(s)) {
      // Convert bare Search: into curated public links (no invented slugs)
      const q = s.replace(/^search:\s*/i, "").trim() || topic;
      lines.push(
        ...markResourceLines(
          [
            {
              kind: /youtube/i.test(q) ? "YouTube" : "Website",
              title: q,
              url: "",
            },
          ],
          inputs,
          topic
        )
      );
    } else if (!/upload|ctrl\+f|ebook|pdf you uploaded/i.test(s)) {
      lines.push(`   · Extra: ${s}`);
    }
  }

  // Ebook / Ctrl+F tips ONLY when the student actually uploaded docs
  if (hasUploadedEbook(inputs)) {
    const hints = ebookHintsFromUploads(inputs, topic);
    for (const h of hints.slice(0, 1)) lines.push(h);
  }

  return lines;
}

function skillTypeLabel(skill) {
  const s = String(skill || "").toLowerCase();
  if (s === "logical") return "Logical thinking";
  if (s === "business") return "Business thinking";
  if (s === "analytical") return "Analytical thinking";
  if (s === "technical") return "Technical thinking";
  if (s === "empathy") return "User empathy / design thinking";
  return "Product thinking";
}

module.exports = {
  pickResourcesForTopic,
  resolveResourcesForTopic,
  ebookHintsFromUploads,
  hasUploadedEbook,
  buildLearningLinkLines,
  markResourceLines,
  skillTypeLabel,
};
