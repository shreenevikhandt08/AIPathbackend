require("dotenv").config();
require("../utils/tlsSetup").applySystemCa();
const {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");

const bucket = process.env.AWS_S3_BUCKET || "naac-document";
const region = process.env.AWS_REGION || "ap-south-1";
const client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

function brief(e) {
  return {
    name: e.name,
    code: e.Code || e.code || "",
    status: e.$metadata?.httpStatusCode || "",
    message: String(e.message || "").slice(0, 180),
  };
}

(async () => {
  console.log("bucket", bucket, "region", region);
  try {
    const r = await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log("head ok", r.$metadata?.httpStatusCode);
  } catch (e) {
    console.log("head fail", brief(e));
  }
  try {
    const r = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 5 })
    );
    console.log(
      "list ok",
      r.$metadata?.httpStatusCode,
      "count",
      (r.Contents || []).length
    );
    (r.Contents || []).forEach((x) => console.log(" -", x.Key));
  } catch (e) {
    console.log("list fail", brief(e));
  }
})();
