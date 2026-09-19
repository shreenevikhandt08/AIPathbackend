/**
 * Push schedule JSON into the official GitHub archive
 * (default: shreenevikhandt08/Schedule_store).
 *
 * Folder layout (name + dept separate):
 *   schedules/{dept}/{memberName}/year-{y}-sem-{s}.json
 *   schedules/index.json
 *
 * Env (backend/.env):
 *   GITHUB_TOKEN            — PAT with Contents: Read and write
 *   GITHUB_SCHEDULE_REPO    — owner/repo
 *   GITHUB_SCHEDULE_BRANCH  — branch (default main)
 */

function githubConfig() {
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  const repo = String(
    process.env.GITHUB_SCHEDULE_REPO || "shreenevikhandt08/Schedule_store"
  ).trim();
  const branch = String(process.env.GITHUB_SCHEDULE_BRANCH || "main").trim();
  const [owner, name] = repo.split("/");
  return {
    token,
    repo,
    branch,
    owner: owner || "",
    name: name || "",
    enabled: Boolean(token && owner && name),
  };
}

function slug(s, max = 48) {
  return (
    String(s || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "unknown"
  );
}

function buildPaths(entry = {}) {
  const dept = slug(entry.department || entry.key?.department || "dept", 32);
  const member = slug(entry.memberName || entry.title || "member", 40);
  const year = String(entry.year || entry.key?.year || "0").replace(/[^\w]/g, "") || "0";
  const sem = String(entry.semester || entry.key?.semester || "0").replace(/[^\w]/g, "") || "0";
  const filePath = `schedules/${dept}/${member}/year-${year}-sem-${sem}.json`;
  return { filePath, indexPath: "schedules/index.json", dept, member, year, sem };
}

/** Canonical archive document — daily + weekly + homework + versions for reuse later */
function buildArchiveDocument(entry = {}, full = {}) {
  const plan = full.plan || entry.plan || null;
  const weekly = full.weekly != null ? full.weekly : entry.weekly || null;
  const homework = full.homework != null ? full.homework : entry.homework || null;
  const versions = Array.isArray(full.versions)
    ? full.versions
    : Array.isArray(entry.versions)
      ? entry.versions
      : [];
  const inputs = full.inputsSnapshot || entry.inputsSnapshot || {};
  const rows = Array.isArray(plan?.rows) ? plan.rows : [];
  const weeklyRows = Array.isArray(weekly?.rows) ? weekly.rows : [];
  const homeworkRows = Array.isArray(homework?.rows) ? homework.rows : [];

  return {
    schemaVersion: 2,
    savedAt: new Date().toISOString(),
    member: {
      name: entry.memberName || entry.title || "",
      key: entry.memberKey || "",
      department: entry.department || "",
      year: entry.year != null ? String(entry.year) : "",
      semester: entry.semester != null ? String(entry.semester) : "",
      campus: entry.campus || "",
    },
    meta: {
      id: entry.id || "",
      fingerprint: entry.fingerprint || "",
      softFingerprint: entry.softFingerprint || "",
      cohortKey: entry.cohortKey || "",
      mode: entry.mode || "",
      numDays: entry.numDays ?? null,
      kind: entry.kind || "personal",
      visibility: entry.visibility || "cohort",
      rowCount: rows.length,
      weeklyRowCount: weeklyRows.length,
      homeworkRowCount: homeworkRows.length,
      versionCount: versions.length,
      includes: {
        daily: rows.length > 0,
        weekly: weeklyRows.length > 0,
        homework: homeworkRows.length > 0 || Boolean(homework?.nights?.length),
        versions: versions.length > 0,
      },
    },
    daily: plan
      ? {
          module: plan.module || "daily",
          title: plan.title || entry.title || "",
          rows,
        }
      : null,
    weekly: weekly
      ? {
          module: weekly.module || "weekly",
          title: weekly.title || "Weekly plan",
          rows: weeklyRows,
        }
      : null,
    homework: homework
      ? {
          module: homework.module || "homework",
          title: homework.title || "Tonight's Homework",
          rows: homeworkRows,
          nights: homework.nights || undefined,
        }
      : null,
    /** Full Version Management history for this member (V1…Vn) */
    versions: versions.map((v) => ({
      version: v.version,
      memberVersion: v.memberVersion,
      memberKey: v.memberKey,
      memberName: v.memberName,
      changeType: v.changeType,
      reason: v.reason,
      trigger: v.trigger,
      protected: v.protected,
      createdAt: v.createdAt,
      rowCount: v.rowCount ?? (Array.isArray(v.plan?.rows) ? v.plan.rows.length : 0),
      plan: v.plan || null,
    })),
    inputs: {
      college: inputs.college || entry.campus || "",
      department: inputs.department || entry.department || "",
      collegeYear: inputs.collegeYear ?? entry.year ?? null,
      semester: inputs.semester ?? entry.semester ?? null,
      plannerMode: inputs._plannerMode || entry.mode || "",
      numDays: inputs._numDays ?? entry.numDays ?? null,
      memberName: inputs.memberName || entry.memberName || "",
      memberKey: inputs.memberKey || entry.memberKey || "",
      problem: String(inputs.problem || "").slice(0, 800),
    },
  };
}

async function ghFetch(cfg, path, options = {}) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.name}/contents/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ai-path-builder-schedule-store",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

async function getFileSha(cfg, path) {
  const r = await ghFetch(cfg, `${path}?ref=${encodeURIComponent(cfg.branch)}`);
  if (r.status === 404) return null;
  if (!r.ok) {
    const msg = r.body?.message || `GitHub GET failed (${r.status})`;
    throw new Error(msg);
  }
  return r.body?.sha || null;
}

async function putFile(cfg, path, contentObj, message) {
  const sha = await getFileSha(cfg, path);
  const content = Buffer.from(
    typeof contentObj === "string"
      ? contentObj
      : JSON.stringify(contentObj, null, 2),
    "utf8"
  ).toString("base64");

  const r = await ghFetch(cfg, path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content,
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!r.ok) {
    const msg = r.body?.message || `GitHub PUT failed (${r.status})`;
    const hint =
      /not accessible by personal access token/i.test(msg)
        ? " Your token cannot write. Use a Classic PAT with the 'repo' scope (token starts with ghp_), put it in GITHUB_TOKEN, restart backend."
        : "";
    throw new Error(msg + hint);
  }
  return {
    path,
    htmlUrl: r.body?.content?.html_url || null,
    commitUrl: r.body?.commit?.html_url || null,
  };
}

async function pushScheduleToGithub(entry, full = {}) {
  const cfg = githubConfig();
  if (!cfg.enabled) {
    return {
      ok: false,
      skipped: true,
      reason:
        "GITHUB_TOKEN not set in backend/.env — schedule saved in app DB only, not on GitHub.",
      repo: cfg.repo,
    };
  }

  const { filePath, indexPath, dept, member } = buildPaths(entry);
  const archive = buildArchiveDocument(entry, full);
  const label = archive.member.name || member;

  const fileResult = await putFile(
    cfg,
    filePath,
    archive,
    `chore(schedule): ${dept}/${label} year-${archive.member.year || "?"} sem-${archive.member.semester || "?"}`
  );

  let indexResult = null;
  try {
    let index = {
      schemaVersion: 2,
      updatedAt: null,
      entries: [],
    };
    const existing = await ghFetch(
      cfg,
      `${indexPath}?ref=${encodeURIComponent(cfg.branch)}`
    );
    if (existing.ok && existing.body?.content) {
      const decoded = Buffer.from(existing.body.content, "base64").toString("utf8");
      index = JSON.parse(decoded);
    }
    if (!Array.isArray(index.entries)) index.entries = [];
    const card = {
      id: archive.meta.id,
      memberName: archive.member.name,
      memberKey: archive.member.key || "",
      department: archive.member.department,
      year: archive.member.year,
      semester: archive.member.semester,
      campus: archive.member.campus,
      path: filePath,
      folder: `schedules/${dept}/${member}`,
      fingerprint: archive.meta.fingerprint,
      rowCount: archive.meta.rowCount,
      weeklyRowCount: archive.meta.weeklyRowCount,
      homeworkRowCount: archive.meta.homeworkRowCount,
      versionCount: archive.meta.versionCount,
      includes: archive.meta.includes,
      updatedAt: archive.savedAt,
      htmlUrl: fileResult.htmlUrl,
    };
    const without = index.entries.filter((e) => String(e.id) !== String(card.id));
    without.unshift(card);
    index.schemaVersion = 2;
    index.entries = without.slice(0, 500);
    index.updatedAt = archive.savedAt;
    indexResult = await putFile(
      cfg,
      indexPath,
      index,
      `chore(schedule): index ${dept}/${label}`
    );
  } catch (err) {
    console.warn("github index update failed:", err.message);
  }

  return {
    ok: true,
    skipped: false,
    repo: cfg.repo,
    branch: cfg.branch,
    path: filePath,
    htmlUrl: fileResult.htmlUrl,
    commitUrl: fileResult.commitUrl,
    indexUrl: indexResult?.htmlUrl || null,
    browseUrl: `https://github.com/${cfg.repo}/tree/${cfg.branch}/schedules/${dept}/${member}`,
  };
}

module.exports = {
  githubConfig,
  pushScheduleToGithub,
  buildArchiveDocument,
  buildPaths,
};
