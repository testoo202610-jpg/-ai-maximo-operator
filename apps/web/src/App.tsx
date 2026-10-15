import {
  useEffect,
  useState,
  useCallback,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileCheck2,
  Globe2,
  LayoutDashboard,
  ListFilter,
  Loader2,
  LogOut,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  TriangleAlert,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { Button, Card, Badge } from "./components/ui.tsx";
import { api } from "./api.ts";
import {
  recordKey,
  type Plan,
  type RecordData,
  type Change,
  type ScheduleItem,
} from "../../../packages/domain/index.ts";
type Screen =
  | "dashboard"
  | "chat"
  | "wo"
  | "pm"
  | "planner"
  | "approvals"
  | "execution"
  | "audit"
  | "settings";
const date = (v: string | null | undefined, lang = "ar") =>
  v
    ? new Intl.DateTimeFormat(lang === "ar" ? "ar-SA-u-ca-gregory" : "en-GB", {
        timeZone: "Asia/Riyadh",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(v))
    : "—";
const day = (v: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(
    new Date(v),
  );
const today = () => day(new Date().toISOString());
const colors: Record<string, string> = {
  blue: "#478cd9",
  green: "#418b67",
  amber: "#c98e30",
  violet: "#8b6db4",
  red: "#ce5a55",
};
const tone = (s: string) =>
  ["COMPLETED", "VERIFIED", "APPROVED", "ACTIVE", "APPR"].includes(s)
    ? "green"
    : ["FAILED", "CONFLICT", "UNCERTAIN"].includes(s)
      ? "red"
      : ["RUNNING", "QUEUED", "PENDING", "PARTIAL"].includes(s)
        ? "amber"
        : "neutral";
export function App() {
  const [user, setUser] = useState<any>(null),
    [checking, setChecking] = useState(true),
    [lang, setLang] = useState<"ar" | "en">("ar"),
    [screen, setScreen] = useState<Screen>("dashboard"),
    [dashboard, setDashboard] = useState<any>(null),
    [plan, setPlan] = useState<Plan | null>(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [version, setVersion] = useState(0);
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const notify = useCallback((m: string) => setToast(m), []);
  const refresh = useCallback(async () => {
    setDashboard(await api("/dashboard"));
    setVersion((n) => n + 1);
  }, []);
  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    api("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (user) refresh().catch((e) => notify(e.message));
  }, [user, screen, refresh, notify]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(""), 7000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  async function synchronize() {
    setBusy(true);
    try {
      const r = await api("/sync", {});
      notify(
        t(
          `تمت مزامنة ${r.records} سجل`,
          `Synchronized ${r.records} authoritative records`,
        ),
      );
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const shared = {
    lang,
    t,
    notify,
    run,
    version,
    plan,
    setPlan,
    setScreen,
    refresh,
  };
  const nav: [Screen, typeof Activity, string, string][] = [
    ["dashboard", LayoutDashboard, "نظرة عامة", "Overview"],
    ["chat", Sparkles, "المشغّل الذكي", "AI Operator"],
    ["wo", Wrench, "أوامر العمل", "Work orders"],
    ["pm", CalendarDays, "الصيانة الوقائية", "Preventive maintenance"],
    ["planner", CalendarDays, "مخطط الجدولة", "Scheduling planner"],
    ["approvals", FileCheck2, "مركز الموافقات", "Approval center"],
    ["execution", Activity, "مراقبة التنفيذ", "Execution monitor"],
    ["audit", ShieldCheck, "سجل التدقيق", "Audit history"],
    ["settings", Settings2, "الإعدادات", "Settings"],
  ];
  if (checking)
    return (
      <div className="loading">
        <Loader2 className="spin" />
        Loading operator…
      </div>
    );
  if (!user)
    return <Login t={t} onLogin={setUser} notify={notify} toast={toast} />;
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <div className="brand-mark">
            <Activity size={26} />
          </div>
          <div>
            MAXIMO<span>AI OPERATOR</span>
          </div>
        </a>
        <div className="workspace-label">
          {t("مساحة العمليات", "OPERATIONS WORKSPACE")}
        </div>
        <div className="site-select">
          <span className="site-icon">
            <Globe2 size={17} />
          </span>
          <div>
            <strong>SBGMax</strong>
            <small>
              {dashboard?.mode === "simulation"
                ? t("بيئة المحاكاة المحلية", "Local simulation")
                : t("اتصال معتمد", "Authorized connection")}
            </small>
          </div>
          <ChevronDown size={14} />
        </div>
        <nav aria-label={t("التنقل الرئيسي", "Main navigation")}>
          {nav.map(([key, Icon, ar, en], i) => (
            <div key={key}>
              {i === 5 && <div className="nav-divider" />}
              <button
                className={"nav-item " + (screen === key ? "active" : "")}
                aria-label={t(ar, en)}
                title={t(ar, en)}
                onClick={() => setScreen(key)}
              >
                <Icon size={19} />
                <span>{t(ar, en)}</span>
                {key === "approvals" && dashboard?.pendingApprovals > 0 && (
                  <b>{dashboard.pendingApprovals}</b>
                )}
                {screen === key && <span className="nav-dot" />}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="safe-note">
            <ShieldCheck size={20} />
            <div>
              <strong>{t("كل تعديل بموافقتك", "You stay in control")}</strong>
              <small>
                {t("مراجعة ← موافقة ← تحقق", "Review → approve → verify")}
              </small>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role_id}</small>
            </div>
            <button
              aria-label="Sign out"
              onClick={() =>
                run(async () => {
                  await api("/logout", {});
                  setUser(null);
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            {t("مساحة العمل", "Workspace")}
            <span>/</span>
            <strong>
              {nav.find((n) => n[0] === screen)?.[lang === "ar" ? 2 : 3]}
            </strong>
          </div>
          <div className="top-actions">
            <span className="time-label">Asia/Riyadh · UTC+3</span>
            <button
              className="language"
              onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            >
              <Globe2 size={15} />
              {lang === "ar" ? "English" : "العربية"}
            </button>
            <span className="top-avatar">{user.name.slice(0, 1)}</span>
          </div>
        </header>
        <main>
          <div className="environment-banner">
            <div>
              <span className="status-dot amber" />
              <strong>{dashboard?.mode ?? "simulation"}</strong>
              <span>
                {dashboard?.mode === "simulation"
                  ? t(
                      "بيانات تجريبية خيالية · لم يتم التحقق من اتصال SBGMax فعلي",
                      "Fictitious local data · No real SBGMax connection verified",
                    )
                  : t(
                      "بيئة معتمدة · يخضع التنفيذ لسياسات الخادم",
                      "Authorized environment · Server write policies apply",
                    )}
              </span>
            </div>
            <Badge tone="green">
              <ShieldCheck size={12} />
              {dashboard?.productionWriteEnabled &&
              dashboard?.mode === "live-approved" &&
              !dashboard?.readOnly
                ? t(
                    "كتابة الإنتاج تتطلب موافقة",
                    "Production writes require approval",
                  )
                : t("كتابة الإنتاج معطلة", "Production writes disabled")}
            </Badge>
          </div>
          {screen === "dashboard" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MAINTENANCE INTELLIGENCE</div>
                  <h1>
                    {t(
                      "عمليات أكثر وضوحًا. صيانة أكثر كفاءة.",
                      "Clarity for every maintenance operation.",
                    )}
                  </h1>
                  <p>
                    {t(
                      "خطط بثقة، راجع التغييرات، وتأكد من حفظ كل إجراء.",
                      "Plan confidently, review every change, and verify every saved record.",
                    )}
                  </p>
                </div>
                <Button variant="outline" onClick={synchronize} disabled={busy}>
                  <RefreshCw size={16} className={busy ? "spin" : ""} />
                  {t("مزامنة Maximo", "Sync Maximo")}
                </Button>
              </div>
              <div className="metrics">
                {[
                  [
                    Wrench,
                    t("أوامر العمل المفتوحة", "Open work orders"),
                    dashboard?.openWO ?? 0,
                    "teal",
                  ],
                  [
                    CalendarDays,
                    t("PM مستحقة خلال أسبوع", "PM due within 7 days"),
                    dashboard?.pmDue ?? 0,
                    "blue",
                  ],
                  [
                    Clock3,
                    t("أعمال متأخرة", "Overdue work"),
                    dashboard?.overdue ?? 0,
                    "amber",
                  ],
                  [
                    FileCheck2,
                    t("بانتظار الموافقة", "Pending approvals"),
                    dashboard?.pendingApprovals ?? 0,
                    "violet",
                  ],
                ].map(([Icon, label, value, color]: any) => (
                  <Card key={label} className="metric">
                    <span className={"metric-icon " + color}>
                      <Icon size={20} />
                    </span>
                    <span>{label}</span>
                    <div>
                      <strong>{value}</strong>
                      <small>
                        {t("من السجلات المتزامنة", "From synchronized records")}
                      </small>
                    </div>
                  </Card>
                ))}
              </div>
              <div className="dashboard-grid">
                <Card className="operator-feature">
                  <div className="feature-icon">
                    <Sparkles size={25} />
                  </div>
                  <Badge tone="green">
                    {t("مساعد العمليات", "OPERATIONS ASSISTANT")}
                  </Badge>
                  <h2>
                    {t(
                      "من توجيهك… إلى خطة قابلة للتنفيذ",
                      "From your instruction to an executable plan.",
                    )}
                  </h2>
                  <p>
                    {t(
                      "اكتب طلبك بالعربية أو الإنجليزية. سيقرأ المشغّل السجلات، ويقترح جدولًا، ويعرض التعديلات الدقيقة لموافقتك.",
                      "Ask in Arabic or English. The operator reads records, builds a schedule, and presents exact changes for your approval.",
                    )}
                  </p>
                  <button
                    className="prompt-preview"
                    onClick={() => setScreen("chat")}
                  >
                    <MessageSquare size={17} />
                    <span>جدول PM في المطاف، كل لون في يوم مختلف</span>
                    <ArrowLeft size={18} />
                  </button>
                  <Button onClick={() => setScreen("chat")}>
                    {t("ابدأ مع المشغّل الذكي", "Open AI Operator")}
                    <ArrowLeft size={15} />
                  </Button>
                  <div className="feature-footer">
                    <span>
                      <Check size={13} />
                      {t("دعم العربية", "Arabic & English")}
                    </span>
                    <span>
                      <Check size={13} />
                      {t("مراجعة قبل التنفيذ", "Approval required")}
                    </span>
                  </div>
                </Card>
                <Card className="connection-card">
                  <div className="section-title">
                    <h2>{t("حالة الاتصال", "Connection status")}</h2>
                    <span
                      className={
                        "status-dot " +
                        (dashboard?.connection ? "green" : "amber")
                      }
                    />
                  </div>
                  <div className="connection-visual">
                    <Globe2 size={29} />
                    <span />
                    <div className="mini-logo">M</div>
                  </div>
                  <h3>
                    {dashboard?.connection
                      ? t(
                          "نجح آخر تحقق للاتصال",
                          "Last connection check succeeded",
                        )
                      : t(
                          "بانتظار التحقق من الاتصال",
                          "Awaiting connection check",
                        )}
                  </h3>
                  <p>
                    {dashboard?.connection
                      ? t(
                          "تمت قراءة السجلات في آخر مزامنة",
                          "Authoritative records read at last synchronization",
                        )
                      : t(
                          "زامن السجلات لبدء التخطيط",
                          "Synchronize records to begin planning",
                        )}
                  </p>
                  <dl>
                    <div>
                      <dt>{t("نوع الموصل", "Connector")}</dt>
                      <dd>{dashboard?.connector ?? "browser"}</dd>
                    </div>
                    <div>
                      <dt>{t("آخر تحقق", "Last capability check")}</dt>
                      <dd>{date(dashboard?.connection?.checkedAt, lang)}</dd>
                    </div>
                    <div>
                      <dt>{t("صلاحيات الإنتاج", "Production access")}</dt>
                      <dd>
                        <Badge>
                          {dashboard?.productionWriteEnabled
                            ? t("يتطلب موافقة", "Approval required")
                            : t("غير مفعّل", "Disabled")}
                        </Badge>
                      </dd>
                    </div>
                  </dl>
                  <Button
                    variant="outline"
                    onClick={synchronize}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 size={15} className="spin" />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                    {t("قراءة السجلات والتحقق", "Read records & check")}
                  </Button>
                </Card>
              </div>
              <div className="dashboard-bottom">
                <Card>
                  <div className="section-title">
                    <h2>{t("مسار العمل الآمن", "Controlled workflow")}</h2>
                    <Badge tone="green">
                      {t("حماية مدمجة", "Policy enforced")}
                    </Badge>
                  </div>
                  <div className="workflow">
                    {[
                      [Search, t("اكتشاف وقراءة", "Read")],
                      [CalendarDays, t("تخطيط وجدولة", "Plan")],
                      [FileCheck2, t("موافقة بشرية", "Approve")],
                      [CheckCheck, t("تنفيذ وتحقق", "Execute & verify")],
                    ].map(([Icon, label]: any, i) => (
                      <div key={label}>
                        <span>{i + 1}</span>
                        <Icon size={21} />
                        <strong>{label}</strong>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card>
                  <div className="section-title">
                    <h2>{t("آخر العمليات", "Recent operations")}</h2>
                    <button
                      className="text-button"
                      onClick={() => setScreen("execution")}
                    >
                      {t("عرض الكل", "View all")}
                    </button>
                  </div>
                  {dashboard?.recent?.length ? (
                    dashboard.recent.map((j: any) => (
                      <div className="recent-row" key={j.id}>
                        <Activity size={16} />
                        <code>{j.id.slice(0, 8)}</code>
                        <Badge tone={tone(j.status)}>{j.status}</Badge>
                      </div>
                    ))
                  ) : (
                    <Empty
                      icon={<Terminal size={25} />}
                      title={t("لم يتم تنفيذ عمليات بعد", "No executions yet")}
                      text={t(
                        "ستظهر هنا نتائج العمليات الفعلية",
                        "Actual execution results will appear here",
                      )}
                    />
                  )}
                </Card>
              </div>
            </>
          )}
          {screen === "chat" && <Chat {...shared} />}
          {(screen === "wo" || screen === "pm") && (
            <Explorer {...shared} type={screen === "wo" ? "WO" : "PM"} />
          )}
          {screen === "planner" && <Planner {...shared} />}
          {screen === "approvals" && <Approvals {...shared} />}
          {screen === "execution" && <Execution {...shared} />}
          {screen === "audit" && <Audit {...shared} />}
          {screen === "settings" && <Settings {...shared} />}
        </main>
        <footer>
          <span>
            AI MAXIMO OPERATOR <b>·</b>{" "}
            {t(
              "محاكاة محلية، تنفيذ قابل للتحقق",
              "Local simulation. Verifiable execution.",
            )}
          </span>
          <span>
            <ShieldCheck size={12} />
            {t("تفرض السياسات في الخادم", "Server-enforced policy")}
          </span>
        </footer>
      </div>
      {busy && <div className="busy-bar" />}
      {toast && (
        <div className="toast" role="status">
          <Activity size={17} />
          {toast}
          <button onClick={() => setToast("")} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
type Shared = {
  lang: "ar" | "en";
  t: (ar: string, en: string) => string;
  notify: (message: string) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  version: number;
  plan: Plan | null;
  setPlan: (p: Plan | null) => void;
  setScreen: (s: Screen) => void;
  refresh: () => Promise<void>;
};
function Empty({
  icon,
  title,
  text,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
}) {
  return (
    <div className="empty">
      {icon ?? <Search size={25} />}
      <strong>{title}</strong>
      {text && <p>{text}</p>}
    </div>
  );
}
function Heading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
function Login({ t, onLogin, notify, toast }: any) {
  const [username, setUsername] = useState("supervisor"),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onLogin(await api("/login", { username, password }));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-brand">
        <Activity size={40} />
        <h1>AI MAXIMO OPERATOR</h1>
        <p>{t("خطط. وافق. نفّذ. تحقّق.", "Plan. Approve. Execute. Verify.")}</p>
      </div>
      <Card>
        <Badge tone="amber">LOCAL SIMULATION</Badge>
        <h2>
          {t(
            "مرحبًا في مساحة العمليات",
            "Welcome to your operations workspace",
          )}
        </h2>
        <form onSubmit={submit}>
          <label>
            {t("حساب محلي", "Local account")}
            <select
              aria-label="Account"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            >
              <option value="supervisor">Supervisor · approve & execute</option>
              <option value="planner">Planner · plan only</option>
              <option value="viewer">Viewer · read only</option>
            </select>
          </label>
          <label>
            {t("كلمة المرور", "Password")}
            <input
              aria-label="Password"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <Button disabled={busy} type="submit">
            {busy ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <ShieldCheck size={17} />
            )}{" "}
            {t("تسجيل الدخول", "Sign in")}
          </Button>
        </form>
        <p className="muted">
          Simulation password: <code>local-demo</code>
        </p>
        <small>
          {t(
            "بيانات خيالية. لا يوجد اتصال فعلي بـ SBGMax.",
            "Fictitious records. No live SBGMax connection.",
          )}
        </small>
        {toast && (
          <p role="alert" className="error-text">
            {toast}
          </p>
        )}
      </Card>
    </div>
  );
}
function Chat(p: Shared) {
  const { t, notify, setPlan, setScreen, refresh, plan } = p;
  const [input, setInput] = useState(""),
    [sending, setSending] = useState(false),
    [messages, setMessages] = useState<any[]>([]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    const message = input;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: message }]);
    setSending(true);
    try {
      const r = await api("/chat", {
        message,
        startDate: today(),
        planId: plan?.id,
      });
      setMessages((m) => [...m, { role: "assistant", ...r }]);
      if (r.plan) setPlan(r.plan);
      await refresh();
    } catch (e) {
      setMessages((m) => [...m, { role: "error", text: (e as Error).message }]);
      notify((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  const prompts = [
    "استخرج كل أوامر PM المفتوحة في المطاف",
    "جدول PM في المطاف لمدة 15 دقيقة، كل لون في يوم مختلف",
    "اعرض جميع أوامر العمل التي لم تتم جدولتها",
  ];
  return (
    <>
      <Heading
        title={t("المشغّل الذكي", "AI Operator")}
        subtitle={t(
          "تعليماتك بالعربية والإنجليزية. إجراءات محددة، ونتائج قابلة للمراجعة.",
          "Arabic and English instructions. Typed actions and reviewable results.",
        )}
      >
        <Badge tone="green">
          <ShieldCheck size={13} />
          {t("لا تنفيذ دون موافقة", "Approval before execution")}
        </Badge>
      </Heading>
      <Card className="chat-card">
        <div className="chat-top">
          <span className="assistant-avatar">
            <Sparkles size={21} />
          </span>
          <div>
            <strong>
              {t("مساعد عمليات Maximo", "Maximo operations assistant")}
            </strong>
            <small>
              {t(
                "محلل أوامر محلي · لا يتم إرسال البيانات لخدمة AI خارجية افتراضيًا",
                "Local command parser · External AI is disabled by default",
              )}
            </small>
          </div>
          <span className="status-dot green" />
        </div>
        <div className="messages" aria-live="polite">
          {!messages.length && (
            <div className="chat-welcome">
              <span className="welcome-mark">
                <Sparkles size={34} />
              </span>
              <h2>
                {t("ما الذي نخطط له اليوم؟", "What are we planning today?")}
              </h2>
              <p>
                {t(
                  "ابدأ بقراءة السجلات أو إنشاء خطة. سأعرض التغييرات قبل أي تعديل.",
                  "Start by reading records or creating a plan. Every proposed write is shown for approval.",
                )}
              </p>
              <div className="suggestions">
                {prompts.map((text, i) => (
                  <button key={text} onClick={() => setInput(text)}>
                    <span>
                      {
                        [
                          <Search size={16} />,
                          <CalendarDays size={16} />,
                          <ListFilter size={16} />,
                        ][i]
                      }
                    </span>
                    {text}
                    <ArrowLeft size={15} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div className={"message message-" + m.role} key={i}>
              {m.role !== "user" && (
                <span className="assistant-avatar">
                  <Sparkles size={17} />
                </span>
              )}
              <div>
                <p>{m.text ?? m.message}</p>
                {m.command && (
                  <div className="tool-result">
                    <div>
                      <CheckCircle2 size={15} />
                      <code>{m.command.tool}()</code>
                      <Badge tone="green">{t("مكتمل", "Completed")}</Badge>
                    </div>
                    <details>
                      <summary>
                        {t("فحص الأمر والنتيجة", "Inspect command & result")}
                      </summary>
                      <pre dir="ltr">
                        {JSON.stringify(
                          { command: m.command, result: m.result },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                    {m.plan && (
                      <div className="result-actions">
                        <span>
                          {m.plan.items.length}{" "}
                          {t("مهمة مقترحة", "proposed tasks")} ·{" "}
                          {m.plan.unscheduled.length}{" "}
                          {t("للمراجعة", "need review")}
                        </span>
                        <Button
                          size="sm"
                          onClick={() => {
                            setPlan(m.plan);
                            setScreen("planner");
                          }}
                        >
                          {t("مراجعة الخطة", "Review plan")}
                          <ArrowLeft size={13} />
                        </Button>
                      </div>
                    )}
                    {Array.isArray(m.result) && m.result.length > 0 && (
                      <div className="chat-records">
                        {m.result.slice(0, 4).map((r: any, j: number) => (
                          <div key={j}>
                            <code>{r.id ?? r.key}</code>
                            <span>{r.description ?? JSON.stringify(r)}</span>
                          </div>
                        ))}
                        {m.result.length > 4 && (
                          <small>
                            + {m.result.length - 4}{" "}
                            {t("سجلات في التفاصيل", "records in details")}
                          </small>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="thinking">
              <Loader2 size={17} className="spin" />
              {t(
                "جارٍ قراءة البيانات والتحقق من القيود…",
                "Reading records and validating constraints…",
              )}
            </div>
          )}
        </div>
        <form className="chat-composer" onSubmit={send}>
          <textarea
            aria-label="Operator instruction"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(e);
              }
            }}
            placeholder={t(
              "اكتب توجيهًا للمشغّل…",
              "Give the operator an instruction…",
            )}
            rows={2}
          />
          <Button
            type="submit"
            disabled={sending || !input.trim()}
            aria-label="Send instruction"
          >
            <Send size={19} />
          </Button>
        </form>
        <div className="chat-disclaimer">
          <ShieldCheck size={13} />
          {t(
            "النتائج مقترحات حتى مراجعتها والموافقة عليها. التحقق يتم من السجل المحفوظ.",
            "Proposals require review and approval. Verification reads the persisted record.",
          )}
        </div>
      </Card>
      <div className="mini-info">
        <Terminal size={17} />
        <span>
          {t(
            "المخرجات المنظمة تمر بتحقق الخادم. لا يمكن للمشغّل حذف السجلات أو إغلاق أوامر العمل.",
            "Structured commands pass server validation. Record deletion and WO closure are outside the allowlist.",
          )}
        </span>
      </div>
    </>
  );
}
function Explorer(p: Shared & { type: "WO" | "PM" }) {
  const { t, lang, type, run, notify, setPlan, setScreen, version } = p;
  const [rows, setRows] = useState<RecordData[]>([]),
    [query, setQuery] = useState(""),
    [project, setProject] = useState(""),
    [status, setStatus] = useState(""),
    [building, setBuilding] = useState(""),
    [asset, setAsset] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [selected, setSelected] = useState<RecordData | null>(null),
    [pmDate, setPmDate] = useState(""),
    [groupCsv, setGroupCsv] = useState(""),
    [mappingPreview, setMappingPreview] = useState<any[]>([]);
  useEffect(() => {
    const q = new URLSearchParams({
      type,
      q: query,
      project,
      status,
      building,
      asset,
      from,
      to,
    });
    api<RecordData[]>("/records?" + q)
      .then(setRows)
      .catch((e) => notify(e.message));
  }, [
    type,
    query,
    project,
    status,
    building,
    asset,
    from,
    to,
    version,
    notify,
  ]);
  function previewGroups() {
    try {
      const parsed = groupCsv
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [id, siteId, color] = line.split(",").map((s) => s.trim());
          if (!id || !siteId || !colors[color])
            throw Error(
              "Format: record_id,site_id,blue|green|amber|violet|red",
            );
          return {
            identity: { type, id, siteId },
            color,
            source: "Confirmed CSV import",
          };
        });
      setMappingPreview(parsed);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <>
      <Heading
        title={
          type === "WO"
            ? t("أوامر العمل", "Work orders")
            : t("الصيانة الوقائية", "Preventive maintenance")
        }
        subtitle={
          type === "WO"
            ? t(
                "استكشف السجلات، مواعيد العمل، وتعيينات الفنيين.",
                "Inspect records, scheduled dates and labor assignments.",
              )
            : t(
                "راجع التكرار وتواريخ الاستحقاق وتأثير توليد أوامر العمل.",
                "Inspect frequencies, due dates and WO-generation implications.",
              )
        }
      >
        <Badge>
          {rows.length} {t("سجل", "records")}
        </Badge>
      </Heading>
      <Card className="explorer">
        <div className="filters">
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="Search records"
              placeholder={t(
                "بحث برقم السجل أو الأصل…",
                "Search record or asset…",
              )}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Project filter"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="">{t("كل المشاريع", "All projects")}</option>
            {["1610", "1611", "1612", "1613"].map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
          <select
            aria-label="Status filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t("كل الحالات", "All statuses")}</option>
            {["APPR", "ACTIVE", "COMP", "WAPPR", "INPRG"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <select
            aria-label="Building filter"
            value={building}
            onChange={(e) => setBuilding(e.target.value)}
          >
            <option value="">{t("كل المباني", "All buildings")}</option>
            {["MATAF", "SHAMIYA", "GB", "PZ", "SVB", "NBB"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <input
            aria-label="Asset filter"
            placeholder="Asset ID"
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
          />
          <label className="compact-label">
            {t("من", "From")}
            <input
              aria-label="Due from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="compact-label">
            {t("إلى", "To")}
            <input
              aria-label="Due to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  t("السجل / الموقع", "Record / site"),
                  t("الوصف", "Description"),
                  t("المشروع / المبنى", "Project / building"),
                  t("الحالة", "Status"),
                  t("الاستحقاق", "Due date"),
                  type === "WO"
                    ? t("بداية مجدولة", "Scheduled start")
                    : t("التكرار", "Frequency"),
                  t("المجموعة", "Group"),
                ].map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={recordKey(r)}
                  onClick={() => setSelected(r)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSelected(r);
                  }}
                >
                  <td>
                    <button className="record-link">{r.id}</button>
                    <small>{r.siteId}</small>
                  </td>
                  <td>
                    <strong>{r.description}</strong>
                    <small>
                      {r.location} · {r.asset}
                    </small>
                  </td>
                  <td>
                    {r.project}
                    <small>{r.building}</small>
                  </td>
                  <td>
                    <Badge tone={tone(r.status)}>{r.status}</Badge>
                  </td>
                  <td>{date(r.nextDue ?? r.due, lang)}</td>
                  <td>
                    {type === "WO" ? date(r.scheduledStart, lang) : r.frequency}
                  </td>
                  <td>
                    {r.color ? (
                      <span className="color-label">
                        <i style={{ background: colors[r.color] }} />
                        {r.color}
                      </span>
                    ) : (
                      <Badge tone="amber">{t("غير مؤكد", "Unconfirmed")}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <Empty
            title={t("لا توجد سجلات مطابقة", "No matching records")}
            text={t(
              "زامن Maximo من النظرة العامة أو عدّل عوامل التصفية.",
              "Synchronize Maximo from Overview or adjust filters.",
            )}
          />
        )}
      </Card>
      <details className="card import-groups">
        <summary>
          <span>
            <Plus size={16} />
            {t(
              "استيراد مجموعات الألوان وتأكيدها",
              "Import and confirm color mappings",
            )}
          </span>
        </summary>
        <p>
          {t(
            "اللون من مصدر مؤكد فقط. تنسيق CSV: رقم السجل، الموقع، اللون.",
            "Use a confirmed source. CSV columns: record ID, site ID, color.",
          )}
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Import color CSV"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setGroupCsv(await file.text());
          }}
        />
        <textarea
          aria-label="Color mapping CSV"
          rows={3}
          value={groupCsv}
          onChange={(e) => setGroupCsv(e.target.value)}
          placeholder={`${type === "PM" ? "PM-1001" : "WO-2001"},HARAM,blue`}
        />
        <Button variant="outline" onClick={previewGroups}>
          {t("معاينة المجموعات", "Preview mappings")}
        </Button>
        {mappingPreview.length > 0 && (
          <>
            <div className="mapping-preview">
              {mappingPreview.map((m, i) => (
                <span key={i}>
                  <i style={{ background: colors[m.color] }} />
                  {m.identity.id} / {m.identity.siteId} → {m.color}
                </span>
              ))}
            </div>
            <Button
              onClick={() =>
                run(async () => {
                  await api("/groups", {
                    confirmed: true,
                    mappings: mappingPreview,
                  });
                  setMappingPreview([]);
                  notify(
                    t(
                      "تم تأكيد المجموعات محليًا",
                      "Mappings confirmed locally",
                    ),
                  );
                })
              }
            >
              {t(
                "أؤكد مصدر المجموعات وأحفظها",
                "Confirm source & save mappings",
              )}
            </Button>
          </>
        )}
      </details>
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Record details"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-title">
              <h2>{selected.id}</h2>
              <Button
                variant="ghost"
                aria-label="Close record"
                onClick={() => setSelected(null)}
              >
                <X size={18} />
              </Button>
            </div>
            <p>{selected.description}</p>
            <dl className="record-details">
              {Object.entries(selected).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v === null ? "—" : String(v)}</dd>
                </div>
              ))}
            </dl>
            <Button
              variant="outline"
              onClick={() =>
                run(async () => {
                  const fresh = await api<RecordData>(
                    `/records/${selected.type}/${selected.siteId}/${selected.id}`,
                  );
                  setSelected(fresh);
                  notify(
                    t(
                      "تمت إعادة قراءة السجل المرجعي",
                      "Authoritative record re-read",
                    ),
                  );
                })
              }
            >
              <RefreshCw size={15} />
              {t("إعادة قراءة السجل", "Read authoritative record")}
            </Button>
            {type === "PM" && (
              <div className="pm-proposal">
                <h3>
                  {t(
                    "مقترح مستقل لتغيير استحقاق PM",
                    "Separate PM due-date proposal",
                  )}
                </h3>
                <p>
                  <TriangleAlert size={14} />
                  {t(
                    "قد يتغير موعد توليد أوامر العمل المستقبلية. الكتابة الفعلية لـ PM معطلة.",
                    "Future WO generation can change. Live PM writes remain disabled.",
                  )}
                </p>
                <label>
                  {t("الاستحقاق المقترح", "Proposed due date")}
                  <input
                    type="date"
                    aria-label="Proposed PM due date"
                    value={pmDate}
                    onChange={(e) => setPmDate(e.target.value)}
                  />
                </label>
                <Button
                  disabled={!pmDate}
                  onClick={() =>
                    run(async () => {
                      const p = await api<Plan>("/pm-proposals", {
                        identity: {
                          type: "PM",
                          id: selected.id,
                          siteId: selected.siteId,
                        },
                        values: { nextDue: pmDate + "T08:00:00+03:00" },
                        reason: "Operator-reviewed PM due-date proposal",
                      });
                      setPlan(p);
                      setScreen("planner");
                      setSelected(null);
                    })
                  }
                >
                  {t("إنشاء مقترح للمراجعة", "Create reviewable proposal")}
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
function Planner(p: Shared) {
  const { t, lang, plan, setPlan, setScreen, run, notify, version } = p;
  const [plans, setPlans] = useState<any[]>([]),
    [startDate, setStartDate] = useState(today()),
    [project, setProject] = useState("1611"),
    [duration, setDuration] = useState(15),
    [separate, setSeparate] = useState(true),
    [view, setView] = useState("calendar"),
    [edit, setEdit] = useState<ScheduleItem | null>(null),
    [editStart, setEditStart] = useState(""),
    [editLabor, setEditLabor] = useState("");
  useEffect(() => {
    api("/plans")
      .then(setPlans)
      .catch((e) => notify(e.message));
  }, [version, notify]);
  const dates = Array.from({ length: plan?.parameters.days ?? 7 }, (_, i) => {
    const d = new Date(
      (plan?.parameters.startDate ?? startDate) + "T12:00:00+03:00",
    );
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  async function move(key: string, dayValue: string) {
    if (!plan) return;
    const item = plan.items.find((i) => recordKey(i.identity) === key);
    if (!item) return;
    const localTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(item.start));
    await run(async () =>
      setPlan(
        await api(`/plans/${plan.id}/adjust`, {
          key,
          start: `${dayValue}T${localTime}:00+03:00`,
          laborId: item.laborId,
        }),
      ),
    );
  }
  return (
    <>
      <Heading
        title={t("مخطط الجدولة", "Scheduling planner")}
        subtitle={t(
          "مقترحات تحترم الورديات والمهارات والقيود. عدّل الخطة قبل إرسالها للموافقة.",
          "Schedules respect shifts, skills and constraints. Adjust drafts before submitting for approval.",
        )}
      >
        <select
          aria-label="Select plan"
          value={plan?.id ?? ""}
          onChange={(e) => {
            const p = plans.find((p) => p.id === e.target.value);
            if (p) setPlan(p.data);
          }}
        >
          <option value="">{t("اختر خطة سابقة", "Select saved plan")}</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id.slice(0, 8)} · {p.status}
            </option>
          ))}
        </select>
      </Heading>
      <Card className="plan-controls">
        <label>
          {t("المشروع", "Project")}
          <select
            aria-label="Scheduling project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            {["1610", "1611", "1612", "1613"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          {t("تاريخ البداية", "Start date")}
          <input
            aria-label="Schedule start date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label>
          {t("مدة التقدير (دقيقة)", "Planning duration (min)")}
          <input
            aria-label="Planning duration"
            type="number"
            min="5"
            max="480"
            value={duration}
            onChange={(e) => setDuration(+e.target.value)}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={separate}
            onChange={(e) => setSeparate(e.target.checked)}
          />
          {t("كل لون في يوم منفصل", "Separate calendar day per color")}
        </label>
        <Button
          onClick={() =>
            run(async () =>
              setPlan(
                await api("/plans", {
                  project,
                  startDate,
                  startTime: "08:00",
                  days: 7,
                  durationOverride: duration,
                  colorSeparation: separate,
                }),
              ),
            )
          }
        >
          <Sparkles size={16} />
          {t("إنشاء خطة", "Create plan")}
        </Button>
      </Card>
      {plan ? (
        <>
          <div className="plan-summary">
            <div>
              <Badge tone="green">
                {plan.items.length} {t("مهمة مجدولة", "scheduled")}
              </Badge>
              <Badge tone={plan.unscheduled.length ? "amber" : "green"}>
                {plan.unscheduled.length} {t("تحتاج مراجعة", "need review")}
              </Badge>
              <Badge>
                {Object.values(plan.workload).reduce((a, b) => a + b, 0)}{" "}
                {t("دقيقة", "minutes")}
              </Badge>
            </div>
            <code>{plan.solver}</code>
            <span className="muted">
              {t("لم يتم تعديل Maximo", "Maximo has not been modified")}
            </span>
          </div>
          <Card className="calendar-card">
            <div className="tabs" role="tablist">
              {[
                ["calendar", "تقويم أسبوعي", "Weekly calendar"],
                ["gantt", "الجدول الزمني", "Gantt"],
                ["color", "مجموعات الألوان", "Color groups"],
                ["shift", "الورديات", "Shifts"],
                ["workload", "حمل الفنيين", "Workload"],
                ["conflicts", "القيود والملاحظات", "Constraints & review"],
              ].map(([key, ar, en]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={view === key}
                  className={view === key ? "selected" : ""}
                  onClick={() => setView(key)}
                >
                  {t(ar, en)}
                </button>
              ))}
            </div>
            {view === "calendar" && (
              <div className="calendar-grid">
                {dates.map((d) => (
                  <div
                    className="calendar-day"
                    key={d}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void move(e.dataTransfer.getData("text/plain"), d);
                    }}
                  >
                    <div className="calendar-date">
                      <strong>
                        {new Intl.DateTimeFormat(
                          lang === "ar" ? "ar-SA" : "en-GB",
                          { weekday: "short", timeZone: "Asia/Riyadh" },
                        ).format(new Date(d + "T12:00:00+03:00"))}
                      </strong>
                      <span>{d.slice(8)}</span>
                    </div>
                    {plan.items
                      .filter((i) => day(i.start) === d)
                      .map((i) => (
                        <button
                          className="calendar-task"
                          key={recordKey(i.identity)}
                          draggable
                          onDragStart={(e) =>
                            e.dataTransfer.setData(
                              "text/plain",
                              recordKey(i.identity),
                            )
                          }
                          onClick={() => {
                            setEdit(i);
                            setEditStart(
                              new Date(Date.parse(i.start) + 3 * 3600000)
                                .toISOString()
                                .slice(0, 16),
                            );
                            setEditLabor(i.laborId);
                          }}
                          style={{
                            borderInlineStartColor:
                              colors[i.color ?? ""] ?? "#7b9190",
                          }}
                        >
                          <code>{i.identity.id}</code>
                          <strong>{i.building}</strong>
                          <small>
                            {new Intl.DateTimeFormat("en-GB", {
                              timeZone: "Asia/Riyadh",
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(i.start))}{" "}
                            · {i.minutes} min
                          </small>
                          <small>
                            {i.laborId} · {i.color ?? "—"}
                          </small>
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            )}
            {view === "gantt" && (
              <div className="gantt">
                <div className="gantt-head">
                  <span>{t("المهمة", "Task")}</span>
                  <div>
                    {dates.map((d) => (
                      <span key={d}>{d.slice(5)}</span>
                    ))}
                  </div>
                </div>
                {plan.items.map((i) => {
                  const idx = dates.indexOf(day(i.start));
                  return (
                    <div className="gantt-row" key={recordKey(i.identity)}>
                      <code>
                        {i.identity.id}
                        <small>
                          {i.laborId} · {i.minutes}m
                        </small>
                      </code>
                      <div>
                        <span
                          style={{
                            gridColumn: idx + 1,
                            background: colors[i.color ?? ""] ?? "#638981",
                          }}
                        >
                          {new Intl.DateTimeFormat("en-GB", {
                            timeZone: "Asia/Riyadh",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(i.start))}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {(view === "color" || view === "shift") && (
              <div className="group-view">
                {[
                  ...new Set(
                    plan.items.map((i) =>
                      view === "color"
                        ? (i.color ?? "unknown")
                        : String(i.shift),
                    ),
                  ),
                ].map((group) => (
                  <div key={group}>
                    <h3>
                      <span
                        className="status-dot"
                        style={{ background: colors[group] }}
                      />
                      {view === "color" ? group : t("وردية ", "Shift ") + group}
                    </h3>
                    {plan.items
                      .filter(
                        (i) =>
                          (view === "color"
                            ? (i.color ?? "unknown")
                            : String(i.shift)) === group,
                      )
                      .map((i) => (
                        <div className="group-item" key={recordKey(i.identity)}>
                          <code>{i.identity.id}</code>
                          <span>{date(i.start, lang)}</span>
                          <Badge>{i.minutes} min</Badge>
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            )}
            {view === "workload" && (
              <div className="workload">
                {Object.entries(plan.workload).map(([id, m]) => (
                  <div key={id}>
                    <Users size={18} />
                    <strong>{id}</strong>
                    <div className="workload-track">
                      <span
                        style={{
                          width:
                            (m /
                              Math.max(480, ...Object.values(plan.workload))) *
                              100 +
                            "%",
                        }}
                      />
                    </div>
                    <span>
                      {m} min · {(m / 60).toFixed(1)} h
                    </span>
                  </div>
                ))}
              </div>
            )}
            {view === "conflicts" && (
              <div className="constraint-list">
                {plan.explanations.map((s) => (
                  <p key={s}>
                    <CheckCircle2 size={16} />
                    {s}
                  </p>
                ))}
                {plan.unscheduled.map((u) => (
                  <p className="warning" key={recordKey(u.identity)}>
                    <TriangleAlert size={16} />
                    <code>{u.identity.id}</code>
                    {u.reason}
                  </p>
                ))}
                {plan.conflicts.map((s) => (
                  <p className="error-text" key={s}>
                    {s}
                  </p>
                ))}
              </div>
            )}
            {!plan.items.length && view !== "conflicts" && (
              <Empty
                title={
                  plan.changes.length
                    ? t(
                        "مقترح استحقاق PM مستقل",
                        "Separate PM due-date proposal",
                      )
                    : t("لا يوجد جدول قابل للتنفيذ", "No feasible schedule")
                }
                text={plan.changes[0]?.pmImpact ?? plan.unscheduled[0]?.reason}
              />
            )}
          </Card>
          <Card className="changes-preview">
            <div className="section-title">
              <h2>
                {t("التغييرات المقترحة الدقيقة", "Exact proposed changes")}
              </h2>
              <Badge>{plan.changes.length}</Badge>
            </div>
            {plan.changes.slice(0, 5).map((c) => (
              <ChangeRow key={c.key} change={c} lang={lang} />
            ))}
            {plan.changes.length > 5 && (
              <p className="muted">
                +{plan.changes.length - 5}{" "}
                {t(
                  "تغييرات ستظهر كاملة في مركز الموافقات",
                  "changes shown in full in Approval Center",
                )}
              </p>
            )}
            <div className="plan-actions">
              <Button
                disabled={!plan.changes.length}
                onClick={() =>
                  run(async () => {
                    await api(`/plans/${plan.id}/submit`, {});
                    setScreen("approvals");
                  })
                }
              >
                <FileCheck2 size={16} />
                {t("إرسال للموافقة", "Submit for approval")}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  run(async () => {
                    await api(`/plans/${plan.id}/cancel`, {});
                    notify(t("تم إلغاء الخطة", "Plan cancelled"));
                    setPlan(null);
                  })
                }
              >
                {t("إلغاء الخطة", "Cancel plan")}
              </Button>
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <Empty
            icon={<CalendarDays size={32} />}
            title={t("ابدأ بخطة جديدة", "Create your first plan")}
            text={t(
              "اختر المشروع والتاريخ أو اطلب من المشغّل إنشاء الجدول.",
              "Choose a project and date, or ask the AI Operator to create a schedule.",
            )}
          />
        </Card>
      )}
      {edit && plan && (
        <div className="modal-backdrop">
          <section
            className="modal small"
            role="dialog"
            aria-modal="true"
            aria-label="Adjust schedule"
          >
            <div className="section-title">
              <h2>{edit.identity.id}</h2>
              <Button
                variant="ghost"
                onClick={() => setEdit(null)}
                aria-label="Close adjustment"
              >
                <X size={17} />
              </Button>
            </div>
            <p>Asia/Riyadh · UTC+3</p>
            <label>
              {t("موعد البداية", "Scheduled start")}
              <input
                type="datetime-local"
                aria-label="Adjusted start"
                value={editStart}
                onChange={(e) => setEditStart(e.target.value)}
              />
            </label>
            <label>
              {t("الفني", "Labor")}
              <input
                aria-label="Adjusted labor"
                value={editLabor}
                onChange={(e) => setEditLabor(e.target.value)}
              />
            </label>
            <Button
              onClick={() =>
                run(async () => {
                  setPlan(
                    await api(`/plans/${plan.id}/adjust`, {
                      key: recordKey(edit.identity),
                      start: editStart + ":00+03:00",
                      laborId: editLabor,
                    }),
                  );
                  setEdit(null);
                })
              }
            >
              {t("التحقق وحفظ المسودة", "Validate & save draft")}
            </Button>
          </section>
        </div>
      )}
    </>
  );
}
function ChangeRow({
  change: c,
  lang,
  children,
}: {
  change: Change;
  lang: string;
  children?: ReactNode;
}) {
  const value = (v: any) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)
      ? date(v, lang)
      : String(v ?? "—");
  return (
    <div className="change-row">
      {children}
      <div className="change-identity">
        <code>{c.identity.id}</code>
        <small>
          {c.identity.siteId} · {c.identity.type} · rev {c.revision}
        </small>
        <p>{c.description}</p>
      </div>
      <div className="before-after">
        {Object.keys(c.after).map((k) => (
          <div key={k}>
            <small>{k}</small>
            <span className="before">
              {value(c.before[k as keyof typeof c.before])}
            </span>
            <ArrowLeft size={14} />
            <strong>{value(c.after[k as keyof typeof c.after])}</strong>
          </div>
        ))}
      </div>
      <details className="change-reason">
        <summary>
          {lang === "ar" ? "السبب والتأثير" : "Reason & impact"}
        </summary>
        <p>{c.reason}</p>
        <p>{c.pmImpact}</p>
        {c.conflicts.map((x) => (
          <p key={x}>{x}</p>
        ))}
      </details>
    </div>
  );
}
function Approvals(p: Shared) {
  const { t, lang, version, notify, run, setScreen } = p;
  const [data, setData] = useState<any>({ sets: [], approvals: [] }),
    [selected, setSelected] = useState<Record<string, string[]>>({});
  useEffect(() => {
    api("/approvals")
      .then(setData)
      .catch((e) => notify(e.message));
  }, [version, notify]);
  const pending = data.sets.filter((s: any) => s.status === "PENDING");
  return (
    <>
      <Heading
        title={t("مركز الموافقات", "Approval center")}
        subtitle={t(
          "الموافقة مرتبطة ببصمة ثابتة للقيم المحددة. تنتهي بعد 30 دقيقة.",
          "Approval binds an immutable snapshot of selected values and expires after 30 minutes.",
        )}
      >
        <Badge tone="amber">
          {pending.length} {t("بانتظار المراجعة", "awaiting review")}
        </Badge>
      </Heading>
      {!pending.length && (
        <Card>
          <Empty
            icon={<FileCheck2 size={30} />}
            title={t(
              "لا توجد تغييرات بانتظار الموافقة",
              "No changes awaiting approval",
            )}
            text={t(
              "أرسل خطة من مخطط الجدولة لتظهر هنا.",
              "Submit a plan from the scheduling planner to review it here.",
            )}
          />
        </Card>
      )}
      {pending.map((s: any) => {
        const keys = selected[s.id] ?? [],
          changes = s.data as Change[];
        return (
          <Card className="approval-card" key={s.id}>
            <div className="section-title">
              <div>
                <h2>{t("مراجعة دفعة التغييرات", "Review change batch")}</h2>
                <small>
                  {date(s.created_at, lang)} · {s.id.slice(0, 8)}
                </small>
              </div>
              <Badge tone="amber">PENDING</Badge>
            </div>
            <div className="approval-info">
              <ShieldCheck size={17} />
              <span>
                {t(
                  "تتم إعادة قراءة السجلات قبل التنفيذ. أي تغيير مرجعي يلغي صلاحية التعديل.",
                  "Records are re-read before execution. Stale changes are rejected.",
                )}
              </span>
            </div>
            <label className="select-all">
              <input
                aria-label="Select all changes"
                type="checkbox"
                checked={keys.length === changes.length}
                onChange={(e) =>
                  setSelected({
                    ...selected,
                    [s.id]: e.target.checked ? changes.map((c) => c.key) : [],
                  })
                }
              />
              {t("تحديد الدفعة الدقيقة", "Select exact batch")} (
              {changes.length})
            </label>
            {changes.map((c) => (
              <ChangeRow key={c.key} change={c} lang={lang}>
                <input
                  aria-label={"Approve " + c.identity.id}
                  type="checkbox"
                  checked={keys.includes(c.key)}
                  onChange={(e) =>
                    setSelected({
                      ...selected,
                      [s.id]: e.target.checked
                        ? [...keys, c.key]
                        : keys.filter((k) => k !== c.key),
                    })
                  }
                />
              </ChangeRow>
            ))}
            <details>
              <summary>{t("بصمة التغييرات", "Snapshot hash")}</summary>
              <code className="hash">{s.snapshot_hash}</code>
            </details>
            <div className="plan-actions">
              <Button
                disabled={!keys.length}
                onClick={() =>
                  run(async () => {
                    await api("/approvals", { changeSetId: s.id, keys });
                    notify(
                      t(
                        "تمت الموافقة. التنفيذ إجراء مستقل.",
                        "Approved. Execution is a separate action.",
                      ),
                    );
                  })
                }
              >
                <Check size={16} />
                {t(
                  "أوافق على القيم المحددة",
                  "Approve selected exact values",
                )}{" "}
                ({keys.length})
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  run(async () => {
                    await api(`/approvals/${s.id}/reject`, {});
                    notify(t("تم رفض الدفعة", "Batch rejected"));
                  })
                }
              >
                {t("رفض الدفعة", "Reject batch")}
              </Button>
            </div>
          </Card>
        );
      })}
      {data.approvals.length > 0 && (
        <>
          <h2 className="subheading">
            {t("الموافقات وسجل التنفيذ", "Approvals & execution")}
          </h2>
          {data.approvals.map((a: any) => (
            <Card className="approval-approved" key={a.id}>
              <ShieldCheck size={25} />
              <div>
                <strong>
                  {a.data.length} {t("تغييرات معتمدة", "approved changes")}
                </strong>
                <small>
                  {t("بواسطة", "By")} {a.approved_by} ·{" "}
                  {date(a.approved_at, lang)}
                </small>
                <small>
                  {t("تنتهي", "Expires")} {date(a.expires_at, lang)}
                </small>
                <details>
                  <summary>{t("نطاق الموافقة", "Approval scope")}</summary>
                  <pre dir="ltr">
                    {JSON.stringify(
                      { hash: a.snapshot_hash, changes: a.data },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </div>
              <Badge tone={tone(a.status)}>{a.status}</Badge>
              <Button
                disabled={
                  a.status !== "APPROVED" ||
                  Date.parse(a.expires_at) < Date.now()
                }
                onClick={() =>
                  run(async () => {
                    await api("/execute", { approvalId: a.id });
                    setScreen("execution");
                  })
                }
              >
                <Play size={15} />
                {t("تنفيذ المعتمد فقط", "Execute approved changes")}
              </Button>
            </Card>
          ))}
        </>
      )}
    </>
  );
}
function Execution(p: Shared) {
  const { t, lang, version, notify, run } = p;
  const [jobs, setJobs] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [details, setDetails] = useState<any>(null),
    [verification, setVerification] = useState<any>(null);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const rows = await api<any[]>("/jobs");
        if (!active) return;
        setJobs(rows);
        const id = selected || rows[0]?.id;
        if (id) {
          const r = await api("/jobs/" + id);
          if (active) setDetails(r);
        }
      } catch (e) {
        if (active) notify((e as Error).message);
      }
    }
    void load();
    const id = setInterval(load, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [selected, version, notify]);
  return (
    <>
      <Heading
        title={t("مراقبة التنفيذ", "Execution monitor")}
        subtitle={t(
          "حالة فعلية لكل سجل. لا يُعد الحفظ ناجحًا إلا بعد إعادة القراءة والمطابقة.",
          "Live per-record outcomes. A save succeeds only after read-back matches the approved values.",
        )}
      >
        <Button
          variant="danger"
          onClick={() =>
            run(async () => {
              await api("/stop", {});
              notify(
                t(
                  "تم طلب إيقاف جميع العمليات. يتم التحقق من الحفظ الجاري.",
                  "Stop requested for all jobs. In-flight saves will be reconciled.",
                ),
              );
            })
          }
        >
          <Square size={15} />
          {t("إيقاف طارئ", "Emergency stop")}
        </Button>
      </Heading>
      {!jobs.length ? (
        <Card>
          <Empty
            icon={<Activity size={30} />}
            title={t("لا توجد عمليات تنفيذ", "No execution jobs")}
            text={t(
              "نفّذ دفعة معتمدة من مركز الموافقات.",
              "Execute an approved batch from Approval Center.",
            )}
          />
        </Card>
      ) : (
        <div className="execution-layout">
          <Card className="job-list">
            {jobs.map((j) => (
              <button
                key={j.id}
                className={(selected || jobs[0]?.id) === j.id ? "selected" : ""}
                onClick={() => {
                  setSelected(j.id);
                  setVerification(null);
                }}
              >
                <div>
                  <code>{j.id.slice(0, 8)}</code>
                  <Badge tone={tone(j.status)}>{j.status}</Badge>
                </div>
                <small>{date(j.created_at, lang)}</small>
              </button>
            ))}
          </Card>
          {details && (
            <Card className="job-details">
              <div className="section-title">
                <h2>{t("نتائج العملية", "Execution results")}</h2>
                <Badge tone={tone(details.job.status)}>
                  {details.job.status}
                </Badge>
              </div>
              <code className="muted">{details.job.id}</code>
              <div className="execution-progress">
                <span
                  style={{
                    width:
                      (details.steps.filter((s: any) =>
                        [
                          "VERIFIED",
                          "FAILED",
                          "CONFLICT",
                          "CANCELLED",
                          "UNCERTAIN",
                        ].includes(s.status),
                      ).length /
                        Math.max(1, details.steps.length)) *
                        100 +
                      "%",
                  }}
                />
              </div>
              <div className="plan-summary">
                {Object.entries(details.summary).map(([s, n]) => (
                  <Badge key={s} tone={tone(s)}>
                    {s}: {String(n)}
                  </Badge>
                ))}
              </div>
              {details.job.error && (
                <p className="error-text">{details.job.error}</p>
              )}
              {details.steps.map((s: any) => (
                <div className="execution-step" key={s.id}>
                  <span
                    className={
                      "step-icon " + (s.status === "VERIFIED" ? "success" : "")
                    }
                  >
                    {s.status === "VERIFIED" ? (
                      <CheckCheck size={18} />
                    ) : s.status === "RUNNING" ? (
                      <Loader2 className="spin" size={18} />
                    ) : (
                      <Activity size={18} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {s.data.identity.id}{" "}
                      <small>· {s.data.identity.siteId}</small>
                    </strong>
                    <p>
                      {s.result?.error ??
                        (s.status === "VERIFIED"
                          ? t(
                              "تمت إعادة القراءة ومطابقة القيم المعتمدة",
                              "Persisted record matches approved values",
                            )
                          : t("بانتظار المعالجة", "Awaiting processing"))}
                    </p>
                    <details>
                      <summary>
                        {t("القيم والنتيجة", "Values & outcome")}
                      </summary>
                      <pre dir="ltr">
                        {JSON.stringify(
                          { approved: s.data.after, result: s.result },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </div>
                  <Badge tone={tone(s.status)}>{s.status}</Badge>
                </div>
              ))}
              <div className="plan-actions">
                <Button variant="outline" asChild>
                  <a href={"/api/jobs/" + details.job.id + "/report"} download>
                    <ArrowDownToLine size={15} />
                    {t("تقرير التنفيذ", "Download report")}
                  </a>
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    run(async () => {
                      const r = await api(`/jobs/${details.job.id}/verify`, {});
                      setVerification(r);
                    })
                  }
                >
                  <RefreshCw size={15} />
                  {t("تحقق من Maximo مجددًا", "Reverify Maximo")}
                </Button>
              </div>
              {verification && (
                <div className="constraint-list">
                  {verification.outcomes.map((o: any) => (
                    <p key={o.key} className={o.matches ? "" : "error-text"}>
                      {o.matches ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <TriangleAlert size={16} />
                      )}
                      <code>{o.key}</code>
                      {o.matches ? "MATCH" : "MISMATCH / READ UNAVAILABLE"}
                    </p>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
function Audit(p: Shared) {
  const { t, lang, version, notify } = p;
  const [data, setData] = useState<any>({ events: [] }),
    [q, setQ] = useState("");
  useEffect(() => {
    api("/audit")
      .then(setData)
      .catch((e) => notify(e.message));
  }, [version, notify]);
  const events = data.events.filter((e: any) =>
    JSON.stringify(e).toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <Heading
        title={t("سجل التدقيق", "Audit history")}
        subtitle={t(
          "أثر تدقيق ببصمات متسلسلة للقراءة والموافقات والتغييرات والتحقق.",
          "Hash-chained events for reads, approvals, writes and verification.",
        )}
      >
        <Button variant="outline" asChild>
          <a href="/api/audit/export" download>
            <ArrowDownToLine size={16} />
            {t("تصدير السجل", "Export audit")}
          </a>
        </Button>
      </Heading>
      <Card>
        <div className="filters">
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="Search audit"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t(
                "ابحث بالمستخدم أو الإجراء أو رقم السجل",
                "Search actor, action or record",
              )}
            />
          </div>
          <Badge tone={data.chainValid ? "green" : "red"}>
            <ShieldCheck size={13} />
            {data.chainValid
              ? t("سلسلة التدقيق سليمة", "Audit chain intact")
              : t("جارٍ التحقق", "Checking chain")}
          </Badge>
        </div>
        <div className="audit-events">
          {events.map((e: any) => (
            <details key={e.id}>
              <summary>
                <span className="audit-icon">
                  <ShieldCheck size={16} />
                </span>
                <strong>{e.action}</strong>
                <code>{e.actor}</code>
                <span>{e.entity.slice(0, 12)}</span>
                <time>{date(e.created_at, lang)}</time>
              </summary>
              <pre dir="ltr">{JSON.stringify(e, null, 2)}</pre>
            </details>
          ))}
        </div>
        {!events.length && (
          <Empty title={t("لا توجد أحداث مطابقة", "No matching events")} />
        )}
      </Card>
    </>
  );
}
function Settings(p: Shared) {
  const { t, run, notify, version } = p;
  const [data, setData] = useState<any>(null),
    [holiday, setHoliday] = useState("");
  useEffect(() => {
    api("/settings")
      .then((d) => {
        setData(d);
        setHoliday(d.calendar.join(","));
      })
      .catch((e) => notify(e.message));
  }, [version, notify]);
  if (!data) return <Empty title={t("جارٍ التحميل", "Loading settings")} />;
  return (
    <>
      <Heading
        title={t("إعدادات التشغيل", "Operations settings")}
        subtitle={t(
          "إعدادات التخطيط قابلة للتحرير. بيانات الاتصال والأسرار تضبط على الخادم.",
          "Edit planning rules here. Connection credentials and write authorization are server configuration.",
        )}
      />
      <div className="settings-grid">
        <Card>
          <div className="section-title">
            <h2>{t("الاتصال والسياسة", "Connection & policy")}</h2>
            <ShieldCheck size={20} />
          </div>
          <dl>
            {[
              ["Mode", data.mode],
              ["Connector", data.connector],
              ["Timezone", data.timezone],
              ["Read only", String(data.readOnly)],
              ["Production flag", String(data.productionWriteEnabled)],
              ["AI provider", data.aiProvider],
              ["AI model", data.aiModel],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            {t(
              "لتفعيل اتصال معتمد: راجع MAXIMO_INTEGRATION.md. لا تُخزن مفاتيح API في هذه الواجهة.",
              "For an authorized connection, follow MAXIMO_INTEGRATION.md. API keys stay outside application records.",
            )}
          </p>
        </Card>
        <Card>
          <h2>{t("مدد التخطيط", "Planning durations")}</h2>
          <p className="muted">
            {t(
              "تقديرات أولية. المدة المعتمدة في خطة العمل لها الأولوية افتراضيًا.",
              "Initial estimates. Approved job-plan durations take precedence by default.",
            )}
          </p>
          {data.rules.map((r: any, i: number) => (
            <div className="rule-row" key={r.building}>
              <strong>{r.building}</strong>
              <input
                aria-label={"Duration " + r.building}
                type="number"
                min="5"
                max="480"
                value={r.minutes}
                onChange={(e) => {
                  const rules = [...data.rules];
                  rules[i] = { ...r, minutes: +e.target.value };
                  setData({ ...data, rules });
                }}
              />
              <span>min</span>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={!!r.job_plan_precedence}
                  onChange={(e) => {
                    const rules = [...data.rules];
                    rules[i] = {
                      ...r,
                      job_plan_precedence: Number(e.target.checked),
                    };
                    setData({ ...data, rules });
                  }}
                />
                Job plan
              </label>
            </div>
          ))}
          <Button
            size="sm"
            onClick={() =>
              run(async () => {
                await api(
                  "/settings/rules",
                  data.rules.map((r: any) => ({
                    building: r.building,
                    minutes: r.minutes,
                    jobPlanPrecedence: !!r.job_plan_precedence,
                  })),
                );
                notify(t("تم حفظ القواعد", "Rules saved"));
              })
            }
          >
            {t("حفظ القواعد", "Save rules")}
          </Button>
        </Card>
        <Card>
          <h2>{t("الورديات", "Shifts")}</h2>
          <p className="muted">
            Asia/Riyadh ·{" "}
            {t("المرجع الافتراضي 08:00", "Default scheduling reference 08:00")}
          </p>
          {data.shifts.map((s: any, i: number) => (
            <div className="rule-row" key={s.id}>
              <strong>{s.name}</strong>
              <label>
                {t("تبدأ", "Start")}
                <input
                  aria-label={"Shift start " + s.id}
                  type="number"
                  min="0"
                  max="23"
                  value={s.start_hour}
                  onChange={(e) => {
                    const shifts = [...data.shifts];
                    shifts[i] = { ...s, start_hour: +e.target.value };
                    setData({ ...data, shifts });
                  }}
                />
              </label>
              <label>
                {t("ساعات", "Hours")}
                <input
                  aria-label={"Shift hours " + s.id}
                  type="number"
                  min="1"
                  max="12"
                  value={s.hours}
                  onChange={(e) => {
                    const shifts = [...data.shifts];
                    shifts[i] = { ...s, hours: +e.target.value };
                    setData({ ...data, shifts });
                  }}
                />
              </label>
            </div>
          ))}
          <Button
            size="sm"
            onClick={() =>
              run(async () => {
                await api(
                  "/settings/shifts",
                  data.shifts.map((s: any) => ({
                    id: s.id,
                    name: s.name,
                    startHour: s.start_hour,
                    hours: s.hours,
                  })),
                );
                notify(t("تم حفظ الورديات", "Shifts saved"));
              })
            }
          >
            {t("حفظ الورديات", "Save shifts")}
          </Button>
        </Card>
        <Card>
          <h2>{t("ربط المشاريع بالمواقع", "Project-to-site mapping")}</h2>
          <p className="muted">
            {t(
              "رقم المشروع لا يساوي SITEID. جميع المواقع الحالية خيالية.",
              "A project number is distinct from SITEID. Seeded sites are fictitious.",
            )}
          </p>
          {data.projects.map((r: any, i: number) => (
            <div className="rule-row" key={r.id}>
              <strong>{r.id}</strong>
              <span>{r.name}</span>
              <input
                aria-label={"Project site " + r.id}
                value={r.site_id}
                onChange={(e) => {
                  const projects = [...data.projects];
                  projects[i] = { ...r, site_id: e.target.value };
                  setData({ ...data, projects });
                }}
              />
            </div>
          ))}
          <Button
            size="sm"
            onClick={() =>
              run(async () => {
                await api(
                  "/settings/projects",
                  data.projects.map((r: any) => ({
                    id: r.id,
                    name: r.name,
                    siteId: r.site_id,
                  })),
                );
                notify(t("تم حفظ ربط المواقع", "Project mappings saved"));
              })
            }
          >
            {t("حفظ الربط", "Save mapping")}
          </Button>
        </Card>
        <Card>
          <h2>{t("التقويم والعطلات", "Calendar & holidays")}</h2>
          <label>
            {t(
              "تواريخ العطلات (تفصل بفاصلة)",
              "Holiday dates (comma separated)",
            )}
            <input
              aria-label="Holidays"
              value={holiday}
              onChange={(e) => setHoliday(e.target.value)}
              placeholder="2026-10-23,2026-10-30"
            />
          </label>
          <Button
            size="sm"
            onClick={() =>
              run(async () => {
                await api("/settings/calendar", {
                  holidays: holiday
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  restrictedBuildings: [],
                });
                notify(t("تم حفظ التقويم", "Calendar saved"));
              })
            }
          >
            {t("حفظ التقويم", "Save calendar")}
          </Button>
        </Card>
        <Card>
          <h2>{t("الموارد المؤكدة", "Confirmed labor resources")}</h2>
          {data.labor.map((l: any) => (
            <div className="labor-row" key={l.id}>
              <Users size={19} />
              <div>
                <strong>
                  {l.name} · {l.id}
                </strong>
                <small>
                  {l.skills.join(", ")} · {l.siteIds.join(", ")} · shifts{" "}
                  {l.shifts.join(", ")}
                </small>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
