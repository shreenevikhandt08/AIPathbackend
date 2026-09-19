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
  const status = error?.response?.status || 500;
  const message =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallback;
  const normalized = new Error(message);
  normalized.status = status;
  normalized.details = error?.response?.data || null;
  return normalized;
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
};
