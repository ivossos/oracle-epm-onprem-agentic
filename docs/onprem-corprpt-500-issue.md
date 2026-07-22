# On-prem Planning REST API 500 — CORPRPT jobdefinitions

## Issue

REST API call to Planning application `CORPRPT` returns HTTP 500.

- **Server:** `10.10.10.20:19000`
- **Endpoint:** `GET /HyperionPlanning/rest/11.1.2.4/applications/CORPRPT/jobdefinitions`
- **Auth:** Basic Auth, user `admin` (confirmed valid — not a 401)

## What's confirmed working

- The web tier is up and Planning is reachable at this host/port.
- The REST resources are correctly registered — `OPTIONS` requests return `200 OK` with `Allow: HEAD,GET,OPTIONS` and valid WADL. So Jersey routing is fine.
- The app name `CORPRPT` is correct.

## What's failing

**Every readable (GET) endpoint returns HTTP 500** — a generic Oracle HTML error page, not a normal REST error response. This includes the most trivial, context-free endpoint:

| Endpoint | Result |
|---|---|
| `/rest/11.1.2.4` (API discovery root) | **500** (but `OPTIONS` → 200, `Allow: GET`) |
| `/rest/11.1.2.4/applications` (list apps) | **500** (but `OPTIONS` → 200, `Allow: GET`) |
| `/rest/11.1.2.4/applications/CORPRPT/jobdefinitions` | **500** (with or without the `q` query param) |
| `/rest/11.1.2.4/applications/CORPRPT/jobs` | 405 — POST-only (job execution) |
| `substitutionvariables`, `dimensions`, `plantypes` | 404 — not exposed |

**Key clue:** even the API discovery root (`/rest/11.1.2.4`), which takes no application context and only returns version metadata, throws a 500. Jersey routes it (OPTIONS → 200), but the GET handler itself crashes. OPTIONS/WADL is served by the JAX-RS framework and never touches business logic, so a 200 there only proves routing is alive. A GET actually invokes the resource method, which resolves the Shared Services (CSS) security token and opens the Planning repository datasource — a crash in that path produces exactly this generic HTML 500.

The **fix** is server-side (see the admin checklist). But there is still meaningful client-side **diagnosis** left to do before escalating — `scripts/test_onprem_planning_connection.py` now runs a `diagnose_500()` matrix automatically when the authenticated GET 500s. It attacks the four client-controllable variables most likely to change the outcome:

- **API-version path** (`v3` / `11.1.2.4` / `v1` / `v2`) — OPTIONS→200 only proves routing, not that a given version's GET handler works; a different segment may actually serve.
- **Username format** (`admin` / `Native Directory.admin` / `native directory\admin`) — a malformed CSS principal can crash token resolution as a 500 rather than a clean 401.
- **`Accept` header** (`json` / `xml` / none) — dodges a content-negotiation crash and can coax a real JSON error body out instead of the generic HTML page.
- **Sibling web-apps on 19000** (`/interop/rest`, `/aif/rest`, `/workspace`, Planning non-REST UI) — isolates Shared Services/CSS health from the Planning app/datasource: if interop answers but Planning 500s, CSS is fine and the fault is the Planning app/DB; if interop also 500s, it's Shared Services/registry.

The matrix also scrapes the HTML 500 body for the embedded **ECID and Java exception class** (`extract_diag()`), so even a 500 yields a lead without server access.

## Port reachability (tested from the client machine)

Only the OHS/Workspace front-end is reachable from here. The Planning managed server and WebLogic admin ports are firewalled off:

| Port | Role | Reachable from client? |
|---|---|---|
| **19000** | Oracle HTTP Server / Workspace (reverse proxy) | **Yes** (HTTP 200) |
| 8300 | Planning managed server (default direct port) | No |
| 7001 | WebLogic Admin Console | No |
| 8080 / 9000 | (other/compact-deployment candidates) | No |

**Implication:** `/HyperionPlanning` on 19000 is served by OHS's `mod_wl_ohs` reverse proxy, which forwards to the Planning managed server on **8300**. Because we can only reach 19000, we can't test 8300 directly from here to isolate proxy-vs-backend. That test must be run **on the server itself**.

## Most likely root causes (from research)

**Update — the client reports "nothing is down":** every EPM service (Foundation/Shared Services, Planning, the repository RDBMS, Workspace) shows healthy/green, and the Planning and Workspace web UIs work. That *reprioritizes* the list below hard. If no service is down, then the "X is down" causes (repository RDBMS, Shared Services outage, app not deployed) are unlikely, and what's left is a fault in the **REST request path specifically** while everything the REST handler depends on is genuinely up. Two candidates dominate:

1. **Broken OHS `mod_wl_ohs` proxy route for `/HyperionPlanning`** — MORE likely now, not less. A broken reverse-proxy forward produces "Failure of server APACHE bridge" 500s *while every backend service is green*, and OHS answers the OPTIONS preflight locally (at the proxy) without ever forwarding it — which is exactly the observed OPTIONS-200 / every-GET-500 fingerprint. **Decisive test: hit 8300 directly on the server** (`curl -u admin http://localhost:8300/HyperionPlanning/rest/v3/applications`). 200/JSON there = proxy route is the whole problem; 500 there = it's the Planning REST module itself (go to #2).
2. **Planning REST web module misconfigured / partially patched** — the REST/ADF servlet throws an *uncaught* exception during request init (before the JAX-RS error mapper can emit a JSON body — hence the generic HTML page, not a REST error). Typical triggers with all services up: a partial PSU leaving a classpath/jar mismatch (`NoClassDefFoundError`/`ClassNotFoundException`), a broken ADF `logging.xml`, or the REST layer's own repository/registry datasource binding pointing at the wrong Planning system DB. Look for the exception class in `Planning_ADF.log` / `HyperionPlanning.log` at the ECID below.

Lower likelihood now that nothing is down (keep only if #1 and #2 clear):

3. Planning managed server can't reach its repository RDBMS (`SQLException`) — but this usually also breaks the UI, which the client says works.
4. Shared Services / registry misconfig breaking CSS token resolution — possible even with services "up" if the EPM Registry is stale; validate with `epmsys_registry.bat view`.

Note: the REST API is **not** a separate enable step — it ships with Planning 11.1.2.4+ and is live once the web app is deployed. So "REST not enabled" is unlikely; this is a plumbing/config failure in the REST path, not an outage.

## Update — live diagnostic run 2026-07-21 (client-side, from the app host)

Ran `scripts/test_onprem_planning_connection.py` (`diagnose_500()` matrix + extra probes) against `10.10.10.20:19000`, app `CORPRPT`, user `admin`. New evidence that **reprioritizes the root causes above and rules out the proxy theory (#1)**:

| Probe | Result | What it proves |
|---|---|---|
| `GET .../rest/**v3**/applications` | **404** | `v3` segment is not registered on this server |
| `GET .../rest/**11.1.2.4**/applications` | 500 | `11.1.2.4` (and `v1`) *are* registered — they route to a handler that then crashes |
| `GET .../rest/v2/applications` | 404 | not registered |
| `GET .../applications` **Accept: application/xml** | **406** | JAX-RS content negotiation runs — the request reaches Jersey on the Planning tier |
| `GET .../applications` **no auth header** | **500, no `WWW-Authenticate`** | the crash happens **before authentication is evaluated** — never gets to a 401 |
| all username-format variants | 500 (not 401) | consistent with pre-auth crash; username format is irrelevant |
| body of every 500 | Planning's own **`Error.jsp`** UI page (`LaunchPlanningCentral.jsp`, `upk_Planning_context="HyperionPlanning"`, `HspEnterDataHelper`) | **not** the OHS "APACHE bridge" page and **not** a raw WebLogic page — the request reached the Planning web app |
| `OPTIONS` on the same URLs | 200, `Allow: HEAD,GET,OPTIONS` | routing alive (framework-handled, no business logic) |
| `/workspace/index.jsp` | 200 | Workspace front-end healthy |
| 8300 / 7001 TCP probe | firewalled from client | can't bypass OHS from here — the direct-backend curl must run on the server |

**Conclusion — the fault is the Planning REST web module itself (doc's cause #2), NOT the OHS proxy (#1):**

- The Planning app returns **its own `Error.jsp`**, and `Accept: xml` gets a clean **406** from Jersey — both prove OHS forwards correctly to the Planning managed server and JAX-RS is running. A broken `mod_wl_ohs` bridge could produce neither (it would return the "Failure of server APACHE bridge" page and never reach Jersey). **Proxy theory ruled out.**
- **No-auth → 500 (no `WWW-Authenticate`)** means the REST module throws an **uncaught exception during request initialization, before the security filter runs**. This also rules out the username-format / CSS-principal theory (D2) — auth is never reached.
- **`Accept: xml` → 406** rules out a content-negotiation crash; the JSON code path is the one that throws.
- **`v3` → 404 vs `11.1.2.4` → 500** resolves the repo's open API-version question: **`11.1.2.4` is the correct segment for this server; `v3` does not exist here.** So `EPM_API_VERSION=11.1.2.4` in `.env`/config is right, and Oracle's "canonical v3" note does not apply to this patch level.

**Most probable server-side root cause now** (crash is pre-auth, in REST-module init, while UI + Workspace + repository are all up): a **partially/mismatched-patched REST/ADF module** in the `HyperionPlanning` web app throwing at servlet/filter init (`NoClassDefFoundError` / `ClassNotFoundException` / bad ADF config), or the REST module's own repository/registry datasource binding failing. The classic Planning UI works because it uses a different servlet path that doesn't hit the broken init.

**Decisive next step (requires server access — 8300 is firewalled from the client):**
1. On the server, bypass OHS: `curl -u admin http://localhost:8300/HyperionPlanning/rest/11.1.2.4/applications` — expected 500 here too (proxy already exonerated), confirming the backend.
2. Read `Planning_ADF.log` / `HyperionPlanning.log` / `Planning0.out` at the ECID → the **exception class** distinguishes patch-mismatch (`NoClassDefFoundError`) vs datasource (`SQLException`) vs registry/CSS. This session's HTML body did not leak a fresh ECID (it's the UI `Error.jsp`), so correlate via the OHS `access_log` timestamp or use the ECID already captured below.

## Diagnostic correlation ID

Search the Planning managed-server logs for this ECID to get the actual stack trace:

```
ECID: 00jhRSZ9R6aFw0ztvl0Djz6MxRi2jJmwv0003F^0000B4
Time: 2026-07-21 15:41:18 GMT (11:41:18 EDT)
```

Log locations (Windows, `MW_HOME` typically `C:\Oracle\Middleware`):

- **Planning app / REST stack traces** — `MW_HOME\user_projects\domains\EPMSystem\servers\<Planning0|EPMServer0>\logs\`: `HyperionPlanning.log`, `Planning_ADF.log`, `Planning0.out`
- **OHS access/error** — `MW_HOME\user_projects\epmsystem1\httpConfig\ohs\diagnostics\logs\OHS\ohs_component\`: `access_log`, `ohs_component.log`

Search by ECID:
- WLST: `displayLogs(ecid='00jhRSZ9R6aFw0ztvl0Djz6MxRi2jJmwv0003F^0000B4', target='Planning0')`
- Enterprise Manager (FMW Control): WebLogic Domain → Logs → View Log Messages → row → View Related Messages → by ECID
- Raw: `findstr /S "00jhRSZ9R6aFw0ztvl0Djz6MxRi2jJmwv0003F" *.log`

## Admin checklist

```
1. On the server, hit the Planning managed server DIRECTLY (bypass OHS):
     curl -u admin:*** http://localhost:8300/HyperionPlanning/rest/11.1.2.4/applications
   - 200/JSON  -> problem is the OHS proxy route (fix mod_wl_ohs.conf)
   - 500       -> problem is Planning backend; continue below
2. grep the ECID in OHS access_log to confirm URL + 500
3. WLST: displayLogs(ecid='00jhRSZ9...0000B4', target='Planning0')
   (or EM: View Related Messages -> by ECID)
4. Open Planning_ADF.log / HyperionPlanning.log at that ECID -> read the stack trace
5. Match the root exception:
     JDBC/SQLException      -> Planning repository datasource down / bad creds
     CSS / cssUser / token  -> Shared Services / Foundation down or registry misconfig
     app not registered     -> re-register Planning app in Shared Services
6. Verify Foundation/Shared Services is up and the Planning RDBMS datasource is healthy
7. Validate EPM Registry:  epmsys_registry.bat view
```

## Note for this repo

- The `/jobs` WADL confirms on-prem `executeJob` expects **`application/x-www-form-urlencoded`** (`jobType`, `jobName`, `parameters`), not the Cloud-style JSON body. `packages/epm-core-client/src/client.ts` currently assumes the v3 JSON shape and will need a form-urlencoded path for on-prem once the server is healthy.
- `EPM_API_VERSION` is set to `11.1.2.4` (legacy on-prem form); Oracle's canonical docs use `v3`. **Resolved 2026-07-21:** this server serves `11.1.2.4` (and `v1`) and returns **404** for `v3`/`v2`, so `11.1.2.4` is correct for this target — see the diagnostic-run update above.
- Consider extending `scripts/test_onprem_planning_connection.py` to probe port 8300 in addition to 19000.

## Workaround implemented — read via Essbase REST (2026-07-21)

While Planning REST is down, the **Essbase REST v1 API on the same host/port is healthy** and reaches the same CORPRPT data (Planning apps are Essbase-backed). Verified live against `10.10.10.20:19000`:

- `GET /essbase/rest/v1/applications` → 200 (`CORPRPT`, `Demo`, `Vision`)
- `POST /essbase/rest/v1/applications/CORPRPT/databases/CORPRPT/mdx` with the proven MDX → 200, `TotalDivisions × TotalNetPricing = 23,971,333.37`
- `GET .../applications/CORPRPT/variables` and `.../databases/CORPRPT/variables` → 200 (substitution variables)

So `EpmClient` now routes on-prem `listApplications`, `getSubstitutionVariables`, and `exportDataSlice` through Essbase REST (`essbaseMdxSlice` + `parseEssbaseMdxGrid`), not Planning REST. Gotcha: the MDX endpoint replies as `application/octet-stream` and **406s on `Accept: application/json`** — the client sends `Accept: */*`. `listJobDefinitions`/`executeJob` still target Planning REST and remain blocked until the server-side fix above lands.
