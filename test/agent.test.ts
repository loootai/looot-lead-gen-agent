import { test } from "node:test";
import assert from "node:assert/strict";
import { dryRun, liveRun, parseDomains, toCsv, cleanDomain } from "../src/agent.ts";
import { Looot } from "../src/looot.ts";
import { extractPeople, titleMatches } from "../src/parse.ts";
import { startMock } from "./mock-server.ts";

const opts = { domains: ["example.com"], titles: ["CEO", "Head of Marketing"], perDomain: 3, maxCostUsd: 1 };

test("parseDomains cleans urls, comments and duplicates", () => {
  assert.deepEqual(parseDomains("# x\nhttps://www.Example.com/about\nexample.com\n\nnotadomain\n"), ["example.com"]);
  assert.equal(cleanDomain("http://a.io/x?y=1"), "a.io");
});

test("extractPeople finds nested person arrays and splits full names", () => {
  const people = extractPeople({ data: { people: [{ full_name: "Jane Q Doe", job_title: "CEO" }] } });
  assert.equal(people[0]?.firstName, "Jane");
  assert.equal(people[0]?.lastName, "Q Doe");
  assert.equal(people[0]?.title, "CEO");
  assert.deepEqual(extractPeople({ nothing: [1, 2] }), []);
});

test("titleMatches is case-insensitive and open when no filter", () => {
  assert.ok(titleMatches("Co-Founder & CEO", ["ceo"]));
  assert.ok(titleMatches("Anything", []));
  assert.ok(!titleMatches("Intern", ["CEO"]));
});

test("dry run without a token calls only the keyless overview", async () => {
  const mock = await startMock();
  try {
    const client = new Looot({ baseUrl: mock.url, token: "" });
    const report = await dryRun(client, opts);
    assert.deepEqual(mock.calls.map((c) => c.path), ["/v1/catalog/overview"]);
    assert.match(report.lines.join("\n"), /job:people.email.find {2}\$0.0036/);
    assert.equal(report.leads[0]?.note, "dry-run");
  } finally {
    await mock.close();
  }
});

test("dry run with a token adds balance and search, never POSTs a run", async () => {
  const mock = await startMock();
  try {
    const client = new Looot({ baseUrl: mock.url, token: "test-token" });
    const report = await dryRun(client, opts);
    const paths = mock.calls.map((c) => `${c.method} ${c.path}`);
    assert.deepEqual(paths, ["GET /v1/catalog/overview", "GET /v1/balance", "GET /v1/catalog/search"]);
    assert.match(report.lines.join("\n"), /Balance: \$12.50/);
  } finally {
    await mock.close();
  }
});

test("live run finds people, emails and statuses and sums the cost", async () => {
  const mock = await startMock();
  try {
    const client = new Looot({ baseUrl: mock.url, token: "test-token" });
    const result = await liveRun(client, opts);
    const jane = result.leads.find((l) => l.firstName === "Jane");
    assert.equal(jane?.email, "jane@example.com");
    assert.equal(jane?.emailStatus, "valid");
    assert.equal(result.leads.find((l) => l.firstName === "Ana")?.note, "no email found");
    assert.ok(!result.leads.some((l) => l.firstName === "Bob"), "intern filtered out by title");
    assert.ok(Math.abs(result.spentUsd - (0.01 + 0.02 + 0.002 + 0.02)) < 1e-9);
    const runs = mock.calls.filter((c) => c.path === "/v1/runs");
    assert.ok(runs.every((c) => c.body.idempotencyKey.startsWith("leadgen-")));
    assert.ok(runs.every((c) => c.auth === "Bearer test-token"));
  } finally {
    await mock.close();
  }
});

test("live run stops at the cost cap", async () => {
  const mock = await startMock();
  try {
    const client = new Looot({ baseUrl: mock.url, token: "test-token" });
    const result = await liveRun(client, { ...opts, maxCostUsd: 0.03 }, () => {});
    assert.ok(result.stoppedByCap);
    assert.ok(mock.calls.filter((c) => c.path === "/v1/runs").length < 4);
  } finally {
    await mock.close();
  }
});

test("csv quotes commas and defuses formulas", () => {
  const csv = toCsv([
    { domain: "a.com", firstName: "=cmd", lastName: 'O"Neil', title: "VP, Sales", linkedinUrl: "", email: "", emailStatus: "", note: "" },
  ]);
  assert.match(csv, /'=cmd/);
  assert.match(csv, /"O""Neil"/);
  assert.match(csv, /"VP, Sales"/);
});
