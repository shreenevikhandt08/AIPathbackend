const ScheduleRepository = require("../models/ScheduleRepository");
const { buildScheduleFingerprint } = require("../utils/scheduleFingerprint");

function previewProblem(inputs = {}) {
  return String(inputs.problem || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function profileLabel(key = {}) {
  const bits = [
    key.department && `Dept: ${String(key.department).toUpperCase()}`,
    key.year ? `Year: ${key.year}` : "",
  ].filter(Boolean);
  return bits.join(" · ") || "";
}

function slimMatch(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  const hwRows = Array.isArray(o.homework?.rows) ? o.homework.rows.length : 0;
  const versionCount = Array.isArray(o.versions) ? o.versions.length : 0;
  return {
    id: String(o._id),
    title: o.title || o.memberName || "Saved schedule",
    memberName: o.memberName || "",
    memberKey: o.memberKey || "",
    fingerprint: o.fingerprint,
    softFingerprint: o.softFingerprint,
    cohortKey: o.cohortKey || "",
    campus: o.campus,
    department: o.department,
    year: o.year,
    semester: o.semester,
    mode: o.mode,
    numDays: o.numDays,
    useCount: o.useCount || 0,
    kind: o.kind || "personal",
    status: o.status || "published",
    visibility: o.visibility || "cohort",
    updatedAt: o.updatedAt,
    createdAt: o.createdAt,
    plan: o.plan,
    weekly: o.weekly || null,
    homework: o.homework || null,
    versions: o.versions || [],
    bundleMeta: o.bundleMeta || {},
    rowCount: Array.isArray(o.plan?.rows) ? o.plan.rows.length : 0,
    weeklyRowCount: Array.isArray(o.weekly?.rows) ? o.weekly.rows.length : 0,
    homeworkRowCount: hwRows,
    versionCount,
    problemPreview: o.problemPreview || previewProblem(o.inputsSnapshot || {}),
  };
}

function slimCard(doc) {
  const full = slimMatch(doc);
  if (!full) return null;
  const { plan, weekly, homework, versions, ...card } = full;
  return card;
}

function resolveMemberName(inputs = {}, extra = {}) {
  if (extra.memberName) return String(extra.memberName).trim();
  if (inputs.memberName) return String(inputs.memberName).trim();
  if (inputs._memberName) return String(inputs._memberName).trim();
  // Team primary member
  try {
    let team = inputs._teamMembers || inputs.teamMembers;
    if (typeof team === "string") team = JSON.parse(team);
    if (Array.isArray(team)) {
      const named = team.find((m) => m?.name && String(m.name).trim());
      if (named?.name) return String(named.name).trim();
    }
  } catch (_) {}
  return "";
}

function basePayload(inputs, plan, weekly, userId, extra = {}) {
  const { hash, softHash, key, cohortKey } = buildScheduleFingerprint(inputs || {});
  const memberName = resolveMemberName(inputs, extra);
  const title =
    extra.title ||
    plan?.title ||
    memberName ||
    `${key.department || "Dept"} · Year ${key.year || "?"}`.trim();
  const homework = extra.homework || null;
  const versions = Array.isArray(extra.versions) ? extra.versions : [];
  const memberKey = String(extra.memberKey || "").trim();
  const dailyRows = Array.isArray(plan?.rows) ? plan.rows.length : 0;
  const weeklyRows = Array.isArray(weekly?.rows) ? weekly.rows.length : 0;
  const homeworkRows = Array.isArray(homework?.rows) ? homework.rows.length : 0;
  return {
    fingerprint: hash,
    softFingerprint: softHash,
    cohortKey,
    key,
    title,
    memberName,
    memberKey,
    plan,
    weekly: weekly || null,
    homework: homework || null,
    versions,
    bundleMeta: {
      dailyRows,
      weeklyRows,
      homeworkRows,
      versionCount: versions.length,
      savedAt: new Date().toISOString(),
      includes: {
        daily: dailyRows > 0,
        weekly: weeklyRows > 0,
        homework: homeworkRows > 0,
        versions: versions.length > 0,
      },
    },
    inputsSnapshot: {
      college: inputs.college || "",
      department: inputs.department || "",
      collegeYear: inputs.collegeYear ?? null,
      schoolGrade: inputs.schoolGrade ?? null,
      semester: inputs.semester ?? null,
      _plannerMode: inputs._plannerMode || "",
      _numDays: inputs._numDays || null,
      problem: String(inputs.problem || "").slice(0, 1200),
      memberName,
      memberKey,
    },
    campus: key.campus,
    department: key.department,
    year: key.year,
    semester: key.semester,
    mode: key.mode,
    numDays: key.days,
    problemPreview: previewProblem(inputs),
    sourceUserId: userId || null,
    kind: extra.kind || "personal",
    status: extra.status || "published",
    visibility: extra.visibility || "cohort",
    isPublic: (extra.visibility || "cohort") !== "private",
  };
}

function homeworkFromDaily(plan) {
  try {
    const { extractHomeworkNightsFromRows } = require("../utils/homeworkExtract");
    const nights = extractHomeworkNightsFromRows(plan?.rows || []);
    const rows = (plan?.rows || []).filter(
      (r) => Array.isArray(r) && /homework/i.test(String(r[2] || ""))
    );
    if (!rows.length && !(Array.isArray(nights) && nights.length)) return null;
    return {
      module: "homework",
      title: "Tonight's Homework",
      rows,
      nights: Array.isArray(nights) && nights.length ? nights : undefined,
    };
  } catch (_) {
    const rows = (plan?.rows || []).filter(
      (r) => Array.isArray(r) && /homework/i.test(String(r[2] || ""))
    );
    return rows.length
      ? { module: "homework", title: "Tonight's Homework", rows }
      : null;
  }
}

function slugMemberKey(value) {
  return (
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "default"
  );
}

/**
 * Load this member's PlanVersion history (full plans) for archive.
 */
async function loadMemberVersions(userId, memberKey, memberName) {
  if (!userId) return [];
  try {
    const PlanVersion = require("../models/PlanVersion");
    const key = String(memberKey || "").trim();
    const filter = { userId };
    if (key) filter.memberKey = key;
    else if (memberName) {
      filter.$or = [
        { memberName: new RegExp(`^${String(memberName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
        { memberKey: slugMemberKey(memberName) },
      ];
    }
    const docs = await PlanVersion.find(filter)
      .sort({ memberVersion: 1, version: 1 })
      .select(
        "version memberVersion memberKey memberName changeType reason trigger createdAt plan protected"
      )
      .lean();
    return (docs || []).map((d) => ({
      version: d.version,
      memberVersion: d.memberVersion || d.version,
      memberKey: d.memberKey || key || "default",
      memberName: d.memberName || memberName || "",
      changeType: d.changeType || "",
      reason: d.reason || "",
      trigger: d.trigger || "",
      protected: Boolean(d.protected),
      createdAt: d.createdAt,
      plan: d.plan || null,
      rowCount: Array.isArray(d.plan?.rows) ? d.plan.rows.length : 0,
    }));
  } catch (err) {
    console.warn("[schedule-repo] loadMemberVersions:", err.message);
    return [];
  }
}

/**
 * Visible docs for this user within a cohort soft fingerprint.
 * Never returns other campuses / other departments.
 */
function cohortVisibilityFilter(userId, softHash, cohortKey) {
  const uid = userId || null;
  return {
    $and: [
      {
        $or: [
          { softFingerprint: softHash },
          ...(cohortKey ? [{ cohortKey }] : []),
        ],
      },
      {
        $or: [
          { visibility: "cohort", status: "published" },
          { visibility: "campus", status: "published" },
          { kind: "template", status: "published" },
          ...(uid
            ? [{ sourceUserId: uid }, { visibility: "private", sourceUserId: uid }]
            : []),
          // Legacy rows without new fields
          { isPublic: true, softFingerprint: softHash },
        ],
      },
    ],
  };
}

/**
 * Auto-resolve for campus scale:
 * 1) exact problem fingerprint
 * 2) published official template for cohort
 * 3) most-used cohort schedule (same campus/dept/year/sem/mode/days)
 * 4) user's own personal save in cohort
 */
async function autoResolve(inputs, userId) {
  const { hash, softHash, key, cohortKey } = buildScheduleFingerprint(inputs || {});

  const exact = await ScheduleRepository.findOne({ fingerprint: hash })
    .sort({ useCount: -1, updatedAt: -1 });
  if (exact?.plan?.rows?.length) {
    return { doc: exact, matchType: "exact", key, softHash, cohortKey, hash };
  }

  const template = await ScheduleRepository.findOne({
    softFingerprint: softHash,
    kind: "template",
    status: "published",
  }).sort({ useCount: -1, updatedAt: -1 });
  if (template?.plan?.rows?.length) {
    return { doc: template, matchType: "template", key, softHash, cohortKey, hash };
  }

  const cohortBest = await ScheduleRepository.findOne({
    softFingerprint: softHash,
    status: "published",
    visibility: { $in: ["cohort", "campus"] },
  }).sort({ useCount: -1, updatedAt: -1 });
  if (cohortBest?.plan?.rows?.length) {
    return { doc: cohortBest, matchType: "cohort", key, softHash, cohortKey, hash };
  }

  if (userId) {
    const mine = await ScheduleRepository.findOne({
      softFingerprint: softHash,
      sourceUserId: userId,
    }).sort({ updatedAt: -1 });
    if (mine?.plan?.rows?.length) {
      return { doc: mine, matchType: "personal", key, softHash, cohortKey, hash };
    }
  }

  return { doc: null, matchType: null, key, softHash, cohortKey, hash };
}

/**
 * POST /api/schedule-repo/lookup
 * Returns one recommended match for the user's cohort — not a campus-wide list.
 */
async function lookup(req, res) {
  try {
    const inputs = req.body?.inputs || req.body || {};
    const userId = req.user?.id || req.user?._id || null;
    const resolved = await autoResolve(inputs, userId);
    const { doc, matchType, key, softHash, cohortKey, hash } = resolved;

    // Official templates for THIS cohort only (usually 0–3), never campus-wide dump
    const templates = await ScheduleRepository.find({
      softFingerprint: softHash,
      kind: "template",
      status: "published",
    })
      .sort({ useCount: -1, updatedAt: -1 })
      .limit(5)
      .lean();

    const recommendation = doc
      ? {
          ...slimCard(doc),
          matchTag:
            matchType === "exact"
              ? "best match"
              : matchType === "template"
                ? "official"
                : matchType === "personal"
                  ? "yours"
                  : matchType === "manual"
                    ? "friend"
                    : "saved",
          reason:
            matchType === "exact"
              ? "Same campus, department, year, and problem"
              : matchType === "template"
                ? "Official schedule for your campus, department, and year"
                : matchType === "personal"
                  ? "Your earlier saved schedule"
                  : "Most-used schedule for your campus, department, and year",
        }
      : null;

    const templateCards = templates.map((t) => ({
      ...slimCard(t),
      matchTag: "template",
    }));

    // Only expose alternate templates when they differ from the recommendation
    const alternates = templateCards.filter(
      (t) => !recommendation || String(t.id) !== String(recommendation.id)
    );

    // Full selectable list for this cohort (Use saved / Customise)
    const cohortFilter = {
      softFingerprint: softHash,
      status: { $ne: "draft" },
      $or: [
        { visibility: { $in: ["cohort", "campus"] } },
        { isPublic: true },
        { kind: "template", status: "published" },
        ...(userId ? [{ sourceUserId: userId }] : []),
      ],
    };
    const cohortRows = await ScheduleRepository.find(cohortFilter)
      .sort({ kind: -1, useCount: -1, updatedAt: -1 })
      .limit(40)
      .lean();
    const cohortEntries = cohortRows.map((d) => {
      const id = String(d._id);
      let matchTag = d.kind === "template" ? "template" : "cohort";
      if (recommendation && id === String(recommendation.id)) matchTag = recommendation.matchTag;
      return { ...slimCard(d), matchTag };
    });

    // If cohort fingerprint is empty (legacy / days mismatch), still offer same campus+dept+year
    let extraCampus = [];
    if (!cohortEntries.length && key.campus) {
      const campusFilter = {
        campus: key.campus,
        status: { $ne: "draft" },
        $or: [
          { visibility: { $in: ["cohort", "campus"] } },
          { isPublic: true },
          { kind: "template", status: "published" },
          ...(userId ? [{ sourceUserId: userId }] : []),
        ],
      };
      if (key.department) campusFilter.department = key.department;
      const campusRows = await ScheduleRepository.find(campusFilter)
        .sort({ useCount: -1, updatedAt: -1 })
        .limit(40)
        .lean();
      extraCampus = campusRows.map((d) => ({
        ...slimCard(d),
        matchTag: recommendation && String(d._id) === String(recommendation.id)
          ? recommendation.matchTag
          : d.kind === "template"
            ? "template"
            : "saved",
      }));
    }

    const selectable = (cohortEntries.length ? cohortEntries : extraCampus).filter((c) => c?.id);

    return res.json({
      success: true,
      approach: "cohort_auto",
      fingerprint: hash,
      softFingerprint: softHash,
      cohortKey,
      key,
      cohortLabel: profileLabel(key),
      profileLabel: profileLabel(key),
      recommendation,
      match: recommendation, // back-compat
      templates: templateCards,
      alternates,
      cohortEntries: selectable,
      // Selectable schedules for Review UI
      candidates: selectable.length
        ? selectable
        : recommendation
          ? [recommendation, ...alternates].slice(0, 6)
          : [],
      hasMatch: Boolean(recommendation || selectable.length),
      similar: [],
    });
  } catch (err) {
    console.error("schedule-repo lookup:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/schedule-repo/save
 * Body: { inputs, plan, weekly?, homework?, versions?, title?, memberName?, memberKey?, kind?, visibility? }
 * Persists full bundle to MongoDB + GitHub archive (daily, weekly, homework, version history).
 */
async function save(req, res) {
  try {
    const {
      inputs = {},
      plan,
      weekly = null,
      homework = null,
      versions = null,
      title = "",
      memberName = "",
      memberKey = "",
      kind = "personal",
      visibility = "cohort",
      status = "published",
    } = req.body || {};
    if (!plan?.rows?.length) {
      return res.status(400).json({ success: false, error: "plan.rows required" });
    }

    const userId = req.user?.id || req.user?._id || null;
    let resolvedName = String(memberName || "").trim();
    if (!resolvedName && userId) {
      try {
        const User = require("../models/User");
        const u = await User.findById(userId).select("name").lean();
        if (u?.name) resolvedName = String(u.name).trim();
      } catch (_) {}
    }
    const resolvedKey =
      String(memberKey || "").trim() ||
      (resolvedName ? slugMemberKey(resolvedName) : "default");

    let homeworkPlan =
      homework?.rows?.length || homework?.nights?.length
        ? homework
        : homeworkFromDaily(plan);

    let versionList = Array.isArray(versions) ? versions : [];
    if (!versionList.length && userId) {
      versionList = await loadMemberVersions(userId, resolvedKey, resolvedName);
    }

    const { hash } = buildScheduleFingerprint(inputs);
    const payload = basePayload(inputs, plan, weekly, userId, {
      title,
      memberName: resolvedName,
      memberKey: resolvedKey,
      homework: homeworkPlan,
      versions: versionList,
      kind: kind === "template" ? "template" : "personal",
      visibility: ["private", "cohort", "campus"].includes(visibility)
        ? visibility
        : "cohort",
      status: status === "draft" ? "draft" : "published",
    });

    const existing = await ScheduleRepository.findOne({ fingerprint: hash });
    let doc;
    if (existing) {
      Object.assign(existing, payload);
      existing.useCount = (existing.useCount || 0) + 1;
      doc = await existing.save();
    } else {
      doc = await ScheduleRepository.create({ ...payload, useCount: 1 });
    }

    const entry = slimMatch(doc);
    let github = null;
    try {
      const { pushScheduleToGithub } = require("../utils/githubScheduleStore");
      github = await pushScheduleToGithub(entry, {
        plan,
        weekly,
        homework: homeworkPlan,
        versions: versionList,
        inputsSnapshot: payload.inputsSnapshot,
        bundleMeta: payload.bundleMeta,
      });
      if (github?.ok) {
        console.log("📦 GitHub archive saved:", github.path, github.htmlUrl);
      } else if (github?.skipped) {
        console.warn("📦 GitHub archive skipped:", github.reason);
      }
    } catch (err) {
      console.error("📦 GitHub archive failed:", err.message);
      github = {
        ok: false,
        skipped: false,
        error: err.message,
        repo: process.env.GITHUB_SCHEDULE_REPO || "shreenevikhandt08/Schedule_store",
      };
    }

    return res.json({
      success: true,
      entry,
      github,
      saved: {
        daily: true,
        weekly: Boolean(weekly?.rows?.length),
        homework: Boolean(homeworkPlan?.rows?.length || homeworkPlan?.nights?.length),
        versions: versionList.length,
      },
    });
  } catch (err) {
    console.error("schedule-repo save:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/schedule-repo?campus=...&q=&department=&year=&limit=
 * Manual friend-pick: same campus only (never cross-campus dump).
 * Also supports softFingerprint / cohortKey for cohort-scoped lists.
 */
async function list(req, res) {
  try {
    const { norm } = require("../utils/scheduleFingerprint");
    const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 20));
    const softFingerprint = String(req.query.softFingerprint || "").trim();
    const cohortKey = String(req.query.cohortKey || "").trim();
    const campus = norm(req.query.campus || "", 120);
    const department = norm(req.query.department || "", 80);
    const year = String(req.query.year || "").trim();
    const q = String(req.query.q || "").trim();
    const userId = req.user?.id || req.user?._id || null;

    // Manual pick within one campus
    if (campus) {
      const filter = {
        campus,
        status: { $ne: "draft" },
        $or: [
          { visibility: { $in: ["cohort", "campus"] } },
          { isPublic: true },
          ...(userId ? [{ sourceUserId: userId }] : []),
        ],
      };
      // Optional filters — do not force department so friend list is complete
      if (department) filter.department = department;
      if (year) filter.year = year;
      if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$and = [
          {
            $or: [
              { title: rx },
              { memberName: rx },
              { memberKey: rx },
              { department: rx },
              { year: rx },
              { problemPreview: rx },
            ],
          },
        ];
      }
      const rows = await ScheduleRepository.find(filter)
        .sort({ memberName: 1, useCount: -1, updatedAt: -1 })
        .limit(limit)
        .lean();
      return res.json({
        success: true,
        scope: "campus",
        campus,
        entries: rows.map((d) => ({
          ...slimCard(d),
          matchTag: d.kind === "template" ? "template" : "peer",
        })),
      });
    }

    if (!softFingerprint && !cohortKey) {
      return res.json({
        success: true,
        entries: [],
        note: "Pass campus (manual pick) or softFingerprint/cohortKey.",
      });
    }

    const filter = cohortVisibilityFilter(userId, softFingerprint, cohortKey);
    if (department) filter.department = department;
    if (year) filter.year = year;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { title: rx },
            { memberName: rx },
            { memberKey: rx },
            { department: rx },
            { year: rx },
            { problemPreview: rx },
          ],
        },
      ];
    }
    const rows = await ScheduleRepository.find(filter)
      .sort({ memberName: 1, useCount: -1, updatedAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      scope: "cohort",
      entries: rows.map((d) => ({
        ...slimCard(d),
        matchTag: d.kind === "template" ? "template" : "cohort",
      })),
    });
  } catch (err) {
    console.error("schedule-repo list:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/schedule-repo/:id — full plan for a selected entry
 */
async function getOne(req, res) {
  try {
    const doc = await ScheduleRepository.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, error: "Schedule not found" });
    return res.json({ success: true, entry: slimMatch(doc) });
  } catch (err) {
    console.error("schedule-repo getOne:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function findExactMatch(inputs) {
  const { hash } = buildScheduleFingerprint(inputs || {});
  return ScheduleRepository.findOne({ fingerprint: hash }).sort({
    useCount: -1,
    updatedAt: -1,
  });
}

async function findSoftMatch(inputs) {
  const { softHash } = buildScheduleFingerprint(inputs || {});
  return ScheduleRepository.findOne({ softFingerprint: softHash }).sort({
    useCount: -1,
    updatedAt: -1,
  });
}

async function findBestMatch(inputs, userId) {
  const r = await autoResolve(inputs, userId);
  return { doc: r.doc, matchType: r.matchType };
}

async function findById(id) {
  if (!id) return null;
  try {
    return await ScheduleRepository.findById(id);
  } catch {
    return null;
  }
}

/** Resolve optional override id, else cohort auto-resolve.
 *  For manual pick modes, selected id is required.
 */
async function resolveRepoSeed(inputs) {
  const selectedId = inputs?._repoEntryId || inputs?.repoEntryId || "";
  const userId = inputs?._userId || null;
  const mode = String(inputs?._repoMode || "").toLowerCase();
  const manual = mode === "manual" || mode === "pick_manual" || mode === "manual_select";

  if (selectedId) {
    const doc = await findById(selectedId);
    if (doc?.plan?.rows?.length) {
      return { doc, matchType: manual ? "manual" : "selected" };
    }
  }
  if (manual) return { doc: null, matchType: null };
  return findBestMatch(inputs, userId);
}

async function bumpUseCount(doc) {
  if (!doc) return;
  doc.useCount = (doc.useCount || 0) + 1;
  await doc.save().catch(() => {});
}

async function upsertFromGenerate(inputs, plan, weekly, extra = {}) {
  if (!plan?.rows?.length) return null;
  const userId = inputs?._userId || null;
  const memberName = resolveMemberName(inputs, extra);
  const memberKey =
    String(extra.memberKey || inputs.memberKey || "").trim() ||
    (memberName ? slugMemberKey(memberName) : "default");
  const homework =
    extra.homework ||
    homeworkFromDaily(plan);
  let versions = Array.isArray(extra.versions) ? extra.versions : [];
  if (!versions.length && userId) {
    versions = await loadMemberVersions(userId, memberKey, memberName);
  }
  const { hash } = buildScheduleFingerprint(inputs || {});
  const payload = basePayload(inputs, plan, weekly, userId, {
    ...extra,
    memberName,
    memberKey,
    homework,
    versions,
    kind: "personal",
    visibility: "cohort",
    status: "published",
  });
  const existing = await ScheduleRepository.findOne({ fingerprint: hash });
  let doc;
  if (existing) {
    Object.assign(existing, payload);
    existing.useCount = (existing.useCount || 0) + 1;
    doc = await existing.save();
  } else {
    doc = await ScheduleRepository.create({ ...payload, useCount: 1 });
  }
  // Best-effort GitHub mirror (manual Save still remains the primary publish path)
  try {
    const { pushScheduleToGithub } = require("../utils/githubScheduleStore");
    await pushScheduleToGithub(slimMatch(doc), {
      plan,
      weekly,
      homework,
      versions,
      inputsSnapshot: payload.inputsSnapshot,
      bundleMeta: payload.bundleMeta,
    });
  } catch (_) {}
  return doc;
}

module.exports = {
  lookup,
  save,
  list,
  getOne,
  findExactMatch,
  findSoftMatch,
  findBestMatch,
  findById,
  resolveRepoSeed,
  autoResolve,
  bumpUseCount,
  upsertFromGenerate,
  slimMatch,
  slimCard,
};
