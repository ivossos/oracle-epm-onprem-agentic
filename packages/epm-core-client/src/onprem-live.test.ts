import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EpmClient } from "./client.js";
import { closeDimensionDb } from "./dimension-db.js";
import type { EpmClientConfig } from "./types.js";

/** Starts a local HTTP server standing in for an on-prem Planning instance. */
function startTestServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolvePromise) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function onpremConfig(baseUrl: string): EpmClientConfig {
  return {
    mode: "live",
    deployment: "onprem",
    baseUrl,
    apiVersion: "v3",
    auth: "basic",
    username: "native.admin",
    password: "s3cret",
    onprem: { useHttps: false, verifySslCert: true },
  };
}

describe("on-prem live wiring (Basic Auth)", () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
  });

  it("listJobDefinitions sends Basic Auth and parses an {items:[...]} envelope", async () => {
    let receivedAuth: string | undefined;
    const { baseUrl, close } = await startTestServer((req, res) => {
      receivedAuth = req.headers.authorization;
      expect(req.url).toBe("/HyperionPlanning/rest/v3/applications/Financ/jobdefinitions");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: [{ jobName: "Agg_ORC_Plan", jobType: "RULES" }] }));
    });
    closeServer = close;

    const client = new EpmClient(onpremConfig(baseUrl));
    const defs = await client.listJobDefinitions("Financ");

    expect(receivedAuth).toBe(`Basic ${Buffer.from("native.admin:s3cret").toString("base64")}`);
    expect(defs).toEqual([{ jobName: "Agg_ORC_Plan", jobType: "RULES" }]);
  });

  it("listJobDefinitions also accepts a raw array response", async () => {
    const { baseUrl, close } = await startTestServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ jobName: "Export_Actuals", jobType: "EXPORT_DATA" }]));
    });
    closeServer = close;

    const client = new EpmClient(onpremConfig(baseUrl));
    const defs = await client.listJobDefinitions("Financ");
    expect(defs).toEqual([{ jobName: "Export_Actuals", jobType: "EXPORT_DATA" }]);
  });

  it("executeJob resolves jobType from job definitions and POSTs the job", async () => {
    const requests: { method?: string; url?: string; body: string; contentType?: string }[] = [];
    const { baseUrl, close } = await startTestServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        requests.push({
          method: req.method,
          url: req.url,
          body,
          contentType: req.headers["content-type"],
        });
        if (req.url?.endsWith("/jobdefinitions")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ items: [{ jobName: "Agg_ORC_Plan", jobType: "RULES" }] }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jobId: 4242, status: "PROCESSING" }));
        }
      });
    });
    closeServer = close;

    const client = new EpmClient(onpremConfig(baseUrl));
    const result = await client.executeJob("Financ", "Agg_ORC_Plan", "packet-1", { Foo: "Bar" });

    expect(result.jobId).toBe(4242);
    expect(result.status).toBe("PROCESSING");
    const jobsReq = requests.find((r) => r.url?.endsWith("/jobs"));
    expect(jobsReq?.method).toBe("POST");
    expect(jobsReq?.contentType).toBe("application/x-www-form-urlencoded");
    // On-prem /jobs is application/x-www-form-urlencoded, with the parameters
    // map JSON-encoded into a single form field.
    const form = new URLSearchParams(jobsReq!.body);
    expect(form.get("jobType")).toBe("RULES");
    expect(form.get("jobName")).toBe("Agg_ORC_Plan");
    expect(JSON.parse(form.get("parameters")!)).toEqual({ Foo: "Bar" });
  });

  it("executeJob refuses an unknown jobName before making any POST", async () => {
    const { baseUrl, close } = await startTestServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: [] }));
    });
    closeServer = close;

    const client = new EpmClient(onpremConfig(baseUrl));
    await expect(
      client.executeJob("Financ", "Does_Not_Exist", "packet-1")
    ).rejects.toThrow(/no job definition named/);
  });

  it("exportDataSlice runs an MDX query via Essbase REST and flattens the grid", async () => {
    let received:
      | { method?: string; url?: string; body: string; contentType?: string; accept?: string }
      | undefined;
    const { baseUrl, close } = await startTestServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received = {
          method: req.method,
          url: req.url,
          body,
          contentType: req.headers["content-type"],
          accept: req.headers["accept"],
        };
        // Essbase replies as application/octet-stream, mirrored here.
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(
          JSON.stringify({
            metadata: {
              page: ["Year", "Scenario", "Version", "Period", "Currency"],
              column: ["Account"],
              row: ["Division"],
            },
            data: [
              ["", "TotalNetPricing"],
              ["TotalDivisions", "2.3971333374886442E7"],
              ["Corporate", "#Missing"],
            ],
          })
        );
      });
    });
    closeServer = close;

    const client = new EpmClient(onpremConfig(baseUrl));
    const slice = await client.exportDataSlice("CORPRPT", "CORPRPT", "SELECT ... ON COLUMNS");

    expect(received?.method).toBe("POST");
    expect(received?.url).toBe(
      "/essbase/rest/v1/applications/CORPRPT/databases/CORPRPT/mdx"
    );
    expect(received?.contentType).toBe("application/json");
    // Critical: application/json here yields a 406 from the real server.
    expect(received?.accept).toBe("*/*");
    expect(JSON.parse(received!.body).query).toBe("SELECT ... ON COLUMNS");
    expect(slice.pov).toEqual({});
    expect(slice.rows).toEqual([
      { members: { Division: "TotalDivisions", Account: "TotalNetPricing" }, value: 23971333.374886442 },
      { members: { Division: "Corporate", Account: "TotalNetPricing" }, value: null },
    ]);
  });

  it("exportDataSlice stamps WHERE/POV members onto every row via the cache DB", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dimdb-"));
    const dbFile = join(dir, "dimensions.db");
    process.env.EPM_DIMENSION_DB = dbFile;
    const db = new DatabaseSync(dbFile);
    db.exec(
      "CREATE TABLE members (dimension TEXT, member TEXT, parent TEXT, alias TEXT, data_storage TEXT, description TEXT, props TEXT, PRIMARY KEY(dimension,member));"
    );
    const ins = db.prepare("INSERT INTO members VALUES (?,?,?,?,?,?,?)");
    ins.run("Year", "FY25", "", "", "", "", "{}");
    ins.run("Currency", "USD", "Currency", "", "", "", "{}");
    db.close();

    const { baseUrl, close } = await startTestServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(
        JSON.stringify({
          metadata: { page: ["Year", "Currency"], column: ["Account"], row: ["Division"] },
          data: [
            ["", "TotalNetPricing"],
            ["TotalDivisions", "100"],
          ],
        })
      );
    });
    closeServer = close;

    try {
      const client = new EpmClient(onpremConfig(baseUrl));
      const slice = await client.exportDataSlice(
        "CORPRPT",
        "CORPRPT",
        "SELECT {TotalNetPricing} ON COLUMNS, {TotalDivisions} ON ROWS WHERE (CrossJoin({FY25}, {USD}))"
      );
      expect(slice.pov).toEqual({ Year: "FY25", Currency: "USD" });
      expect(slice.rows[0]?.members).toEqual({
        Year: "FY25",
        Currency: "USD",
        Division: "TotalDivisions",
        Account: "TotalNetPricing",
      });
    } finally {
      closeDimensionDb();
      rmSync(dir, { recursive: true, force: true });
      delete process.env.EPM_DIMENSION_DB;
    }
  });

  it("runBusinessRule POSTs an Essbase calc job and maps the status", async () => {
    let received: { method?: string; url?: string; body: string } | undefined;
    const { baseUrl, close } = await startTestServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received = { method: req.method, url: req.url, body };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ job_ID: 7788, statusMessage: "Completed", jobType: "calc" }));
      });
    });
    closeServer = close;

    const client = new EpmClient(onpremConfig(baseUrl));
    const result = await client.runBusinessRule({
      app: "CORPRPT",
      cube: "CORPRPT",
      ruleName: "EXP2PL",
      approvalPacketId: "packet-1",
      parameters: { RTP_Period: "Per04" },
    });

    expect(received?.method).toBe("POST");
    expect(received?.url).toBe("/essbase/rest/v1/jobs");
    const sent = JSON.parse(received!.body);
    expect(sent.application).toBe("CORPRPT");
    expect(sent.db).toBe("CORPRPT");
    expect(sent.jobtype).toBe("calc");
    // The rule name is the calc-script file; extra params merge alongside it.
    expect(sent.parameters).toEqual({ file: "EXP2PL", RTP_Period: "Per04" });
    expect(result.jobId).toBe(7788);
    expect(result.status).toBe("COMPLETED");
    expect(result.jobName).toBe("EXP2PL");
  });

  it("runBusinessRule refuses without an approvalPacketId before any request", async () => {
    let hit = false;
    const { baseUrl, close } = await startTestServer((_req, res) => {
      hit = true;
      res.writeHead(200);
      res.end("{}");
    });
    closeServer = close;

    const client = new EpmClient(onpremConfig(baseUrl));
    await expect(
      client.runBusinessRule({
        app: "CORPRPT",
        cube: "CORPRPT",
        ruleName: "EXP2PL",
        approvalPacketId: "",
      })
    ).rejects.toThrow(/missing approvalPacketId/);
    expect(hit).toBe(false);
  });

  it("getSubstitutionVariables merges Essbase app- and database-level variables", async () => {
    const { baseUrl, close } = await startTestServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/essbase/rest/v1/applications/CORPRPT/variables") {
        res.end(JSON.stringify({ items: [{ name: "corprpt_cur_act_per", value: '"Per04"' }] }));
      } else if (req.url === "/essbase/rest/v1/applications/CORPRPT/databases") {
        res.end(JSON.stringify({ items: [{ name: "CORPRPT" }] }));
      } else if (
        req.url === "/essbase/rest/v1/applications/CORPRPT/databases/CORPRPT/variables"
      ) {
        res.end(JSON.stringify({ items: [{ name: "corprpt_F2Plan", value: "Plan20" }] }));
      } else {
        res.writeHead(404);
        res.end("{}");
      }
    });
    closeServer = close;

    const client = new EpmClient(onpremConfig(baseUrl));
    const vars = await client.getSubstitutionVariables("CORPRPT");

    expect(vars).toEqual([
      { name: "corprpt_cur_act_per", value: "Per04", plan: "" },
      { name: "corprpt_F2Plan", value: "Plan20", plan: "CORPRPT" },
    ]);
  });

  it("surfaces a clear error on a non-2xx response", async () => {
    const { baseUrl, close } = await startTestServer((req, res) => {
      if (req.url?.endsWith("/jobdefinitions")) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
      res.writeHead(200);
      res.end("{}");
    });
    closeServer = close;

    const client = new EpmClient(onpremConfig(baseUrl));
    await expect(client.listJobDefinitions("Financ")).rejects.toThrow(/failed with 401/);
  });
});
