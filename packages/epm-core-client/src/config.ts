import type { EpmClientConfig, EpmMode, AuthKind, EpmDeployment } from "./types.js";

/**
 * Loads client config from environment variables.
 * Defaults to mock mode so demos and evals run with zero credentials.
 * Never throws on missing live credentials in mock mode.
 *
 * On-prem EPM 11.1.2.4 uses Basic Auth only (no OAuth).
 * Cloud EPM supports both Basic Auth and OAuth.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): EpmClientConfig {
  const mode = (env.EPM_MODE ?? "mock").toLowerCase() as EpmMode;
  const deployment = (env.EPM_DEPLOYMENT ?? "cloud").toLowerCase() as EpmDeployment;

  // On-prem always uses Basic Auth; Cloud defaults to OAuth if token URL provided
  const auth: AuthKind = deployment === "onprem" || !env.EPM_OAUTH_TOKEN_URL ? "basic" : "oauth";

  // Build base URL
  let baseUrl: string | undefined;
  if (deployment === "onprem") {
    const hostname = env.EPM_SERVER_HOSTNAME;
    const port = env.EPM_SERVER_PORT ? parseInt(env.EPM_SERVER_PORT) : 8080;
    const useHttps = env.EPM_USE_HTTPS === "true";
    baseUrl = `${useHttps ? "https" : "http"}://${hostname}:${port}`;
  } else {
    baseUrl = env.EPM_BASE_URL || undefined;
  }

  const config: EpmClientConfig = {
    mode: mode === "live" ? "live" : "mock",
    deployment,
    baseUrl,
    identityDomain: env.EPM_IDENTITY_DOMAIN || undefined,
    apiVersion: env.EPM_API_VERSION || "v3",
    auth,
    username: env.EPM_USERNAME || undefined,
    password: env.EPM_PASSWORD || undefined,
    oauth: {
      tokenUrl: env.EPM_OAUTH_TOKEN_URL || undefined,
      clientId: env.EPM_OAUTH_CLIENT_ID || undefined,
      clientSecret: env.EPM_OAUTH_CLIENT_SECRET || undefined,
      scope: env.EPM_OAUTH_SCOPE || undefined,
    },
    onprem: {
      serverHostname: env.EPM_SERVER_HOSTNAME || undefined,
      serverPort: env.EPM_SERVER_PORT ? parseInt(env.EPM_SERVER_PORT) : 8080,
      useHttps: env.EPM_USE_HTTPS === "true",
      verifySslCert: env.EPM_VERIFY_SSL_CERT !== "false",
      essbaseBasePath: env.EPM_ESSBASE_BASE_PATH || "/essbase/rest/v1",
      aifBasePath: env.EPM_AIF_BASE_PATH || "/aif/rest/V1",
    },
  };

  if (config.mode === "live") {
    assertLiveConfig(config);
  }
  return config;
}

function assertLiveConfig(config: EpmClientConfig): void {
  if (!config.baseUrl) {
    throw new Error(
      config.deployment === "onprem"
        ? "EPM_MODE=live with on-prem deployment requires EPM_SERVER_HOSTNAME"
        : "EPM_MODE=live requires EPM_BASE_URL"
    );
  }
  if (config.auth === "basic" && (!config.username || !config.password)) {
    throw new Error(
      "EPM_MODE=live with Basic Auth requires EPM_USERNAME and EPM_PASSWORD"
    );
  }
  if (config.auth === "oauth" && !config.oauth?.clientId) {
    throw new Error("OAuth mode requires EPM_OAUTH_CLIENT_ID");
  }
}

/** Redacts secrets for safe logging/return. */
export function redactConfig(config: EpmClientConfig): Record<string, unknown> {
  return {
    mode: config.mode,
    deployment: config.deployment,
    baseUrl: config.baseUrl ?? null,
    identityDomain: config.identityDomain ?? null,
    apiVersion: config.apiVersion,
    auth: config.auth,
    username: config.username ? mask(config.username) : null,
    password: config.password ? "***" : null,
    oauth: config.oauth?.clientId
      ? { clientId: mask(config.oauth.clientId), configured: true }
      : { configured: false },
    onprem: config.deployment === "onprem" ? {
      serverHostname: config.onprem?.serverHostname ?? null,
      serverPort: config.onprem?.serverPort ?? null,
      useHttps: config.onprem?.useHttps ?? false,
      verifySslCert: config.onprem?.verifySslCert ?? true,
    } : undefined,
  };
}

function mask(s: string): string {
  if (s.length <= 3) return "***";
  return s.slice(0, 2) + "***" + s.slice(-1);
}
