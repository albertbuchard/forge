const protectedApplicantFieldKeys = new Set([
  "age",
  "birthdate",
  "citizenship",
  "dateofbirth",
  "demographic",
  "demographics",
  "disability",
  "disabilitystatus",
  "ethnicity",
  "familystatus",
  "gender",
  "genderidentity",
  "geneticinformation",
  "maritalstatus",
  "militaryservice",
  "militarystatus",
  "nationality",
  "nationalorigin",
  "pregnancy",
  "pregnancystatus",
  "protectedclass",
  "race",
  "religion",
  "sex",
  "sexualorientation",
  "veteranstatus"
]);

const protectedApplicantWords = new Set([
  "age",
  "birth",
  "citizenship",
  "demographic",
  "disabled",
  "disability",
  "ethnic",
  "ethnicity",
  "gender",
  "genetic",
  "marital",
  "military",
  "nationality",
  "pregnancy",
  "pregnant",
  "race",
  "religion",
  "religious",
  "sex",
  "veteran"
]);

const applicantFieldDescriptorKeys = new Set([
  "category",
  "field",
  "fieldname",
  "key",
  "label",
  "name",
  "question",
  "questiontext",
  "type"
]);

function normalizedFieldKey(value: string) {
  return value.replaceAll(/[^a-z0-9]/giu, "").toLowerCase();
}

function fieldWords(value: string) {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/gu)
    .filter(Boolean);
}

function describesProtectedApplicantField(value: string) {
  const normalized = normalizedFieldKey(value);
  if (protectedApplicantFieldKeys.has(normalized)) return true;
  const words = fieldWords(value);
  if (words.some((word) => protectedApplicantWords.has(word))) return true;
  return (
    (words.includes("family") && words.includes("status")) ||
    (words.includes("national") && words.includes("origin")) ||
    (words.includes("protected") && words.includes("class")) ||
    (words.includes("sexual") && words.includes("orientation"))
  );
}

export function findProtectedApplicantField(
  value: unknown,
  path: Array<string | number> = []
): Array<string | number> | null {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findProtectedApplicantField(entry, [...path, index]);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = [...path, key];
    if (describesProtectedApplicantField(key)) {
      return nextPath;
    }
    if (
      typeof entry === "string" &&
      applicantFieldDescriptorKeys.has(normalizedFieldKey(key)) &&
      describesProtectedApplicantField(entry)
    ) {
      return nextPath;
    }
    const found = findProtectedApplicantField(entry, nextPath);
    if (found) return found;
  }
  return null;
}
