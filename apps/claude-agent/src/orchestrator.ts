/**
 * EPM orchestrator: deterministic router + demo entry point.
 *
 * In production this is the Claude Agent SDK harness that routes a request to a
 * domain subagent and loads the matching skill. Here we implement the routing
 * logic and a runnable mock demo so the whole system can be exercised without
 * Oracle credentials or an Anthropic API key.
 */
import { fccs, planning, core } from "@epm/servers-as-code";

export type Domain =
  | "planning"
  | "fccs"
  | "data-integration"
  | "metadata"
  | "smartview"
  | "security"
  | "automate"
  | "unknown";

const ROUTES: { domain: Domain; patterns: RegExp[] }[] = [
  { domain: "fccs", patterns: [/close|journal|consolidat|intercompany|fccs|supplemental/i] },
  { domain: "planning", patterns: [/forecast|budget|actual|variance|plan|substitution|rule/i] },
  { domain: "data-integration", patterns: [/pipeline|data integration|data management|load|mapping|pov lock/i] },
  { domain: "metadata", patterns: [/metadata|dimension|member|drift|orphan|snapshot diff/i] },
  { domain: "smartview", patterns: [/smart ?view|excel|retrieval|webview2|sso timeout/i] },
  { domain: "security", patterns: [/role|access|login|permission|group assignment/i] },
  { domain: "automate", patterns: [/epm ?automate|snapshot backup|replay/i] },
];

export function routeRequest(text: string): Domain {
  for (const r of ROUTES) {
    if (r.patterns.some((p) => p.test(text))) return r.domain;
  }
  return "unknown";
}

async function demo(): Promise<void> {
  console.log("=== Oracle EPM Agentic Services — mock demo ===\n");

  const apps = await core.listApplications();
  console.log("Applications:", apps.map((a) => `${a.name}(${a.type})`).join(", "));

  const q1 = "What is the close readiness for FCCS Jun?";
  console.log(`\n[route] "${q1}" ->`, routeRequest(q1));
  const readiness = await fccs.closeReadinessReport({ app: "FCCS", period: "Jun" });
  console.log("Close readiness:", JSON.stringify(readiness, null, 2));

  const q2 = "Show me actual vs forecast variance for Financ";
  console.log(`\n[route] "${q2}" ->`, routeRequest(q2));
  const variance = await planning.varianceSnapshot({ app: "Financ", cube: "ORC_Plan" });
  console.log("Variance exceptions:", JSON.stringify(variance, null, 2));
}

// Run demo only when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  demo().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
