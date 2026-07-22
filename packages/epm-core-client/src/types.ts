/**
 * Shared domain types for the Oracle EPM agentic services.
 * These mirror the shapes returned by Oracle Cloud EPM REST APIs closely
 * enough for tooling, but are intentionally trimmed to what the agents need.
 */

export type EpmMode = "mock" | "live";

/** Deployment topology: cloud-hosted or on-premises. */
export type EpmDeployment = "cloud" | "onprem";

/** How the client authenticates against a live pod. */
export type AuthKind = "basic" | "oauth";

export interface EpmClientConfig {
  mode: EpmMode;
  deployment: EpmDeployment;
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
  /** On-premises specific config. */
  onprem?: {
    serverHostname?: string;
    serverPort?: number;
    useHttps?: boolean;
    verifySslCert?: boolean;
    /**
     * Base path of the Essbase REST API on this server (default
     * `/essbase/rest/v1`). Planning apps are backed by Essbase cubes, and on a
     * server whose Planning REST module is down this is the live read path.
     */
    essbaseBasePath?: string;
    /**
     * Base path of the FDMEE / Data Management REST API (default `/aif/rest/V1`;
     * note the literal uppercase `V1`). Present on 11.1.2.4.210+.
     */
    aifBasePath?: string;
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

/** A business rule (Calc Manager rule / Essbase calc script) summary. */
export interface BusinessRule {
  name: string;
  sizeInBytes: number;
  modifiedTime: number | null;
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

/** A registered FDMEE / Data Management target application. */
export interface DmApplication {
  name: string;
  type: string;
}

/** An FDMEE data load rule (from `/aif/rest/V1/rules?locationId=`). */
export interface DataRule {
  ruleName: string;
  locationId: number;
  application: string;
  lastJobId: number | null;
  lastJobStatus: string;
  source: string;
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

// ---- Security audit ----

export interface RoleAssignment {
  user: string;
  displayName: string;
  role: string;
  application: string;
}

export interface UserAccess {
  user: string;
  active: boolean;
  lastLogin: string;
  mfaEnabled: boolean;
}

export interface LoginRecord {
  user: string;
  timestamp: string;
  success: boolean;
  ip: string;
}

export interface GroupAssignment {
  group: string;
  members: string[];
}

export interface AccessSnapshot {
  snapshotId: string;
  capturedAt: string;
  assignments: { user: string; role: string }[];
}

export type AccessChangeKind = "GRANTED" | "REVOKED" | "ROLE_CHANGED";

export interface AccessChange {
  kind: AccessChangeKind;
  user: string;
  from?: string;
  to?: string;
}

// ---- EPM Automate wrapper ----

export interface AutomateCommandParam {
  name: string;
  required: boolean;
}

export interface AutomateCommandSpec {
  command: string;
  description: string;
  mutating: boolean;
  params: AutomateCommandParam[];
}

export interface AutomateRunbook {
  runbookId: string;
  name: string;
  lastRun: string;
  lastStatus: JobStatusCode;
  commands: string[];
}

export interface AutomateResult {
  command: string;
  status: JobStatusCode;
  output: string;
  artifactPath?: string;
  elapsedMs: number;
}

// ---- Hyperion Financial Management (HFM) ----

export interface HfmEntity {
  name: string;
  parent: string | null;
  description?: string;
  active: boolean;
}

export interface HfmConsolidationStatus {
  entity: string;
  period: string;
  scenario: string;
  status: "Not Started" | "In Progress" | "Completed" | "Needs Review" | "Submitted";
  consolidationDate?: string;
  completionPercentage: number;
  owner?: string;
}

export interface HfmIcTransaction {
  id: string;
  sender: string;
  receiver: string;
  amount: number;
  status: "Pending" | "Matched" | "Rejected" | "Confirmed";
  description?: string;
  createdDate: string;
}

export interface HfmBalancingStatus {
  entity: string;
  period: string;
  scenario: string;
  totalDebits: number;
  totalCredits: number;
  difference: number;
  balanced: boolean;
  lastBalancedDate?: string;
}

export interface HfmConsolidationReport {
  entities: number;
  consolidated: number;
  pending: number;
  submitted: number;
  completionPercentage: number;
  byStatus: Record<string, number>;
  issues: string[];
}

export interface HfmCurrencyConversion {
  sourceCurrency: string;
  targetCurrency: string;
  rate: number;
  effectiveDate: string;
  rateType: "Spot" | "Corporate" | "Historical";
}

export interface HfmExtractSpec {
  name: string;
  description?: string;
  dimensions: Record<string, string[]>;
  format: "Excel" | "CSV" | "XML";
  lastRun?: string;
}

