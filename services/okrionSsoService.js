const axios = require("axios");

function getConfig() {
  const baseUrl = String(process.env.OKRION_SSO_BASE_URL || "").replace(/\/+$/, "");
  const internalKey = process.env.OKRION_SSO_INTERNAL_KEY;

  if (!baseUrl) {
    throw new Error("OKRION_SSO_BASE_URL is not configured");
  }
  if (!internalKey) {
    throw new Error("OKRION_SSO_INTERNAL_KEY is not configured");
  }

  return { baseUrl, internalKey };
}

function ssoHostLabel() {
  try {
    return new URL(String(process.env.OKRION_SSO_BASE_URL || "")).host || "OKRION_SSO_BASE_URL";
  } catch {
    return "OKRION_SSO_BASE_URL";
  }
}

function isSsoNetworkError(error) {
  if (error?.response) return false;
  const code = String(error?.code || "");
  const msg = String(error?.message || "");
  return (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    /timeout/i.test(msg)
  );
}

function client() {
  const { baseUrl, internalKey } = getConfig();
  return axios.create({
    baseURL: baseUrl,
    timeout: 15000,
    headers: {
      Accept: "application/json",
      "x-internal-key": internalKey,
      "Content-Type": "application/json",
    },
  });
}

function assertJsonPayload(data, endpointLabel) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error(
      `${endpointLabel} did not return JSON. Check that OKRion SSO URL is public and points to the backend API.`
    );
    error.status = 502;
    throw error;
  }
  return data;
}

function normalizeSsoError(error, fallback = "OKRion SSO request failed") {
  if (isSsoNetworkError(error)) {
    const normalized = new Error(
      `Cannot reach OKRion SSO at ${ssoHostLabel()}. Start the OKRion server or Dev Tunnel, then retry login.`
    );
    normalized.status = 502;
    normalized.code = "SSO_UNREACHABLE";
    return normalized;
  }

  const status = error?.response?.status || 500;
  const message =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallback;
  const normalized = new Error(message);
  normalized.status = status;
  normalized.code = error?.response?.data?.code || (status >= 500 ? "SSO_ERROR" : undefined);
  normalized.details = error?.response?.data || null;
  return normalized;
}

async function pingOkrionSso() {
  const { baseUrl, internalKey } = getConfig();
  try {
    await axios.get(baseUrl, {
      timeout: 5000,
      validateStatus: () => true,
      headers: { "x-internal-key": internalKey, Accept: "application/json" },
    });
    console.log(`OKRion SSO reachable → ${baseUrl}`);
    return true;
  } catch (error) {
    console.warn(
      `OKRion SSO not reachable → ${ssoHostLabel()}: ${error.message} (login will fail until this is up)`
    );
    return false;
  }
}

async function loginWithOkrion(email, password) {
  try {
    const { data } = await client().post("/login", { email, password });
    return assertJsonPayload(data, "OKRion SSO login");
  } catch (error) {
    throw normalizeSsoError(error, "Unable to validate OKRion credentials");
  }
}

async function checkOkrionUserExists(email) {
  try {
    const { data } = await client().get("/users/exists", { params: { email } });
    return assertJsonPayload(data, "OKRion user check");
  } catch (error) {
    throw normalizeSsoError(error, "Unable to check OKRion user");
  }
}

async function createOkrionUser(payload) {
  try {
    const { data } = await client().post("/users", payload);
    return assertJsonPayload(data, "OKRion user create");
  } catch (error) {
    throw normalizeSsoError(error, "Unable to create OKRion user");
  }
}

async function listOkrionInstitutions() {
  try {
    const { data } = await client().get("/metadata/institutions");
    return assertJsonPayload(data, "OKRion institution metadata");
  } catch (error) {
    throw normalizeSsoError(error, "Unable to fetch OKRion institutions");
  }
}

async function listOkrionDepartments(institutionId) {
  try {
    const { data } = await client().get("/metadata/departments", {
      params: { institutionId },
    });
    return assertJsonPayload(data, "OKRion department metadata");
  } catch (error) {
    throw normalizeSsoError(error, "Unable to fetch OKRion departments");
  }
}

module.exports = {
  loginWithOkrion,
  checkOkrionUserExists,
  createOkrionUser,
  listOkrionInstitutions,
  listOkrionDepartments,
  pingOkrionSso,
};
