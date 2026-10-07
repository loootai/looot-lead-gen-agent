import { createServer, type Server } from "node:http";

export interface Mock {
  server: Server;
  url: string;
  calls: { method: string; path: string; auth: string | undefined; body: any }[];
  close(): Promise<void>;
}

const overview = {
  categories: [
    {
      platforms: [
        {
          jobs: [
            { id: "people.search", title: "Find people matching a filter", providerCount: 17, cheapestPerCall: 0 },
            { id: "people.email.find", title: "Find a work email", providerCount: 17, cheapestPerCall: 0.003598 },
            { id: "people.email.verify", title: "Verify an email", providerCount: 13, cheapestPerCall: 0.00145 },
          ],
        },
      ],
    },
  ],
};

export async function startMock(): Promise<Mock> {
  const calls: Mock["calls"] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: req.method!, path: u.pathname, auth: req.headers.authorization, body });
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (u.pathname === "/v1/catalog/overview") return send(200, overview);
      if (!req.headers.authorization) return send(401, { error: { code: "unauthorized", message: "Valid bearer token required" } });
      if (u.pathname === "/v1/balance") return send(200, { available: 12.5, reserved: 0 });
      if (u.pathname === "/v1/catalog/search") return send(200, { endpoints: [{ id: "a" }, { id: "b" }] });
      if (u.pathname === "/v1/runs" && req.method === "POST") {
        const job = body.endpointId;
        if (job === "job:people.search") {
          return send(200, {
            runId: "r1", status: "completed", actualCost: 0.01,
            result: { data: { people: [
              { full_name: "Jane Doe", job_title: "CEO", linkedin_url: "https://linkedin.com/in/jane" },
              { full_name: "Bob Intern", job_title: "Intern" },
              { first_name: "Ana", last_name: "Lopez", title: "Head of Marketing" },
            ] } },
          });
        }
        if (job === "job:people.email.find") {
          if (body.input.first_name === "Ana") return send(200, { runId: "r2", status: "completed", actualCost: 0.02, result: {} });
          return send(200, { runId: "r3", status: "completed", actualCost: 0.02, normalized: { fields: { email: "jane@example.com" } } });
        }
        if (job === "job:people.email.verify") {
          return send(200, { runId: "r4", status: "completed", actualCost: 0.002, normalized: { fields: { status: "valid" } } });
        }
      }
      send(404, { error: { code: "not_found", message: "no route" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((r) => server.close(() => r())) };
}
