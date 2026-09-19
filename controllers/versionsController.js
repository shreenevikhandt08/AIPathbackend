// controllers/versionsController.js
const PlanVersion = require("../models/PlanVersion");
const {
  buildCompareDiff,
  slimDiff,
  inferTrigger,
  inferChangedBy,
  triggerLabel,
  applyProtectedOverrides,
  collectProtectedSlots,
  slotKey,
} = require("../utils/planVersioning");

function isGenerationChange(changeType = "", reason = "") {
  const t = String(changeType);
  const r = String(reason);
  if (/^Initial Plan$/i.test(t)) return true;
  if (/^Regenerat/i.test(t)) return true;
  if (/regenerat/i.test(r)) return true;
  return false;
}

async function persistDailyPlanRows(userId, plan) {
  if (!plan?.rows?.length) return;
  const DailyPlan = require("../models/DailyPlan");
  const { syncWeeklyFromDaily } = require("../utils/weeklySync");
  const byDay = {};
  for (const row of plan.rows) {
    if (!Array.isArray(row) || !row[0]) continue;
    const dayId = String(row[0]);
    if (!byDay[dayId]) {
      const m = dayId.match(/Week\s*(\d+)\s*[-–]\s*(\w+)/i);
      byDay[dayId] = {
        week: m ? parseInt(m[1], 10) : 1,
        dayName: m ? m[2] : "Monday",
        rows: [],
      };
    }
    byDay[dayId].rows.push(row);
  }
  const dayIds = Object.keys(byDay);
  const ops = dayIds.map((dayId) => {
    const { week, dayName, rows } = byDay[dayId];
    return {
      updateOne: {
        filter: { userId, dayId },
        update: {
          $set: { userId, dayId, week, dayName, rows },
          $setOnInsert: { locked: false, completed: false, doneRows: [], subTaskDoneRows: [] },
        },
        upsert: true,
      },
    };
  });
  if (!ops.length) return;
  await DailyPlan.bulkWrite(ops);
  // Drop leftover days from a previous longer / other-student plan so live DB
  // matches this snapshot exactly (no phantom Week 5+ from an earlier generate).
  await DailyPlan.deleteMany({ userId, dayId: { $nin: dayIds } });
  const weeks = [...new Set(Object.values(byDay).map((d) => d.week))];
  for (const w of weeks) {
    syncWeeklyFromDaily(userId, w).catch(() => null);
  }
}

function slugMemberKey(value) {
  const s = String(value || "solo")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "default";
}

/**
 * Each student (name or email) gets an independent version lane starting at 1.
 * Prefer email for the key when present so the same person stays one lane
 * even if display name changes slightly.
 */
function normalizeMember(body = {}) {
  const memberName =
    String(body.memberName || body.personName || body.name || "Solo").trim() || "Solo";
  const memberEmail = String(body.memberEmail || body.email || "")
    .trim()
    .toLowerCase();
  const explicitKey = String(body.memberKey || "").trim();
  const memberKey =
    explicitKey ||
    (memberEmail ? slugMemberKey(memberEmail) : slugMemberKey(memberName)) ||
    "default";
  return { memberKey, memberName, memberEmail };
}

async function nextMemberVersion(userId, memberKey) {
  const latestForMember = await PlanVersion.findOne({ userId, memberKey })
    .sort({ memberVersion: -1, version: -1 })
    .select("memberVersion");
  const prev = Number(latestForMember?.memberVersion) || 0;
  return prev + 1;
}

/** Union of protected slots from all protected versions (faculty overrides). */
async function loadActiveProtectedSlots(userId, memberKey = "default") {
  const docs = await PlanVersion.find({
    userId,
    memberKey,
    $or: [{ protected: true }, { protectedSlots: { $exists: true, $ne: [] } }],
  })
    .sort({ version: -1 })
    .limit(20)
    .select("protected protectedSlots plan");

  const set = new Set();
  for (const d of docs) {
    (d.protectedSlots || []).forEach((k) => set.add(String(k)));
    if (d.protected && Array.isArray(d.plan?.rows)) {
      d.plan.rows.forEach((row) => {
        if (Array.isArray(row)) set.add(slotKey(row));
      });
    }
  }
  return [...set];
}

function actorMeta(req, changeType, body = {}) {
  const trigger = inferTrigger(changeType, body.reason, body.trigger);
  const changedBy = inferChangedBy(req, changeType, body.changedBy);
  const changedByEmail = String(
    body.changedByEmail || req?.user?.email || ""
  ).slice(0, 120);
  const isProtected = Boolean(
    body.protected ||
      body.manualOverride ||
      trigger === "faculty_override" ||
      /^faculty/i.test(String(changeType || ""))
  );
  return { trigger, changedBy, changedByEmail, isProtected };
}

function enrichVersionDoc(v, idx, versions) {
  const plain = v.toObject ? v.toObject() : v;
  const globalVersion = Number(plain.version) || 1;
  const memberKey = plain.memberKey || "default";
  const memberName = plain.memberName || "Solo";
  let personVersion = Number(plain.memberVersion);
  if (!Number.isFinite(personVersion) || personVersion < 1) {
    // Legacy rows: derive this student's lane number from their own history
    const sameAsc = versions
      .filter((x) => (x.memberKey || "default") === memberKey)
      .map((x) => (x.toObject ? x.toObject() : x))
      .sort((a, b) => (Number(a.version) || 0) - (Number(b.version) || 0));
    const rank = sameAsc.findIndex((x) => Number(x.version) === globalVersion);
    personVersion = rank >= 0 ? rank + 1 : globalVersion;
  }
  const prevSameMember = versions.find(
    (x, i) =>
      i > idx && (x.memberKey || "default") === memberKey
  );
  const prev =
    plain.previousVersion ??
    prevSameMember?.version ??
    versions[idx + 1]?.version ??
    null;
  const isLatestForMember = !versions.some(
    (x, i) =>
      i < idx && (x.memberKey || "default") === memberKey
  );
  return {
    ...plain,
    memberKey,
    memberName,
    memberVersion: personVersion,
    /** Shown in UI as this student's Version N */
    displayVersion: personVersion,
    globalVersion,
    previousVersion: prev,
    isLatest: idx === 0,
    isLatestForMember,
    changeCount: plain.diff?.totalChanges || 0,
    diffSummary: plain.differenceSummary || plain.diff?.summary || null,
    differenceSummary: plain.differenceSummary || plain.diff?.summary || "",
    triggerLabel: triggerLabel(plain.trigger),
    label: `${memberName} · Version ${personVersion}`,
    title: plain.changeType || "Update",
    // Don't dump full previousPlan in list payloads
    previousPlan: undefined,
    hasPreviousPlan: Boolean(plain.previousPlan) || prev != null,
  };
}

// GET /
async function listVersions(req, res) {
  try {
    const filter = { userId: req.user.id };
    const memberKey = String(req.query.memberKey || "").trim();
    if (memberKey) filter.memberKey = memberKey;

    const versions = await PlanVersion.find(filter)
      .sort({ version: -1 })
      .select(
        "version previousVersion memberKey memberName memberVersion changeType reason trigger changedBy changedByEmail protected protectedSlots createdAt diff differenceSummary leaveEvents"
      );

    const generationCount = versions.filter((v) =>
      isGenerationChange(v.changeType, v.reason)
    ).length;

    const enriched = versions.map((v, idx) => enrichVersionDoc(v, idx, versions));

    const byMember = {};
    for (const v of enriched) {
      const key = v.memberKey || "default";
      if (!byMember[key]) {
        byMember[key] = {
          memberKey: key,
          memberName: v.memberName || "Solo",
          totalVersions: 0,
          latestMemberVersion: 0,
          generationCount: 0,
        };
      }
      byMember[key].totalVersions += 1;
      byMember[key].latestMemberVersion = Math.max(
        byMember[key].latestMemberVersion,
        Number(v.displayVersion) || Number(v.memberVersion) || 0
      );
      if (isGenerationChange(v.changeType, v.reason)) {
        byMember[key].generationCount += 1;
      }
    }

    const members = Object.values(byMember).sort((a, b) =>
      String(a.memberName).localeCompare(String(b.memberName))
    );
    const latestPersonVersion = enriched[0]?.displayVersion || 0;

    res.json({
      success: true,
      versions: enriched,
      members,
      meta: {
        totalVersions: versions.length,
        latestVersion: latestPersonVersion,
        latestGlobalVersion: versions[0]?.version || 0,
        generationCount,
        previousVersion: versions[1]?.version || null,
        memberCount: members.length,
        chain:
          members.length === 1 && latestPersonVersion > 0
            ? Array.from(
                { length: Math.min(latestPersonVersion, 12) },
                (_, i) => `V${i + 1}`
              ).join(" → ") + (latestPersonVersion > 12 ? " → …" : "")
            : members.length > 1
              ? `${members.length} students · separate version lanes`
              : "",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /compare/:vA/:vB
async function compareVersions(req, res) {
  try {
    const vA = parseInt(req.params.vA, 10);
    const vB = parseInt(req.params.vB, 10);
    if (!Number.isFinite(vA) || !Number.isFinite(vB) || vA < 1 || vB < 1) {
      return res.status(400).json({ success: false, error: "Invalid version numbers" });
    }
    if (vA === vB) {
      return res.status(400).json({ success: false, error: "Pick two different versions to compare" });
    }

    const selectFields =
      "version memberKey memberName memberVersion changeType reason trigger changedBy createdAt protected plan";
    const [docA, docB] = await Promise.all([
      PlanVersion.findOne({ userId: req.user.id, version: vA }).select(selectFields),
      PlanVersion.findOne({ userId: req.user.id, version: vB }).select(selectFields),
    ]);
    if (!docA || !docB) {
      return res.status(404).json({
        success: false,
        error: !docA && !docB
          ? `Versions ${vA} and ${vB} not found`
          : !docA
            ? `Version ${vA} not found`
            : `Version ${vB} not found`,
      });
    }

    const keyA = docA.memberKey || "default";
    const keyB = docB.memberKey || "default";
    const crossMember = keyA !== keyB;

    // Per-student display numbers (never use global storage ids in the UI)
    const loadDisplayMap = async (memberKey) => {
      const rows = await PlanVersion.find({ userId: req.user.id, memberKey })
        .sort({ version: 1 })
        .select("version memberVersion")
        .lean();
      return rows || [];
    };
    const [laneA, laneB] = await Promise.all([
      loadDisplayMap(keyA),
      crossMember ? loadDisplayMap(keyB) : Promise.resolve(null),
    ]);
    const displayFor = (doc, lane) => {
      let n = Number(doc.memberVersion);
      if (Number.isFinite(n) && n >= 1) return n;
      const rank = (lane || []).findIndex((x) => Number(x.version) === Number(doc.version));
      return rank >= 0 ? rank + 1 : Number(doc.version) || 1;
    };
    const displayA = displayFor(docA, laneA);
    const displayB = displayFor(docB, crossMember ? laneB : laneA);
    const nameA = docA.memberName || "Solo";
    const nameB = docB.memberName || "Solo";

    if (!docA.plan?.rows || !docB.plan?.rows) {
      return res.status(422).json({
        success: false,
        error: "One or both versions have no schedule rows to compare",
      });
    }

    // Same student: older→newer by their version lane. Cross-student: by createdAt (side-by-side).
    let older = docA;
    let newer = docB;
    let olderDisplay = displayA;
    let newerDisplay = displayB;
    if (!crossMember) {
      const aIsOlder =
        displayA !== displayB
          ? displayA < displayB
          : new Date(docA.createdAt || 0) <= new Date(docB.createdAt || 0);
      older = aIsOlder ? docA : docB;
      newer = aIsOlder ? docB : docA;
      olderDisplay = aIsOlder ? displayA : displayB;
      newerDisplay = aIsOlder ? displayB : displayA;
    } else {
      const aIsOlder = new Date(docA.createdAt || 0) <= new Date(docB.createdAt || 0);
      older = aIsOlder ? docA : docB;
      newer = aIsOlder ? docB : docA;
      olderDisplay = aIsOlder ? displayA : displayB;
      newerDisplay = aIsOlder ? displayB : displayA;
    }
    const rawDiff = buildCompareDiff(older.plan, newer.plan);
    const diff = slimDiff(rawDiff, 60);

    const pack = (doc, displayVersion) => ({
      version: doc.version,
      globalVersion: doc.version,
      memberKey: doc.memberKey || "default",
      memberName: doc.memberName || "Solo",
      memberVersion: displayVersion,
      displayVersion,
      label: `${doc.memberName || "Solo"} · V${displayVersion}`,
      changeType: doc.changeType,
      reason: doc.reason,
      trigger: doc.trigger,
      changedBy: doc.changedBy,
      createdAt: doc.createdAt,
      protected: doc.protected,
    });

    const fromName = older.memberName || "Solo";
    const toName = newer.memberName || "Solo";

    res.json({
      success: true,
      crossMember,
      vA: pack(docA, displayA),
      vB: pack(docB, displayB),
      previousVersion: older.version,
      newVersion: newer.version,
      previousDisplayVersion: olderDisplay,
      newDisplayVersion: newerDisplay,
      fromLabel: `${fromName} · V${olderDisplay}`,
      toLabel: `${toName} · V${newerDisplay}`,
      memberKey: crossMember ? null : keyA,
      memberName: crossMember ? `${nameA} vs ${nameB}` : nameA,
      diff,
    });
  } catch (err) {
    console.error("[compareVersions]", err.message);
    res.status(500).json({ success: false, error: err.message || "Compare failed" });
  }
}

// POST /compare — body { vA, vB } (avoids any GET routing issues)
async function compareVersionsPost(req, res) {
  req.params = {
    ...req.params,
    vA: String(req.body?.vA ?? req.body?.a ?? ""),
    vB: String(req.body?.vB ?? req.body?.b ?? ""),
  };
  return compareVersions(req, res);
}

// GET /:versionNum
async function getVersion(req, res) {
  try {
    const doc = await PlanVersion.findOne({
      userId: req.user.id,
      version: parseInt(req.params.versionNum, 10),
    });
    if (!doc)
      return res.status(404).json({ success: false, error: "Version not found" });

    let previousPlan = doc.previousPlan || null;
    if (!previousPlan && doc.previousVersion) {
      const prev = await PlanVersion.findOne({
        userId: req.user.id,
        version: doc.previousVersion,
      }).select("plan version");
      previousPlan = prev?.plan || null;
    }

    res.json({
      success: true,
      versionDoc: {
        ...doc.toObject(),
        previousPlan,
        triggerLabel: triggerLabel(doc.trigger),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /restore/:versionNum
async function restoreVersion(req, res) {
  try {
    const toRestore = await PlanVersion.findOne({
      userId: req.user.id,
      version: parseInt(req.params.versionNum, 10),
    });
    if (!toRestore) {
      return res.status(404).json({ success: false, error: "Version not found" });
    }

    const force = Boolean(req.body?.force);
    const memberKey = toRestore.memberKey || "default";
    const memberName = toRestore.memberName || "Solo";
    const latest = await PlanVersion.findOne({ userId: req.user.id }).sort({
      version: -1,
    });
    const newVersion = (latest?.version || 0) + 1;
    const memberVersion = await nextMemberVersion(req.user.id, memberKey);

    const latestSameMember = await PlanVersion.findOne({
      userId: req.user.id,
      memberKey,
    }).sort({ memberVersion: -1, version: -1 });

    let planToApply = toRestore.plan;
    let preserved = 0;
    if (!force && latestSameMember?.plan) {
      // Keep newer faculty-protected slots unless force=true
      const protectNewer = await loadActiveProtectedSlots(req.user.id, memberKey);
      const result = applyProtectedOverrides(
        latestSameMember.plan,
        toRestore.plan,
        protectNewer
      );
      planToApply = result.plan;
      preserved = result.preserved;
    }

    const diff = latestSameMember?.plan
      ? buildCompareDiff(latestSameMember.plan, planToApply)
      : latest?.plan
        ? buildCompareDiff(latest.plan, planToApply)
        : null;

    const { trigger, changedBy, changedByEmail } = actorMeta(req, "Restored", {
      reason: `Restored from Version ${toRestore.version}`,
      trigger: "rollback",
      changedBy: req.body?.changedBy,
    });

    await PlanVersion.create({
      userId: req.user.id,
      version: newVersion,
      previousVersion: latestSameMember?.version || latest?.version || null,
      memberKey,
      memberName,
      memberVersion,
      changeType: "Restored",
      reason: `Restored ${memberName} Version ${toRestore.memberVersion || toRestore.version} (${toRestore.changeType})`,
      trigger,
      changedBy,
      changedByEmail,
      protected: Boolean(toRestore.protected),
      protectedSlots: toRestore.protectedSlots || [],
      plan: planToApply,
      previousPlan: latestSameMember?.plan || latest?.plan || null,
      leaveEvents: toRestore.leaveEvents || [],
      diff: slimDiff(diff),
      differenceSummary: diff?.summary || "",
    });

    try {
      await persistDailyPlanRows(req.user.id, planToApply);
    } catch (persistErr) {
      console.warn("[restoreVersion] DailyPlan persist skipped:", persistErr.message);
    }

    try {
      const { auditVersionAreas } = require("../utils/auditLog");
      let homeworkNights = null;
      try {
        const { syncHomeworkFromDailyPlan } = require("./homeworkController");
        const hw = await syncHomeworkFromDailyPlan(
          req.user.id,
          planToApply,
          "version-restore"
        );
        homeworkNights = hw?.synced ?? null;
      } catch (_) {}

      auditVersionAreas(req, {
        version: newVersion,
        memberKey,
        memberName,
        memberVersion,
        changeType: "Restored",
        reason: `Restored from Version ${toRestore.version}`,
        action: "version.restore",
        plan: planToApply,
        homeworkNights,
        previousVersion: latest?.version || null,
        changeCount: diff?.totalChanges || 0,
        trigger,
        changedBy,
        differenceSummary: diff?.summary || "",
      });
    } catch (_) {
      /* optional */
    }

    res.json({
      success: true,
      plan: planToApply,
      newVersion,
      memberKey,
      memberName,
      memberVersion,
      fromVersion: toRestore.version,
      fromMemberVersion: toRestore.memberVersion || toRestore.version,
      previousVersion: latest?.version || null,
      trigger,
      changedBy,
      protectedPreserved: preserved,
      diff: slimDiff(diff),
      differenceSummary: diff?.summary || "",
      message: `Restored ${memberName} as Version ${memberVersion}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /save
async function saveVersion(req, res) {
  try {
    const { plan, changeType, reason, leaveEvents } = req.body;
    if (!plan)
      return res.status(400).json({ success: false, error: "plan is required" });

    const { memberKey, memberName } = normalizeMember(req.body);
    const latest = await PlanVersion.findOne({ userId: req.user.id }).sort({
      version: -1,
    });
    const newVersion = (latest?.version || 0) + 1;
    const memberVersion = await nextMemberVersion(req.user.id, memberKey);

    const latestSameMember = await PlanVersion.findOne({
      userId: req.user.id,
      memberKey,
    }).sort({ memberVersion: -1, version: -1 });

    const type = changeType || "Manual Edit";
    const why = reason || "";
    const { trigger, changedBy, changedByEmail, isProtected } = actorMeta(
      req,
      type,
      req.body
    );

    // Respect faculty-protected slots from earlier overrides (unless this save IS an override)
    let planToStore = plan;
    let preserved = 0;
    if (!isProtected && latestSameMember?.plan) {
      const slots = await loadActiveProtectedSlots(req.user.id, memberKey);
      const result = applyProtectedOverrides(latestSameMember.plan, plan, slots);
      planToStore = result.plan;
      preserved = result.preserved;
    }

    const previousPlan = latestSameMember?.plan || latest?.plan || null;
    const diff = previousPlan
      ? buildCompareDiff(previousPlan, planToStore)
      : null;

    let protectedSlots = Array.isArray(req.body.protectedSlots)
      ? req.body.protectedSlots.map(String)
      : [];
    if (isProtected && Array.isArray(planToStore?.rows)) {
      // Mark changed/all slots as protected for faculty override
      if (diff?.changes?.length) {
        diff.changes.forEach((c) => {
          const row = c.rowB || c.rowA;
          if (row) protectedSlots.push(slotKey(row));
        });
      } else {
        planToStore.rows.forEach((row) => {
          if (Array.isArray(row)) protectedSlots.push(slotKey(row));
        });
      }
      protectedSlots = collectProtectedSlots(
        { protectedSlots },
        latestSameMember?.protectedSlots || []
      );
    }

    await PlanVersion.create({
      userId: req.user.id,
      version: newVersion,
      previousVersion: latestSameMember?.version || null,
      memberKey,
      memberName,
      memberVersion,
      changeType: type,
      reason: why,
      trigger,
      changedBy,
      changedByEmail,
      protected: isProtected,
      protectedSlots,
      plan: planToStore,
      previousPlan,
      leaveEvents: leaveEvents || latestSameMember?.leaveEvents || latest?.leaveEvents || [],
      diff: slimDiff(diff),
      differenceSummary: diff?.summary || "",
    });

    try {
      const { auditVersionAreas } = require("../utils/auditLog");
      let homeworkNights = null;
      try {
        const { syncHomeworkFromDailyPlan } = require("./homeworkController");
        const hw = await syncHomeworkFromDailyPlan(
          req.user.id,
          planToStore,
          "version-save"
        );
        homeworkNights = hw?.synced ?? null;
      } catch (_) {}

      auditVersionAreas(req, {
        version: newVersion,
        memberKey,
        memberName,
        memberVersion,
        changeType: type,
        reason: why,
        action: "version.save",
        plan: planToStore,
        homeworkNights,
        previousVersion: latest?.version || null,
        changeCount: diff?.totalChanges || 0,
        trigger,
        changedBy,
        differenceSummary: diff?.summary || "",
        protected: isProtected,
      });
    } catch (_) {
      /* optional */
    }

    try {
      await persistDailyPlanRows(req.user.id, planToStore);
    } catch (persistErr) {
      console.warn("[saveVersion] DailyPlan persist skipped:", persistErr.message);
    }

    res.json({
      success: true,
      version: newVersion,
      previousVersion: latestSameMember?.version || null,
      memberKey,
      memberName,
      memberVersion,
      previousMemberVersion: latestSameMember?.memberVersion || null,
      changeCount: diff?.totalChanges || 0,
      diffSummary: diff?.summary || null,
      differenceSummary: diff?.summary || null,
      highlights: diff?.highlights || [],
      trigger,
      triggerLabel: triggerLabel(trigger),
      changedBy,
      protected: isProtected,
      protectedPreserved: preserved,
      label: `${memberName} · Version ${memberVersion}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// POST /:versionNum/protect — mark / unmark faculty manual override
async function setVersionProtected(req, res) {
  try {
    const version = parseInt(req.params.versionNum, 10);
    const doc = await PlanVersion.findOne({ userId: req.user.id, version });
    if (!doc)
      return res.status(404).json({ success: false, error: "Version not found" });

    const protectedFlag = req.body?.protected !== false;
    let protectedSlots = Array.isArray(req.body?.protectedSlots)
      ? req.body.protectedSlots.map(String)
      : doc.protectedSlots || [];

    if (protectedFlag && (!protectedSlots.length) && Array.isArray(doc.plan?.rows)) {
      protectedSlots = doc.plan.rows
        .filter(Array.isArray)
        .map((row) => slotKey(row));
    }
    if (!protectedFlag) protectedSlots = [];

    doc.protected = protectedFlag;
    doc.protectedSlots = protectedSlots;
    if (protectedFlag) {
      doc.trigger = doc.trigger === "other" ? "faculty_override" : doc.trigger;
      doc.changedBy = inferChangedBy(req, doc.changeType, "Faculty");
      if (req.user?.email) {
        doc.changedByEmail = String(req.user.email).slice(0, 120);
      }
    }
    await doc.save();

    try {
      const { audit } = require("../utils/auditLog");
      const memberName = doc.memberName || "Solo";
      const memberVersion = Number(doc.memberVersion) || null;
      audit(req, {
        entity: "plan",
        action: protectedFlag ? "version.protect" : "version.unprotect",
        summary: protectedFlag
          ? `${memberName} · Version ${memberVersion || version} · Protected`
          : `${memberName} · Version ${memberVersion || version} · Protection removed`,
        meta: {
          version,
          memberKey: doc.memberKey || "default",
          memberName,
          memberVersion,
          changeType: protectedFlag ? "Protected" : "Unprotected",
          differenceSummary: protectedFlag
            ? "Version marked protected"
            : "Protection removed from version",
          protected: protectedFlag,
          protectedSlots: protectedSlots.length,
          trigger: doc.trigger,
          changedBy: doc.changedBy,
        },
      });
    } catch (_) {}

    res.json({
      success: true,
      version,
      protected: doc.protected,
      protectedSlots: doc.protectedSlots,
      message: protectedFlag
        ? `Version ${version} marked as protected faculty override`
        : `Version ${version} protection removed`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// DELETE /:versionNum
async function deleteVersion(req, res) {
  try {
    const version = parseInt(req.params.versionNum, 10);
    const totalCount = await PlanVersion.countDocuments({ userId: req.user.id });
    if (totalCount <= 1) {
      return res
        .status(400)
        .json({ success: false, error: "Can't delete the only remaining version" });
    }

    const target = await PlanVersion.findOne({ userId: req.user.id, version });
    if (!target)
      return res.status(404).json({ success: false, error: "Version not found" });
    if (target.protected) {
      return res.status(400).json({
        success: false,
        error:
          "This version is a protected faculty override. Unprotect it before deleting.",
      });
    }

    const deleted = await PlanVersion.findOneAndDelete({
      userId: req.user.id,
      version,
    });

    try {
      const { audit } = require("../utils/auditLog");
      audit(req, {
        entity: "plan",
        action: "version.delete",
        summary: `Version ${version} · Deleted`,
        meta: {
          version,
          changeType: deleted.changeType,
          trigger: deleted.trigger,
          changedBy: deleted.changedBy,
        },
      });
    } catch (_) {
      /* optional */
    }

    res.json({ success: true, message: `Version ${version} deleted` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  listVersions,
  compareVersions,
  compareVersionsPost,
  getVersion,
  restoreVersion,
  saveVersion,
  deleteVersion,
  setVersionProtected,
  buildCompareDiff,
};
