/**
 * Safe GitHub PAT diagnostic — prints status only, never full token.
 * Run: node scripts/diagnoseGithubSchedule.js
 */
const https = require("https");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function mask(v) {
  const s = String(v || "");
  if (!s) return "(empty)";
  if (s.length <= 12) return s.slice(0, 4) + "…";
  return s.slice(0, 10) + "…(len " + s.length + ")";
}

function ghJson(method, urlPath, token, bodyObj) {
  const body = bodyObj ? JSON.stringify(bodyObj) : null;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "ai-path-builder-diag",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          let json = null;
          try {
            json = d ? JSON.parse(d) : null;
          } catch {
            json = { raw: d };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  const repo = String(
    process.env.GITHUB_SCHEDULE_REPO || "shreenevikhandt08/Schedule_store"
  ).trim();
  const branch = String(process.env.GITHUB_SCHEDULE_BRANCH || "main").trim();

  console.log("GITHUB_TOKEN:", mask(token));
  console.log("GITHUB_SCHEDULE_REPO:", repo || "(missing)");
  console.log("GITHUB_SCHEDULE_BRANCH:", branch);

  if (!token) {
    console.log("RESULT: no token in .env");
    process.exit(1);
  }

  const user = await ghJson("GET", "/user", token);
  console.log("auth_status:", user.status, "login:", user.json?.login || user.json?.message);

  const repoRes = await ghJson("GET", `/repos/${repo}`, token);
  console.log("repo_status:", repoRes.status);
  console.log("repo_name:", repoRes.json?.full_name || repoRes.json?.message);
  console.log("default_branch:", repoRes.json?.default_branch || null);
  console.log("permissions:", JSON.stringify(repoRes.json?.permissions || null));

  const probePath = "schedules/_permission_probe.txt";
  const put = await ghJson("PUT", `/repos/${repo}/contents/${probePath}`, token, {
    message: "chore: permission probe (safe to delete)",
    content: Buffer.from("ok\n", "utf8").toString("base64"),
    branch,
  });
  console.log("write_status:", put.status);
  console.log("write_message:", put.json?.message || put.json?.content?.path || "ok");

  if (put.status >= 200 && put.status < 300) {
    console.log("RESULT: WRITE OK — Save to repository should work now.");
  } else if (/not accessible by personal access token/i.test(put.json?.message || "")) {
    console.log("RESULT: PAT cannot write this repo.");
    console.log("ACTION:");
    console.log("  1) Token login must own", repo, "or be a collaborator with write.");
    console.log("  2) Fine-grained: Repository access must include", repo);
    console.log("  3) Permissions → Contents = Read and write");
    console.log("  4) Classic alternative: scope = repo");
    console.log("  5) Replace GITHUB_TOKEN, save .env, restart backend.");
  } else {
    console.log("RESULT: write failed — see write_message above.");
  }
}

main().catch((e) => {
  console.error("diag_err:", e.message);
  process.exit(1);
});
