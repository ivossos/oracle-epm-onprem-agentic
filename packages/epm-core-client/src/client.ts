import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import https from "node:https";
import type {
  Application,
  AccessSnapshot,
  AutomateCommandSpec,
  AutomateResult,
  AutomateRunbook,
  DataSlice,
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
 * (no network). In live mode, methods issue REST calls (implemented behind
 * `liveNotImplemented` guards for now — Basic/OAuth wiring is a follow-up).
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

  async listJobDefinitions(_app: string): Promise<JobDefinition[]> {
    if (this.isMock) {
      return readFixture<PlanningFixture>("mock-planning/planning.json")
        .jobDefinitions;
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

  async exportDataSlice(_app: string, _cube: string): Promise<DataSlice> {
    if (this.isMock) {
      return readFixture<PlanningFixture>("mock-planning/planning.json")
        .dataSlice;
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
