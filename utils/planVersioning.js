/**
 * Shared helpers for schedule version management:
 * Version Number · Previous/New · Difference · Reason · Trigger · Changed By · Protected
 */

const TRIGGERS = [
  "initial_generate",
  "regenerate",
  "refine",
  "manual_edit",
  "holiday_added",
  "leave_added",
  "leave_removed",
  "disruption",
  "task_pending",
  "faculty_override",
  "blueprint_changed",
  "ia_dates_changed",
  "rollback",
  "other",
];

const CHANGED_BY = ["AI", "Faculty", "Admin", "Student", "System"];

function dayNameFromId(dayId = "") {
  const s = String(dayId || "");
  const m = s.match(/Week\s*\d+\s*[-–]\s*([A-Za-z]+)/i);
  if (m) return m[1];
  const m2 = s.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i);
  return m2 ? m2[1] : s.slice(0, 40) || "?";
}

function weekFromId(dayId = "") {
  const m = String(dayId || "").match(/Week\s*(\d+)/i);
  return m ? m[1] : "";
}

function normText(s) {
  return String(s || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function rowFields(row) {
  if (!Array.isArray(row)) {
    return { day: "?", dayName: "?", week: "", time: "", activity: "", detail: "" };
  }
  const day = String(row[0] || "");
  return {
    day,
    dayName: dayNameFromId(day),
    week: weekFromId(day),
    time: String(row[1] || "").trim(),
    activity: normText(row[2] || ""),
    detail: normText(row[3] || ""),
  };
}

function contentFingerprint(row) {
  const f = rowFields(row);
  const activity = f.activity.toLowerCase();
  const detailHead = f.detail.toLowerCase().split(/[·|\n]/)[0].slice(0, 80);
  return `${activity}||${detailHead}`;
}

/** Stable schedule slot — week + weekday + time (ignore date in parentheses) */
function slotKeyOf(fields) {
  const week = fields.week || weekFromId(fields.day);
  const dayName = String(fields.dayName || dayNameFromId(fields.day) || "").toLowerCase();
  const time = String(fields.time || "").toLowerCase().replace(/\s+/g, "");
  return `${week}|${dayName}|${time}`;
}

function slotKey(row) {
  return slotKeyOf(rowFields(row));
}

function subjectHint(activity = "", detail = "") {
  const act = String(activity || "").replace(/^[▶•\-\s]+/, "").trim();
  if (act && !/^content$/i.test(act)) {
    if (/^(study|task|session|slot)$/i.test(act) && detail) {
      const line = String(detail)
        .replace(/^[▶•\-\s]+/, "")
        .split(/[\n|]/)[0]
        .trim()
        .slice(0, 56);
      return line || act;
    }
    return act.slice(0, 56);
  }
  const line = String(detail || "")
    .replace(/^[▶•\-\s]+/, "")
    .split(/[\n|]/)[0]
    .trim()
    .slice(0, 56);
  return line || "Schedule item";
}

function describeSlot(fields = {}) {
  const dayName = fields.dayName || dayNameFromId(fields.day) || "—";
  const time = fields.time || "—";
  const fullDay = fields.day || null;
  return {
    day: fullDay || dayName,
    dayName,
    time,
    fullDay,
    activity: fields.activity || "—",
    detail: String(fields.detail || ""),
  };
}

/**
 * Infer trigger from changeType / reason text.
 */
function inferTrigger(changeType = "", reason = "", explicit) {
  if (explicit && TRIGGERS.includes(String(explicit))) return String(explicit);
  const t = String(changeType || "");
  const r = String(reason || "").toLowerCase();

  if (/^restored$/i.test(t) || /rollback|restored from/i.test(r)) return "rollback";
  if (/^initial plan$/i.test(t)) return "initial_generate";
  if (/^regenerat/i.test(t) || /regenerat/i.test(r)) return "regenerate";
  if (/^refined$/i.test(t) || /\brefine/i.test(r)) return "refine";
  if (/leave added/i.test(t)) {
    if (/holiday/i.test(r)) return "holiday_added";
    return "leave_added";
  }
  if (/leave removed/i.test(t)) return "leave_removed";
  if (/disruption|partial disruption/i.test(t)) return "disruption";
  if (/blueprint/i.test(t)) return "blueprint_changed";
  if (/ia dates/i.test(t)) return "ia_dates_changed";
  if (/faculty|override/i.test(t) || /faculty override/i.test(r)) return "faculty_override";
  if (/holiday/i.test(r)) return "holiday_added";
  if (/pending|incomplete|not done/i.test(r)) return "task_pending";
  if (/manual edit/i.test(t)) return "manual_edit";
  return "other";
}

/**
 * Infer who made the change.
 */
function inferChangedBy(req, changeType = "", explicit) {
  if (explicit && CHANGED_BY.includes(String(explicit))) return String(explicit);
  const role = String(req?.user?.role || "").toLowerCase();
  if (role === "admin") return "Admin";
  if (role === "faculty" || role === "teacher") return "Faculty";

  const t = String(changeType || "");
  if (
    /^initial plan$/i.test(t) ||
    /^day regenerat/i.test(t) ||
    /^regenerat/i.test(t) ||
    /^refined$/i.test(t)
  ) {
    return "AI";
  }
  if (/leave|disruption|blueprint|ia dates/i.test(t)) return "System";
  if (/^restored$/i.test(t)) return "Student";
  if (/protect/i.test(t) || /faculty override/i.test(t)) return "Faculty";
  return "Student";
}

function triggerLabel(trigger) {
  const map = {
    initial_generate: "Initial generate",
    regenerate: "Regenerate",
    refine: "Refine",
    manual_edit: "Manual edit",
    holiday_added: "Holiday added",
    leave_added: "Leave added",
    leave_removed: "Leave removed",
    disruption: "Disruption",
    task_pending: "Task pending",
    faculty_override: "Faculty override",
    blueprint_changed: "Blueprint changed",
    ia_dates_changed: "IA dates changed",
    rollback: "Rollback",
    other: "Other",
  };
  return map[trigger] || trigger || "Other";
}

/**
 * Only real schedule differences:
 * - same week/weekday/time with different activity/content → updated
 * - same content on another weekday/time → moved
 * - otherwise added / removed
 * Date-only changes inside the day label are ignored.
 */
function buildCompareDiff(planA, planB) {
  if (!planA?.rows || !planB?.rows) {
    return {
      totalChanges: 0,
      added: 0,
      removed: 0,
      modified: 0,
      moved: 0,
      changes: [],
      summary: "No row data to compare",
      highlights: [],
    };
  }

  const rowsA = planA.rows
    .filter(Array.isArray)
    .map((row, idx) => ({ idx, row, fields: rowFields(row) }));
  const rowsB = planB.rows
    .filter(Array.isArray)
    .map((row, idx) => ({ idx, row, fields: rowFields(row) }));

  const bySlotB = new Map();
  rowsB.forEach((item, j) => {
    const k = slotKeyOf(item.fields);
    if (!bySlotB.has(k)) bySlotB.set(k, []);
    bySlotB.get(k).push(j);
  });

  const usedB = new Set();
  const usedA = new Set();
  const changes = [];

  const meaningfulContentChange = (a, b) => {
    if (!a || !b) return true;
    return (
      a.fields.activity.toLowerCase() !== b.fields.activity.toLowerCase() ||
      a.fields.detail.toLowerCase() !== b.fields.detail.toLowerCase()
    );
  };

  const locationChanged = (a, b) => {
    if (!a || !b) return true;
    return (
      String(a.fields.dayName || "").toLowerCase() !== String(b.fields.dayName || "").toLowerCase() ||
      String(a.fields.week || "") !== String(b.fields.week || "") ||
      String(a.fields.time || "").toLowerCase().replace(/\s+/g, "") !==
        String(b.fields.time || "").toLowerCase().replace(/\s+/g, "")
    );
  };

  /** Pull useful lines from schedule blobs — drop ▶ and label noise. */
  const cleanScheduleText = (raw) => {
    let t = String(raw || "").replace(/\r/g, "\n");
    if (!t.trim()) return "";

    const lines = t
      .split(/\n+/)
      .map((l) =>
        l
          .replace(/^[▶•\-–—*▸▪☐☑\s]+/g, "")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);

    const prefer =
      /^(?:today'?s lesson|today'?s focus|today'?s piece|topic|subject today|learn today|new learning|problem(?:\s*review)?|dsa(?:\s*concept)?(?:\s*today)?|system design(?:\s*concept)?(?:\s*today)?)\s*:\s*(.+)$/i;
    const valueOnly =
      /^(?:in plain words|what to learn|do now|heading|dt playbook step today|key point|focus)\s*:\s*(.+)$/i;
    const skip =
      /^(?:why this connects|transition|apply to your problem|read\s*\/\s*watch|helpful links|done when|extra hint|process|log)\s*:/i;

    for (const line of lines) {
      const pref = line.match(prefer);
      if (pref) return pref[1].trim();
    }
    for (const line of lines) {
      const val = line.match(valueOnly);
      if (val) return val[1].trim();
    }
    for (const line of lines) {
      if (skip.test(line)) continue;
      if (/^https?:\/\//i.test(line)) continue;
      return line.replace(/^[▶•\s]+/, "").trim();
    }
    return t.replace(/[▶•▸▪☐☑]/g, " ").replace(/\s+/g, " ").trim();
  };

  const DANGLING_END =
    /^(for|to|of|with|and|or|the|a|an|is|are|was|were|in|on|at|by|from|into|as|than|that|this|these|those|our|your|their|be|been|being|not|also|very)$/i;

  /** Complete focus phrase — never cut mid-thought (e.g. “…crucial for”). */
  const extractFocus = (raw, max = 110) => {
    let t = cleanScheduleText(raw);
    if (!t || t === "(none)" || t === "—") return "";

    t = t
      .replace(/^[▶•\-–—*▸▪☐☑\s]+/g, "")
      .replace(
        /^(?:in plain words|today'?s piece|today'?s lesson|today'?s focus|what to learn|heading|do now|topic|learn today|subject today|key point|focus)\s*:\s*/i,
        ""
      )
      .replace(/["“”]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) return "";

    // Prefer a full first sentence when present
    const fullSent = t.match(/^(.{20,140}?[.!?])(?:\s|$)/);
    if (fullSent) {
      return fullSent[1].replace(/\s+/g, " ").trim();
    }

    // Else take first clause before · | — ;
    t = t.split(/\s*[·|—–;]\s*/)[0].trim();

    // Known problem titles — keep whole name
    const named = t.match(
      /\b((?:Valid\s+Parenthes[ei]s|Two\s+Sum|Binary\s+Tree(?:\s+[A-Za-z]+){0,4}|[A-Z][A-Za-z0-9'’\-]*(?:\s+[A-Za-z0-9'’\-]+){1,6}))\b/
    );
    if (named && named[1].length >= 8 && named[1].length <= max) {
      t = named[1].trim();
    }

    t = t.replace(/^(study|practice|solve|complete|do|work on|learn|cover[s]?)\s+/i, "").trim();

    const words = t.split(/\s+/).filter(Boolean);
    let out = [];
    for (let i = 0; i < words.length; i++) {
      const next = [...out, words[i]].join(" ");
      if (next.length > max && out.length >= 5) {
        // If we would stop on a dangling word, keep pulling a few more
        if (DANGLING_END.test(words[i - 1] || "") || DANGLING_END.test(out[out.length - 1])) {
          out.push(words[i]);
          // pull until not dangling or hard stop
          while (i + 1 < words.length && DANGLING_END.test(out[out.length - 1]) && out.join(" ").length < max + 50) {
            i += 1;
            out.push(words[i]);
          }
        }
        break;
      }
      out.push(words[i]);
    }

    while (out.length && DANGLING_END.test(out[out.length - 1])) out.pop();
    t = out.join(" ").replace(/[,:;·\-–—]+$/g, "").trim();
    if (!t || DANGLING_END.test(t.split(/\s+/).pop() || "")) return "";
    return t;
  };

  const finishSentence = (s) => {
    let out = String(s || "")
      .replace(/[▶•▸▪☐☑]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!out) return "";
    if (!/[.!?]$/.test(out) && out.split(/\s+/).length > 4) out += ".";
    return out;
  };

  const exactContentDiff = (before, after) => {
    const b = String(before || "").trim();
    const a = String(after || "").trim();
    if (b.toLowerCase() === a.toLowerCase()) return null;
    const bLines = b.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const aLines = a.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (bLines.length > 1 || aLines.length > 1) {
      const bSet = new Set(bLines.map((l) => l.toLowerCase()));
      const aSet = new Set(aLines.map((l) => l.toLowerCase()));
      const removed = bLines.filter((l) => !aSet.has(l.toLowerCase()));
      const added = aLines.filter((l) => !bSet.has(l.toLowerCase()));
      if ((removed.length || added.length) && (removed.length < bLines.length || added.length < aLines.length)) {
        return {
          before: removed.length ? removed.join("\n") : "",
          after: added.length ? added.join("\n") : "",
        };
      }
    }
    return { before: b, after: a };
  };

  /** Short purpose line from schedule text (Why this connects / Build hook / …). */
  const extractPurpose = (raw) => {
    const lines = String(raw || "")
      .replace(/\r/g, "\n")
      .split(/\n+/)
      .map((l) => l.replace(/^[▶•\-–—*▸▪☐☑\s]+/g, "").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const re =
      /^(?:why this connects|build hook|project link|purpose|apply|how it links|pipeline goal|connectivity|done when)\s*:\s*(.+)$/i;
    for (const line of lines) {
      const m = line.match(re);
      if (m) {
        let v = m[1].trim().replace(/["“”]/g, "");
        if (v.length > 120) {
          const cut = v.slice(0, 120);
          const sp = cut.lastIndexOf(" ");
          v = (sp > 40 ? cut.slice(0, sp) : cut).trim();
        }
        while (DANGLING_END.test(v.split(/\s+/).pop() || "")) {
          const parts = v.split(/\s+/);
          parts.pop();
          v = parts.join(" ");
        }
        return v.replace(/[,:;·\-–—]+$/g, "").trim();
      }
    }
    return "";
  };

  /** Why the topic shifted — short reason only (no label prefix). */
  const whyTopicChange = ({ activity, topicWas, topicNow, afterContent }) => {
    const act = String(activity || "session").replace(/[▶•]/g, "").trim() || "session";
    const purpose = extractPurpose(afterContent);
    if (purpose) return purpose;

    const now = String(topicNow || "").trim().replace(/[.!?]+$/g, "");
    const was = String(topicWas || "").trim().replace(/[.!?]+$/g, "");
    const nowL = now.toLowerCase();
    const actL = act.toLowerCase();

    if (/problem review|dt|research|standup/i.test(actL) || /\b(data|user|interview|problem|research|field|customer)\b/i.test(nowL)) {
      return now
        ? `Supports clearer problem understanding through ${now}.`
        : `Supports the live problem research thread.`;
    }
    if (/homework|coding|dsa|leetcode|practice/i.test(actL) || /\b(tree|array|graph|sum|parenthes|stack|queue|sort|hash)\b/i.test(nowL)) {
      return now
        ? `Matches today's skill drill with ${now}.`
        : `Matches today's coding focus.`;
    }
    if (/system design|lecture|learn|subject/i.test(actL)) {
      return now
        ? `Next concept to apply is ${now}.`
        : `Moves to the next connected concept.`;
    }
    if (was && now) return `Centers the session on ${now}.`;
    if (now) return `Centers the session on ${now}.`;
    return `Clears the previous topic focus.`;
  };

  /**
   * Plain compare cells:
   * before / after = the actual focus text (complete, no fluff)
   * note = short reason (for topic updates: why / purpose / alignment)
   */
  const buildTrio = (type, bits) => {
    const {
      dayWas,
      dayNow,
      timeWas,
      timeNow,
      topicWas,
      topicNow,
      actWas,
      actNow,
      activity,
      day,
      afterContent,
    } = bits;
    const act = String(activity || "Session").replace(/[▶•]/g, "").trim() || "Session";

    const focusOr = (v, fallback) => finishSentence(v) || fallback || "—";

    if (type === "moved") {
      if (dayWas && dayNow && dayWas !== dayNow) {
        if (topicWas && topicNow && topicWas.toLowerCase() !== topicNow.toLowerCase()) {
          return {
            was: focusOr(topicWas),
            now: focusOr(topicNow),
            note: whyTopicChange({ activity, topicWas, topicNow, afterContent }),
          };
        }
        return {
          was: dayWas,
          now: dayNow,
          note: `Moved to ${dayNow}`,
        };
      }
      if (timeWas && timeNow && timeWas !== timeNow) {
        return {
          was: timeWas,
          now: timeNow,
          note: `Time updated`,
        };
      }
      return {
        was: focusOr(topicWas, dayWas),
        now: focusOr(topicNow, dayNow),
        note: `Rescheduled`,
      };
    }

    if (type === "modified") {
      if (actWas && actNow && actWas.toLowerCase() !== actNow.toLowerCase()) {
        return {
          was: actWas,
          now: actNow,
          note: `Activity renamed`,
        };
      }
      if (topicWas && topicNow) {
        return {
          was: focusOr(topicWas, "—"),
          now: focusOr(topicNow, "—"),
          note: whyTopicChange({ activity, topicWas, topicNow, afterContent }),
        };
      }
      return {
        was: focusOr(topicWas, "—"),
        now: focusOr(topicNow, "—"),
        note: topicNow ? `Topic added` : `Topic removed`,
      };
    }

    if (type === "added") {
      return {
        was: "—",
        now: focusOr(topicNow, `${act} on ${day}`),
        note: `Added on ${day}`,
      };
    }

    if (type === "removed") {
      return {
        was: focusOr(topicWas, `${act} on ${day}`),
        now: "—",
        note: `Removed from ${day}`,
      };
    }

    return {
      was: focusOr(topicWas, "—"),
      now: focusOr(topicNow, "—"),
      note: `Updated`,
    };
  };

  const pushChange = (type, a, b) => {
    if (type === "modified" && !meaningfulContentChange(a, b)) return;
    if (type === "moved" && !locationChanged(a, b)) return;

    const from = a ? describeSlot(a.fields) : null;
    const to = b ? describeSlot(b.fields) : null;
    const activity = (b?.fields.activity || a?.fields.activity || "Session").trim();
    const beforeContent = String(a?.fields.detail || "").trim();
    const afterContent = String(b?.fields.detail || "").trim();

    const dayWas = from?.dayName || "";
    const dayNow = to?.dayName || "";
    const timeWas = from?.time || "";
    const timeNow = to?.time || "";
    const actWas = extractFocus(a?.fields.activity || "", 40);
    const actNow = extractFocus(b?.fields.activity || "", 40);

    let topicWas = extractFocus(beforeContent);
    let topicNow = extractFocus(afterContent);
    if (type === "modified" || type === "moved") {
      const cd = exactContentDiff(beforeContent, afterContent);
      if (cd) {
        topicWas = extractFocus(cd.before) || topicWas;
        topicNow = extractFocus(cd.after) || topicNow;
      } else if (type === "moved") {
        topicWas = "";
        topicNow = "";
      }
    }

    // If topics are identical after cleanup, this is not a real content change
    if (
      type === "modified" &&
      topicWas &&
      topicNow &&
      topicWas.toLowerCase() === topicNow.toLowerCase() &&
      !(actWas && actNow && actWas.toLowerCase() !== actNow.toLowerCase())
    ) {
      return;
    }

    const bits = {
      dayWas,
      dayNow,
      timeWas,
      timeNow,
      topicWas,
      topicNow,
      actWas,
      actNow,
      activity,
      day: dayNow || dayWas,
      time: timeNow || timeWas,
      afterContent,
      beforeContent,
    };

    const { was, now, note } = buildTrio(type, bits);

    if (
      String(was).toLowerCase() === String(now).toLowerCase() &&
      type !== "added" &&
      type !== "removed"
    ) {
      return;
    }

    const where =
      type === "added"
        ? `${dayNow} · ${timeNow}`
        : type === "removed"
          ? `${dayWas} · ${timeWas}`
          : `${dayWas || dayNow} · ${timeWas || timeNow}`;

    changes.push({
      type,
      title: activity,
      activity,
      where,
      whatChanged: note,
      human: note,
      changedFields: [type],
      diffs: [
        {
          field: "summary",
          before: was,
          after: now,
          note,
        },
      ],
    });
  };

  // Pass 1 — same week/weekday/time slot
  rowsA.forEach((a, ai) => {
    const k = slotKeyOf(a.fields);
    const candidates = bySlotB.get(k) || [];
    const bj = candidates.find((j) => !usedB.has(j));
    if (bj == null) return;
    usedA.add(ai);
    usedB.add(bj);
    const b = rowsB[bj];
    if (meaningfulContentChange(a, b)) {
      pushChange("modified", a, b);
    }
    // else: only date text in day label may differ — ignore
  });

  // Pass 2 — unmatched content fingerprints → moves
  const mapBfp = new Map();
  rowsB.forEach((item, realIdx) => {
    if (usedB.has(realIdx)) return;
    const fp = contentFingerprint(item.row);
    if (!mapBfp.has(fp)) mapBfp.set(fp, []);
    mapBfp.get(fp).push({ realIdx, item });
  });

  rowsA.forEach((a, ai) => {
    if (usedA.has(ai)) return;
    const fp = contentFingerprint(a.row);
    const list = mapBfp.get(fp) || [];
    const hit = list.find((x) => !usedB.has(x.realIdx));
    if (!hit) return;
    usedA.add(ai);
    usedB.add(hit.realIdx);
    if (locationChanged(a, hit.item)) {
      pushChange("moved", a, hit.item);
    }
  });

  // Pass 3 — true additions / removals
  rowsA.forEach((a, ai) => {
    if (!usedA.has(ai)) pushChange("removed", a, null);
  });
  rowsB.forEach((b, bj) => {
    if (!usedB.has(bj)) pushChange("added", null, b);
  });

  const order = { moved: 0, modified: 1, removed: 2, added: 3 };
  changes.sort((x, y) => (order[x.type] ?? 9) - (order[y.type] ?? 9));

  const added = changes.filter((c) => c.type === "added").length;
  const removed = changes.filter((c) => c.type === "removed").length;
  const modified = changes.filter((c) => c.type === "modified").length;
  const moved = changes.filter((c) => c.type === "moved").length;
  const highlights = changes.filter((c) => c.human).slice(0, 5).map((c) => c.human);
  const parts = [];
  if (moved) parts.push(`${moved} moved`);
  if (modified) parts.push(`${modified} updated`);
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);

  return {
    totalChanges: changes.length,
    added,
    removed,
    modified,
    moved,
    summary: changes.length === 0 ? "No differences" : highlights[0] || parts.join(" · "),
    highlights,
    changes,
  };
}

function slimDiff(diff, maxChanges = 40) {
  if (!diff) return null;
  const slimChanges = (Array.isArray(diff.changes) ? diff.changes : [])
    .slice(0, maxChanges)
    .map((c) => ({
      type: c.type,
      title: c.title || c.activity || "",
      activity: c.activity,
      where: c.where || "",
      human: c.human || "",
      whatChanged: c.whatChanged || "",
      changedFields: Array.isArray(c.changedFields) ? c.changedFields : [],
      // Exact differences only — this is what the UI should render
      diffs: Array.isArray(c.diffs)
        ? c.diffs.slice(0, 1).map((d) => ({
            field: d.field || "summary",
            before: String(d.before || "—").slice(0, 260),
            after: String(d.after || "—").slice(0, 260),
            note: String(d.note || c.whatChanged || c.human || "").slice(0, 220),
          }))
        : [],
    }));
  return {
    totalChanges: diff.totalChanges || 0,
    added: diff.added || 0,
    removed: diff.removed || 0,
    modified: diff.modified || 0,
    moved: diff.moved || 0,
    summary: diff.summary || "",
    highlights: Array.isArray(diff.highlights) ? diff.highlights.slice(0, 5) : [],
    changes: slimChanges,
  };
}

/**
 * Collect protected slot keys from a plan (or from diff changes).
 */
function collectProtectedSlots(plan, existing = []) {
  const set = new Set((existing || []).map(String));
  if (Array.isArray(plan?.protectedSlots)) {
    plan.protectedSlots.forEach((k) => set.add(String(k)));
  }
  return [...set];
}

/**
 * When applying a new plan, keep faculty-protected slots from the previous plan.
 */
function applyProtectedOverrides(previousPlan, nextPlan, protectedSlots = []) {
  if (!previousPlan?.rows?.length || !nextPlan?.rows?.length || !protectedSlots?.length) {
    return { plan: nextPlan, preserved: 0 };
  }
  const protect = new Set(protectedSlots.map((k) => String(k).toLowerCase()));
  const prevBySlot = new Map();
  for (const row of previousPlan.rows) {
    if (!Array.isArray(row)) continue;
    prevBySlot.set(slotKey(row), row);
  }

  let preserved = 0;
  const rows = nextPlan.rows.map((row) => {
    if (!Array.isArray(row)) return row;
    const key = slotKey(row);
    // Match by day+time (activity may change)
    const dayTime = `${String(row[0] || "").toLowerCase()}|${String(row[1] || "").toLowerCase()}`;
    const protectedHit = [...protect].find(
      (p) => p === key || p.startsWith(dayTime + "|") || p === dayTime
    );
    if (!protectedHit) return row;
    const prev =
      prevBySlot.get(key) ||
      [...prevBySlot.entries()].find(([k]) => k.startsWith(dayTime + "|"))?.[1];
    if (!prev) return row;
    preserved += 1;
    return [...prev];
  });

  return {
    plan: { ...nextPlan, rows },
    preserved,
  };
}

module.exports = {
  TRIGGERS,
  CHANGED_BY,
  rowFields,
  dayNameFromId,
  contentFingerprint,
  slotKey,
  subjectHint,
  inferTrigger,
  inferChangedBy,
  triggerLabel,
  buildCompareDiff,
  slimDiff,
  collectProtectedSlots,
  applyProtectedOverrides,
};
