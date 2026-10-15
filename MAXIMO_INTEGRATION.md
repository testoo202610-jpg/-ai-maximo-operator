# Authorized SBGMax onboarding

**Current status: local simulator verified only. No real SBGMax version, schema, permission, API or browser selector has been verified.** IBM Maximo terminology in this project is not a compatibility certification.

## Required information and authorization

1. An administrator-approved non-production URL, network/VPN route, deployment version and the exact authorized sites/projects. Project identifiers 1610–1613 must be mapped to actual SITEIDs; seeded HARAM/NORTH names are fictitious.
2. A least-privilege read identity and approved authentication mechanism: API key, bearer credential, or human SSO/MFA browser state. Do not create/revoke API keys automatically.
3. Actual REST/OSLC documentation, object structures, schema/discovery URLs, field names, collection/pagination shape, record URLs, identity and revision semantics, permitted filters, and scheduling field editability.
4. Confirmed labor skills, shift coverage, availability, calendar exceptions, material readiness, asset/location mappings, approved job-plan durations and color metadata provenance.
5. A reviewed UI mapping if API support is incomplete. The generic browser reader requires a reliable structured JSON extraction mapping; arbitrary customized Maximo table parsing requires a deployment-specific adapter implementation.
6. Administrator authorization for bounded non-production conditional-update tests. Document ETag behavior, locks, validation responses, exact timestamp roundtrips, conflict behavior and post-save verification. No live write test is authorized merely by setting a URL.

Start with `MAXIMO_MODE=live-readonly`, `MAXIMO_READ_ONLY=true`, and `MAXIMO_PRODUCTION_WRITE_ENABLED=false`. Live startup requires a strong `OPERATOR_PASSWORD`; use corporate IAM before shared rollout. Live base URLs must use HTTPS. Run the runner only inside the authorized network.

## REST mapping

Use `MAXIMO_CONNECTOR_MODE=rest`, `MAXIMO_BASE_URL`, `MAXIMO_AUTH_MODE=apikey|bearer`, `MAXIMO_API_KEY`, `MAXIMO_SITE_IDS` and a private `MAXIMO_MAPPING_FILE`. No standard object structure name is assumed. Example configuration shape (all paths and fields below are placeholders):

```json
{
  "rest": {
    "discoveryPath": "/ADMIN-CONFIRMED-DISCOVERY-PATH",
    "resources": {
      "WO": {
        "list": "/CONFIRMED-WO-COLLECTION?approved-bounded-query",
        "record": "/CONFIRMED-WO-RESOURCE/{site}/{id}",
        "collectionKey": "member",
        "nextKey": "responseInfo.nextPage.href",
        "fields": {
          "id": "CONFIRMED_WONUM",
          "siteId": "CONFIRMED_SITEID",
          "revision": "CONFIRMED_REVISION",
          "description": "CONFIRMED_DESCRIPTION",
          "project": "CONFIRMED_PROJECT",
          "building": "CONFIRMED_BUILDING",
          "location": "CONFIRMED_LOCATION",
          "asset": "CONFIRMED_ASSET",
          "status": "CONFIRMED_STATUS",
          "priority": "CONFIRMED_PRIORITY",
          "duration": "CONFIRMED_APPROVED_DURATION_MINUTES",
          "skill": "CONFIRMED_SKILL",
          "color": "CONFIRMED_COLOR",
          "materialsReady": "CONFIRMED_MATERIALS_READY",
          "due": "CONFIRMED_DUE",
          "scheduledStart": "CONFIRMED_START",
          "scheduledFinish": "CONFIRMED_FINISH",
          "laborId": "CONFIRMED_LABOR",
          "pmId": "CONFIRMED_PM_REFERENCE",
          "nextDue": "CONFIRMED_UNUSED_NULL"
        }
      },
      "PM": {
        "list": "/CONFIRMED-PM-COLLECTION",
        "record": "/CONFIRMED-PM/{site}/{id}",
        "collectionKey": "member",
        "nextKey": "responseInfo.nextPage.href",
        "fields": {
          "id": "CONFIRMED_PMNUM",
          "siteId": "CONFIRMED_SITEID",
          "revision": "CONFIRMED_REVISION"
        }
      }
    },
    "laborPath": "/CONFIRMED-LABOR-ARRAY",
    "laborFields": {
      "id": "CONFIRMED_LABORCODE",
      "name": "CONFIRMED_NAME",
      "skills": "CONFIRMED_SKILLS_ARRAY",
      "siteIds": "CONFIRMED_SITES_ARRAY",
      "shifts": "CONFIRMED_SHIFTS_ARRAY",
      "unavailableDates": "CONFIRMED_UNAVAILABLE_DATES"
    },
    "writeEvidence": {
      "verifiedInAuthorizedTest": false,
      "writableFields": [],
      "conditionalETag": false
    }
  }
}
```

Complete all normalized domain fields for both resources using actual schemas. Mapping transforms complex Maximo relationships, durations/units, authentication challenges and status synonyms may need deployment-specific code; the template is not a ready SBGMax configuration. The reader follows same-origin pagination with loop/page/record limits and locally filters normalized records. Configure bounded server queries in list URLs to avoid downloading an entire enterprise dataset. Automatic schema interpretation, negotiated authentication and universal OSLC where-clause generation are not claimed.

Discovery fetches the configured documentation endpoint and authenticates read access; configured resource and field mappings still require an administrator's inspection. A supplied write-evidence flag is **administrator attestation**, not automatic test certification. It must remain false until tests actually pass. Live updates require a strong ETag/If-Match and supported PATCH behavior. Deployments requiring a different Maximo method/header protocol need an adapter extension and tests before write enablement.

## Browser mapping and interactive authentication

Set `MAXIMO_CONNECTOR_MODE=browser`, a private `MAXIMO_BROWSER_STATE` path and a verified `browser` mapping. On an authorized workstation with a display, run `npm run browser:login`, complete SSO/MFA manually, then press Enter. State is saved with restrictive filesystem permissions. The runtime never bypasses MFA/CAPTCHA. Expired state blocks operations and must be renewed interactively.

```json
{
  "browser": {
    "module": "VERIFIED_SELECT",
    "site": "VERIFIED_SITE_INPUT",
    "query": "VERIFIED_RECORD_SEARCH",
    "search": "VERIFIED_SEARCH_BUTTON",
    "recordButton": "VERIFIED_RECORD_BUTTON_{id}",
    "recordData": "VERIFIED_STRUCTURED_RECORD_JSON",
    "listData": "VERIFIED_STRUCTURED_LIST_JSON",
    "laborData": "VERIFIED_STRUCTURED_LABOR_JSON",
    "save": "VERIFIED_SAVE_BUTTON",
    "saveStatus": "VERIFIED_STATUS_ELEMENT",
    "fields": {
      "scheduledStart": "VERIFIED_START",
      "scheduledFinish": "VERIFIED_FINISH",
      "laborId": "VERIFIED_LABOR"
    }
  }
}
```

Every required control must be unique. Unknown/ambiguous mappings stop; no coordinate guessing or arbitrary browser commands are exposed. The simulator implements these controls and real browser E2E proves its browser connector. **Generic live browser writes remain blocked**, because simulator conditional-save behavior is not evidence of an atomic conditional save in a customized deployment.

## Controlled pilot

First compare read results with the authorized test UI. Verify identities and revisions, writable fields and business validation. Run bounded test-environment changes with before/after snapshots and read-back reconciliation. Record permission denial, lock, concurrency and timeout tests. Only after administrator and business approval should a limited production WO REST pilot set `MAXIMO_MODE=live-approved`, `MAXIMO_READ_ONLY=false`, `MAXIMO_PRODUCTION_WRITE_ENABLED=true` and validated mapping evidence. Each exact record/value batch still needs human approval.

PM due-date writes remain disabled in **all live modes** regardless of these flags. A future release needs verified frequency/forecast/extended-date/hierarchy behavior plus a separate high-risk role and approval policy. Never conflate WO rescheduling with PM next due or frequency.

Optional canonical record mappings include `earliestStart`, `latestFinish`, `targetStart`, and `targetFinish`. Confirm which dates are hard restrictions with the maintenance planner; do not reinterpret target dates as hard deadlines without that policy. `targetFinish` contributes to the due-date objective; `targetStart` is inspection data in this MVP. Simulated atomic labor-overlap checks do not prove equivalent Maximo-wide resource reservation behavior.

Use a **new, separate `DATABASE_URL` for live onboarding**. The application binds each database to its operating family (simulation/live) and configured deployment URL. It refuses to open simulator data in a live mode, live data in simulation, or data belonging to another endpoint. Live defaults include unmapped project sites and zero labor/maintenance records; only an authorized successful synchronization populates them. Successful synchronization replaces the current record snapshot and removes resources no longer returned by the authorized connector.
