/**
 * AWS S3 (or S3-compatible) storage for user uploads.
 * Keys live in env — never commit secrets.
 *
 * Layout:
 *   AI-Path-Builder/users/{userId}/{email}/{field}/{yyyy}/{mm}/{stamp}__{original}
 */
const { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const DEFAULT_BUCKET = "naac-document";
const DEFAULT_PREFIX = "AI-Path-Builder";

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function folderPrefix() {
  const raw = env("AWS_S3_PREFIX", DEFAULT_PREFIX) || DEFAULT_PREFIX;
  return raw.replace(/^\/+|\/+$/g, "") || DEFAULT_PREFIX;
}

function bucketName() {
  return env("AWS_S3_BUCKET", DEFAULT_BUCKET) || DEFAULT_BUCKET;
}

function isConfigured() {
  return Boolean(env("AWS_ACCESS_KEY_ID") && env("AWS_SECRET_ACCESS_KEY") && bucketName());
}

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!isConfigured()) return null;
  const region = env("AWS_REGION", "ap-south-1");
  const endpoint = env("AWS_S3_ENDPOINT");
  _client = new S3Client({
    region,
    credentials: {
      accessKeyId: env("AWS_ACCESS_KEY_ID"),
      secretAccessKey: env("AWS_SECRET_ACCESS_KEY"),
    },
    ...(endpoint
      ? {
          endpoint,
          forcePathStyle: env("AWS_S3_FORCE_PATH_STYLE", "true") !== "false",
        }
      : {}),
  });
  return _client;
}

function slugPart(value, fallback = "x") {
  const s = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || fallback;
}

function safeFileName(original = "file") {
  const base = String(original || "file").replace(/\\/g, "/").split("/").pop();
  const cleaned = base
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .replace(/\s+/g, "-")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return cleaned || "file";
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function stampParts(date = new Date()) {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return {
    yyyy: String(y),
    mm: m,
    stamp: `${y}-${m}-${d}_${hh}-${mm}-${ss}`,
    iso: date.toISOString(),
  };
}

function objectKey({ userId, email, field, originalName, uploadedAt }) {
  const when = stampParts(uploadedAt || new Date());
  const owner = userId ? slugPart(userId, "user") : "guest";
  const kind = slugPart(field || "general", "general");
  const file = safeFileName(originalName);
  const emailBit = email ? `${slugPart(email)}/` : "";
  const rand = Math.random().toString(36).slice(2, 8);
  return `${folderPrefix()}/users/${owner}/${emailBit}${kind}/${when.yyyy}/${when.mm}/${when.stamp}_${rand}__${file}`;
}

function publicUrlForKey(key) {
  const bucket = bucketName();
  const base = env("AWS_S3_PUBLIC_BASE").replace(/\/+$/, "");
  if (base) return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const endpoint = env("AWS_S3_ENDPOINT").replace(/\/+$/, "");
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  if (endpoint) {
    return `${endpoint}/${bucket}/${encoded}`;
  }
  const region = env("AWS_REGION", "ap-south-1");
  return `https://${bucket}.s3.${region}.amazonaws.com/${encoded}`;
}

async function signedUrlForKey(key, expiresIn = 60 * 60 * 24 * 7) {
  const client = getClient();
  const bucket = bucketName();
  if (!client || !bucket || !key) return "";
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, cmd, { expiresIn });
}

async function uploadBuffer({
  buffer,
  contentType,
  originalName,
  field,
  userId,
  email,
}) {
  if (!isConfigured()) {
    return { skipped: true, reason: "S3 is not configured" };
  }
  const client = getClient();
  const bucket = bucketName();
  const uploadedAt = new Date();
  const key = objectKey({ userId, email, field, originalName, uploadedAt });
  const acl = env("AWS_S3_ACL");
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
      ContentDisposition: `inline; filename="${safeFileName(originalName)}"`,
      Metadata: {
        "original-name": String(originalName || "").slice(0, 200),
        field: String(field || "").slice(0, 80),
        "user-id": String(userId || "guest").slice(0, 80),
      },
      ...(acl ? { ACL: acl } : {}),
    })
  );

  const url = publicUrlForKey(key);
  let signedUrl = "";
  const wantSigned = env("AWS_S3_SIGNED_URLS", "true") !== "false";
  if (wantSigned) {
    try {
      signedUrl = await signedUrlForKey(key);
    } catch (e) {
      console.warn("[s3] signed URL skipped:", e.message);
    }
  }

  console.log(`[s3] stored in bucket "${bucket}": ${key}`);

  return {
    skipped: false,
    bucket,
    key,
    url: signedUrl || url,
    publicUrl: url,
    signedUrl: signedUrl || "",
    originalName: originalName || "file",
    storedName: key.split("/").pop(),
    contentType: contentType || "application/octet-stream",
    size: buffer?.length || 0,
    uploadedAt: uploadedAt.toISOString(),
    field: field || "general",
  };
}

async function verifyBucket() {
  if (!isConfigured()) {
    return { ok: false, bucket: bucketName(), reason: "AWS keys not set" };
  }
  const bucket = bucketName();
  try {
    await getClient().send(new HeadBucketCommand({ Bucket: bucket }));
    return { ok: true, bucket };
  } catch (e) {
    return { ok: false, bucket, reason: e.code || e.name || e.message };
  }
}

module.exports = {
  isConfigured,
  bucketName,
  folderPrefix,
  objectKey,
  publicUrlForKey,
  signedUrlForKey,
  uploadBuffer,
  verifyBucket,
};
