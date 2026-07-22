import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";
import https from "node:https";
import type {
  Application,
  AccessSnapshot,
  AutomateCommandSpec,
  AutomateResult,
  AutomateRunbook,
  BusinessRule,
  DataRule,
  DmApplication,
  DataSlice,
  DataSliceRow,
  EpmClientConfig,
  EpmFile,
  GroupAssignment,
  HfmEntity,
  HfmConsolidationStatus,
  HfmIcTransaction,
  HfmBalancingStatus,
  HfmConsolidationReport,
  HfmCurrencyConversion,
  HfmExtractSpec,
  IntercompanyMatch,
  Integration,
  IntegrationJob,
  Journal,
  JobDefinition,
  JobResult,
  JobStatusCode,
  LoginRecord,
  Mapping,
  MetadataSnapshot,
  MetadataValidationResult,
  Pipeline,
  PovLock,
  RoleAssignment,
  UserAccess,
} from "./types.js";
import { loadConfig } from "./config.js";
import { metadataSnapshotFromDb, dimensionOf } from "./dimension-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/epm-core-client/src -> repo root
const REPO_ROOT = resolve(__dirname, "../../..");

function readFixture<T>(relPath: string): T {
  const full = resolve(REPO_ROOT, "fixtures", relPath);
  return JSON.parse(readFileSync(full, "utf8")) as T;
}

/**
 * Creates an HTTPS agent for on-prem deployments with optional self-signed cert handling.
 * For on-prem Oracle EPM running on internal CAs or self-signed certificates.
 */
function createHttpsAgent(config: EpmClientConfig): https.Agent {
  return new https.Agent({
    rejectUnauthorized: config.onprem?.verifySslCert ?? true,
  });
}

/**
 * Builds the Authorization header for Basic Auth.
 * On-prem Oracle EPM 11.1.2.4 uses Basic Auth exclusively.
 */
function buildBasicAuthHeader(username: string, password: string): string {
  const credentials = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${credentials}`;
}

/**
 * Builds request headers for Oracle EPM REST API calls.
 * On-prem: Basic Auth only. Cloud: OAuth token (if available).
 */
function buildRequestHeaders(
  config: EpmClientConfig,
  authToken?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (config.deployment === "onprem" && config.username && config.password) {
    headers.Authorization = buildBasicAuthHeader(config.username, config.password);
  } else if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  return headers;
}

/** Thrown when an on-prem REST call returns a non-2xx status. */
export class OnpremRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string
  ) {
    super(`On-prem EPM request to '${path}' failed with ${status}: ${body.slice(0, 500)}`);
  }
}

/**
 * Issues a Basic-Auth REST call against an on-prem Oracle EPM 11.1.2.4 server.
 *
 * ASSUMES the v3 JSON job-management surface (same as Cloud EPM):
 * `/HyperionPlanning/rest/v3/applications/{app}/jobs` etc. This has not been
 * confirmed against a real on-prem 11.1.2.4 server — some patch levels may
 * instead expose a legacy `/rest/11.1.2.4/` form-urlencoded surface (see
 * scripts/test_onprem_planning_connection.py). Re-verify with the discovery
 * step there before trusting this against a real target.
 */
function onpremRequest<T>(
  config: EpmClientConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  bodyEncoding: "json" | "form" = "json",
  accept = "application/json"
): Promise<T> {
  if (config.deployment !== "onprem" || config.auth !== "basic") {
    throw new Error(
      "onpremRequest called for a non-onprem/non-basic-auth config."
    );
  }
  if (!config.baseUrl || !config.username || !config.password) {
    throw new Error(
      "onpremRequest requires baseUrl, username, and password to be configured."
    );
  }

  const useHttps = config.onprem?.useHttps ?? false;
  const url = new URL(`${config.baseUrl}${path}`);
  const headers = buildRequestHeaders(config);
  // Essbase's MDX endpoint replies as application/octet-stream and 406s on an
  // `Accept: application/json`; callers override the Accept header here.
  headers.Accept = accept;

  let payload: string | undefined;
  if (body !== undefined) {
    if (bodyEncoding === "form") {
      // On-prem 11.1.2.4 /jobs expects application/x-www-form-urlencoded
      // (per the WADL), not the Cloud-style JSON body. Nested values (e.g. the
      // `parameters` map) are JSON-encoded into a single form field.
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
        form.append(k, typeof v === "string" ? v : JSON.stringify(v));
      }
      payload = form.toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else {
      payload = JSON.stringify(body);
    }
    headers["Content-Length"] = Buffer.byteLength(payload).toString();
  }

  return new Promise<T>((resolvePromise, reject) => {
    const transport = useHttps ? https : http;
    const req = transport.request(
      url,
      {
        method,
        headers,
        agent: useHttps ? createHttpsAgent(config) : undefined,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new OnpremRequestError(status, path, raw));
            return;
          }
          try {
            resolvePromise(raw ? (JSON.parse(raw) as T) : (undefined as T));
          } catch (err) {
            reject(new Error(`On-prem EPM response for '${path}' was not valid JSON: ${(err as Error).message}`));
          }
        });
      }
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function gridValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "" || s === "#Missing" || s === "#MISSING") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Essbase REST v1 MDX grid response (`.../databases/{db}/mdx`). */
interface EssbaseMdxGrid {
  metadata?: { page?: string[]; column?: string[]; row?: string[] };
  data?: unknown[][];
}

/**
 * Default whole-slice MDX for a live demo against the CORPRPT cube — the proven
 * query returning TotalDivisions × TotalNetPricing for FY25/Actual/MgmtRestated/
 * Per01/USD. Callers pass their own `mdx` for any other slice (pass-through).
 */
const DEFAULT_MDX =
  "SELECT {TotalNetPricing} ON COLUMNS, {TotalDivisions} ON ROWS " +
  "WHERE (CrossJoin(CrossJoin(CrossJoin(CrossJoin({FY25}, {Actual}), {MgmtRestated}), {Per01}), {USD}))";

/**
 * Flattens an Essbase REST v1 MDX grid ({metadata,data}) into a DataSlice.
 *
 * Layout: the first `metadata.column.length` rows of `data` are column-header
 * rows whose leading `metadata.row.length` cells are the blank corner; every
 * remaining row starts with that many row-member headers, followed by one value
 * per column. Page (WHERE) members are fixed by the query and not echoed in the
 * grid, so `pov` is left empty. One DataSliceRow is emitted per (row × column).
 */
function parseEssbaseMdxGrid(res: EssbaseMdxGrid): DataSlice {
  const rowDims = res.metadata?.row ?? [];
  const colDims = res.metadata?.column ?? [];
  const grid = Array.isArray(res.data) ? res.data : [];
  const nRow = rowDims.length;
  const nCol = colDims.length;

  const headerRows = grid.slice(0, nCol);
  const dataRows = grid.slice(nCol);
  const colCount = headerRows.length
    ? Math.max(0, (headerRows[0]?.length ?? 0) - nRow)
    : Math.max(0, (dataRows[0]?.length ?? 0) - nRow);

  // Build the member tuple for each data column across the header rows.
  const columnMembers: Record<string, string>[] = [];
  for (let c = 0; c < colCount; c++) {
    const members: Record<string, string> = {};
    colDims.forEach((dim, h) => {
      members[dim] = String(headerRows[h]?.[nRow + c] ?? "");
    });
    columnMembers.push(members);
  }

  const rows: DataSliceRow[] = [];
  for (const r of dataRows) {
    const cells = Array.isArray(r) ? r : [];
    const rowMembers: Record<string, string> = {};
    rowDims.forEach((dim, i) => {
      rowMembers[dim] = String(cells[i] ?? "");
    });
    for (let c = 0; c < colCount; c++) {
      rows.push({
        members: { ...rowMembers, ...(columnMembers[c] ?? {}) },
        value: gridValue(cells[nRow + c]),
      });
    }
  }
  return { pov: {}, rows };
}

/**
 * Adds the fixed (WHERE/POV) members from an MDX query back onto every row of a
 * parsed slice, so each row is a full intersection. POV members are parsed from
 * the WHERE clause and resolved to their dimension via the local cache DB
 * (`dimensionOf`); members that don't resolve (or if the DB is absent) are
 * skipped. Axis members already on the row always win over POV.
 */
function enrichSliceWithPov(slice: DataSlice, mdx: string): DataSlice {
  const whereIdx = mdx.search(/\bwhere\b/i);
  if (whereIdx < 0) return slice;
  const whereClause = mdx.slice(whereIdx);
  const members = [...whereClause.matchAll(/\{\s*([^{}]+?)\s*\}/g)]
    .map((m) => (m[1] ?? "").trim())
    .filter(Boolean);

  const pov: Record<string, string> = {};
  for (const mem of members) {
    const dim = dimensionOf(mem);
    if (dim) pov[dim] = mem;
  }
  if (Object.keys(pov).length === 0) return slice;

  return {
    pov: { ...slice.pov, ...pov },
    rows: slice.rows.map((r) => ({ members: { ...pov, ...r.members }, value: r.value })),
  };
}

/** A job object as returned by the FDMEE REST `jobs` resource (fields vary). */
interface FdmeeJob {
  jobId?: number | string;
  jobID?: number | string;
  processId?: number | string;
  jobStatus?: string;
  status?: number;
  processType?: string;
  processName?: string;
  jobName?: string;
  executedBy?: string;
  details?: string;
  logFileName?: string;
}

/** Maps FDMEE job status (string or numeric code) to the normalized code. */
function mapFdmeeStatus(jobStatus?: string, status?: number): JobStatusCode {
  switch ((jobStatus ?? "").toUpperCase()) {
    case "SUCCESS": return "COMPLETED";
    case "FAILED": return "FAILED";
    case "RUNNING": return "PROCESSING";
  }
  switch (status) {
    case 0: return "COMPLETED";
    case -1:
    case 2: return "PROCESSING";
    case 1:
    case 3:
    case 4: return "FAILED";
    default: return "PENDING";
  }
}

/**
 * Maps an FDMEE job into the IntegrationJob shape. FDMEE REST reports job-level
 * status only — no row counts and no per-row rejections (those live in the
 * process log / DB), so rowsProcessed/rowsRejected are 0 and the error `details`
 * string (if any) is surfaced as a single failedRows entry.
 */
function mapFdmeeJob(j: FdmeeJob): IntegrationJob {
  const rawId = Number(j.jobId ?? j.jobID ?? j.processId ?? 0);
  const details = j.details ? String(j.details).trim() : "";
  return {
    jobId: Number.isFinite(rawId) ? rawId : 0,
    integrationId: String(j.processType ?? j.processName ?? j.jobName ?? ""),
    status: mapFdmeeStatus(j.jobStatus, j.status),
    rowsProcessed: 0,
    rowsRejected: 0,
    startTime: "",
    failedRows: details ? [{ row: 0, reason: details }] : [],
  };
}

/**
 * Maps an Essbase REST v1 job result to the normalized JobStatusCode. The jobs
 * API reports either a `statusMessage` string ("Completed", "Completed with
 * warnings", "Failed", "In Progress") or a numeric `status_code`; map both.
 */
function mapEssbaseJobStatus(statusMessage?: string, statusCode?: unknown): JobStatusCode {
  const msg = (statusMessage ?? "").toLowerCase();
  if (msg) {
    if (msg.includes("warning")) return "COMPLETED_WITH_ERRORS";
    if (msg.includes("complet") || msg.includes("success")) return "COMPLETED";
    if (msg.includes("fail") || msg.includes("error")) return "FAILED";
    if (msg.includes("progress") || msg.includes("running")) return "PROCESSING";
  }
  switch (Number(statusCode)) {
    case 100: return "PROCESSING";
    case 200: return "COMPLETED";
    case 300: return "COMPLETED_WITH_ERRORS";
    case 400:
    case 500: return "FAILED";
  }
  // Essbase jobs are asynchronous; an unrecognized/absent status means "kicked off".
  return "PROCESSING";
}

interface PlanningFixture {
  applications: Application[];
  jobDefinitions: JobDefinition[];
  substitutionVariables: { name: string; value: string; plan: string }[];
  dataSlice: DataSlice;
}

interface FccsFixture {
  applications: Application[];
  metadataValidation: MetadataValidationResult;
  journals: Journal[];
  intercompany: IntercompanyMatch[];
}

interface DataIntegrationFixture {
  pipelines: Pipeline[];
  integrations: Integration[];
  jobs: IntegrationJob[];
  mappings: Mapping[];
  povLocks: PovLock[];
}

interface MetadataFixture {
  snapshots: Record<string, MetadataSnapshot>;
}

interface SecurityFixture {
  roleAssignments: RoleAssignment[];
  userAccess: UserAccess[];
  loginRecords: LoginRecord[];
  groupAssignments: GroupAssignment[];
  accessSnapshots: Record<string, AccessSnapshot>;
}

interface AutomateFixture {
  allowedCommands: AutomateCommandSpec[];
  runbooks: AutomateRunbook[];
}

interface HfmFixture {
  entities: HfmEntity[];
  consolidationStatus: HfmConsolidationStatus[];
  icTransactions: HfmIcTransaction[];
  balancingStatus: HfmBalancingStatus[];
  consolidationReport: HfmConsolidationReport;
  currencyConversions: HfmCurrencyConversion[];
  extracts: HfmExtractSpec[];
}

/**
 * Mock-first Oracle EPM client.
 *
 * In mock mode, all reads come from fixtures and all "mutations" are simulated
 * (no network). In live mode with on-prem Basic Auth: `listJobDefinitions` and
 * `executeJob` use the Planning REST surface (see `onpremRequest`), while
 * `listApplications`, `getSubstitutionVariables`, and `exportDataSlice` read
 * through the Essbase REST v1 API (Planning REST is down on the target server —
 * see docs/onprem-corprpt-500-issue.md). Every other method and all of Cloud
 * OAuth remain behind `liveNotImplemented` guards.
 *
 * The client NEVER performs a mutating operation without an approvalPacketId;
 * that contract is enforced here as a defense-in-depth layer beyond the agent
 * hooks.
 */
export class EpmClient {
  readonly config: EpmClientConfig;
  private jobCounter = 1000;

  constructor(config?: EpmClientConfig) {
    this.config = config ?? loadConfig();
  }

  get isMock(): boolean {
    return this.config.mode === "mock";
  }

  private get isOnpremBasic(): boolean {
    return this.config.deployment === "onprem" && this.config.auth === "basic";
  }

  private essbaseBase(): string {
    return this.config.onprem?.essbaseBasePath ?? "/essbase/rest/v1";
  }

  private aifBase(): string {
    return this.config.onprem?.aifBasePath ?? "/aif/rest/V1";
  }

  // ---- Read operations ----

  async listApplications(): Promise<Application[]> {
    if (this.isMock) {
      const p = readFixture<PlanningFixture>("mock-planning/planning.json");
      const f = readFixture<FccsFixture>("mock-fccs/fccs.json");
      return [...p.applications, ...f.applications];
    }
    if (this.isOnpremBasic) {
      const base = this.essbaseBase();
      const res = await onpremRequest<{ items?: { name: string }[] }>(
        this.config,
        "GET",
        `${base}/applications`
      );
      const out: Application[] = [];
      for (const a of res.items ?? []) {
        let cubes: string[] = [];
        try {
          const dbs = await onpremRequest<{ items?: { name: string }[] }>(
            this.config,
            "GET",
            `${base}/applications/${encodeURIComponent(a.name)}/databases`
          );
          cubes = (dbs.items ?? []).map((d) => d.name);
        } catch {
          // best-effort: leave cubes empty if the databases call fails
        }
        // Every Essbase app on this deployment is a Planning application.
        out.push({ name: a.name, type: "PLANNING", cubes });
      }
      return out;
    }
    return this.liveNotImplemented("listApplications");
  }

  async listJobDefinitions(app: string): Promise<JobDefinition[]> {
    if (this.isMock) {
      return readFixture<PlanningFixture>("mock-planning/planning.json")
        .jobDefinitions;
    }
    if (this.config.deployment === "onprem" && this.config.auth === "basic") {
      const path = `/HyperionPlanning/rest/${this.config.apiVersion}/applications/${encodeURIComponent(app)}/jobdefinitions`;
      const res = await onpremRequest<{ items?: JobDefinition[] } | JobDefinition[]>(
        this.config,
        "GET",
        path
      );
      return Array.isArray(res) ? res : res.items ?? [];
    }
    return this.liveNotImplemented("listJobDefinitions");
  }

  async getSubstitutionVariables(
    app: string
  ): Promise<{ name: string; value: string; plan: string }[]> {
    if (this.isMock) {
      return readFixture<PlanningFixture>("mock-planning/planning.json")
        .substitutionVariables;
    }
    if (this.isOnpremBasic) {
      // A Planning substitution variable maps to an Essbase variable, defined at
      // the application level (plan="") or per database (plan=<cube>). Essbase
      // wraps string values in quotes (e.g. "Per04"), which we strip.
      const base = this.essbaseBase();
      const strip = (v: string) => v.replace(/^"(.*)"$/, "$1");
      const out: { name: string; value: string; plan: string }[] = [];
      const appVars = await onpremRequest<{ items?: { name: string; value: string }[] }>(
        this.config,
        "GET",
        `${base}/applications/${encodeURIComponent(app)}/variables`
      );
      for (const v of appVars.items ?? []) {
        out.push({ name: v.name, value: strip(v.value), plan: "" });
      }
      try {
        const dbs = await onpremRequest<{ items?: { name: string }[] }>(
          this.config,
          "GET",
          `${base}/applications/${encodeURIComponent(app)}/databases`
        );
        for (const d of dbs.items ?? []) {
          const dbVars = await onpremRequest<{ items?: { name: string; value: string }[] }>(
            this.config,
            "GET",
            `${base}/applications/${encodeURIComponent(app)}/databases/${encodeURIComponent(d.name)}/variables`
          );
          for (const v of dbVars.items ?? []) {
            out.push({ name: v.name, value: strip(v.value), plan: d.name });
          }
        }
      } catch {
        // best-effort: return app-level variables even if a db call fails
      }
      return out;
    }
    return this.liveNotImplemented("getSubstitutionVariables");
  }

  async exportDataSlice(app: string, cube: string, mdx?: string): Promise<DataSlice> {
    if (this.isMock) {
      return readFixture<PlanningFixture>("mock-planning/planning.json")
        .dataSlice;
    }
    if (this.isOnpremBasic) {
      // Planning's own REST `exportdataslice` is dead on this server (every GET
      // 500s — see docs/onprem-corprpt-500-issue.md). The Planning app is backed
      // by an Essbase cube whose REST v1 MDX endpoint is healthy, so we read the
      // slice there via a pass-through MDX query.
      const query = mdx ?? DEFAULT_MDX;
      const slice = await this.essbaseMdxSlice(app, cube, query);
      // The MDX grid only echoes the axis members; the fixed (WHERE/POV)
      // dimensions are not returned. Stamp them back onto every row so each row
      // is a full intersection ("all dimensions present in the export").
      return enrichSliceWithPov(slice, query);
    }
    return this.liveNotImplemented("exportDataSlice");
  }

  /** Lists the cube's dimensions from Essbase REST (name + member count). */
  async listEssbaseDimensions(
    app: string,
    database: string
  ): Promise<{ name: string; members: number }[]> {
    const path = `${this.essbaseBase()}/applications/${encodeURIComponent(app)}/databases/${encodeURIComponent(database)}/dimensions`;
    const res = await onpremRequest<{ items?: { name: string; members?: number }[] }>(
      this.config,
      "GET",
      path
    );
    return (res.items ?? []).map((d) => ({ name: d.name, members: d.members ?? 0 }));
  }

  /** Enumerates a dimension's member names via a dataless MDX query. */
  async listDimensionMembers(
    app: string,
    database: string,
    dimension: string
  ): Promise<string[]> {
    const path = `${this.essbaseBase()}/applications/${encodeURIComponent(app)}/databases/${encodeURIComponent(database)}/mdx`;
    const res = await onpremRequest<EssbaseMdxGrid>(
      this.config,
      "POST",
      path,
      {
        query: `SELECT {} ON COLUMNS, {[${dimension}].Members} ON ROWS`,
        preferences: { dataless: true, memberIdentifierType: "NAME" },
      },
      "json",
      "*/*"
    );
    const rows = Array.isArray(res.data) ? res.data : [];
    return rows.map((r) => String((r as unknown[])[0] ?? "").trim()).filter((s) => s !== "");
  }

  /**
   * Runs an MDX query against the Essbase REST v1 grid endpoint
   * (`.../applications/{app}/databases/{db}/mdx`) and flattens the response.
   */
  async essbaseMdxSlice(app: string, database: string, mdx: string): Promise<DataSlice> {
    const path = `${this.essbaseBase()}/applications/${encodeURIComponent(app)}/databases/${encodeURIComponent(database)}/mdx`;
    const res = await onpremRequest<EssbaseMdxGrid>(
      this.config,
      "POST",
      path,
      {
        query: mdx,
        preferences: { dataless: false, formatValues: true, memberIdentifierType: "NAME" },
      },
      "json",
      // Essbase MDX replies as application/octet-stream; Accept: application/json => 406.
      "*/*"
    );
    return parseEssbaseMdxGrid(res);
  }

  /**
   * Lists the cube's business rules (Calc Manager rules, stored as Essbase calc
   * scripts) from `GET /essbase/rest/v1/applications/{app}/databases/{db}/scripts`.
   */
  async listBusinessRules(app: string, cube: string): Promise<BusinessRule[]> {
    if (this.isMock) return [];
    if (this.isOnpremBasic) {
      const path = `${this.essbaseBase()}/applications/${encodeURIComponent(app)}/databases/${encodeURIComponent(cube)}/scripts`;
      const res = await onpremRequest<{
        items?: { name?: string; sizeInBytes?: number; modifiedTime?: number }[];
      }>(this.config, "GET", path);
      return (res?.items ?? []).map((s) => ({
        name: String(s.name ?? ""),
        sizeInBytes: Number(s.sizeInBytes ?? 0),
        modifiedTime: s.modifiedTime ?? null,
      }));
    }
    return this.liveNotImplemented("listBusinessRules");
  }

  /** Returns one business rule's calc-script content. */
  async getBusinessRule(
    app: string,
    cube: string,
    name: string
  ): Promise<{ name: string; content: string } | null> {
    if (this.isMock) return null;
    if (this.isOnpremBasic) {
      const path = `${this.essbaseBase()}/applications/${encodeURIComponent(app)}/databases/${encodeURIComponent(cube)}/scripts/${encodeURIComponent(name)}/content`;
      const res = await onpremRequest<{ content?: string }>(
        this.config,
        "GET",
        path,
        undefined,
        "json",
        "*/*"
      );
      return { name, content: String(res?.content ?? "") };
    }
    return this.liveNotImplemented("getBusinessRule") as never;
  }

  async listFiles(_path = "/"): Promise<EpmFile[]> {
    if (this.isMock) {
      return [
        { name: "outbox", type: "FOLDER" },
        { name: "Actuals_Jun.zip", type: "FILE", size: 20480 },
        { name: "MetadataExport_FY26.zip", type: "FILE", size: 51200 },
      ];
    }
    return this.liveNotImplemented("listFiles");
  }

  async validateMetadata(_app: string): Promise<MetadataValidationResult> {
    if (this.isMock) {
      return readFixture<FccsFixture>("mock-fccs/fccs.json").metadataValidation;
    }
    return this.liveNotImplemented("validateMetadata");
  }

  async retrieveJournals(filter?: Partial<Journal>): Promise<Journal[]> {
    if (this.isMock) {
      const all = readFixture<FccsFixture>("mock-fccs/fccs.json").journals;
      if (!filter) return all;
      return all.filter((j) =>
        Object.entries(filter).every(
          ([k, v]) => (j as unknown as Record<string, unknown>)[k] === v
        )
      );
    }
    return this.liveNotImplemented("retrieveJournals");
  }

  async intercompanyMatching(): Promise<IntercompanyMatch[]> {
    if (this.isMock) {
      return readFixture<FccsFixture>("mock-fccs/fccs.json").intercompany;
    }
    return this.liveNotImplemented("intercompanyMatching");
  }

  // ---- Data Integration / Data Management (read) ----

  async listPipelines(): Promise<Pipeline[]> {
    if (this.isMock) {
      return readFixture<DataIntegrationFixture>(
        "mock-data-integration/data-integration.json"
      ).pipelines;
    }
    // "Pipeline" is an EPM Cloud Data Integration concept; on-prem FDMEE
    // 11.1.2.4 has no pipeline object and no inventory/listing REST endpoint
    // (verified live: /aif/rest/V1 exposes no pipelines/batches resource).
    if (this.isOnpremBasic) return [];
    return this.liveNotImplemented("listPipelines");
  }

  async listIntegrations(): Promise<Integration[]> {
    if (this.isMock) {
      return readFixture<DataIntegrationFixture>(
        "mock-data-integration/data-integration.json"
      ).integrations;
    }
    // On-prem FDMEE REST has no integration/rule listing endpoint.
    if (this.isOnpremBasic) return [];
    return this.liveNotImplemented("listIntegrations");
  }

  async listIntegrationJobs(): Promise<IntegrationJob[]> {
    if (this.isMock) {
      return readFixture<DataIntegrationFixture>(
        "mock-data-integration/data-integration.json"
      ).jobs;
    }
    if (this.isOnpremBasic) {
      // FDMEE REST `jobs` resource. A bare GET returns the job list when the
      // instance exposes one (empty on servers with no enumerable history);
      // per-row detail is never in REST, so mapFdmeeJob keeps it job-level.
      const res = await onpremRequest<{ items?: FdmeeJob[] } | FdmeeJob[] | undefined>(
        this.config,
        "GET",
        `${this.aifBase()}/jobs`
      );
      const items = Array.isArray(res) ? res : res?.items ?? [];
      return items.map(mapFdmeeJob);
    }
    return this.liveNotImplemented("listIntegrationJobs");
  }

  async exportMapping(integrationId: string): Promise<Mapping[]> {
    if (this.isMock) {
      return readFixture<DataIntegrationFixture>(
        "mock-data-integration/data-integration.json"
      ).mappings.filter((m) => m.integrationId === integrationId);
    }
    // Mapping export on-prem is a job (POST jobType=MAPPINGEXPORT that writes a
    // file), not a REST-readable inventory — nothing to return synchronously.
    if (this.isOnpremBasic) return [];
    return this.liveNotImplemented("exportMapping");
  }

  async listPovLocks(): Promise<PovLock[]> {
    if (this.isMock) {
      return readFixture<DataIntegrationFixture>(
        "mock-data-integration/data-integration.json"
      ).povLocks;
    }
    // POV lock/unlock is UI/DB-only on-prem 11.1.2.4; the /aif/rest/V1/POV REST
    // API is EPM Cloud-only (verified live: /aif/rest/V1/pov => 404).
    if (this.isOnpremBasic) return [];
    return this.liveNotImplemented("listPovLocks");
  }

  /** FDMEE registered target applications (`GET /aif/rest/V1/applications`). */
  async listDmApplications(): Promise<DmApplication[]> {
    if (this.isMock) return [];
    if (this.isOnpremBasic) {
      const res = await onpremRequest<{ items?: { applicationName?: string; applicationType?: string }[] }>(
        this.config,
        "GET",
        `${this.aifBase()}/applications`
      );
      return (res?.items ?? []).map((a) => ({
        name: String(a.applicationName ?? ""),
        type: String(a.applicationType ?? ""),
      }));
    }
    return this.liveNotImplemented("listDmApplications");
  }

  /**
   * FDMEE data load rules. The `/aif/rest/V1/rules` resource is keyed by numeric
   * `locationId` and there is no locations-list endpoint, so we scan location
   * ids starting at 1. Unknown ids return an empty item list, so scanning is
   * safe. The scan is self-tuning: it runs in parallel batches up to a hard
   * ceiling (`EPM_AIF_MAX_LOCATION_ID`, default 500) but stops early once it has
   * seen `EPM_AIF_LOCATION_GAP` (default 100) consecutive empty ids after the
   * last rule found. Transient per-id request errors are tolerated and counted.
   * Returns the rules plus scan telemetry (never silently caps).
   */
  async listDataRules(): Promise<{
    rules: DataRule[];
    scannedThroughLocationId: number;
    stoppedEarly: boolean;
    errors: number;
  }> {
    if (this.isMock) {
      return { rules: [], scannedThroughLocationId: 0, stoppedEarly: false, errors: 0 };
    }
    if (this.isOnpremBasic) {
      const hardMax = Math.max(1, Number(process.env.EPM_AIF_MAX_LOCATION_ID ?? 500));
      const gapLimit = Math.max(1, Number(process.env.EPM_AIF_LOCATION_GAP ?? 100));
      const BATCH = 10;
      const rules: DataRule[] = [];
      let scannedThroughLocationId = 0;
      let consecutiveEmpty = 0;
      let foundAny = false;
      let errors = 0;
      let stoppedEarly = false;

      const fetchLoc = async (loc: number): Promise<Record<string, unknown>[] | null> => {
        try {
          const res = await onpremRequest<{ items?: Record<string, unknown>[] }>(
            this.config,
            "GET",
            `${this.aifBase()}/rules?locationId=${loc}`
          );
          return res?.items ?? [];
        } catch {
          return null; // transient error — counted, treated as empty for gap purposes
        }
      };

      outer: for (let start = 1; start <= hardMax; start += BATCH) {
        const ids: number[] = [];
        for (let i = start; i < start + BATCH && i <= hardMax; i++) ids.push(i);
        const batch = await Promise.all(ids.map((id) => fetchLoc(id).then((items) => ({ id, items }))));
        for (const { id, items } of batch) {
          scannedThroughLocationId = id;
          if (items === null) {
            errors++;
            consecutiveEmpty++;
          } else if (items.length > 0) {
            foundAny = true;
            consecutiveEmpty = 0;
            for (const r of items) {
              rules.push({
                ruleName: String(r.ruleName ?? ""),
                locationId: Number(r.location ?? id),
                application: String(r.application ?? ""),
                lastJobId: r.lastJobId == null ? null : Number(r.lastJobId),
                lastJobStatus: String(r.lastJobStatus ?? ""),
                source: String(r.source ?? ""),
              });
            }
          } else {
            consecutiveEmpty++;
          }
          if (foundAny && consecutiveEmpty >= gapLimit) {
            stoppedEarly = true;
            break outer;
          }
        }
      }
      return { rules, scannedThroughLocationId, stoppedEarly, errors };
    }
    return this.liveNotImplemented("listDataRules") as never;
  }

  // ---- Metadata governance (read) ----

  async getMetadataSnapshot(which: string): Promise<MetadataSnapshot> {
    if (this.isMock) {
      const snap = readFixture<MetadataFixture>("mock-metadata/metadata.json")
        .snapshots[which];
      if (!snap) {
        throw new Error(`Unknown snapshot '${which}' (try 'baseline' | 'current')`);
      }
      return snap;
    }
    if (this.isOnpremBasic) {
      // Live outline comes from the SQLite dimension DB (Planning REST is down;
      // see docs/onprem-corprpt-500-issue.md). Only one live snapshot exists, so
      // `which` is ignored and every request returns the current outline.
      return metadataSnapshotFromDb(process.env.EPM_APP || "CORPRPT");
    }
    return this.liveNotImplemented("getMetadataSnapshot");
  }

  // ---- Security audit (read) ----

  async listRoleAssignments(): Promise<RoleAssignment[]> {
    if (this.isMock) {
      return readFixture<SecurityFixture>("mock-security/security.json")
        .roleAssignments;
    }
    return this.liveNotImplemented("listRoleAssignments");
  }

  async listUserAccess(): Promise<UserAccess[]> {
    if (this.isMock) {
      return readFixture<SecurityFixture>("mock-security/security.json")
        .userAccess;
    }
    return this.liveNotImplemented("listUserAccess");
  }

  async listLoginRecords(): Promise<LoginRecord[]> {
    if (this.isMock) {
      return readFixture<SecurityFixture>("mock-security/security.json")
        .loginRecords;
    }
    return this.liveNotImplemented("listLoginRecords");
  }

  async listGroupAssignments(): Promise<GroupAssignment[]> {
    if (this.isMock) {
      return readFixture<SecurityFixture>("mock-security/security.json")
        .groupAssignments;
    }
    return this.liveNotImplemented("listGroupAssignments");
  }

  async getAccessSnapshot(which: string): Promise<AccessSnapshot> {
    if (this.isMock) {
      const snap = readFixture<SecurityFixture>("mock-security/security.json")
        .accessSnapshots[which];
      if (!snap) {
        throw new Error(`Unknown access snapshot '${which}' (try 'baseline' | 'current')`);
      }
      return snap;
    }
    return this.liveNotImplemented("getAccessSnapshot");
  }

  // ---- Hyperion Financial Management (HFM) (read) ----

  async listHfmEntities(_app: string): Promise<HfmEntity[]> {
    if (this.isMock) {
      return readFixture<HfmFixture>("mock-hfm/hfm.json").entities;
    }
    return this.liveNotImplemented("listHfmEntities");
  }

  async getConsolidationStatus(
    _app: string,
    _filter?: { period?: string; scenario?: string }
  ): Promise<HfmConsolidationStatus[]> {
    if (this.isMock) {
      return readFixture<HfmFixture>("mock-hfm/hfm.json").consolidationStatus;
    }
    return this.liveNotImplemented("getConsolidationStatus");
  }

  async listIntercompanyTransactions(
    _app: string,
    _filter?: { status?: string }
  ): Promise<HfmIcTransaction[]> {
    if (this.isMock) {
      return readFixture<HfmFixture>("mock-hfm/hfm.json").icTransactions;
    }
    return this.liveNotImplemented("listIntercompanyTransactions");
  }

  async getBalancingStatus(
    _app: string,
    _filter?: { entity?: string; period?: string }
  ): Promise<HfmBalancingStatus[]> {
    if (this.isMock) {
      return readFixture<HfmFixture>("mock-hfm/hfm.json").balancingStatus;
    }
    return this.liveNotImplemented("getBalancingStatus");
  }

  async getConsolidationReport(
    _app: string,
    _period: string
  ): Promise<HfmConsolidationReport> {
    if (this.isMock) {
      return readFixture<HfmFixture>("mock-hfm/hfm.json").consolidationReport;
    }
    return this.liveNotImplemented("getConsolidationReport");
  }

  async listCurrencyConversions(_app: string): Promise<HfmCurrencyConversion[]> {
    if (this.isMock) {
      return readFixture<HfmFixture>("mock-hfm/hfm.json").currencyConversions;
    }
    return this.liveNotImplemented("listCurrencyConversions");
  }

  async listHfmExtracts(_app: string): Promise<HfmExtractSpec[]> {
    if (this.isMock) {
      return readFixture<HfmFixture>("mock-hfm/hfm.json").extracts;
    }
    return this.liveNotImplemented("listHfmExtracts");
  }

  // ---- EPM Automate wrapper (allowlisted) ----

  async listAutomateCommands(): Promise<AutomateCommandSpec[]> {
    if (this.isMock) {
      return readFixture<AutomateFixture>("mock-automate/automate.json")
        .allowedCommands;
    }
    // EPM Automate is a Cloud-only utility; on-prem 11.1.2.4 has no equivalent
    // REST surface and no real catalog. Return empty rather than serving mock
    // data as if it were live.
    if (this.config.deployment === "onprem") return [];
    return this.liveNotImplemented("listAutomateCommands");
  }

  async listAutomateRunbooks(): Promise<AutomateRunbook[]> {
    if (this.isMock) {
      return readFixture<AutomateFixture>("mock-automate/automate.json").runbooks;
    }
    // No on-prem EPM Automate catalog exists (Cloud-only); see listAutomateCommands.
    if (this.config.deployment === "onprem") return [];
    return this.liveNotImplemented("listAutomateRunbooks");
  }

  /**
   * Runs an ALLOWLISTED EPM Automate command. No arbitrary shell: the command
   * must exist in the fixture allowlist, required params must be present, and
   * any mutating command requires an approvalPacketId.
   */
  async runAutomateCommand(args: {
    command: string;
    params: Record<string, string>;
    approvalPacketId?: string;
  }): Promise<AutomateResult> {
    const allow = await this.listAutomateCommands();
    const spec = allow.find((c) => c.command === args.command);
    if (!spec) {
      throw new Error(
        `runAutomateCommand refused: '${args.command}' is not on the allowlist. ` +
          `Allowed: ${allow.map((c) => c.command).join(", ")}`
      );
    }
    for (const p of spec.params) {
      if (p.required && !args.params[p.name]) {
        throw new Error(
          `runAutomateCommand('${args.command}') refused: missing required param '${p.name}'`
        );
      }
    }
    if (spec.mutating && !args.approvalPacketId) {
      throw new Error(
        `runAutomateCommand('${args.command}') refused: mutating command requires approvalPacketId`
      );
    }
    const start = Date.now();
    if (this.isMock) {
      return {
        command: args.command,
        status: "COMPLETED",
        output: `Mock EPM Automate: ${args.command} ${JSON.stringify(args.params)}`,
        artifactPath: spec.mutating
          ? `artifacts/automate/${args.command}.log`
          : undefined,
        elapsedMs: Date.now() - start,
      };
    }
    return this.liveNotImplemented("runAutomateCommand");
  }

  // ---- Job execution (mutating; requires approval packet) ----

  async executeJob(
    app: string,
    jobName: string,
    approvalPacketId: string,
    parameters?: Record<string, unknown>
  ): Promise<JobResult> {
    if (!approvalPacketId) {
      throw new Error(
        `executeJob('${jobName}') refused: missing approvalPacketId`
      );
    }
    const jobId = ++this.jobCounter;
    const start = new Date();
    if (this.isMock) {
      const end = new Date(start.getTime() + 1500);
      return {
        jobId,
        jobName,
        status: "COMPLETED",
        descriptiveStatus: "Completed",
        details: `Mock execution of ${jobName} on ${app}`,
        statusUrl: `mock://jobs/${jobId}`,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        elapsedMs: 1500,
        logArtifactPath: `artifacts/jobs/${jobId}.log`,
      };
    }
    if (this.config.deployment === "onprem" && this.config.auth === "basic") {
      const defs = await this.listJobDefinitions(app);
      const def = defs.find((d) => d.jobName === jobName);
      if (!def) {
        throw new Error(
          `executeJob('${jobName}') refused: no job definition named '${jobName}' found for app '${app}'.`
        );
      }
      const path = `/HyperionPlanning/rest/${this.config.apiVersion}/applications/${encodeURIComponent(app)}/jobs`;
      // On-prem 11.1.2.4 /jobs takes application/x-www-form-urlencoded, not the
      // Cloud-style JSON body (see the WADL note in
      // docs/onprem-corprpt-500-issue.md). Response shape is best-effort and
      // unverified against a real on-prem server — adjust field names once
      // tested (see OnpremRequestError on failures, or
      // scripts/test_onprem_planning_connection.py).
      const res = await onpremRequest<Record<string, unknown>>(
        this.config,
        "POST",
        path,
        {
          jobType: def.jobType,
          jobName,
          parameters: parameters ?? {},
        },
        "form"
      );
      const resolvedJobId = Number(res.jobId ?? res.jobID ?? res.id ?? jobId);
      const status = String(res.status ?? "PROCESSING") as JobStatusCode;
      return {
        jobId: Number.isFinite(resolvedJobId) ? resolvedJobId : jobId,
        jobName,
        status,
        descriptiveStatus: String(res.descriptiveStatus ?? status),
        details: typeof res.details === "string" ? res.details : undefined,
        statusUrl:
          typeof res.statusUrl === "string"
            ? res.statusUrl
            : `${this.config.baseUrl}${path}/${resolvedJobId}`,
        startTime: start.toISOString(),
      };
    }
    void parameters;
    return this.liveNotImplemented("executeJob");
  }

  /**
   * Runs a business rule (Calc Manager rule / Essbase calc script) as an Essbase
   * REST v1 calc job. MUTATING — refuses without an approvalPacketId (defense in
   * depth beyond the agent write-guard and Claude Code hook).
   *
   * Planning's own REST rule-execution surface is down on the target server
   * (every GET 500s — see docs/onprem-corprpt-500-issue.md), so rules run through
   * the healthy Essbase REST v1 jobs API: `POST /essbase/rest/v1/jobs` with
   * `jobtype: "calc"` and the script name in `parameters.file` — the same scripts
   * `listBusinessRules` enumerates. Any extra `parameters` (e.g. runtime-prompt /
   * substitution-variable overrides) are merged alongside `file`. The response is
   * mapped defensively (`job_ID`/`jobID`/`id`, `statusMessage`/`status_code`); the
   * exact field names are unverified against a real on-prem server — re-verify
   * once tested live (OnpremRequestError surfaces the raw body on failure).
   */
  async runBusinessRule(args: {
    app: string;
    cube: string;
    ruleName: string;
    approvalPacketId: string;
    parameters?: Record<string, string>;
  }): Promise<JobResult> {
    if (!args.approvalPacketId) {
      throw new Error(
        `runBusinessRule('${args.ruleName}') refused: missing approvalPacketId`
      );
    }
    const jobId = ++this.jobCounter;
    const start = new Date();
    if (this.isMock) {
      const end = new Date(start.getTime() + 1500);
      return {
        jobId,
        jobName: args.ruleName,
        status: "COMPLETED",
        descriptiveStatus: "Completed",
        details: `Mock run of business rule ${args.ruleName} on ${args.app}/${args.cube}`,
        statusUrl: `mock://jobs/${jobId}`,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        elapsedMs: 1500,
        logArtifactPath: `artifacts/jobs/${jobId}.log`,
      };
    }
    if (this.isOnpremBasic) {
      const path = `${this.essbaseBase()}/jobs`;
      const res = await onpremRequest<Record<string, unknown>>(
        this.config,
        "POST",
        path,
        {
          application: args.app,
          db: args.cube,
          jobtype: "calc",
          parameters: { file: args.ruleName, ...(args.parameters ?? {}) },
        }
      );
      const resolvedJobId = Number(res.job_ID ?? res.jobID ?? res.id ?? jobId);
      const statusMessage =
        typeof res.statusMessage === "string" ? res.statusMessage : undefined;
      const status = mapEssbaseJobStatus(statusMessage, res.status_code);
      const end = new Date();
      return {
        jobId: Number.isFinite(resolvedJobId) ? resolvedJobId : jobId,
        jobName: args.ruleName,
        status,
        descriptiveStatus: statusMessage ?? status,
        details:
          typeof res.errorMessage === "string" && res.errorMessage
            ? res.errorMessage
            : undefined,
        statusUrl: `${this.config.baseUrl}${path}/${resolvedJobId}`,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        elapsedMs: end.getTime() - start.getTime(),
      };
    }
    return this.liveNotImplemented("runBusinessRule");
  }

  async getJobStatus(jobId: number): Promise<JobResult> {
    if (this.isMock) {
      const now = new Date().toISOString();
      const status: JobStatusCode = "COMPLETED";
      return {
        jobId,
        jobName: "mock-job",
        status,
        descriptiveStatus: "Completed",
        statusUrl: `mock://jobs/${jobId}`,
        startTime: now,
        endTime: now,
        elapsedMs: 0,
      };
    }
    return this.liveNotImplemented("getJobStatus");
  }

  private liveNotImplemented(method: string): never {
    const deploymentHint =
      this.config.deployment === "onprem"
        ? `On-prem Oracle EPM 11.1.2.4 endpoint: implement ${this.config.auth} transport for this method.`
        : `Cloud EPM endpoint: implement ${this.config.auth} transport for this method.`;
    throw new Error(
      `EpmClient.${method} live-mode REST call not implemented yet. ${deploymentHint}`
    );
  }
}
