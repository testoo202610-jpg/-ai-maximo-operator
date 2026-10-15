# Deployment preparation

## Local installation

Follow README. Development binds loopback. `npm run build` produces `dist/`; `APP_ORIGIN=http://127.0.0.1:3001 npm start` serves the packaged UI and API on port 3001 with local simulator and runner children. Keep SQLite and browser state on protected persistent volumes. Do not put credentials into image layers.

## Optional containers

`docker compose up --build` defines independent API, runner, simulator and OR-Tools services. It exposes UI/API at `http://127.0.0.1:3001` and the simulator at `http://127.0.0.1:3002`; all data is fictitious. The Node image installs Playwright Chromium; a separate optimizer image installs Python dependencies. Compose is prepared but was not built or exercised in this session. Apply your managed environment's proxy/CA requirements and approved image registry policy before building.

The API and runner share an operator-data volume; simulator data is separate. Startup migration/seeding is repeatable. Startup dependencies and health checks prevent the worker from writing before the simulator is ready. The API queues jobs only; one runner claims each persistent lease. Run a small number of local workers with SQLite; use an enterprise database/queue before distributed scaling.

## Enterprise deployment

- Keep browser execution inside the authorized SBGMax network and use a protected, attributable least-privilege session. Host the operator behind TLS and corporate identity. Do not publish the simulator or authenticated profile.
- Run API and runner as managed services with persistent storage, health monitoring, graceful termination and backups. Restore-test the operator database, simulator/test data separately and preserve audit chain continuity.
- Provision environment secrets using an approved vault. `MAXIMO_PRODUCTION_WRITE_ENABLED` remains false during discovery and read verification. No production deployment is triggered by this repository.
- Follow the non-production onboarding and pilot gates in MAXIMO_INTEGRATION.md. Generic live browser and all live PM writes remain blocked.

## Optional Cloudflare design

The built React UI may be hosted as static assets in Cloudflare Pages/Workers after configuring a same-origin approved API gateway, TLS, identity and secure cookies. It contains no embedded credentials. The current API uses synchronous Node SQLite and Playwright, so **it cannot be deployed unchanged to Workers**.

A D1 migration requires a new asynchronous database interface, replacing local sessions/job SQL with approved remote identity and queue orchestration, and moving persistent job leasing to an appropriate server/queue design. Preserve approval snapshots, authoritative read-back and server-side policy in that migration. The browser runner must stay inside the enterprise network; expose a narrow authenticated job protocol, not arbitrary browser commands. No Cloudflare deployment has been performed.

## GitHub

The GitHub repository is https://github.com/testoo202610-jpg/-ai-maximo-operator. The implementation is uploaded on `feat/ai-maximo-operator` for review against `main`; do not auto-merge or deploy to production. The repository was created by its owner with public visibility. No credentials, browser state, SQLite data or company maintenance records are included. The CI workflow checks types, lint, unit/integration tests, build, Python CP-SAT and browser E2E using fictitious data only. Local validation evidence is in `docs/VALIDATION.md`; GitHub Actions results are independent and must be inspected after upload.
