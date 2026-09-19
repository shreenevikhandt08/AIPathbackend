/**
 * SNS Thrust Areas — REVISED catalog (9 Verticals × 9 Technologies)
 * Keywords are broad synonyms so real problem statements match reliably.
 */

const INNOVATION_TECHNOLOGIES = [
  {
    id: "cgc",
    name: "CGC (Sales & Marketing) Tech",
    group: "tech",
    keywords: [
      "cgc", "sales", "marketing", "crm", "campaign",
      "conversion", "funnel", "gtm", "go to market", "customer acquisition",
      "salesforce", "hubspot", "growth marketing", "demand gen",
      "outreach", "email campaign", "attribution",
    ],
  },
  {
    id: "hrtech",
    name: "HR Tech",
    group: "tech",
    keywords: [
      "hr", "hr tech", "hrtech", "human resources", "recruit", "recruitment",
      "hiring", "ats", "onboarding", "payroll", "employee", "workforce",
      "attendance", "leave management", "performance review", "talent",
      "people ops", "hrms", "lms training",
    ],
  },
  {
    id: "systemdesign",
    name: "System Design / Data Structures & Algorithms",
    group: "tech",
    keywords: [
      "system design", "dsa", "data structures", "algorithms", "scalability",
      "architecture", "distributed", "load balancer", "caching", "microservices",
      "api design", "latency", "throughput", "consistency", "cap theorem",
      "design patterns", "leetcode", "data structure", "system design / dsa",
    ],
  },
  {
    id: "mern",
    name: "Coding & MERN (Software Engineering / Web & Application Development)",
    group: "tech",
    keywords: [
      "mern", "full stack", "fullstack",
      "react", "node", "nodejs", "express", "mongodb", "javascript", "typescript",
      "rest api", "spa", "next.js", "nextjs",
    ],
  },
  {
    id: "ai",
    name: "AI (Artificial Intelligence)",
    group: "tech",
    keywords: [
      "artificial intelligence", "machine learning", "deep learning",
      "llm", "nlp", "computer vision", "genai", "generative ai", "chatbot",
      "neural", "rag", "large language model",
    ],
  },
  {
    id: "datascience",
    name: "Data Science / Data Engineering",
    group: "tech",
    keywords: [
      "data science", "data engineering", "etl",
      "warehouse", "data lake", "spark", "airflow",
      "big data", "feature store", "kafka", "streaming data",
      "pandas", "notebook",
    ],
  },
  {
    id: "cloud",
    name: "Cloud & DevOps",
    group: "tech",
    keywords: [
      "cloud", "devops", "aws", "azure", "gcp", "kubernetes", "k8s", "docker",
      "ci/cd", "cicd", "terraform", "infrastructure", "sre", "observability",
      "monitoring", "deployment", "container", "serverless", "iaas", "paas",
    ],
  },
  {
    id: "testing",
    name: "Testing & Cybersecurity",
    group: "tech",
    keywords: [
      "testing", "qa", "quality assurance", "security", "cybersecurity", "cyber security",
      "penetration", "vuln", "vulnerability", "owasp", "auth", "encryption",
      "unit test", "integration test", "automation testing", "selenium",
      "sast", "dast", "zero trust", "firewall", "testing & security",
    ],
  },
  {
    id: "core_eng",
    name: "Mechanical / Electronics / Civil Technologies",
    group: "tech",
    keywords: [
      "mechanical", "mech tech", "mech", "cad", "cae", "fea", "thermodynamics", "hvac",
      "manufacturing process", "cnc", "kinematics", "solidworks", "ansys", "machine design",
      "mechatronic", "electronics", "electronics tech", "embedded", "pcb", "vlsi", "fpga",
      "microcontroller", "arduino", "esp32", "sensor", "circuit", "signal processing",
      "iot device", "firmware", "analog", "digital electronics",
      "civil", "civil tech", "construction", "structural", "bim", "autocad", "surveying",
      "concrete", "geotech", "transportation engineering", "quantity survey",
    ],
  },
];

const INDUSTRY_VERTICALS = [
  {
    id: "smart_mfg",
    name: "Smart Manufacturing / Auto / Aero",
    group: "vertical",
    keywords: [
      "smart manufacturing", "manufacturing", "factory", "factories", "industry 4.0",
      "shop floor", "production line", "automobile", "automotive",
      "vehicle", "ev", "electric vehicle", "oem", "fleet", "mobility",
      "aerospace", "aero", "aviation", "aircraft", "drone", "uav", "defence",
      "defense", "satellite", "industrial", "warehouse automation",
    ],
  },
  {
    id: "healthcare",
    name: "Healthcare & Insurance",
    group: "vertical",
    keywords: [
      "healthcare", "hospital", "hospitals", "patient", "clinic",
      "medical", "doctor", "nurse", "diagnosis", "pharma", "pharmacy",
      "telemedicine", "ehr", "insurance", "insurtech", "claims",
      "underwriting", "health insurance", "opd", "ambulance",
    ],
  },
  {
    id: "retail",
    name: "Retail / Fast Moving Consumer Goods - FMCG / Supply Chain & Logistics - SCL",
    group: "vertical",
    keywords: [
      "retail", "fmcg", "fast moving consumer goods", "scl", "supply chain", "logistics",
      "kirana", "ecommerce", "e-commerce", "marketplace", "inventory",
      "billing", "pos", "customer loyalty", "distribution", "warehouse", "last mile",
      "sku", "merchandising", "consumer goods",
    ],
  },
  {
    id: "finserv",
    name: "Financial Services",
    group: "vertical",
    keywords: [
      "finance", "financial services", "fintech", "bfsi", "banking", "bank",
      "loan", "payment", "upi", "credit", "lending", "wealth", "mutual fund",
      "trading", "investment", "kyc", "neft", "wallet", "nbfc",
    ],
  },
  {
    id: "media",
    name: "Media, Entertainment, Gaming",
    group: "vertical",
    keywords: [
      "media", "entertainment", "gaming", "streaming", "ott",
      "publisher", "broadcast", "music", "film", "esports", "unity", "unreal",
      "metaverse", "ar", "vr", "immersive",
    ],
  },
  {
    id: "realestate",
    name: "Realestate",
    group: "vertical",
    keywords: [
      "real estate", "realestate", "property", "housing", "rent", "lease",
      "broker", "proptech", "apartment", "plot", "construction site",
      "facility management", "tenant",
    ],
  },
  {
    id: "energy",
    name: "Power / Oil / Energy",
    group: "vertical",
    keywords: [
      "power", "oil", "energy", "solar", "grid", "renewable", "electricity",
      "battery", "wind", "hydro", "utility", "meter", "petroleum", "gas",
      "refinery", "smart meter", "carbon", "ev charging", "power plant",
    ],
  },
  {
    id: "agri",
    name: "Agri / Food",
    group: "vertical",
    keywords: [
      "agriculture", "agri", "agritech", "farm", "farmer", "farming", "crop",
      "soil", "irrigation", "cattle", "dairy", "food", "foodtech", "harvest",
      "cold storage", "mandi", "greenhouse", "pesticide", "fertilizer",
    ],
  },
  {
    id: "govtech",
    name: "Public Sector / Government Technology (GovTech)",
    group: "vertical",
    keywords: [
      "public sector", "government", "govtech", "gov tech", "civic", "citizen",
      "municipality", "e-governance", "egovernance", "public service", "digilocker",
      "aadhaar", "gst", "smart city", "policy tech", "digital india", "panchayat",
      "grievance", "welfare scheme", "passport seva",
    ],
  },
];

const YC_CHECKS = [
  { id: "clear_user", label: "Clear user / who has the pain", hint: "Name a specific user group" },
  { id: "pain", label: "Concrete pain / job-to-be-done", hint: "What goes wrong today?" },
  { id: "why_now", label: "Why now (timing / wedge)", hint: "What changed that makes this solvable now?" },
  { id: "solution_shape", label: "Product shape (not just a wish)", hint: "What will users do in the product?" },
  { id: "measurable", label: "Measurable outcome", hint: "How do you know it worked?" },
];

const UNICORN_CHECKS = [
  { id: "large_market", label: "Large / expanding market", hint: "Who else has this pain at scale?" },
  { id: "repeatable", label: "Repeatable usage or revenue path", hint: "Why would users come back / pay?" },
  { id: "defensible", label: "Defensible wedge (data, network, workflow)", hint: "What gets stronger with use?" },
  { id: "tech_leverage", label: "Technology leverage (not pure services)", hint: "Where does software/tech multiply effort?" },
  { id: "ambitious", label: "Ambitious but buildable first slice", hint: "Is there a tiny v1 that still matters?" },
];

/** Map legacy / short labels → current revised catalog names */
const TECH_ALIASES = {
  "cgc (sales & marketing) tech": "CGC (Sales & Marketing) Tech",
  "cgc": "CGC (Sales & Marketing) Tech",
  "hr tech": "HR Tech",
  "hrtech": "HR Tech",
  "system design / dsa": "System Design / Data Structures & Algorithms",
  "system design / data structures & algorithms": "System Design / Data Structures & Algorithms",
  "system design": "System Design / Data Structures & Algorithms",
  "dsa": "System Design / Data Structures & Algorithms",
  "coding / mern": "Coding & MERN (Software Engineering / Web & Application Development)",
  "coding & mern": "Coding & MERN (Software Engineering / Web & Application Development)",
  "coding & mern (software engineering / web & application development)":
    "Coding & MERN (Software Engineering / Web & Application Development)",
  "mern": "Coding & MERN (Software Engineering / Web & Application Development)",
  "ai": "AI (Artificial Intelligence)",
  "ai (artificial intelligence)": "AI (Artificial Intelligence)",
  "artificial intelligence": "AI (Artificial Intelligence)",
  "data science / data engineering": "Data Science / Data Engineering",
  "cloud & devops": "Cloud & DevOps",
  "testing & security": "Testing & Cybersecurity",
  "testing & cybersecurity": "Testing & Cybersecurity",
  "mech tech": "Mechanical / Electronics / Civil Technologies",
  "electronics tech": "Mechanical / Electronics / Civil Technologies",
  "civil tech": "Mechanical / Electronics / Civil Technologies",
  "mechanical / electronics / civil technologies": "Mechanical / Electronics / Civil Technologies",
};

const VERTICAL_ALIASES = {
  "smart manufacturing / auto / aero": "Smart Manufacturing / Auto / Aero",
  "healthcare & insurance": "Healthcare & Insurance",
  "retail / fmcg / scl":
    "Retail / Fast Moving Consumer Goods - FMCG / Supply Chain & Logistics - SCL",
  "retail / fast moving consumer goods - fmcg / supply chain & logistics - scl":
    "Retail / Fast Moving Consumer Goods - FMCG / Supply Chain & Logistics - SCL",
  "financial services": "Financial Services",
  "media, entertainment, gaming": "Media, Entertainment, Gaming",
  "real estate": "Realestate",
  realestate: "Realestate",
  "power / oil / energy": "Power / Oil / Energy",
  "agri / food": "Agri / Food",
  telecom: "Public Sector / Government Technology (GovTech)",
  "public sector / government technology (govtech)":
    "Public Sector / Government Technology (GovTech)",
  govtech: "Public Sector / Government Technology (GovTech)",
};

function canonicalizeTechName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  if (INNOVATION_TECHNOLOGIES.some((t) => t.name === raw)) return raw;
  const key = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (TECH_ALIASES[key]) return TECH_ALIASES[key];
  const hit = INNOVATION_TECHNOLOGIES.find(
    (t) =>
      t.name.toLowerCase() === key ||
      key.includes(t.name.toLowerCase()) ||
      t.name.toLowerCase().includes(key)
  );
  return hit ? hit.name : raw;
}

function canonicalizeVerticalName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  if (INDUSTRY_VERTICALS.some((v) => v.name === raw)) return raw;
  const key = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (VERTICAL_ALIASES[key]) return VERTICAL_ALIASES[key];
  const hit = INDUSTRY_VERTICALS.find(
    (v) =>
      v.name.toLowerCase() === key ||
      key.includes(v.name.toLowerCase()) ||
      v.name.toLowerCase().includes(key)
  );
  return hit ? hit.name : raw;
}

function canonicalizeTechList(list) {
  const out = [];
  const seen = new Set();
  for (const n of list || []) {
    const c = canonicalizeTechName(n);
    if (!c || seen.has(c)) continue;
    if (!INNOVATION_TECHNOLOGIES.some((t) => t.name === c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

function canonicalizeVerticalList(list) {
  const out = [];
  const seen = new Set();
  for (const n of list || []) {
    const c = canonicalizeVerticalName(n);
    if (!c || seen.has(c)) continue;
    if (!INDUSTRY_VERTICALS.some((v) => v.name === c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

module.exports = {
  INNOVATION_TECHNOLOGIES,
  INDUSTRY_VERTICALS,
  YC_CHECKS,
  UNICORN_CHECKS,
  canonicalizeTechName,
  canonicalizeVerticalName,
  canonicalizeTechList,
  canonicalizeVerticalList,
};
