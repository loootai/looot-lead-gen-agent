import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { dryRun, liveRun, parseDomains, toCsv } from "./agent.ts";
import { Looot, LoootError } from "./looot.ts";

const { values } = parseArgs({
  options: {
    domains: { type: "string" },
    titles: { type: "string", default: "" },
    out: { type: "string", default: "leads.csv" },
    "per-domain": { type: "string", default: "2" },
    "max-cost": { type: "string", default: "1.00" },
    live: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help || !values.domains) {
  console.log(`Usage: node src/cli.ts --domains domains.txt [--titles "CEO,Head of Marketing"] [--out leads.csv]
                       [--per-domain 2] [--max-cost 1.00] [--live]

Without --live this is a dry run: only free endpoints are called and nothing is spent.
With --live it needs LOOOT_TOKEN and a balance, and stops at --max-cost (USD).`);
  process.exit(values.help ? 0 : 1);
}

const opts = {
  domains: parseDomains(readFileSync(values.domains, "utf8")),
  titles: values.titles!.split(",").map((t) => t.trim()).filter(Boolean),
  perDomain: Math.max(1, Number.parseInt(values["per-domain"]!, 10) || 2),
  maxCostUsd: Number.parseFloat(values["max-cost"]!),
};
if (!(opts.maxCostUsd > 0)) {
  console.error("--max-cost must be a number above 0");
  process.exit(1);
}
if (opts.domains.length === 0) {
  console.error("No domains found in the file.");
  process.exit(1);
}

const client = new Looot();
try {
  if (!values.live) {
    const report = await dryRun(client, opts);
    console.log(report.lines.join("\n"));
    writeFileSync(values.out!, toCsv(report.leads));
    console.log(`Wrote ${report.leads.length} placeholder rows to ${values.out}. Add --live to spend.`);
  } else {
    if (!client.hasToken) {
      console.error("--live needs LOOOT_TOKEN. Create an agent token at https://looot.ai.");
      process.exit(1);
    }
    const balance = await client.balance();
    console.log(`Balance $${balance.available.toFixed(2)}. Cost cap $${opts.maxCostUsd.toFixed(2)}.`);
    const result = await liveRun(client, opts, console.log);
    writeFileSync(values.out!, toCsv(result.leads));
    console.log(
      `Wrote ${result.leads.length} rows to ${values.out}. Spent $${result.spentUsd.toFixed(4)}${result.stoppedByCap ? " (stopped at the cost cap)" : ""}.`,
    );
  }
} catch (e) {
  if (e instanceof LoootError) {
    console.error(`looot error ${e.code}: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
