// Providers answer in their own shapes. These helpers read the common ones and
// return null instead of guessing when nothing matches.

export interface Person {
  firstName: string;
  lastName: string;
  title: string;
  linkedinUrl: string;
}

const NAME_KEYS = ["full_name", "fullName", "name"];
const TITLE_KEYS = ["title", "job_title", "jobTitle", "position", "headline"];
const LINKEDIN_KEYS = ["linkedin_url", "linkedinUrl", "linkedin", "profile_url", "url"];

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function pick(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return "";
}

function toPerson(o: Record<string, unknown>): Person | null {
  let first = str(o.first_name) || str(o.firstName);
  let last = str(o.last_name) || str(o.lastName);
  if (!first) {
    const full = pick(o, NAME_KEYS);
    if (!full) return null;
    const parts = full.split(/\s+/);
    first = parts[0] ?? "";
    last = parts.slice(1).join(" ");
  }
  if (!first) return null;
  return { firstName: first, lastName: last, title: pick(o, TITLE_KEYS), linkedinUrl: pick(o, LINKEDIN_KEYS) };
}

/** Finds the first array of person-like objects anywhere in a search result. */
export function extractPeople(result: unknown, depth = 0): Person[] {
  if (depth > 5 || result === null || typeof result !== "object") return [];
  if (Array.isArray(result)) {
    const people = result
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x))
      .map(toPerson)
      .filter((p): p is Person => p !== null);
    if (people.length > 0) return people;
    for (const item of result) {
      const nested = extractPeople(item, depth + 1);
      if (nested.length > 0) return nested;
    }
    return [];
  }
  for (const value of Object.values(result as Record<string, unknown>)) {
    const nested = extractPeople(value, depth + 1);
    if (nested.length > 0) return nested;
  }
  return [];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** Email from the normalized block when present, else the first address in the raw result. */
export function extractEmail(run: { normalized?: { fields?: Record<string, unknown> }; result?: unknown }): string {
  const fromNorm = str(run.normalized?.fields?.email);
  if (fromNorm) return fromNorm;
  const m = JSON.stringify(run.result ?? "").match(EMAIL_RE);
  return m ? m[0] : "";
}

/** Verification status: valid, invalid, catch_all, risky or unknown. */
export function extractStatus(run: { normalized?: { fields?: Record<string, unknown> } }): string {
  return str(run.normalized?.fields?.status) || str(run.normalized?.fields?.check) || "unknown";
}

export function titleMatches(title: string, wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  const t = title.toLowerCase();
  return wanted.some((w) => t.includes(w.toLowerCase()));
}
