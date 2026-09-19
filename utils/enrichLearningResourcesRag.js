/**
 * Learning resources — curated working links first; RAG only as filler.
 * YouTube/course URLs are verified (oEmbed / HEAD) so students don't get 404s.
 */
const axios = require("axios");
const { callLLM } = require("./llm");
const {
  sanitizeResourcePair,
  isBlockedUrl,
  isAllowedHost,
  isWatchYoutube,
  isPublicYoutube,
  curatedForTopic,
  curatedOrDefault,
} = require("../data/curatedLearningLinks");

const ONLINE_MODEL = "openai/gpt-4o-mini:online";
const cache = new Map(); // key -> { web, youtube, source, at }
const urlCheckCache = new Map(); // url -> { ok, at }

function clip(text, n = 200) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function cacheKey(topic, extra = "") {
  return `${String(topic || "").toLowerCase().trim()}|${String(extra || "").toLowerCase().trim()}`.slice(0, 180);
}

function emergencyFallback(topic) {
  return curatedOrDefault(topic);
}

async function callOnlineJson(prompt, maxTokens = 900) {
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "openai/gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: maxTokens,
    },
    // {
    //   model: ONLINE_MODEL,
    //   messages: [{ role: "user", content: prompt }],
    //   temperature: 0.15,
    //   max_tokens: maxTokens,
    // },
    {
      headers: {
        Authorization: "Bearer " + process.env.OPENROUTER_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 45001,
    }
  );
  const raw = response.data.choices?.[0]?.message?.content || "";
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const match = cleaned.match(/(\{[\s\S]*\})/);
  return JSON.parse(match ? match[1] : cleaned);
}

/** True if URL responds (YouTube oEmbed or lightweight HEAD/GET). */
async function urlLooksAlive(url) {
  const u = String(url || "").trim();
  if (!u || !/^https?:\/\//i.test(u) || isBlockedUrl(u)) return false;

  const hit = urlCheckCache.get(u);
  if (hit && Date.now() - hit.at < 12 * 60 * 60 * 1000) return hit.ok;

  let ok = false;
  try {
    if (/youtu(\.be|be\.com)/i.test(u)) {
      if (!isPublicYoutube(u) && !/youtube\.com\/@|youtube\.com\/channel\//i.test(u)) {
        ok = false;
      } else if (isWatchYoutube(u)) {
        const oembed = await axios.get("https://www.youtube.com/oembed", {
          params: { url: u, format: "json" },
          timeout: 8000,
          validateStatus: (s) => s >= 200 && s < 500,
        });
        ok = oembed.status === 200 && Boolean(oembed.data && (oembed.data.title || oembed.data.html));
      } else {
        // Playlist / channel playlists hub — treat as ok if host allowed
        ok = isAllowedHost(u) && isPublicYoutube(u);
      }
    } else {
      const res = await axios.head(u, {
        timeout: 8000,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LearningLinkCheck/1.0)" },
      });
      ok = res.status >= 200 && res.status < 400;
    }
  } catch (_) {
    // Some hosts block HEAD — try GET range
    try {
      const res = await axios.get(u, {
        timeout: 10000,
        maxRedirects: 5,
        responseType: "stream",
        validateStatus: (s) => s >= 200 && s < 400,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; LearningLinkCheck/1.0)",
          Range: "bytes=0-0",
        },
      });
      ok = res.status >= 200 && res.status < 400;
      if (res.data && typeof res.data.destroy === "function") res.data.destroy();
    } catch {
      ok = false;
    }
  }

  urlCheckCache.set(u, { ok, at: Date.now() });
  return ok;
}

async function verifyPair(pair, topic) {
  const fb = curatedOrDefault(topic);
  if (!pair) return fb;

  let web = { ...(pair.web || {}) };
  let youtube = { ...(pair.youtube || {}) };

  const webShapeOk =
    web.url && !isBlockedUrl(web.url) && isAllowedHost(web.url);
  const ytShapeOk =
    youtube.url &&
    !isBlockedUrl(youtube.url) &&
    isPublicYoutube(youtube.url);

  const [webAlive, ytAlive] = await Promise.all([
    webShapeOk ? urlLooksAlive(web.url) : Promise.resolve(false),
    ytShapeOk ? urlLooksAlive(youtube.url) : Promise.resolve(false),
  ]);

  if (!webAlive) web = { ...fb.web };
  if (!ytAlive) youtube = { ...fb.youtube };

  return {
    web,
    youtube,
    source: pair.source || "verified",
    topic: String(topic || "").slice(0, 80),
    why: pair.why || null,
    verified: { web: webAlive, youtube: ytAlive },
  };
}

function normalizeHit(parsed, topic) {
  const fb = curatedOrDefault(topic);
  if (!parsed || typeof parsed !== "object") return fb;
  const webTitle = String(parsed.web?.title || parsed.website?.title || "").trim();
  const webUrl = String(parsed.web?.url || parsed.website?.url || "").trim();
  const ytTitle = String(parsed.youtube?.title || parsed.video?.title || "").trim();
  const ytUrl = String(parsed.youtube?.url || parsed.video?.url || "").trim();
  const okWeb = /^https?:\/\//i.test(webUrl) && !isBlockedUrl(webUrl) && isAllowedHost(webUrl);
  const okYt =
    /^https?:\/\//i.test(ytUrl) &&
    /youtu/i.test(ytUrl) &&
    !isBlockedUrl(ytUrl) &&
    isPublicYoutube(ytUrl);

  return sanitizeResourcePair(
    {
      web: {
        title: webTitle || fb.web.title,
        url: okWeb ? webUrl : fb.web.url,
      },
      youtube: {
        title: ytTitle || fb.youtube.title,
        url: okYt ? ytUrl : fb.youtube.url,
      },
      source: parsed.source || "rag",
      why: String(parsed.why || "").trim().slice(0, 160) || null,
    },
    topic,
    emergencyFallback
  );
}

function buildPrompt(topic, extra = "", academicNote = "") {
  return `
Find the SINGLE BEST **free & public** learning resources for this exact topic.

Topic: "${clip(topic, 120)}"
Context: "${clip(extra, 160)}"
Academic level: ${clip(academicNote, 220) || "Year 2 college — clear, not PhD"}

STRICT RULES:
- FREE only — NEVER Udemy, Coursera, Pluralsight, LinkedIn Learning, Skillshare, paid Medium, or any paywall.
- PUBLIC YouTube only: watch?v=VIDEO_ID OR playlist?list=PLAYLIST_ID (must exist — no invented IDs). Prefer freeCodeCamp / known public playlists.
- Prefer stable hubs: MDN Learn, freeCodeCamp /learn, GeeksforGeeks hubs or ?s= search, Programiz, javascript.info, React.dev, Wikipedia topic pages, GitHub system-design-primer.
- NEVER invent GeeksforGeeks article slugs (they 404). Prefer https://www.geeksforgeeks.org/data-structures/ or https://www.geeksforgeeks.org/?s=TOPIC.
- NEVER invent freeCodeCamp /news/article-slug URLs (they 404). Use https://www.freecodecamp.org/learn/ or a real YouTube watch/playlist.
- If unsure a URL works publicly, DO NOT invent it — omit and we will use a curated fallback.

Return ONLY valid JSON:
{
  "why": "one short reason this pair fits the topic + year",
  "web": { "title": "short title", "url": "https://..." },
  "youtube": { "title": "short title", "url": "https://www.youtube.com/watch?v=... OR playlist?list=..." }
}
`.trim();
}

/**
 * Resolve best website + YouTube for a topic.
 * Order: curated match → verified RAG → curated default.
 */
async function resolveBestResources(topic, extra = "", academicNote = "") {
  const key = cacheKey(topic, `${extra}|${academicNote}`);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.value;

  const t = String(topic || "").trim() || "programming basics";

  // 1) Known-good curated pair for this topic — skip fragile RAG
  const curated = curatedForTopic(t);
  if (curated) {
    const verified = await verifyPair(curated, t);
    cache.set(key, { at: Date.now(), value: { ...verified, source: "curated-free" } });
    return cache.get(key).value;
  }

  // 2) RAG suggestion, then live-verify; replace dead links with curated default
  const prompt = buildPrompt(t, extra, academicNote);
  let parsed = null;
  let mode = "online";

  try {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("no key");
    parsed = await callOnlineJson(prompt);
  } catch (err) {
    mode = "offline";
    try {
      parsed = await callLLM(
        prompt +
          `\n\n(Web search unavailable — use ONLY well-known FREE public URLs: MDN, freeCodeCamp, GFG, youtube.com/watch?v=...). Never invent video IDs.`,
        700
      );
    } catch (err2) {
      const fb = curatedOrDefault(t);
      cache.set(key, { at: Date.now(), value: fb });
      return fb;
    }
  }

  const shaped = normalizeHit(parsed, t);
  const verified = await verifyPair(shaped, t);
  const value = { ...verified, source: `${mode}-verified` };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Sync peek — returns cached RAG hit or null (callers may fall back). */
function peekCachedResources(topic, extra = "") {
  const hit = cache.get(cacheKey(topic, extra));
  return hit?.value || null;
}

/** Warm cache for several topics in parallel (plan generation). */
async function warmTopicResources(topics = [], extra = "", academicNote = "") {
  const uniq = [...new Set(topics.map((t) => String(t || "").trim()).filter(Boolean))].slice(0, 12);
  const out = {};
  await Promise.all(
    uniq.map(async (t) => {
      out[t] = await resolveBestResources(t, extra, academicNote);
    })
  );
  return out;
}

module.exports = {
  resolveBestResources,
  peekCachedResources,
  warmTopicResources,
  emergencyFallback,
  urlLooksAlive,
  verifyPair,
};
