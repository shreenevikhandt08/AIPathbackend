/**
 * SNS campus catalog — shared with academicLevel for Tech / Arts / School.
 */

const SNS_CAMPUSES = [
  {
    id: "sns-cot",
    name: "SNS College of Technology",
    kind: "college",
    stream: "tech",
    departments: ["CSE", "IT", "AI & DS", "ECE", "EEE", "Mechanical", "Mechatronics", "Civil", "AIDS", "Other"],
  },
  {
    id: "sns-coe",
    name: "SNS College of Engineering",
    kind: "college",
    stream: "tech",
    departments: ["CSE", "IT", "ECE", "EEE", "Mechanical", "Civil", "Automobile", "Other"],
  },
  {
    id: "sns-arts",
    name: "Dr. SNS Rajalakshmi College of Arts & Science",
    kind: "college",
    stream: "arts",
    departments: [
      "Computer Science", "BCA", "BBA", "B.Com", "English", "Mathematics",
      "Physics", "Chemistry", "Visual Communication", "Psychology", "Other",
    ],
  },
  {
    id: "sns-academy",
    name: "SNS Academy",
    kind: "school",
    stream: "school",
    departments: ["General", "Science stream", "Commerce stream", "Computer Science", "Other"],
  },
];

function getCampusByName(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return null;
  return (
    SNS_CAMPUSES.find((c) => c.name.toLowerCase() === n) ||
    SNS_CAMPUSES.find((c) => n.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(n)) ||
    null
  );
}

module.exports = {
  SNS_CAMPUSES,
  getCampusByName,
};
