# looot-lead-gen-agent

A small template agent. Give it a list of company domains and job titles. It finds people at each company, finds their work emails, verifies them, and writes a CSV.

It runs on [looot](https://looot.ai): one token and one prepaid balance for 2,500+ data API endpoints. looot picks the provider for each step, shows the price first, and charges $0 for a failed call. This repo is a template. Click "Use this template" on GitHub, then change `src/agent.ts` to fit your list.

No dependencies. Plain `fetch`, Node 22.18 or newer (it runs the `.ts` files directly).

## Try it without spending anything

```bash
git clone https://github.com/loootai/looot-lead-gen-agent
cd looot-lead-gen-agent
node src/cli.ts --domains examples/domains.txt --titles "CEO,Head of Marketing"
```

That is a dry run, and it is the default. It calls only free endpoints and needs no token:

```
Dry run. Nothing is spent. Cheapest listed price per call:
  job:people.search  $0.0000  (17 providers)
  job:people.email.find  $0.0036  (17 providers)
  job:people.email.verify  $0.0014  (13 providers)
...
```

With `LOOOT_TOKEN` set, the dry run also reads your balance and runs a catalog search, both free. It then writes a CSV of placeholder rows so you can check the shape.

## Run it for real

1. Sign up at https://looot.ai, top up (from $5), and create an agent token with the scopes `catalog.read`, `runs.read`, `runs.execute` and `usage.read`.
2. Run:

```bash
export LOOOT_TOKEN=...            # never commit this
node src/cli.ts --domains my-domains.txt --titles "CEO,Founder" --per-domain 2 --max-cost 2.00 --live
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `--domains` | Text file, one domain per line, `#` for comments | required |
| `--titles` | Comma list. A person is kept when their title contains one of these | any |
| `--per-domain` | Max people per company | 2 |
| `--max-cost` | Stop starting paid calls once this many USD are spent | 1.00 |
| `--out` | CSV path | `leads.csv` |
| `--live` | Spend money. Without it, dry run | off |

## What it calls

For each domain, in order:

| Step | looot job | Input |
| --- | --- | --- |
| Find people | `job:people.search` | `domain`, `title` |
| Find the work email | `job:people.email.find` | `first_name`, `last_name`, `domain`, `linkedin_url` when known |
| Verify it | `job:people.email.verify` | `email` |

Each is `POST https://api.looot.ai/v1/runs?wait=30` with `endpointId: "job:<id>"` and `fallback: true`, so a miss moves on to the next provider inside one hold. Job inputs are mapped to each provider's own fields by looot, see https://docs.looot.ai/concepts/job-inputs.

Two things to know:

- Every run carries a deterministic `idempotencyKey` (a hash of the job and input). Running the script twice on the same list does not pay twice.
- Providers answer in their own shapes. `src/parse.ts` reads the common ones. If your first live run shows "no matching people" for a domain you know has staff, print `search.result` in `src/agent.ts` and adjust the parser. The cost cap is checked before each paid call, so a run can overshoot it by the price of one call.

## CSV columns

`domain, firstName, lastName, title, email, emailStatus, linkedinUrl, note`

`emailStatus` is one of `valid`, `invalid`, `catch_all`, `risky`, `unknown`. Cells that start with `=`, `+`, `-` or `@` get a leading quote so a spreadsheet does not run them.

## Tests

```bash
npm test
npm run scan   # secret and internal-path scan, run it before you push
```

The tests start a local mock server. They check the dry run never POSTs a run, the live path, the cost cap, and CSV escaping.

## Using an AI SDK instead

`src/looot.ts` is a 120-line client you can replace with [looot-js](https://github.com/loootai/looot-js) or give the same five operations (search, inspect, run, get run, balance) to a model as tools. The agent here is a fixed pipeline on purpose, so cost is predictable.

## License

MIT. Docs: https://docs.looot.ai. Support: https://looot.ai/contact.
