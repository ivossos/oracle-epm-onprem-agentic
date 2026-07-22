#!/usr/bin/env python3
"""
Connectivity test for Oracle Hyperion Planning ON-PREMISES (11.1.2.4) REST API.

IMPORTANT: This is NOT the same REST surface as Planning Cloud/EPBCS/PBCS.
- Cloud uses: /HyperionPlanning/rest/v3/... with exportdataslice / importdataslice
- On-prem 11.1.2.4 uses: /HyperionPlanning/rest/11.1.2.4/... with dataexport / dataimport
  and form-urlencoded (not JSON) payloads for jobs.

UNCONFIRMED: this API-version assumption has not been verified against a real
on-prem server or Oracle's official docs, and it conflicts with what the rest
of this repo assumes (packages/epm-core-client/src/config.ts defaults
EPM_API_VERSION to "v3" and docs/onprem-setup.md documents the v3 JSON surface
for 11.1.2.4). Confirm which is actually correct for the target patch level
before relying on either — run this script's discovery step first.

Run this FROM INSIDE the client's network (same LAN/VPN as the Planning server),
since this API is typically not exposed to the public internet.

Usage:
    python test_onprem_planning_connection.py
"""

import requests
from requests.auth import HTTPBasicAuth
import socket
import sys
import json

# --- Configuration: fill these in ---
PLANNING_SERVER = "your-planning-server.client.local"  # hostname or IP, no protocol
PLANNING_PORT = 8300  # Planning managed server (direct); confirm with client
USE_HTTPS = False  # set True if they've configured SSL termination
APP_NAME = "YourAppName"  # the Planning application name to test against
USERNAME = "domain.username"  # native/LDAP user, e.g. "Native Directory.jsmith"
PASSWORD = "changeme"

API_VERSION = "11.1.2.4"

# Ports to TCP-probe for reachability before making any REST call. The point is
# to isolate the OHS reverse-proxy front-end from the Planning managed server it
# forwards to: if 19000 is reachable but every GET returns HTTP 500 while 8300 is
# NOT reachable from here, you cannot tell proxy-vs-backend apart from the client
# and must test 8300 on the server itself (see docs/onprem-corprpt-500-issue.md).
PROBE_PORTS = [
    (19000, "OHS / Workspace reverse proxy (front-end)"),
    (8300, "Planning managed server (direct)"),
    (7001, "WebLogic Admin Console"),
]


def base_url() -> str:
    scheme = "https" if USE_HTTPS else "http"
    return f"{scheme}://{PLANNING_SERVER}:{PLANNING_PORT}/HyperionPlanning/rest"


def probe_ports():
    """Step 0: TCP-probe the candidate ports so a 500 later can be attributed to
    the right tier. Reachability of a port only means the TCP socket accepts a
    connection, not that the app behind it is healthy."""
    print(f"[0] Probing TCP reachability of {PLANNING_SERVER} ...")
    for port, role in PROBE_PORTS:
        try:
            with socket.create_connection((PLANNING_SERVER, port), timeout=5):
                print(f"    {port:>5}  OPEN    {role}")
        except OSError as e:
            print(f"    {port:>5}  closed  {role}  ({e.__class__.__name__})")
    print(
        "    -> If 8300 is closed from here, the direct-backend test in\n"
        "       docs/onprem-corprpt-500-issue.md must be run ON the server."
    )


def test_api_discovery():
    """Step 1: unauthenticated GET to /HyperionPlanning/rest — confirms the
    REST endpoint exists at all and tells you which API versions are active."""
    url = base_url()
    print(f"[1] Discovering API versions at: {url}")
    try:
        resp = requests.get(url, timeout=10, verify=False)
        print(f"    Status: {resp.status_code}")
        print(f"    Body: {resp.text[:500]}")
        return resp.status_code == 200
    except requests.exceptions.ConnectionError as e:
        print(f"    CONNECTION FAILED: {e}")
        print("    -> Check: are you on the client's network/VPN? Correct host/port?")
        return False
    except Exception as e:
        print(f"    ERROR: {e}")
        return False


def test_authenticated_call():
    """Step 2: authenticated GET against the applications resource to confirm
    credentials and app name are correct."""
    url = f"{base_url()}/{API_VERSION}/applications/{APP_NAME}"
    print(f"\n[2] Testing authenticated call to: {url}")
    try:
        resp = requests.get(
            url,
            auth=HTTPBasicAuth(USERNAME, PASSWORD),
            headers={"Accept": "application/json"},
            timeout=15,
            verify=False,
        )
        print(f"    Status: {resp.status_code}")
        if resp.status_code == 200:
            print("    SUCCESS - credentials and app name are valid.")
            try:
                print(json.dumps(resp.json(), indent=2)[:1000])
            except ValueError:
                print(resp.text[:1000])
        elif resp.status_code == 401:
            print("    AUTH FAILED - check username format (often 'domain.username') and password.")
        elif resp.status_code == 404:
            print("    NOT FOUND - check APP_NAME and API_VERSION match what discovery returned.")
        else:
            print(f"    Unexpected response: {resp.text[:500]}")
        return resp.status_code == 200
    except Exception as e:
        print(f"    ERROR: {e}")
        return False


def test_dimensions_list():
    """Step 3 (optional): list dimensions for the app, useful smoke test for
    later building out data export/import tools."""
    url = f"{base_url()}/{API_VERSION}/applications/{APP_NAME}/dimensions"
    print(f"\n[3] Listing dimensions: {url}")
    try:
        resp = requests.get(
            url,
            auth=HTTPBasicAuth(USERNAME, PASSWORD),
            headers={"Accept": "application/json"},
            timeout=15,
            verify=False,
        )
        print(f"    Status: {resp.status_code}")
        if resp.status_code == 200:
            print(resp.text[:1000])
        return resp.status_code == 200
    except Exception as e:
        print(f"    ERROR: {e}")
        return False


import re

# Alternate API-version path segments to try. OPTIONS returning 200 on one only
# proves Jersey routing is alive, not that that version's GET handler works.
API_VERSION_VARIANTS = ["v3", "11.1.2.4", "v1", "v2"]

# Username-format variants. A malformed CSS principal can crash token resolution
# and surface as a 500 (not a 401) on the way through the REST handler.
def username_variants():
    base = USERNAME.split(".")[-1].split("\\")[-1]
    return [
        USERNAME,
        base,
        f"Native Directory.{base}",
        f"native directory\\{base}",
    ]

# Sibling REST surfaces on the same web tier. If these behave differently from
# Planning, it isolates the fault (Shared Services/CSS vs. the Planning app/DB).
def sibling_surfaces():
    scheme = "https" if USE_HTTPS else "http"
    root = f"{scheme}://{PLANNING_SERVER}:{PLANNING_PORT}"
    return [
        (f"{root}/interop/rest/11.1.2.4/applicationsnapshots", "Shared Services / LCM"),
        (f"{root}/aif/rest/V1/status", "FDMEE / Data Management"),
        (f"{root}/workspace/index.jsp", "Workspace shell"),
        (f"{root}/HyperionPlanning/faces/PlanningDesktop", "Planning web UI (non-REST)"),
    ]


def extract_diag(text: str) -> str:
    """Pull the useful bits out of an Oracle HTML 500 page: the ECID and any
    Java exception class / message it leaked into the markup."""
    bits = []
    ecid = re.search(r"ECID[:\s\-]*([0-9A-Za-z^]+)", text)
    if ecid:
        bits.append(f"ECID={ecid.group(1)}")
    exc = re.search(r"([\w.]+(?:Exception|Error))(:[^<\n]{0,120})?", text)
    if exc:
        bits.append(f"exception={exc.group(0).strip()[:140]}")
    title = re.search(r"<title>(.*?)</title>", text, re.IGNORECASE | re.DOTALL)
    if title:
        bits.append(f"title={title.group(1).strip()[:80]}")
    return " | ".join(bits) if bits else "(no ECID/exception found in body)"


def _get(url, auth=None, accept="application/json"):
    headers = {"Accept": accept} if accept else {}
    return requests.get(url, auth=auth, headers=headers, timeout=15, verify=False)


def diagnose_500():
    """Deep diagnostic matrix, run when the normal authenticated GET 500s.

    Attacks the four client-side variables most likely to change a 500:
    API-version path, username format, Accept header, and which web-app is
    handling the request. See docs/onprem-corprpt-500-issue.md."""
    scheme = "https" if USE_HTTPS else "http"
    root = f"{scheme}://{PLANNING_SERVER}:{PLANNING_PORT}/HyperionPlanning/rest"
    auth = HTTPBasicAuth(USERNAME, PASSWORD)

    print("\n[D1] API-version variants (GET .../applications):")
    for ver in API_VERSION_VARIANTS:
        url = f"{root}/{ver}/applications"
        try:
            r = _get(url, auth=auth)
            note = extract_diag(r.text) if r.status_code >= 500 else r.text[:120].replace("\n", " ")
            print(f"     {ver:>10} -> {r.status_code}  {note}")
        except Exception as e:
            print(f"     {ver:>10} -> ERROR {e.__class__.__name__}: {e}")

    print("\n[D2] Username formats (GET .../{ver}/applications):")
    for user in username_variants():
        url = f"{root}/{API_VERSION}/applications"
        try:
            r = _get(url, auth=HTTPBasicAuth(user, PASSWORD))
            print(f"     {user!r:>28} -> {r.status_code}  {extract_diag(r.text) if r.status_code >= 500 else ''}")
        except Exception as e:
            print(f"     {user!r:>28} -> ERROR {e.__class__.__name__}: {e}")

    print("\n[D3] Accept-header variants (GET .../applications):")
    for accept in ["application/json", "application/xml", None]:
        url = f"{root}/{API_VERSION}/applications"
        try:
            r = _get(url, auth=auth, accept=accept)
            print(f"     Accept={str(accept):>18} -> {r.status_code}  {extract_diag(r.text) if r.status_code >= 500 else ''}")
        except Exception as e:
            print(f"     Accept={str(accept):>18} -> ERROR {e.__class__.__name__}: {e}")

    print("\n[D4] Sibling web-app surfaces on the same tier:")
    for url, label in sibling_surfaces():
        try:
            r = _get(url, auth=auth, accept=None)
            print(f"     {label:>28} -> {r.status_code}  ({url})")
        except Exception as e:
            print(f"     {label:>28} -> ERROR {e.__class__.__name__} ({url})")

    print(
        "\n     Interpret:\n"
        "       - a version/user/Accept combo that returns 200 -> that's your working shape.\n"
        "       - interop 200 but Planning 500 -> CSS is fine; fault is the Planning app/DB.\n"
        "       - interop ALSO 500 -> Shared Services/CSS or the registry is the problem.\n"
        "       - Planning web UI loads but REST 500s -> app is up; REST datasource/registry path is broken."
    )


if __name__ == "__main__":
    print("=" * 70)
    print("On-Prem Oracle Planning 11.1.2.4 REST API Connectivity Test")
    print("=" * 70)

    if PLANNING_SERVER.startswith("your-"):
        print("\n!! Edit the CONFIGURATION section at the top of this script first.")
        sys.exit(1)

    probe_ports()
    print()

    ok1 = test_api_discovery()
    if not ok1:
        print("\nStopping - fix network/host/port issues before testing auth.")
        sys.exit(1)

    ok2 = test_authenticated_call()
    if ok2:
        test_dimensions_list()
    else:
        # The normal path failed (e.g. the CORPRPT 500). Fan out to isolate it.
        diagnose_500()

    print("\nDone.")
