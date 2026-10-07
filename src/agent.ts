import { createHash } from "node:crypto";
import { Looot, type Run } from "./looot.ts";
import { extractEmail, extractPeople, extractStatus, titleMatches } from "./parse.ts";

export interface Options {
  domains: string[];
  titles: string[];
  perDomain: number;
  /** Stop starting new paid runs once this much has been spent, in USD. */
  maxCostUsd: number;
}

export interface Lead {
  domain: string;
  firstName: string;
  lastName: string;
  title: string;
  linkedinUrl: string;
  email: string;
  emailStatus: string;
  note: string;
}

export const JOBS = ["people.search", "people.email.find", "people.email.verify"] as const;

const key = (job: string, input: Record<string, unknown>) =>
  "leadgen-" + createHash("sha256").update(job + JSON.stringify(input)).digest("hex").slice(0, 32);

export function cleanDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}

export function parseDomains(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const d = cleanDomain(l);
    if (d.includes(".")) out.add(d);
  }
  return [...out];
}

export interface DryRunReport {
  lines: string[];
  leads: Lead[];
}

/** Calls only free routes: the keyless job overview, plus search and balance when a token is set. */
export async function dryRun(client: Looot, opts: Options): Promise<DryRunReport> {
  const lines: string[] = [];
  const jobs = await client.jobs();
  let perDomainUsd = 0;
  lines.push("Dry run. Nothing is spent. Cheapest listed price per call:");
  for (const id of JOBS) {
    const job = jobs.find((j) => j.id === id);
    const price = job?.cheapestPerCall ?? null;
    lines.push(`  job:${id}  ${price === null ? "price not listed" : "$" + price.toFixed(4)}  (${job?.providerCount ?? 0} providers)`);
    if (price !== null) perDomainUsd += id === "people.search" ? price : price * opts.perDomain;
  }
  lines.push(
    `Plan: ${opts.domains.length} domains, up to ${opts.perDomain} people each, titles: ${opts.titles.join(", ") || "any"}.`,
    `Rough floor for the whole run: $${(perDomainUsd * opts.domains.length).toFixed(2)} (cheapest providers; real cost is higher when fallback runs).`,
    `Cost cap for a live run: $${opts.maxCostUsd.toFixed(2)}.`,
  );
  if (client.hasToken) {
    const balance = await client.balance();
    lines.push(`Balance: $${balance.available.toFixed(2)} available, $${balance.reserved.toFixed(2)} reserved.`);
    const found = await client.search("find work email from name and domain", 3);
    lines.push(`Catalog search works (${found.endpoints?.length ?? 0} rows returned).`);
  } else {
    lines.push("No LOOOT_TOKEN set, so balance and catalog search were skipped.");
  }
  const leads: Lead[] = opts.domains.map((domain) => ({
    domain, firstName: "", lastName: "", title: "", linkedinUrl: "", email: "", emailStatus: "", note: "dry-run",
  }));
  return { lines, leads };
}

function runCost(run: Run): number {
  return typeof run.actualCost === "number" ? run.actualCost : 0;
}

export interface LiveResult {
  leads: Lead[];
  spentUsd: number;
  stoppedByCap: boolean;
}

/** Spends money. Runs people.search, then email find and verify for each person. */
export async function liveRun(client: Looot, opts: Options, log: (m: string) => void = () => {}): Promise<LiveResult> {
  const leads: Lead[] = [];
  let spent = 0;
  let capped = false;
  const canSpend = () => {
    if (spent >= opts.maxCostUsd) capped = true;
    return !capped;
  };
  const paid = async (job: string, input: Record<string, unknown>): Promise<Run | null> => {
    if (!canSpend()) return null;
    const run = await client.runJob(job, input, key(job, input));
    spent += runCost(run);
    if (run.status !== "completed") log(`  ${job} ${run.status}${run.error?.message ? ": " + run.error.message : ""}`);
    return run;
  };

  for (const domain of opts.domains) {
    log(`${domain}: searching people`);
    const search = await paid("people.search", { domain, title: opts.titles.join(", ") });
    if (!search) break;
    if (search.status !== "completed") {
      leads.push({ domain, firstName: "", lastName: "", title: "", linkedinUrl: "", email: "", emailStatus: "", note: `search ${search.status}` });
      continue;
    }
    const people = extractPeople(search.result)
      .filter((p) => titleMatches(p.title, opts.titles))
      .slice(0, opts.perDomain);
    if (people.length === 0) {
      leads.push({ domain, firstName: "", lastName: "", title: "", linkedinUrl: "", email: "", emailStatus: "", note: "no matching people" });
      continue;
    }
    for (const p of people) {
      const lead: Lead = { domain, ...p, email: "", emailStatus: "", note: "" };
      const find = await paid("people.email.find", {
        first_name: p.firstName, last_name: p.lastName, domain,
        ...(p.linkedinUrl ? { linkedin_url: p.linkedinUrl } : {}),
      });
      if (!find) { lead.note = "cost cap reached"; leads.push(lead); break; }
      lead.email = find.status === "completed" ? extractEmail(find) : "";
      if (!lead.email) {
        lead.note = "no email found";
      } else {
        const verify = await paid("people.email.verify", { email: lead.email });
        if (verify && verify.status === "completed") lead.emailStatus = extractStatus(verify);
        else lead.note = verify ? "verify failed" : "cost cap reached before verify";
      }
      leads.push(lead);
    }
  }
  return { leads, spentUsd: spent, stoppedByCap: capped };
}

const COLUMNS: (keyof Lead)[] = ["domain", "firstName", "lastName", "title", "email", "emailStatus", "linkedinUrl", "note"];

function csvCell(v: string): string {
  // Quote when needed, and defuse spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function toCsv(leads: Lead[]): string {
  const rows = [COLUMNS.join(",")];
  for (const l of leads) rows.push(COLUMNS.map((c) => csvCell(l[c])).join(","));
  return rows.join("\n") + "\n";
}
