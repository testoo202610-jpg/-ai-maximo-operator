# Validation evidence — 2026-10-15

All maintenance data and external records in these checks are fictitious local simulator data. **No live SBGMax connectivity, permissions, schema, write behavior or production operation was verified.**

## Results

| Check                                | Actual result                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run db:migrate`                 | Passed; all five migrations applied, including persistent job leases, confirmed color metadata and per-connection execution locking                          |
| `npm run db:seed`                    | Passed; repeatable seeds preserve existing authoritative record changes                                                                                      |
| `npm run typecheck`                  | Passed                                                                                                                                                       |
| `npm run lint`                       | Passed                                                                                                                                                       |
| `npm test`                           | **48 passed** in four files (19 integration, 14 scheduler, 11 command/domain/security, 4 dataset isolation tests)                                            |
| `npm run build`                      | Passed; Vite production assets emitted. Zod's third-party PURE annotation notices do not fail the build                                                      |
| `npm run test:e2e`                   | **6 passed** using real Chromium against the real local simulator server                                                                                     |
| Python CP-SAT unit check             | **1 passed**                                                                                                                                                 |
| Node → running Python CP-SAT service | Passed; `OR-Tools CP-SAT (OPTIMAL)`, **10 scheduled**, **2 unscheduled**, independently validated; unrelated corrective WO excluded from a PM-linked request |

The fallback and CP-SAT are separate planning implementations. Optimization availability is optional, while Node constraint validation is mandatory for either result.

## Browser scenarios actually executed

1. Sign in through the operator UI → Arabic instruction retrieves PM records → Arabic scheduling instruction creates a color-separated WO plan → inspect the calendar → submit exact changes → a supervisor selects and approves two records → Playwright finds each simulator record, fills the visible scheduling form and clicks Save → runner reopens each persisted record → both steps become `VERIFIED` → download report and inspect audit chain. Unselected records remain unchanged. RTL/LTR switching and a 390px layout are checked.
2. Browser record/site mismatch, ambiguous save (HTTP 503 after actual persistence) and authoritative read-back, followed by expired authenticated browser state. No mocked Playwright calls are used.
3. REST adapter authentication, filtered read, conditional simulator update, read-back and rejection of a stale revision.
4. Viewer planning denial and cross-origin mutation denial by backend middleware.
5. A distinct PM next-due proposal → exact approval → browser execution → verified next-due value, unchanged frequency and no WO scheduling fields modified.
6. A successful fresh synchronization removes cached work orders and labor that are no longer returned by the authoritative source.

[simulation-execution-report.json](simulation-execution-report.json) was generated from the first completed browser job in this run. It records two actual `VERIFIED` simulator changes and `liveVerified: false`; it is not a handcrafted example or a live Maximo report.

## Failure and policy checks

The Node suite covers Arabic numerals and commands, follow-up color context, strict tool/field allowlists, separate PM and WO operations, unknown PM behavior, invalid identifiers and cross-site mismatches, duration precedence, shift boundaries, Riyadh calendar dates, skills/availability/material constraints, holidays/site restrictions, explicit hard time windows, unknown colors, color-day separation, resource overlaps, immutable subset approval hashes, expiry/cancellation, stale original values and revisions, duplicate queue requests, partial batches and locks, interrupted-save recovery, uncertain read-back, emergency stop, lost execution leases, serialized jobs, revoked executor privileges, read-only/production flags, nested secret redaction audit tamper detection, and simulation/live/cross-deployment data isolation.

## Unverified boundaries

- Actual SBGMax/IBM Maximo integration: none.
- External LLM provider: not exercised; deterministic interpretation is the tested default.
- Docker/Compose: configuration prepared; image build/runtime not exercised.
- Cloudflare: migration/deployment design only.
- Enterprise SSO/IAM, corporate VPN, secure browser sandbox deployment and HA: require enterprise setup.
- PM generation consequences are a simulator rule preview. The application does not generate WOs or implement the full IBM PM forecast/frequency engine.

Packaged app smoke: production assets served successfully; `/api/health` returned 200, authentication succeeded, and Arabic RTL navigation worked at 390px without horizontal overflow. `npm audit --omit=dev --audit-level=high` returned **0 vulnerabilities**. A live-mode configuration bootstrap using an intentionally invalid test hostname created zero maintenance/labor records and attempted no external connection; this is a configuration-isolation test, not live integration verification.

After consolidating the fresh read-back tool, the main browser scenario was rerun with an explicit authoritative re-verification assertion and passed. One extra cold-start repeat failed during the initial read before any proposal or write; the following repeat passed. Its cause was not established. Unexpected browser read errors now emit a redacted server diagnostic and fail closed; recurrent startup failures require investigation in the target runner environment.
