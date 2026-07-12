import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type {
  Application,
  DataSlice,
  EpmClientConfig,
  EpmFile,
  IntercompanyMatch,
  Journal,
  JobDefinition,
  JobResult,
  JobStatusCode,
  MetadataValidationResult,
} from "./types.js";
import { loadConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/epm-core-client/src -> repo root
const REPO_ROOT = resolve(__dirname, "../../..");

function readFixture<T>(relPath: string): T {
  const full = resolve(REPO_ROOT, "fixtures", relPath);
  return JSON.parse(readFileSync(full, "utf8")) as T;
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
    throw new Error(
      `EpmClient.${method} live-mode REST call not implemented yet. ` +
        `Set EPM_MODE=mock, or implement the ${this.config.auth} transport.`
    );
  }
}
