import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { EpmClient } from "./client.js";
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

  it("exportDataSlice POSTs a grid request and flattens the response into DataSlice rows", async () => {
    let received: { method?: string; url?: string; body: string; contentType?: string } | undefined;
    const { baseUrl, close } = await startTestServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received = {
          method: req.method,
          url: req.url,
          body,
          contentType: req.headers["content-type"],
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            pov: [
              { dimensionName: "Ano", memberName: "FY26" },
              { dimensionName: "Versao", memberName: "Trabalho" },
            ],
            columns: [[{ dimensionName: "Periodo", memberName: "Jun" }]],
            rows: [
              { headers: [{ dimensionName: "Conta", memberName: "4110" }], data: ["1000.5"] },
              { headers: [{ dimensionName: "Conta", memberName: "4120" }], data: ["#Missing"] },
            ],
          })
        );
      });
    });
    closeServer = close;

    const client = new EpmClient(onpremConfig(baseUrl));
    const slice = await client.exportDataSlice("Financ", "ORC_Plan");

    expect(received?.method).toBe("POST");
    expect(received?.url).toBe(
      "/HyperionPlanning/rest/v3/applications/Financ/plantypes/ORC_Plan/exportdataslice"
    );
    expect(received?.contentType).toBe("application/json");
    expect(slice.pov).toEqual({ Ano: "FY26", Versao: "Trabalho" });
    expect(slice.rows).toEqual([
      { members: { Conta: "4110", Periodo: "Jun" }, value: 1000.5 },
      { members: { Conta: "4120", Periodo: "Jun" }, value: null },
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
