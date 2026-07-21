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
import sys
import json

# --- Configuration: fill these in ---
PLANNING_SERVER = "your-planning-server.client.local"  # hostname or IP, no protocol
PLANNING_PORT = 8300  # common default for on-prem Planning web app; confirm with client
USE_HTTPS = False  # set True if they've configured SSL termination
APP_NAME = "YourAppName"  # the Planning application name to test against
USERNAME = "domain.username"  # native/LDAP user, e.g. "Native Directory.jsmith"
PASSWORD = "changeme"

API_VERSION = "11.1.2.4"


def base_url() -> str:
    scheme = "https" if USE_HTTPS else "http"
    return f"{scheme}://{PLANNING_SERVER}:{PLANNING_PORT}/HyperionPlanning/rest"


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


if __name__ == "__main__":
    print("=" * 70)
    print("On-Prem Oracle Planning 11.1.2.4 REST API Connectivity Test")
    print("=" * 70)

    if PLANNING_SERVER.startswith("your-"):
        print("\n!! Edit the CONFIGURATION section at the top of this script first.")
        sys.exit(1)

    ok1 = test_api_discovery()
    if not ok1:
        print("\nStopping - fix network/host/port issues before testing auth.")
        sys.exit(1)

    ok2 = test_authenticated_call()
    if ok2:
        test_dimensions_list()

    print("\nDone.")
