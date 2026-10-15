# AI Maximo Operator

GitHub source: [testoo202610-jpg/-ai-maximo-operator](https://github.com/testoo202610-jpg/-ai-maximo-operator/tree/feat/ai-maximo-operator). The implementation is on a review branch; production deployment and real SBGMax verification have not been performed.

A runnable, Arabic-first maintenance operator with persistent planning, exact human approvals, browser-driven record updates, read-back verification, and audit reports. The default environment is a **functional local Maximo simulator with fictitious data**, not SBGMax.

**No real SBGMax environment has been connected or verified. Production writes are disabled. Live PM due-date writes are unconditionally blocked.**

## Quick start

Requires Node **24+** (uses built-in SQLite), npm, and Chromium. Python is optional.

```bash
cd /workspace/ai-maximo-operator
npm ci
cp .env.example .env
npx playwright install chromium
npm run db:migrate
npm run db:seed
npm run dev
```

If Chromium is already installed at `/usr/bin/chromium`, the application uses it automatically. Otherwise Playwright uses its installed browser. On Linux, `npx playwright install --with-deps chromium` installs system dependencies when authorized.

Open **http://127.0.0.1:5173**. Login as `supervisor` with password `local-demo`. `planner` can read and plan; `viewer` can only read. These are local demonstration accounts; set `OPERATOR_PASSWORD` for local customization. Live modes refuse startup without a password of at least 16 characters. Enterprise identity integration is required before shared enterprise use.

`npm run dev` applies migrations/seeds and starts four processes: Vite (5173), API (3001), persistent execution runner, and simulator (3002). It does not start external AI or the optional Python optimizer. The simulator is available at **http://127.0.0.1:3002**, with `sim-operator` / `simulation-only`.

## Working demo

1. Sign in and click **Sync Maximo / مزامنة Maximo** on Overview, or let the first chat request synchronize.
2. Open **AI Operator / المشغّل الذكي** and send:
   `ادخل على Maximo واستخرج كل أوامر PM المفتوحة في المطاف.`
3. Send: `جدول كل PM في المطاف لمدة 15 دقيقة، وابدأ الساعة الثامنة صباحًا. كل لون يكون في يوم مختلف.`
4. Open **Review plan**. This schedules existing **WO records linked to PMs**; it does not change PM generation rules. Confirmed colors occupy distinct Riyadh dates; unknown colors and unavailable materials are reported for review. An approved job-plan duration overrides the estimate by default.
5. Inspect the calendar, Gantt, shift, color and workload views. Click a task to adjust its date/labor, or drag it to another date. The server rejects constraint violations, including color splitting.
6. Submit the draft, open **Approval Center**, inspect before/after values, select individual changes or the exact batch, and explicitly approve.
7. Click **Execute approved changes** as a separate action. The runner opens the simulator with Playwright, searches by site and ID, fills scheduling fields, saves and reopens each record.
8. In **Execution Monitor**, wait for `VERIFIED` per record and `COMPLETED`, `PARTIAL`, `FAILED`, `UNCERTAIN` or `STOPPED` for the job. Download the report or reverify the records. Open the simulator to inspect the saved values independently.
9. Search/export Audit History. Emergency stop is cooperative: a save already in progress is reconciled, and remaining records are stopped.

PM due-date changes are a **separate simulation-only workflow** in PM Explorer. Inspect frequency, forecast, hierarchy and the simulated generation behavior first. Proposals go through the same approval pipeline; PM frequency/hierarchy/status cannot be written.

## Optimization

The deterministic fallback is available without Python. To run the actual OR-Tools CP-SAT service:

```bash
python -m venv .venv
.venv/bin/pip install -r services/scheduling-optimizer/requirements.txt
.venv/bin/uvicorn main:app --app-dir services/scheduling-optimizer --host 127.0.0.1 --port 8000
```

Set `OPTIMIZER_URL=http://127.0.0.1:8000` in `.env` and restart the application. CP-SAT uses optional intervals and no-overlap constraints, skill/site/shift/availability windows, holidays, materials, confirmed color-day separation and existing reservations. Its objective rewards priority/due-date coverage and balances workload. Node independently validates solver output. An unavailable service triggers the documented greedy fallback; invalid solver output is rejected. Solver runtime is bounded to eight seconds and can return a feasible rather than optimal solution.

## Commands and checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
.venv/bin/python -m unittest discover -s services/scheduling-optimizer -p 'test_*.py'
```

Stop the development server before E2E tests; Playwright starts its own isolated application on ports 5173/3001/3002 and uses new databases in ignored `data/e2e-*` directories. Browser E2E performs real form edits, not mocked Playwright calls. Test traces/video are disabled to avoid retaining session data. Screenshots are local simulation UI only.

To run the production frontend build locally:

```bash
npm run build
APP_ORIGIN=http://127.0.0.1:3001 npm start
```

Open port 3001. This is local production-mode packaging, **not authorization for SBGMax production writes**. The simulator and worker still run as child processes. Deploy those processes independently in an enterprise installation.

SQLite files persist under `data/`. Seeds are repeatable and do not overwrite changed simulator records. To start a fresh demo, stop all services, back up the desired database files, then use new `DATABASE_URL` and `SIMULATOR_DATABASE_URL` paths.

## Operating modes

| Mode                   | Reads                         | Writes                                                                                                                                                         |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `simulation` (default) | Fictitious simulator          | Explicitly approved WO scheduling and separately proposed PM due dates                                                                                         |
| `live-readonly`        | Mapped, authorized deployment | Blocked server-side                                                                                                                                            |
| `live-approved`        | Mapped, authorized deployment | WO REST updates require all production flags, role checks, approval and documented conditional-write test evidence; generic live browser writes remain blocked |

`MAXIMO_READ_ONLY=true` blocks every write path. `MAXIMO_PRODUCTION_WRITE_ENABLED=false` is the default. No UI control can enable production writes or store API keys.

## Scope and limitations

- The local workflow is implemented. REST and browser adapters share one interface, but **SBGMax schemas, authentication and selectors are unverified**. Follow [MAXIMO_INTEGRATION.md](MAXIMO_INTEGRATION.md).
- The default command interpreter is a deterministic bilingual parser covering the documented examples and explicit ISO dates. It is not unrestricted natural-language intelligence. Ambiguous PM edits or execution instructions ask for exact UI review. An optional OpenAI-compatible typed-tool provider requires explicit external-data permission; it has not been tested against an external model here.
- Default color data and technicians are fictitious. CSV import accepts explicit site-aware mappings with operator confirmation, including PM-to-linked-WO propagation. Excel formatting extraction is not implemented; export confirmed mappings to CSV first.
- Shifts must fit inside a Riyadh calendar day. Split overnight shifts at midnight. No travel-time model, spare-stock inference, Maximo WO generation, or full PM frequency calculation is implemented.
- Auth uses server sessions, three seeded RBAC roles and a server-configured password. Enterprise SSO, distinct user password management, key management, database encryption, HA and regulatory retention controls are deployment work.
- Jobs use SQLite leases and exact approval snapshots. Completed/failed jobs are never blindly retried. `UNCERTAIN` requires read-back and operator investigation; a fresh proposal/approval is needed for further writes.
- Live browser writes remain disabled pending deployment-specific atomic conditional-save validation. Live PM writes remain disabled even if the general production flag is enabled.
- No deletion, WO closure, actual labor/material posting, API-key administration, or PM frequency/hierarchy/status mutations are allowlisted.
- Calendar views show planning dates; the compact Gantt displays daily task bars and start times, not a full dispatch-grade hourly timeline. Chat transcripts are session-local in the UI; tool activity persists in audit history. Audit export currently includes the latest 1,000 events.

See [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [DEPLOYMENT.md](DEPLOYMENT.md), and [docs/VALIDATION.md](docs/VALIDATION.md).

Mapped earliest-start/latest-finish windows are hard constraints. Target finish dates are used as soft due-date objectives; target start is retained for inspection. Independent approved jobs serialize their labor checks using a connection lease. The simulator additionally enforces labor overlap checks atomically at save time.

Live onboarding requires a new database path. A database is bound to simulation/live mode and one configured deployment URL. Live bootstrap has no seeded technicians or maintenance records; map the initially `UNMAPPED` project sites before authorized synchronization.
