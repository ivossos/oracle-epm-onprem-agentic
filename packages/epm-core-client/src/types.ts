/**
 * Shared domain types for the Oracle EPM agentic services.
 * These mirror the shapes returned by Oracle Cloud EPM REST APIs closely
 * enough for tooling, but are intentionally trimmed to what the agents need.
 */

export type EpmMode = "mock" | "live";

/** How the client authenticates against a live pod. */
export type AuthKind = "basic" | "oauth";

export interface EpmClientConfig {
  mode: EpmMode;
  baseUrl?: string;
  identityDomain?: string;
  apiVersion: string;
  auth: AuthKind;
  username?: string;
  /** Never logged or returned by any tool. */
  password?: string;
  oauth?: {
    tokenUrl?: string;
    clientId?: string;
    clientSecret?: string;
    scope?: string;
  };
}

/** Oracle EPM job status codes (subset), normalized. */
export type JobStatusCode =
  | "PROCESSING"
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "FAILED"
  | "PENDING";

export interface Application {
  name: string;
  type: "PLANNING" | "FCCS" | "PCM";
  cubes: string[];
}

export interface JobDefinition {
  jobName: string;
  jobType: string;
  description?: string;
}

export interface JobResult {
  jobId: number;
  jobName: string;
  status: JobStatusCode;
  descriptiveStatus: string;
  details?: string;
  statusUrl: string;
  startTime: string;
  endTime?: string;
  elapsedMs?: number;
  logArtifactPath?: string;
}

export interface EpmFile {
  name: string;
  type: "FILE" | "FOLDER";
  size?: number;
  lastModified?: string;
}

/** A bounded result envelope so large payloads never flood model context. */
export interface BoundedResult<TSample> {
  totalRows: number;
  returnedRows: number;
  sample: TSample[];
  artifactPath?: string;
  truncated: boolean;
}

/** Point-of-view for Planning/FCCS grids. */
export type Pov = Record<string, string>;

export interface DataSliceRow {
  members: Record<string, string>;
  value: number | null;
}

export interface DataSlice {
  pov: Pov;
  rows: DataSliceRow[];
  artifactPath?: string;
}

// ---- FCCS ----

export type JournalStatus =
  | "Working"
  | "Submitted"
  | "Approved"
  | "Posted"
  | "Rejected";

export interface Journal {
  label: string;
  status: JournalStatus;
  period: string;
  scenario: string;
  year: string;
  entity: string;
  balanced: boolean;
  totalDebit: number;
  totalCredit: number;
}

export interface MetadataValidationIssue {
  dimension: string;
  member: string;
  severity: "ERROR" | "WARNING";
  message: string;
}

export interface MetadataValidationResult {
  valid: boolean;
  errors: number;
  warnings: number;
  issues: MetadataValidationIssue[];
}

export interface IntercompanyMatch {
  entity: string;
  partner: string;
  account: string;
  entityAmount: number;
  partnerAmount: number;
  difference: number;
  matched: boolean;
}

// ---- Data Integration / Data Management ----

export interface Integration {
  integrationId: string;
  name: string;
  source: string;
  target: string;
}

export interface Pipeline {
  pipelineId: string;
  name: string;
  /** Cron expression, or null for ad-hoc. */
  schedule: string | null;
  enabled: boolean;
  integrations: string[];
}

export interface FailedRow {
  row: number;
  reason: string;
}

export interface IntegrationJob {
  jobId: number;
  integrationId: string;
  status: JobStatusCode;
  rowsProcessed: number;
  rowsRejected: number;
  startTime: string;
  endTime?: string;
  failedRows?: FailedRow[];
}

export interface MappingRule {
  type: "EXPLICIT" | "LIKE" | "BETWEEN" | "MULTIDIM";
  source: string;
  target: string;
}

export interface Mapping {
  integrationId: string;
  dimension: string;
  rules: MappingRule[];
}

export interface PovLock {
  target: string;
  year: string;
  period: string;
  scenario: string;
  locked: boolean;
}

// ---- Metadata governance ----

export type DataStorage =
  | "Stored"
  | "Dynamic Calc"
  | "Dynamic Calc and Store"
  | "Never Share"
  | "Label Only"
  | "Shared";

export interface MetadataMember {
  dimension: string;
  name: string;
  parent: string | null;
  dataStorage: DataStorage;
  formula: string | null;
  solveOrder?: number | null;
  /** Whether the member holds data. Absent = unknown (never flagged as orphan). */
  hasData?: boolean;
}

export interface MetadataSnapshot {
  snapshotId: string;
  capturedAt: string;
  app: string;
  members: MetadataMember[];
}

export type MetadataChangeKind = "ADDED" | "REMOVED" | "CHANGED";

export interface MetadataChange {
  kind: MetadataChangeKind;
  dimension: string;
  member: string;
  /** For CHANGED: list of field-level diffs. */
  fields?: { field: string; from: unknown; to: unknown }[];
}

export interface MetadataDiffResult {
  fromSnapshot: string;
  toSnapshot: string;
  added: number;
  removed: number;
  changed: number;
  changes: MetadataChange[];
}

export interface MetadataRisk {
  dimension: string;
  member: string;
  severity: "ERROR" | "WARNING";
  kind: "DYNAMIC_CALC_NO_SOLVE_ORDER" | "STORED_WITH_FORMULA" | "ORPHAN";
  message: string;
}

