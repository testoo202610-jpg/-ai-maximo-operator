import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { config } from "../../packages/shared/config.ts";
import {
  Identity,
  ScheduleValues,
  AppError,
} from "../../packages/domain/index.ts";
import {
  seedSimulator,
  simDb,
  simRead,
  simSearch,
  simUpdate,
} from "./store.ts";
import { labor } from "../../packages/shared/seed.ts";
seedSimulator();
const app = new Hono();
app.onError((e, c) =>
  c.json({ error: e.message }, e instanceof AppError ? (e.status as 400) : 400),
);
app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "no-store");
  c.header("X-Frame-Options", "DENY");
  if (
    c.req.method === "POST" &&
    c.req.header("origin") &&
    c.req.header("origin") !== new URL(config.SIMULATOR_BASE_URL).origin
  )
    return c.json({ error: "Invalid origin" }, 403);
  await next();
});
app.get("/health", (c) =>
  c.json({ service: "maximo-simulator", fictitious: true }),
);
app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  if (body.username !== "sim-operator" || body.password !== "simulation-only")
    return c.html(
      page('<p role="alert">Invalid simulation credentials</p>' + loginForm),
      401,
    );
  const id = randomBytes(32).toString("hex");
  simDb
    .prepare("INSERT INTO sim_sessions VALUES (?,?,?)")
    .run(
      id,
      Date.now() + 3600_000,
      body.role === "viewer" ? "viewer" : "editor",
    );
  setCookie(c, "sim_session", id, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: 3600,
  });
  return c.redirect("/");
});
const loginForm =
  '<form method="post" action="/login"><label>Username<input name="username" value="sim-operator" autocomplete="username"></label><label>Password<input name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form><p>Fictitious local system · sim-operator / simulation-only</p>';
app.get("/login", (c) => c.html(page(loginForm)));
app.use("*", async (c, next) => {
  const id = getCookie(c, "sim_session");
  const session = id
    ? simDb
        .prepare("SELECT * FROM sim_sessions WHERE id=? AND expires>?")
        .get(id, Date.now())
    : null;
  if (!session)
    return c.req.path.startsWith("/api")
      ? c.json({ error: "Session expired" }, 401)
      : c.redirect("/login");
  c.set("role" as never, session.role as never);
  await next();
});
app.get("/api/capabilities", (c) =>
  c.json({
    resources: {
      WO: "/api/records/WO",
      PM: "/api/records/PM",
      labor: "/api/labor",
    },
    editableWO: ["scheduledStart", "scheduledFinish", "laborId"],
    editablePM: ["nextDue"],
    conditional: true,
  }),
);
app.get("/api/labor", (c) => c.json(labor));
app.get("/api/records/:type", (c) =>
  c.json(simSearch(c.req.param("type"), c.req.query())),
);
app.get("/api/record/:type/:site/:id", (c) =>
  c.json(
    simRead(
      Identity.parse({
        type: c.req.param("type"),
        siteId: c.req.param("site"),
        id: c.req.param("id"),
      }),
    ),
  ),
);
app.post("/api/record/:type/:site/:id", async (c) => {
  if (c.get("role" as never) === "viewer")
    return c.json({ error: "Read only simulator role" }, 403);
  const body = z
    .object({ revision: z.string(), values: ScheduleValues })
    .strict()
    .parse(await c.req.json());
  const result = simUpdate(
    Identity.parse({
      type: c.req.param("type"),
      siteId: c.req.param("site"),
      id: c.req.param("id"),
    }),
    body.values,
    body.revision,
  );
  if (result.ambiguous)
    return c.json(
      {
        error:
          "Connection interrupted after persistence; read back before retry",
      },
      503,
    );
  return c.json(result.record);
});
app.get("/", (c) =>
  c.html(
    page(
      `<h2>Work Order Tracking / Preventive Maintenance</h2><label>Module<select id="module"><option value="WO">Work Orders</option><option value="PM">Preventive Maintenance</option></select></label><label>Site<input id="site" placeholder="HARAM or NORTH"></label><label>Record identifier<input id="query"></label><button id="search">Search</button><div id="records"></div><section id="editor" hidden><h2 id="record-title"></h2><pre id="record-data"></pre><label>Scheduled start<input id="scheduledStart"></label><label>Scheduled finish<input id="scheduledFinish"></label><label>Labor assignment<input id="laborId"></label><label>Next due date<input id="nextDue"></label><button id="save">Save record</button><p id="save-status" role="status"></p></section><script src="/sim.js"></script>`,
    ),
  ),
);
app.get("/sim.js", (c) =>
  c.body(
    `let current;let searchSeq=0;const $=id=>document.getElementById(id);async function request(url,opts){const r=await fetch(url,opts);if(r.status===401){location.href='/login';throw Error('Session expired')}const data=await r.json();if(!r.ok)throw Error(data.error);return data}async function search(){const seq=++searchSeq;const key={type:$('module').value,site:$('site').value,id:$('query').value};const rows=await request('/api/records/'+key.type+'?q='+encodeURIComponent(key.id)+'&siteId='+encodeURIComponent(key.site));if(seq!==searchSeq)return;$('records').replaceChildren();$('records').dataset.searchKey=JSON.stringify(key);for(const r of rows){const b=document.createElement('button');b.textContent=r.id+' · '+r.siteId+' · '+r.description;b.dataset.record=r.id;b.onclick=()=>open(r);$('records').append(b)}}async function open(r){current=await request('/api/record/'+r.type+'/'+r.siteId+'/'+r.id);$('editor').hidden=false;$('record-title').textContent=current.id+' / '+current.siteId;$('record-data').textContent=JSON.stringify(current,null,2);for(const f of ['scheduledStart','scheduledFinish','laborId','nextDue']){$(f).value=current[f]||'';$(f).disabled=current.type==='PM'?f!=='nextDue':f==='nextDue'}$('save-status').textContent=''}$('search').onclick=()=>search().catch(e=>$('records').textContent=e.message);$('save').onclick=async()=>{try{const values={};for(const f of current.type==='WO'?['scheduledStart','scheduledFinish','laborId']:['nextDue'])values[f]=$(f).value||null;const r=await request('/api/record/'+current.type+'/'+current.siteId+'/'+current.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:current.revision,values})});await open(r);$('save-status').textContent='Saved and reloaded revision '+r.revision}catch(e){$('save-status').textContent='Save error: '+e.message}};search();`,
    200,
    { "Content-Type": "application/javascript" },
  ),
);
function page(content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local Maximo Simulator</title><style>body{font:15px system-ui;margin:30px;background:#f1f5f9;color:#142633}header{background:#163d47;color:white;padding:20px;margin-bottom:24px}label{display:inline-grid;gap:8px;margin:12px}input,select,button{font:inherit;padding:10px;border:1px solid #abc;border-radius:6px}button{cursor:pointer;background:white}#records{display:grid;gap:6px;margin:20px 0}#editor{background:white;padding:20px}pre{white-space:pre-wrap}a{color:inherit}</style></head><body><header><h1>SBGMax · Local simulator</h1><p>Fictitious data · No connection to IBM or SBGMax</p></header>${content}</body></html>`;
}
serve({ fetch: app.fetch, port: config.SIMULATOR_PORT, hostname: config.HOST });
console.log(`Simulator: ${config.SIMULATOR_BASE_URL}`);
