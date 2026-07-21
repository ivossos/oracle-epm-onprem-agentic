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
  bodyEncoding: "json" | "form" = "json"
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

/** A grid cell/header entry as returned by exportdataslice — rich object or bare member string. */
type GridEntry =
  | string
  | {
      dimensionName?: string;
      dimName?: string;
      name?: string;
      memberName?: string;
      member?: string;
      value?: string;
    };

function gridMemberName(entry: GridEntry): string {
  if (typeof entry === "string") return entry;
  return entry.memberName ?? entry.member ?? entry.name ?? entry.value ?? "";
}

function gridDimName(entry: GridEntry, fallback: string): string {
  if (typeof entry === "string") return fallback;
  return entry.dimensionName ?? entry.dimName ?? fallback;
}

function gridValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "" || s === "#Missing" || s === "#MISSING") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses a Cloud-style `exportdataslice` grid response into a flat DataSlice.
 *
 * BEST-EFFORT / UNVERIFIED against a real on-prem 11.1.2.4 server (see
 * docs/onprem-corprpt-500-issue.md). Dimension names are used when the response
 * carries them (rich object form); otherwise members are keyed positionally
 * (`POV1`, `ROW1`, `COL`). One DataSliceRow is emitted per (row × column) cell.
 */
function parseExportDataSliceGrid(res: Record<string, unknown>): DataSlice {
  const pov: Record<string, string> = {};
  const povArr = Array.isArray(res.pov) ? (res.pov as GridEntry[]) : [];
  povArr.forEach((m, i) => {
    pov[gridDimName(m, `POV${i + 1}`)] = gridMemberName(m);
  });

  // `columns` is an array of header bands; use the innermost/only band.
  const colBands = Array.isArray(res.columns) ? (res.columns as GridEntry[][]) : [];
  const cols: GridEntry[] = (colBands.length ? colBands[colBands.length - 1] : []) ?? [];

  const rows: DataSliceRow[] = [];
  const resRows = Array.isArray(res.rows) ? (res.rows as { headers?: GridEntry[]; data?: unknown[] }[]) : [];
  for (const r of resRows) {
    const headers = Array.isArray(r.headers) ? r.headers : [];
    const rowMembers: Record<string, string> = {};
    headers.forEach((m, i) => {
      rowMembers[gridDimName(m, `ROW${i + 1}`)] = gridMemberName(m);
    });
    const data = Array.isArray(r.data) ? r.data : [];
    if (cols.length) {
      cols.forEach((col, ci) => {
        rows.push({
          members: { ...rowMembers, [gridDimName(col, "COL")]: gridMemberName(col) },
          value: gridValue(data[ci]),
        });
      });
    } else {
      rows.push({ members: rowMembers, value: gridValue(data[0]) });
    }
  }
  return { pov, rows };
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
 * (no network). In live mode, on-prem Basic Auth is wired for
 * `listJobDefinitions`/`executeJob` (see `onpremRequest`); every other method
 * and Cloud OAuth remain behind `liveNotImplemented` guards.
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

  // ---- Read operations ----

  async listApplications(): Promise<Application[]> {
    if (this.isMock) {
      const p = readFixture<PlanningFixture>("mock-planning/planning.json");
      const f = readFixture<FccsFixture>("mock-fccs/fccs.json");
      return [...p.applications, ...f.applications];
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
    _app: string
  ): Promise<{ name: string; value: string; plan: string }[]> {
    if (this.isMock) {
      return readFixture<PlanningFixture>("mock-planning/planning.json")
        .substitutionVariables;
    }
    return this.liveNotImplemented("getSubstitutionVariables");
  }

  async exportDataSlice(app: string, cube: string): Promise<DataSlice> {
    if (this.isMock) {
      return readFixture<PlanningFixture>("mock-planning/planning.json")
        .dataSlice;
    }
    if (this.config.deployment === "onprem" && this.config.auth === "basic") {
      // Best-effort against the Cloud-style inline `exportdataslice` endpoint.
      // UNVERIFIED on 11.1.2.4 — some patch levels only expose the job-based
      // (EXPORT_DATA/dataexport) export surface and will 404 here; real export
      // may need to go through executeJob + file download instead. We send a
      // minimal whole-cube grid request (no POV/rows/columns spec yet — a known
      // follow-up). See docs/onprem-corprpt-500-issue.md.
      const path = `/HyperionPlanning/rest/${this.config.apiVersion}/applications/${encodeURIComponent(app)}/plantypes/${encodeURIComponent(cube)}/exportdataslice`;
      const res = await onpremRequest<Record<string, unknown>>(this.config, "POST", path, {
        exportPlanningData: false,
        gridDefinition: { suppressMissingBlocks: true },
      });
      return parseExportDataSliceGrid(res);
    }
    return this.liveNotImplemented("exportDataSlice");
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
    return this.liveNotImplemented("listPipelines");
  }

  async listIntegrations(): Promise<Integration[]> {
    if (this.isMock) {
      return readFixture<DataIntegrationFixture>(
        "mock-data-integration/data-integration.json"
      ).integrations;
    }
    return this.liveNotImplemented("listIntegrations");
  }

  async listIntegrationJobs(): Promise<IntegrationJob[]> {
    if (this.isMock) {
      return readFixture<DataIntegrationFixture>(
        "mock-data-integration/data-integration.json"
      ).jobs;
    }
    return this.liveNotImplemented("listIntegrationJobs");
  }

  async exportMapping(integrationId: string): Promise<Mapping[]> {
    if (this.isMock) {
      return readFixture<DataIntegrationFixture>(
        "mock-data-integration/data-integration.json"
      ).mappings.filter((m) => m.integrationId === integrationId);
    }
    return this.liveNotImplemented("exportMapping");
  }

  async listPovLocks(): Promise<PovLock[]> {
    if (this.isMock) {
      return readFixture<DataIntegrationFixture>(
        "mock-data-integration/data-integration.json"
      ).povLocks;
    }
    return this.liveNotImplemented("listPovLocks");
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
    return this.liveNotImplemented("listAutomateCommands");
  }

  async listAutomateRunbooks(): Promise<AutomateRunbook[]> {
    if (this.isMock) {
      return readFixture<AutomateFixture>("mock-automate/automate.json").runbooks;
    }
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
