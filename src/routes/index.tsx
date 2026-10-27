import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Plus, BookOpen, PanelRight, LogOut, Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/components/auth-provider";
import { useWorkspace } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";
import { generatePlan, interpretCheckIn, suggestGoal } from "@/lib/ai.functions";
import {
  parseTarget, updateGoal, tasksForDay, activeMilestone, addDays, bestStreak, dayState, daysBetween, fmt, fmtLong, goalPct, iso,
  milestonePct, paceLabel, parseIso, streak, uid, weekDays,
  type Entry, type Goal, type Milestone, type Op, type Proposal, type Task,
} from "@/lib/goals";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OpenGoals — Daily check-in workspace" },
      { name: "description", content: "Check in on your goal, log progress in plain language and let AI adapt your plan." },
      { property: "og:title", content: "OpenGoals — Daily check-in workspace" },
      { property: "og:description", content: "Check in on your goal, log progress in plain language and let AI adapt your plan." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: App,
});

type Draft = { title: string; targetDate: string; milestones: Milestone[]; tasks: Task[]; notes?: string | undefined; tokens: number };
type Phase = "setup-goal" | "setup-date" | "review" | "workspace";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9:.]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);

function App() {
  const [today, setToday] = useState(() => iso(new Date()));
  const { workspace, setWorkspace, loaded, status: saveStatus, error: storageError, guestAvailable, importGuest, reload } = useWorkspace();
  const { user } = useAccount();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const goal = workspace.goals.find((g) => g.id === workspace.activeGoalId) ?? null;
  const setGoal = (update: (g: Goal | null) => Goal | null) => {
    const id = goal?.id;
    if (!id) return;
    setWorkspace((w) => updateGoal(w, id, (g) => update(g) ?? g));
  };
  const [showPanel, setShowPanel] = useState(false);
  const requestBusy = useRef(false);
  const [setupCalls, setSetupCalls] = useState<{ date: string; tokens: number }[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  const [phase, setPhase] = useState<Phase>("setup-goal");
  const [setupLog, setSetupLog] = useState<Entry[]>([]);
  const [pendingTitle, setPendingTitle] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<"INSERT" | "NORMAL">("INSERT");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const suggestFn = useServerFn(suggestGoal);
  const planFn = useServerFn(generatePlan);
  const checkInFn = useServerFn(interpretCheckIn);

  useEffect(() => {
    const refresh = () => setToday(iso(new Date()));
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  useEffect(() => {
    if (loaded) setPhase(goal ? "workspace" : "setup-goal");
  }, [loaded]);
  useEffect(() => { setCursor(0); }, [goal?.id, today]);
  async function request<T>(label: string, call: () => Promise<T>): Promise<T | null> {
    if (requestBusy.current) return null;
    requestBusy.current = true; setBusy(label);
    try { return await call(); }
    catch { say({ type: "reply", text: "The request failed. Your saved plan is unchanged; try again when ready.", tone: "error" }); return null; }
    finally { requestBusy.current = false; setBusy(null); }
  }
  async function signOut() {
    if (busy || saveStatus === "saving" || saveStatus === "not saved") return;
    setSigningOut(true);
    try {
      await queryClient.cancelQueries(); queryClient.clear();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      await navigate({ to: "/auth", replace: true });
    } catch { say({ type: "reply", text: "Sign-out failed. Please try again.", tone: "error" }); }
    finally { setSigningOut(false); }
  }
  function exportBackup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "opengoals-backup.json"; link.click(); URL.revokeObjectURL(url);
  }
  function switchGoal(id: string) {
    if (busy || requestBusy.current || phase !== "workspace") return;
    setWorkspace((w) => ({ ...w, activeGoalId: id })); setInput(""); setMode("INSERT");
  }
  const log = phase === "workspace" ? goal?.log ?? [] : setupLog;
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log.length, busy, draft]);
  useEffect(() => inputRef.current?.focus(), [loaded, phase]);

  const say = (...entries: Entry[]) => {
    if (phase === "workspace") setGoal((g) => (g ? { ...g, log: [...g.log, ...entries] } : g));
    else setSetupLog((l) => [...l, ...entries]);
  };
  const recordAi = (tokens: number) =>
    setGoal((g) => (g ? { ...g, aiCalls: [...g.aiCalls, { date: today, tokens }] } : g));

  const todayTasks = phase === "workspace" && goal ? tasksForDay(goal, today) : [];

  // ---------- setup ----------
  async function makePlan(title: string, targetDate: string, notes?: string) {
    const r = await request("generating plan", () => planFn({ data: { title, targetDate, today, notes } }));
    if (!r) return;
    if (!r.ok) return say({ type: "reply", text: r.error, tone: "error" });
    setSetupCalls((calls) => [...calls, { date: today, tokens: r.tokens }]);
    const milestones = (r.data.milestones ?? []).slice(0, 8);
    const tasks: Task[] = (r.data.tasks ?? []).map((t) => ({
      id: uid(), title: t.title, date: t.date, status: "todo",
      milestone: Math.min(Math.max(0, t.milestone ?? 0), milestones.length - 1),
    }));
    if (!milestones.length || !tasks.length) return say({ type: "reply", text: "The plan came back empty. Press r to try again.", tone: "error" });
    setDraft({ title, targetDate, milestones, tasks, notes, tokens: r.tokens });
    setPhase("review");
  }

  async function handleSetup(text: string) {
    if (phase === "setup-goal") {
      if (text.startsWith("/suggest")) {
        const idea = text.slice(8).trim();
        say({ type: "user", text });
        const r = await request("thinking", () => suggestFn({ data: { idea, today } }));
        if (!r) return;
        if (!r.ok) return say({ type: "reply", text: r.error, tone: "error" });
        setSetupCalls((calls) => [...calls, { date: today, tokens: r.tokens }]);
        setPendingTitle(r.data.title);
        say({ type: "ops", meta: "suggested goal · 1 AI call", ops: [{ kind: "schedule", text: `${r.data.title} · by ${fmt(r.data.targetDate)}` }] },
          { type: "reply", text: `${r.data.why} Press enter to accept ${r.data.targetDate}, or type your own date.` });
        setInput(r.data.targetDate);
        setPhase("setup-date");
        return;
      }
      say({ type: "user", text }, { type: "reply", text: "When do you want to get there? A date (2027-03-28) or a span (12 weeks, 6 months)." });
      setPendingTitle(text);
      setPhase("setup-date");
      return;
    }
    if (phase === "setup-date") {
      const d = parseTarget(text, today);
      say({ type: "user", text });
      if (!d) return say({ type: "reply", text: "I need a future date like 2027-03-28 or a span like 12 weeks.", tone: "error" });
      await makePlan(pendingTitle, d);
      return;
    }
    if (phase === "review" && draft) {
      say({ type: "user", text: `revise: ${text}` });
      await makePlan(draft.title, draft.targetDate, text);
    }
  }

  function acceptDraft() {
    if (!draft || busy || requestBusy.current) return;
    const newGoal: Goal = {
      id: uid(),
      title: draft.title, targetDate: draft.targetDate, startDate: today, milestones: draft.milestones,
      tasks: draft.tasks, session: 1, aiCalls: setupCalls,
      log: [...setupLog, { type: "reply", text: `Plan locked in. ${draft.milestones.length} milestones, ${draft.tasks.length} tasks over the next two weeks. Check in whenever you've done something.` }],
    };
    setWorkspace((w) => ({ ...w, goals: [...w.goals, newGoal], activeGoalId: newGoal.id }));
    setSetupCalls([]);
    setDraft(null);
    setSetupLog([]);
    setPhase("workspace");
  }

  function startOver() {
    if (busy || requestBusy.current) return;
    setSetupCalls([]);
    setInput(""); setMode("INSERT");
    setDraft(null);
    setSetupLog([]);
    setPhase("setup-goal");
  }

  // ---------- workspace ----------
  const toggle = (id: string) =>
    setGoal((g) => g && { ...g, tasks: g.tasks.map((t) => (t.id === id ? { ...t, status: t.status === "done" ? "todo" : "done" } : t)) });

  function resolveProposal(pid: string, state: "accepted" | "rejected") {
    setGoal((g) => {
      if (!g) return g;
      const entry = g.log.find((e) => e.type === "proposal" && e.proposal.id === pid);
      if (!entry || entry.type !== "proposal" || entry.proposal.state !== "open") return g;
      const p = entry.proposal;
      const log = g.log.map((e) => (e === entry ? { ...e, proposal: { ...p, state } } : e));
      if (state === "rejected") return { ...g, log: [...log, { type: "reply", text: "Kept the current plan." }] };
      const tasks = g.tasks
        .filter((t) => !p.removeTaskIds.includes(t.id) || t.status !== "todo")
        .concat(p.add.map((a) => ({ id: uid(), title: a.title, date: a.date, status: "todo" as const, milestone: Math.max(0, Math.min(a.milestone, g.milestones.length - 1)) })));
      return { ...g, tasks, log: [...log, { type: "reply", text: `Plan updated: ${p.removeTaskIds.length} removed, ${p.add.length} added.` }] };
    });
  }

  async function replan() {
    if (!goal) return;
    const r = await request("re-planning next 14 days", () => planFn({
      data: {
        title: goal.title, targetDate: goal.targetDate, today,
        existingMilestones: goal.milestones.map((m, i) => ({ ...m, pct: milestonePct(goal.tasks, i) })),
      },
    }));
    if (!r) return;
    if (!r.ok) return say({ type: "reply", text: r.error, tone: "error" });
    recordAi(r.tokens);
    const ms = goal.milestones;
    setGoal((g) => g && {
      ...g, milestones: ms,
      tasks: [
        ...g.tasks.filter((t) => t.date < today || t.status !== "todo"),
        ...(r.data.tasks ?? []).filter((t) => t.date >= today).map((t) => ({ id: uid(), title: t.title, date: t.date, status: "todo" as const, milestone: Math.min(t.milestone ?? 0, ms.length - 1) })),
      ],
      log: [...g.log, { type: "ops", meta: `re-planned · 1 AI call · ${r.tokens} tokens`, ops: [{ kind: "schedule", text: `${(r.data.tasks ?? []).length} tasks scheduled from ${fmt(today)}` }] }],
    });
  }

  async function checkIn(text: string) {
    if (!goal) return;
    say({ type: "user", text });
    const window = goal.tasks.filter((t) => t.date <= addDays(today, 7) && (t.date >= addDays(today, -3) || t.status === "todo"));
    const skips = goal.tasks.filter((t) => t.status === "skipped" && t.date >= addDays(today, -14)).map((t) => `${t.date} ${t.title}`).join("; ");
    const r = await request("reading check-in", () => checkInFn({
      data: {
        text, today, goal: goal.title, skipHistory: skips,
        tasks: window.map(({ id, title, date, status }) => ({ id, title, date, status })),
        milestones: goal.milestones.map((m, i) => ({ index: i, ...m, pct: milestonePct(goal.tasks, i) })),
      },
    }));
    if (!r) return;
    if (!r.ok) return say({ type: "reply", text: r.error, tone: "error" });
    recordAi(r.tokens);
    setGoal((g) => {
      if (!g) return g;
      let tasks = [...g.tasks];
      const ops: Op[] = [];
      for (const o of r.data.ops ?? []) {
        if ((o.op === "complete" || o.op === "skip") && o.taskId) {
          const t = tasks.find((x) => x.id === o.taskId);
          if (!t) continue;
          tasks = tasks.map((x) => (x.id === t.id ? { ...x, status: o.op === "complete" ? "done" : "skipped", reason: o.reason } : x));
          ops.push({ kind: o.op, text: `task.${o.op} ${t.title}${o.reason ? ` (reason: ${o.reason})` : ""}` });
        } else if (o.op === "schedule" && o.title && o.date) {
          tasks.push({ id: uid(), title: o.title, date: o.date, status: "todo", milestone: Math.min(o.milestone ?? activeMilestone(g), g.milestones.length - 1) });
          ops.push({ kind: "schedule", text: `task.schedule ${o.title} · ${fmtLong(o.date)}` });
        }
      }
      const entries: Entry[] = [
        { type: "ops", meta: `understood check-in · 1 AI call · ${r.tokens} tokens`, ops: ops.length ? ops : [{ kind: "info", text: "no task changes" }] },
        { type: "reply", text: r.data.reply || "Logged." },
      ];
      const p = r.data.proposal;
      if (p && (p.add?.length || p.removeTaskIds?.length)) {
        entries.push({ type: "proposal", proposal: { id: uid(), title: p.title, reason: p.reason, note: p.note, removeTaskIds: p.removeTaskIds ?? [], add: p.add ?? [], state: "open" } });
      }
      return { ...g, tasks, log: [...g.log, ...entries] };
    });
  }

  function command(text: string) {
    if (!goal) return;
    const cmd = text.slice(1).split(" ")[0] ?? "";
    const local = (msg: string) => say({ type: "user", text }, { type: "reply", text: msg });
    if (cmd === "help") return local("/today · /plan · /replan (AI) · /clear confirm · /new (adds a goal) · /docs");
    if (cmd === "docs") return void navigate({ to: "/docs" });
    if (cmd === "today") {
      const open = todayTasks.filter((t) => t.status === "todo");
      return local(open.length ? `Open: ${open.map((t) => t.title).join(", ")}.` : "Nothing open today.");
    }
    if (cmd === "plan" ) return local(goal.milestones.map((m, i) => `M${i + 1} ${m.title} ${milestonePct(goal.tasks, i)}% (${fmt(m.due)})`).join(" → ") + "\n" + [...goal.tasks].sort((a,b) => a.date.localeCompare(b.date)).map((t) => `${fmtLong(t.date)} · ${t.title} (${t.status})`).join("\n"));
    if (cmd === "replan") { say({ type: "user", text }); return void replan(); }
    if (cmd === "clear") {
      if (text.trim() === "/clear confirm") return setGoal((g) => g && { ...g, log: [] });
      return local("This clears this goal's conversation history only. Type /clear confirm to continue.");
    }
    if (cmd === "new") return startOver();
    local(`unknown command: /${cmd} — try /help`);
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy || requestBusy.current || text.length > 2000) return;
    setInput("");
    if (text === "/new") return startOver();
    if (text === "/docs") return void navigate({ to: "/docs" });
    if (phase !== "workspace") return handleSetup(text);
    if (text.startsWith("/")) return command(text);
    await checkIn(text);
  }

  const openProposal = [...(goal?.log ?? [])].reverse().find((e) => e.type === "proposal" && e.proposal.state === "open") as
    | Extract<Entry, { type: "proposal" }> | undefined;

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || requestBusy.current) return;
      const element = e.target as HTMLElement;
      if (element !== inputRef.current && element.closest("input, select, textarea, button, a")) return;
      if (e.ctrlKey && e.key === "p" && phase === "workspace") { e.preventDefault(); command("/plan"); return; }
      if (mode === "INSERT") {
        if (e.key === "Escape" || (e.key === "Tab" && phase === "workspace")) {
          e.preventDefault(); setMode("NORMAL"); inputRef.current?.blur();
        } else if (phase === "review" && !input && (e.key === "a" || e.key === "r")) {
          e.preventDefault();
          if (e.key === "a") acceptDraft(); else if (draft && !busy) void makePlan(draft.title, draft.targetDate, draft.notes);
        }
        return;
      }
      const k = e.key;
      if (k === "i" || k === "/" || k === "Enter" || k === "Tab") {
        e.preventDefault(); setMode("INSERT"); inputRef.current?.focus();
        if (k === "/") setInput("/");
      } else if (k === "j" || k === "ArrowDown") setCursor((c) => Math.max(0, Math.min(todayTasks.length - 1, c + 1)));
      else if (k === "k" || k === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
      else if (k === " ") { e.preventDefault(); const t = todayTasks[cursor]; if (t) toggle(t.id); }
      else if (k === "a" && openProposal) resolveProposal(openProposal.proposal.id, "accepted");
      else if (k === "r" && openProposal) resolveProposal(openProposal.proposal.id, "rejected");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!loaded) return <main className="min-h-dvh bg-background p-6"><p>{storageError || "Loading your workspace…"}</p>{storageError && <Button className="mt-4" onClick={reload}>Try loading again</Button>}<Link to="/docs" className="ml-4 text-primary">Docs</Link></main>;

  // ---------- derived ----------
  const target = phase === "workspace" ? goal?.targetDate : draft?.targetDate;
  const daysLeft = target ? daysBetween(today, target) : null;
  const done = todayTasks.filter((t) => t.status === "done").length;
  const planned = todayTasks.filter((t) => t.status !== "skipped").length;
  const aiToday = goal?.aiCalls.filter((c) => c.date === today).length ?? 0;
  const aiWeek = goal?.aiCalls.filter((c) => c.date >= (weekDays(today)[0] ?? today)).length ?? 0;
  const active = goal ? activeMilestone(goal) : 0;
  const nextTask = goal?.tasks.filter((t) => t.status === "todo" && t.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const placeholder =
    phase === "setup-goal" ? "What do you want to achieve? or /suggest <interest>"
    : phase === "setup-date" ? "Target date: 2027-03-28 or 12 weeks"
    : phase === "review" ? "Type changes to revise the plan, or press a to accept"
    : "Tell me what you did, or type / for commands";

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-bold text-primary">opengoals</span>
          <span className="text-subtle">/</span>
          <span className="truncate text-muted-foreground">{phase === "workspace" && goal ? slug(goal.title) : draft ? slug(draft.title) : "new-goal"}</span>
          <span className="text-subtle">/</span>
          <span>{phase === "workspace" && goal ? `session ${goal.session}` : phase === "review" ? "plan review" : "setup"}</span>
        </div>
        <div className="hidden text-muted-foreground sm:block">
          {fmtLong(today)}{daysLeft !== null && ` · ${daysLeft} days left`} · <span className="text-success">●</span> {saveStatus}
        </div>
      </header>

      <nav className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2" aria-label="Workspace controls">
        <select aria-label="Selected goal" value={workspace.activeGoalId ?? ""} disabled={!!busy || phase !== "workspace"} onChange={(e) => switchGoal(e.target.value)} className="min-w-40 max-w-full basis-full border border-input bg-panel px-2 py-1 text-foreground sm:max-w-64 sm:basis-auto sm:flex-1">
          {!workspace.goals.length && <option value="">No saved goals</option>}
          {workspace.goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
        <Button size="sm" variant="ghost" disabled={!!busy || phase !== "workspace"} onClick={startOver}><Plus />Add goal</Button>
        {phase !== "workspace" && goal && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setDraft(null); setSetupLog([]); setSetupCalls([]); setInput(""); setPhase("workspace"); }}>Cancel draft</Button>}
        <Button size="sm" variant="ghost" disabled={!!busy} asChild><Link to="/docs"><BookOpen />Docs</Link></Button>
        <Button size="sm" variant="ghost" className="md:hidden" onClick={() => setShowPanel((v) => !v)} aria-expanded={showPanel}><PanelRight />{showPanel ? "Close plans" : "Plans"}</Button>
        <Button size="sm" variant="ghost" title="Export backup" aria-label="Export backup" onClick={exportBackup}><Download /></Button>
        {user ? <Button size="sm" variant="ghost" disabled={!!busy || signingOut || saveStatus === "saving" || saveStatus === "not saved"} title={user.email} onClick={() => void signOut()}><LogOut />Sign out</Button> : <Button size="sm" variant="ghost" disabled={!!busy} asChild><Link to="/auth">Sign in</Link></Button>}
        <span role="status" className="text-xs text-muted-foreground">{saveStatus}</span>
        {user && guestAvailable && <Button size="sm" variant="outline" disabled={!!busy} onClick={importGuest}>Import browser goals</Button>}
      </nav>
      {storageError && <p role="alert" className="shrink-0 border-b border-border px-4 py-2 text-destructive">{storageError}</p>}
      <div className="relative flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {phase === "workspace" && goal ? (
              <p className="text-muted-foreground">
                Day {daysBetween(goal.startDate, today) + 1} of {daysBetween(goal.startDate, goal.targetDate) + 1} · M{active + 1} {goal.milestones[active]?.title} · {todayTasks.length} tasks for today
              </p>
            ) : (
              <SetupIntro />
            )}
            <div className="mt-5 max-w-4xl space-y-5">
              {log.map((e, i) => (
                <LogEntry key={i} entry={e} onResolve={resolveProposal} />
              ))}
              {phase === "review" && draft && <PlanReview draft={draft} busy={!!busy} onAccept={acceptDraft} onRegenerate={() => void makePlan(draft.title, draft.targetDate, draft.notes)} />}
              {busy && <p className="text-muted-foreground"><span className="caret text-primary">▍</span> {busy}…</p>}
            </div>
          </div>

          <div className="shrink-0 border-t border-border px-6 py-4">
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex items-center gap-3">
              <span className="text-primary">&gt;</span>
              <input
                ref={inputRef}
                value={input}
                disabled={!!busy}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => setMode("INSERT")}
                placeholder={busy ? "working…" : placeholder}
                maxLength={phase === "workspace" ? 2000 : phase === "review" ? 1000 : 300}
                className="min-w-0 flex-1 bg-transparent caret-primary outline-none placeholder:text-muted-foreground disabled:opacity-60"
                aria-label="Command input"
              />
            </form>
            <p className="mt-3 text-subtle">
              {phase === "workspace"
                ? <>enter send · tab tasks · space toggle done · / commands · ctrl+p plan{openProposal && " · esc then a accept / r reject"}</>
                : phase === "review" ? "a accept plan · r regenerate · type + enter to revise · esc then /new to restart"
                : "enter next · /suggest asks AI for a realistic goal"}
            </p>
          </div>
        </main>

        <aside aria-label="Goal plans" className={cn("w-full shrink-0 overflow-y-auto border-l border-border bg-panel px-5 py-6 md:block md:w-[380px]", showPanel ? "absolute inset-0 z-10 md:static" : "hidden")}>
          {phase === "workspace" && goal ? (
            <>
              <Section title="GOAL">
                <p className="font-bold">{goal.title}</p>
                <p className="mt-1 text-muted-foreground">Target {fmt(goal.targetDate)} {goal.targetDate.slice(0, 4)}</p>
                <div className="mt-3 flex items-center gap-3"><Bar pct={goalPct(goal)} /><span>{goalPct(goal)}%</span></div>
              </Section>

              <Section title={`TODAY · ${done}/${planned}`}>
                {todayTasks.length === 0 && <p className="text-muted-foreground">No tasks today. Rest, or /replan.</p>}
                <ul>
                  {todayTasks.map((t, i) => (
                    <li key={t.id}>
                      <Button variant="ghost"
                        disabled={!!busy}
                        onClick={() => { setCursor(i); toggle(t.id); }}
                        className={cn(
                          "-mx-1.5 h-auto w-full justify-start items-start gap-2 whitespace-normal px-1.5 py-1 text-left text-xs",
                          mode === "NORMAL" && cursor === i && "bg-accent",
                          t.status === "done" && "text-success",
                          t.status === "skipped" && "text-muted-foreground",
                        )}
                      >
                        <span className="w-2 shrink-0 text-primary">{mode === "NORMAL" && cursor === i ? "▸" : ""}</span>
                        <span className="shrink-0">{t.status === "done" ? "[x]" : t.status === "skipped" ? "[-]" : "[ ]"}</span>
                        <span>
                          {t.title}
                          {t.status === "skipped" && " (skipped)"}
                          {t.date < today && t.status === "todo" && <span className="text-destructive"> · overdue</span>}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section title="UPCOMING DAY PLANS"><DayPlans tasks={goal.tasks.filter((t) => t.date > today)} /></Section>
              <Section title="MILESTONES">
                <MilestoneList milestones={goal.milestones} tasks={goal.tasks} active={active} />
              </Section>

              <Section title="THIS WEEK">
                <p className="flex gap-2">
                  {weekDays(today).map((d) => {
                    const s = dayState(goal.tasks, d);
                    return (
                      <span key={d} className={cn(d === today && "underline underline-offset-4")}>
                        {"MTWTFSS"[(parseIso(d).getDay() + 6) % 7]}{" "}
                        <span className={cn(s === "done" && "text-success", s === "partial" && "text-primary")}>{s === "empty" ? "□" : "■"}</span>
                      </span>
                    );
                  })}
                </p>
                <p className="mt-1 text-muted-foreground">streak {streak(goal.tasks, today)}d · best {bestStreak(goal.tasks)}</p>
              </Section>

              <Section title="AI USAGE">
                <p>{aiToday} call{aiToday === 1 ? "" : "s"} today · {aiWeek} this week</p>
                <p className="mt-1 text-muted-foreground">tracking, streaks, deadlines run locally</p>
              </Section>
            </>
          ) : draft ? (
            <>
              <Section title="DRAFT GOAL">
                <p className="font-bold">{draft.title}</p>
                <p className="mt-1 text-muted-foreground">Target {fmt(draft.targetDate)} {draft.targetDate.slice(0, 4)}</p>
              </Section>
              <Section title="DAY PLANS"><DayPlans tasks={draft.tasks} /></Section>
              <Section title="MILESTONES"><MilestoneList milestones={draft.milestones} tasks={draft.tasks} active={0} /></Section>
            </>
          ) : (
            <Section title="HOW IT WORKS">
              <ol className="space-y-2 text-muted-foreground">
                <li><span className="text-foreground">1</span> name a goal and a date</li>
                <li><span className="text-foreground">2</span> AI drafts milestones and daily tasks</li>
                <li><span className="text-foreground">3</span> check in daily in plain words</li>
                <li><span className="text-foreground">4</span> accept or reject plan changes</li>
              </ol>
              <p className="mt-4 text-subtle">Saved in this browser. AI is only called for plans and check-ins.</p>
            </Section>
          )}
        </aside>
      </div>

      <footer className="flex h-7 shrink-0 items-center justify-between gap-3 bg-primary px-4 text-xs font-medium text-primary-foreground">
        <span className="shrink-0">{mode} · {phase === "workspace" ? "check-in" : phase === "review" ? "plan review" : "goal setup"}</span>
        <span className="min-w-0 truncate">
          {goal ? `${paceLabel(goal, today)} · next: ${nextTask ? `${nextTask.title.toLowerCase()} ${nextTask.date === today ? "today" : fmtLong(nextTask.date).split(" ")[0]}` : "/replan"}` : "no goal yet"}
        </span>
      </footer>
    </div>
  );
}

function SetupIntro() {
  return (
    <div className="space-y-1">
      <p className="text-primary">opengoals · new goal</p>
      <p className="text-muted-foreground">Type what you want to achieve, e.g. "run a half marathon under 2:15".</p>
      <p className="text-muted-foreground">Not sure? <span className="text-foreground">/suggest learning spanish</span></p>
    </div>
  );
}

function PlanReview({ draft, busy, onAccept, onRegenerate }: { draft: Draft; busy: boolean; onAccept: () => void; onRegenerate: () => void }) {
  const byDate = new Map<string, Task[]>();
  draft.tasks.forEach((t) => byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]));
  return (
    <div className={cn("border border-border p-4", busy && "opacity-50")}>
      <p className="font-bold text-primary">proposed plan · {draft.title}</p>
      <p className="mt-1 text-muted-foreground">{draft.milestones.length} milestones · {draft.tasks.length} tasks for the next 14 days · {draft.tokens} tokens</p>
      <div className="mt-4 space-y-1">
        {draft.milestones.map((m, i) => (
          <p key={i}><span className="text-primary">M{i + 1}</span> · {m.title} <span className="text-muted-foreground">· {fmt(m.due)}</span></p>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {[...byDate.entries()].sort().map(([d, ts]) => (
          <div key={d} className="flex gap-4">
            <span className="w-24 shrink-0 text-muted-foreground">{fmtLong(d)}</span>
            <span className="text-success">{ts.map((t) => `+ ${t.title}`).join("   ")}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-3"><Button size="sm" disabled={busy} onClick={onAccept}>Accept plan</Button><Button size="sm" variant="outline" disabled={busy} onClick={onRegenerate}>Regenerate</Button></div>
    </div>
  );
}

function DayPlans({ tasks }: { tasks: Task[] }) {
  const dates = [...new Set(tasks.map((t) => t.date))].sort();
  return <div className="space-y-4">{!dates.length && <p className="text-muted-foreground">No upcoming tasks scheduled.</p>}{dates.map((date) => <div key={date}><h3 className="mb-1 text-primary">{fmtLong(date)}</h3><ul className="space-y-1">{tasks.filter((t) => t.date === date).map((t) => <li key={t.id} className={cn("break-words", t.status === "done" && "text-success", t.status === "skipped" && "text-muted-foreground")}>{t.status === "done" ? "[x]" : t.status === "skipped" ? "[-]" : "[ ]"} {t.title}</li>)}</ul></div>)}</div>;
}

function MilestoneList({ milestones, tasks, active }: { milestones: Milestone[]; tasks: Task[]; active: number }) {
  return (
    <ul className="space-y-1">
      {milestones.map((m, i) => {
        const pct = milestonePct(tasks, i);
        const state = pct === 100 ? "done" : i === active ? "active" : "todo";
        return (
          <li key={i} className={cn(state === "done" && "text-success", state === "todo" && "text-muted-foreground")}>
            <span className={cn(state === "active" && "text-primary")}>{state === "done" ? "✓" : state === "active" ? "●" : "○"}</span>{" "}
            M{i + 1} · {m.title} {state === "done" ? "done" : state === "active" ? `${pct}%` : fmt(m.due)}
          </li>
        );
      })}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Bar({ pct }: { pct: number }) {
  const total = 16;
  const filled = Math.round((pct / 100) * total);
  return (
    <span aria-label={`${pct}% complete`}>
      <span className="text-primary">{"█".repeat(filled)}</span>
      <span className="text-subtle">{"░".repeat(total - filled)}</span>
    </span>
  );
}

function LogEntry({ entry, onResolve }: { entry: Entry; onResolve: (id: string, s: "accepted" | "rejected") => void }) {
  if (entry.type === "user")
    return <p className="flex gap-3"><span className="text-primary">&gt;</span><span>{entry.text}</span></p>;
  if (entry.type === "ops")
    return (
      <div className="space-y-1.5 border-l-2 border-border pl-4">
        <p className="text-muted-foreground">{entry.meta}</p>
        {entry.ops.map((o, i) => (
          <p key={i} className={cn(o.kind === "complete" ? "text-success" : "text-muted-foreground")}>
            {o.kind === "complete" ? "✓" : o.kind === "skip" ? "–" : o.kind === "schedule" ? "+" : "·"} {o.text}
          </p>
        ))}
      </div>
    );
  if (entry.type === "reply") return <p className={cn("whitespace-pre-wrap break-words", entry.tone === "error" && "text-destructive")}>{entry.text}</p>;
  const p: Proposal = entry.proposal;
  return (
    <div className={cn("border border-border p-4", p.state !== "open" && "opacity-60")}>
      <p className="font-bold text-primary">proposed change · {p.title}</p>
      <p className="mt-1 text-muted-foreground">{p.reason}</p>
      {p.removeTaskIds.length > 0 && <p className="mt-3 text-destructive">- {p.removeTaskIds.length} upcoming task{p.removeTaskIds.length > 1 ? "s" : ""} removed</p>}
      {p.add.map((a, i) => <p key={i} className="mt-1 text-success">+ {fmtLong(a.date)} · {a.title}</p>)}
      {p.note && <p className="mt-3 text-muted-foreground">{p.note}</p>}
      <div className="mt-4 flex items-center gap-3 text-muted-foreground">
        {p.state === "open" ? (
          <>
            <Button variant="ghost" onClick={() => onResolve(p.id, "accepted")} className="bg-primary px-2 text-primary-foreground">a accept</Button>
            <Button variant="ghost" onClick={() => onResolve(p.id, "rejected")} className="hover:text-foreground">r reject</Button>
          </>
        ) : <span>{p.state === "accepted" ? "✓ accepted" : "✗ rejected"}</span>}
      </div>
    </div>
  );
}
