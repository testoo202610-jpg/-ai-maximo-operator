# Security and operating boundaries

Default execution targets the local simulator. No real credentials are included. Simulation credentials identify demonstration accounts only. Binding defaults to loopback; do not expose demo services to an untrusted network.

## Enforced controls

- Server-side RBAC for read, plan, approve, execute and settings; HTTP-only SameSite=Strict sessions with cryptographically random tokens, SHA-256 token storage and expiry. Authentication/authorization does not trust request-supplied role headers.
- Strict, site-aware identifiers and writable field schemas. WO fields: scheduled start, scheduled finish, labor assignment. PM fields: next due only, simulation only, and only when behavior is known. No generic SQL, shell, arbitrary URL, browser evaluation or administrative tool.
- Production flag off by default. Live read-only cannot write. Server configuration, connector capability, conditional update support, executor permission, approver permission, approval expiry and exact field values are checked before execution. Live PM and generic live-browser writes are blocked.
- Approval snapshots bind the exact selected changes. Authoritative revisions and original values are re-read. Strong ETags are required for live REST conditional saves; weak/missing tokens are denied. Browser simulator saves carry revision checks at the authoritative store.
- Persistent unique approval/job IDs, job leases, step attempts, no blind retry and explicit `UNCERTAIN` reconciliation. Cooperative emergency stop prevents remaining writes.
- Origin validation for mutations, JSON-only API mutations, stream-enforced body-size limit, process-local rate limiting, content-security headers in production, React text escaping and simulator textContent rendering.
- Browser operations only use configured selectors on the configured origin. Unknown or ambiguous selectors fail. External navigation is blocked by the runtime connector. Interactive SSO/MFA bootstrap occurs in a human-operated browser; no bypass is implemented.
- Secrets are environment variables or private external browser state, absent from database connection rows and ordinary logs. Audit recursively redacts credential keys and common credential strings. `.env`, data, cookies, screenshots and traces are ignored by Git.
- Audit events include previous and current hashes. The chain detects ordinary tampering but is not an externally anchored immutable ledger; a database administrator could rewrite the complete chain.

## Before enterprise deployment

Replace demo shared-password authentication with corporate SSO and individually attributable users; provision least-privilege roles and sessions. Set secure cookies behind HTTPS and configure the exact allowed origin. Restrict the runner and simulator by network policy. Configure encryption at rest, secret vault integration, backups, incident handling and audited retention. Use a dedicated OS identity, protected browser profile directory and enterprise-managed Chromium. Browser `--no-sandbox` is used for local/container compatibility; production must provide a supported isolated browser sandbox/environment.

The optional LLM is off by default. Enabling it requires `AI_EXTERNAL_DATA_ALLOWED=true`, an enterprise-approved provider and policy review. Only the explicit operator instruction/context is submitted; synchronized records are not automatically attached. Model tool output is untrusted and passes Zod plus normal RBAC/approval/execution checks. Record text cannot approve or execute changes.

The current rate limiter is process-local, demo users share one configured password, sessions have fixed lifetime without rotation, and no distributed rate-limit/session service is included. These are local-MVP boundaries, not a full enterprise IAM/WAF substitute. Never expose the simulator login or real browser state publicly. Disable browser trace/video and retain screenshots only for explicitly fictitious fixtures.

Report issues through your organization's approved process. No external messages are automatically sent.

Database bindings prevent simulation/live or cross-deployment cache reuse. Live bootstrap does not seed fictitious technicians, work orders or PMs; project sites start as `UNMAPPED`. Successful authoritative synchronization removes records/resources outside the latest returned snapshot. These boundaries also keep old simulator approvals from being executed as live changes.
