# API Mapping — Oracle EPM REST → MCP tools

| Document | |
| --- | --- |
| **Version** | 0.3.1 |
| **Date** | 2026-07-16 |
| **Author** | Henry (agent) for Ioannis Vossos |
| **Status** | Draft — mock-first scaffold |
| **Owner** | Ioannis Vossos |

## Change log

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 0.1.0 | 2026-07-12 | Henry | Initial P0 mapping (core, planning, fccs) |
| 0.2.0 | 2026-07-12 | Henry | P1 packs (data-integration-watchtower, metadata-governance) |
| 0.3.0 | 2026-07-12 | Henry | P2 packs (security-audit, epm-automate-wrapper) |
| 0.3.1 | 2026-07-16 | Claude | Corrected against Oracle docs: fixed `epm_ping` path (no `/version` suffix), noted `di_pov_lock_status` uses a different base path (`/aif/rest/V1/`), fixed EPM Automate source link |

---

Mapping between implemented MCP tools and the Oracle Cloud EPM REST surface.
Live-mode transport is not yet implemented; the client throws a clear
`liveNotImplemented` error outside mock mode.

## oracle-epm-core

| MCP tool | Oracle REST | Mutating |
| --- | --- | --- |
| `epm_config` | (local) | no |
| `epm_ping` | `GET /interop/rest/{v}` | no |
| `epm_list_applications` | Planning `GET /HyperionPlanning/rest/{v}/applications` | no |
| `epm_list_job_definitions` | `GET .../jobdefinitions` | no |
| `epm_get_job_status` | `GET .../jobs/{jobId}` | no |
| `epm_execute_job` | `POST .../jobs` | **YES** |

## planning-ops

| MCP tool | Oracle REST | Mutating |
| --- | --- | --- |
| `planning_export_data_slice` | Export Data REST (`exportdataslice`) | no |
| `planning_variance_snapshot` | derived from export slice | no |
| `planning_get_substitution_variables` | `GET .../substitutionvariables` | no |

## fccs-close

| MCP tool | Oracle REST | Mutating |
| --- | --- | --- |
| `fccs_close_readiness_report` | aggregate (validate + journals + IC) | no |
| `fccs_validate_metadata` | FCCS Validate Metadata job | no |
| `fccs_retrieve_journals` | FCCS Journals REST | no |
| `fccs_intercompany_matching_report` | IC Matching report REST | no |

## data-integration-watchtower

| MCP tool | Oracle REST | Mutating |
| --- | --- | --- |
| `di_schedule_inventory` | Data Integration pipelines + integrations | no |
| `di_list_pipelines` | `GET .../pipelines` | no |
| `di_get_job_status` | Data Integration job status | no |
| `di_failed_load_summary` | derived from job status | no |
| `di_diagnose_failures` | job status + POV locks | no |
| `di_export_mapping` | mapping export | no |
| `di_pov_lock_status` | POV lock status (`GET /aif/rest/V1/POV`, note: different base path from `/HyperionPlanning/rest/v3/`) | no |

## metadata-governance

| MCP tool | Oracle REST | Mutating |
| --- | --- | --- |
| `metadata_export_snapshot` | metadata export | no |
| `metadata_compare_snapshots` | derived (two snapshots) | no |
| `metadata_find_risks` | derived (outline scan) | no |
| `metadata_member_impact_analysis` | derived (outline scan) | no |

## security-audit

| MCP tool | Oracle REST | Mutating |
| --- | --- | --- |
| `security_role_assignment_report` | Access Control role assignments | no |
| `security_user_access_report` | user list + login/MFA | no |
| `security_invalid_login_report` | audit / login records | no |
| `security_group_assignment_audit` | Access Control groups | no |
| `security_compare_access_snapshots` | derived (two snapshots) | no |

## epm-automate-wrapper

Allowlisted only — no arbitrary shell. Mutating commands require an approval packet.

| MCP tool | EPM Automate | Mutating |
| --- | --- | --- |
| `automate_list_commands` | (allowlist) | no |
| `automate_runbook_status` | (local runbook state) | no |
| `automate_run_approved_command` | `downloadSnapshot` / `listFiles` | no |
| `automate_run_approved_command` | `runDailyMaintenance` / `uploadFile` / `replay` | **YES** |

## Primary sources

- Manage Jobs: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/manage_jobs.html
- Export Data: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/export_data.html
- Rules: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/rules.html
- FCCS: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_chapter_intro.html
- Data Integration: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fdmee_rest_apis.html
- EPM Automate: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/cepma/toc.htm
