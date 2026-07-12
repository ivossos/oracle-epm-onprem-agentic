import type { EpmClientConfig, EpmMode, AuthKind } from "./types.js";

/**
 * Loads client config from environment variables.
 * Defaults to mock mode so demos and evals run with zero credentials.
 * Never throws on missing live credentials in mock mode.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): EpmClientConfig {
  const mode = (env.EPM_MODE ?? "mock").toLowerCase() as EpmMode;
  const auth: AuthKind = env.EPM_OAUTH_TOKEN_URL ? "oauth" : "basic";

  const config: EpmClientConfig = {
    mode: mode === "live" ? "live" : "mock",
    baseUrl: env.EPM_BASE_URL || undefined,
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
  };

  if (config.mode === "live") {
    assertLiveConfig(config);
  }
  return config;
}

function assertLiveConfig(config: EpmClientConfig): void {
  if (!config.baseUrl) {
    throw new Error("EPM_MODE=live requires EPM_BASE_URL");
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
    baseUrl: config.baseUrl ?? null,
    identityDomain: config.identityDomain ?? null,
    apiVersion: config.apiVersion,
    auth: config.auth,
    username: config.username ? mask(config.username) : null,
    password: config.password ? "***" : null,
    oauth: config.oauth?.clientId
      ? { clientId: mask(config.oauth.clientId), configured: true }
      : { configured: false },
  };
}

function mask(s: string): string {
  if (s.length <= 3) return "***";
  return s.slice(0, 2) + "***" + s.slice(-1);
}
