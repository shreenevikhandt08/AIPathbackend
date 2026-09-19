const DreamCompany = require("../models/DreamCompany");
const { checkCompanyName, normalize } = require("../utils/companyNameCheck");

/** Built-in catalog mirrored for duplicate checks (keep in sync with frontend dreamCompanies.js) */
const BUILTIN = [
  "Meta", "Apple", "Amazon", "Netflix", "Google",
  "Microsoft", "Adobe", "Nvidia", "Oracle", "Salesforce", "Uber", "LinkedIn",
  "TCS", "Infosys", "Wipro", "HCLTech", "Accenture", "Cognizant", "IBM",
  "Capgemini", "Tech Mahindra", "LTIMindtree", "Mphasis", "L&T Technology Services",
  "Deloitte", "KPMG", "PwC", "EY", "BCG", "Bain & Company", "McKinsey",
];

async function allKnownNames() {
  const community = await DreamCompany.find({}).select("name").lean();
  return [...BUILTIN, ...community.map((c) => c.name)];
}

exports.listDreamCompanies = async (req, res) => {
  try {
    const community = await DreamCompany.find({})
      .sort({ useCount: -1, createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({
      success: true,
      builtin: BUILTIN,
      community: community.map((c) => ({
        name: c.name,
        useCount: c.useCount,
        addedByName: c.addedByName || "",
      })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.checkDreamCompany = async (req, res) => {
  try {
    const known = await allKnownNames();
    const result = checkCompanyName(req.body?.name || "", known);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.addDreamCompany = async (req, res) => {
  try {
    const known = await allKnownNames();
    const result = checkCompanyName(req.body?.name || "", known);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: result.warnings[0] || "Invalid company name",
        ...result,
      });
    }

    const force = req.body?.force === true;
    if (result.severity === "warn" && !force) {
      return res.status(409).json({
        success: false,
        needsConfirm: true,
        error: result.warnings[0] || "Possible duplicate — confirm to add anyway",
        ...result,
      });
    }

    const existing = await DreamCompany.findOne({ normalizedName: result.normalizedName });
    if (existing) {
      existing.useCount = (existing.useCount || 0) + 1;
      await existing.save();
      return res.json({
        success: true,
        company: { name: existing.name, useCount: existing.useCount },
        reused: true,
      });
    }

    const doc = await DreamCompany.create({
      name: result.name,
      normalizedName: result.normalizedName || normalize(result.name),
      addedBy: req.user?.id || req.user?._id || null,
      addedByName: req.user?.name || "",
      useCount: 1,
    });

    return res.status(201).json({
      success: true,
      company: { name: doc.name, useCount: doc.useCount },
      reused: false,
      warnings: result.warnings,
      suggestedOriginal: result.suggestedOriginal,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "That company was just added by someone else — refresh and pick it.",
      });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
};
