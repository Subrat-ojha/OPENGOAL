import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

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
  component: Workspace,
});

type TaskStatus = "todo" | "done" | "skipped";
type Task = { id: string; title: string; status: TaskStatus; keywords: string[] };
type Op = { kind: "complete" | "skip" | "schedule" | "info"; text: string };
type Entry =
  | { type: "user"; text: string }
  | { type: "ops"; meta: string; ops: Op[] }
  | { type: "reply"; node: ReactNode }
  | { type: "proposal"; id: string; state: "open" | "accepted" | "rejected" | "why" };

const initialTasks: Task[] = [
  { id: "t1", title: "Tempo run, 5 km", status: "done", keywords: ["tempo", "5k"] },
  { id: "t2", title: "Log weekly mileage", status: "done", keywords: ["mileage", "log"] },
  { id: "t3", title: "Stretch, 10 min", status: "todo", keywords: ["stretch"] },
  { id: "t4", title: "Strength A", status: "skipped", keywords: ["strength", "gym"] },
];

const milestones = [
  { id: "M1", title: "Run 3x/week", state: "done", meta: "done" },
  { id: "M2", title: "Build base", state: "active", meta: "58%" },
  { id: "M3", title: "10 km steady", state: "todo", meta: "Dec 20" },
  { id: "M4", title: "Long run 16 km", state: "todo", meta: "Feb 14" },
  { id: "M5", title: "Taper and race", state: "todo", meta: "Mar 28" },
];

const week: { d: string; s: "done" | "partial" | "empty" }[] = [
  { d: "M", s: "done" }, { d: "T", s: "done" }, { d: "W", s: "done" }, { d: "T", s: "done" },
  { d: "F", s: "partial" }, { d: "S", s: "empty" }, { d: "S", s: "empty" },
];

const initialLog: Entry[] = [
  { type: "user", text: "check in: did the 5k tempo, legs felt strong. skipped strength, work ran late. tomorrow is an easy run." },
  {
    type: "ops",
    meta: "understood check-in · 1 AI call · 412 tokens",
    ops: [
      { kind: "complete", text: "task.complete Tempo run, 5 km" },
      { kind: "skip", text: "task.skip Strength A (reason: work)" },
      { kind: "complete", text: "task.complete Log weekly mileage" },
      { kind: "schedule", text: "task.schedule Easy run 6 km · Tue 27 Oct" },
    ],
  },
  {
    type: "reply",
    node: (
      <>
        Logged. Tempo counts toward <span className="text-primary">M2 · Build base</span>, now 58% done. Streak holds at 9 days.
      </>
    ),
  },
  { type: "proposal", id: "p1", state: "open" },
];

function Workspace() {
  const [tasks, setTasks] = useState(initialTasks);
  const [log, setLog] = useState<Entry[]>(initialLog);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"INSERT" | "NORMAL">("INSERT");
  const [cursor, setCursor] = useState(2);
  const [aiCalls, setAiCalls] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const done = tasks.filter((t) => t.status === "done").length;
  const planned = tasks.filter((t) => t.status !== "skipped").length;
  const openProposal = log.find((e) => e.type === "proposal" && e.state === "open") as
    | Extract<Entry, { type: "proposal" }>
    | undefined;

  const goalPct = useMemo(() => 8 + done, [done]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

  const toggle = (i: number) =>
    setTasks((ts) =>
      ts.map((t, idx) => (idx === i ? { ...t, status: t.status === "done" ? "todo" : "done" } : t)),
    );

  const resolveProposal = (state: "accepted" | "rejected" | "why") => {
    if (!openProposal) return;
    setLog((l) => {
      const next = l.map((e) =>
        e.type === "proposal" && e.id === openProposal.id ? { ...e, state: state === "why" ? ("open" as const) : state } : e,
      );
      const msg =
        state === "accepted"
          ? "Plan updated. Strength A moves to Wednesdays, 25 min. M2 deadline unchanged."
          : state === "rejected"
            ? "Kept the current strength plan. I'll check again next week."
            : "You skipped strength 3 of the last 4 sessions, mostly on workdays. A single shorter session is more likely to stick.";
      return [...next, { type: "reply", node: msg }];
    });
  };

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (text.startsWith("/")) {
      const cmd = text.slice(1).split(" ")[0] ?? "";
      const replies: Record<string, string> = {
        help: "/help · /plan · /today · /reset · /new — commands run locally, no AI call.",
        plan: "M2 Build base 58% → M3 10 km steady (Dec 20) → M4 Long run 16 km (Feb 14) → M5 Taper and race (Mar 28).",
        today: `${done}/${planned} done. Next: ${tasks.find((t) => t.status === "todo")?.title ?? "nothing left"}.`,
        new: "Goal setup isn't wired up yet in this preview.",
      };
      if (cmd === "reset") {
        setTasks(initialTasks);
        setLog(initialLog);
        return;
      }
      setLog((l) => [...l, { type: "user", text }, { type: "reply", node: replies[cmd] ?? `unknown command: /${cmd}` }]);
      return;
    }
    // Local matcher stands in for the AI check-in parser.
    const lower = text.toLowerCase();
    const ops: Op[] = [];
    const next = tasks.map((t) => {
      if (!t.keywords.some((k) => lower.includes(k))) return t;
      const skipped = /skip|missed|didn'?t|no time/.test((lower.split(t.keywords.find((k) => lower.includes(k)) ?? "")[0] ?? "").slice(-25));
      ops.push({ kind: skipped ? "skip" : "complete", text: `task.${skipped ? "skip" : "complete"} ${t.title}` });
      return { ...t, status: skipped ? ("skipped" as const) : ("done" as const) };
    });
    setTasks(next);
    setAiCalls((n) => n + 1);
    setLog((l) => [
      ...l,
      { type: "user", text },
      {
        type: "ops",
        meta: `understood check-in · 1 AI call · ${180 + text.length * 3} tokens`,
        ops: ops.length ? ops : [{ kind: "info", text: "no task changes detected" }],
      },
      {
        type: "reply",
        node: ops.length
          ? `Logged. ${next.filter((t) => t.status === "done").length}/${next.filter((t) => t.status !== "skipped").length} tasks done today.`
          : "Noted. Nothing matched today's tasks — tell me which one, or use /today.",
      },
    ]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "p") {
        e.preventDefault();
        setLog((l) => [...l, { type: "reply", node: "M2 Build base 58% → M3 Dec 20 → M4 Feb 14 → M5 Mar 28." }]);
        return;
      }
      if (mode === "INSERT") {
        if (e.key === "Escape") {
          setMode("NORMAL");
          inputRef.current?.blur();
        } else if (e.key === "Tab") {
          e.preventDefault();
          setMode("NORMAL");
          inputRef.current?.blur();
        }
        return;
      }
      const k = e.key;
      if (k === "i" || k === "/" || k === "Enter") {
        e.preventDefault();
        setMode("INSERT");
        inputRef.current?.focus();
        if (k === "/") setInput("/");
      } else if (k === "j" || k === "ArrowDown") setCursor((c) => Math.min(tasks.length - 1, c + 1));
      else if (k === "k" || k === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
      else if (k === " ") {
        e.preventDefault();
        toggle(cursor);
      } else if (k === "a") resolveProposal("accepted");
      else if (k === "r") resolveProposal("rejected");
      else if (k === "?") resolveProposal("why");
      else if (k === "Tab") {
        e.preventDefault();
        setMode("INSERT");
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* top bar */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <span className="font-bold text-primary">opengoals</span>
          <span className="text-subtle">/</span>
          <span className="text-muted-foreground">half-marathon-2:15</span>
          <span className="text-subtle">/</span>
          <span>session 12</span>
        </div>
        <div className="hidden text-muted-foreground sm:block">
          Mon 26 Oct · 153 days left · <span className="text-success">●</span> local
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* main */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <p className="text-muted-foreground">
              Day 12 of 153 · Week 2, Build base · {tasks.length - 1} tasks planned for today
            </p>
            <div className="mt-5 max-w-4xl space-y-5">
              {log.map((e, i) => (
                <LogEntry key={i} entry={e} onResolve={resolveProposal} />
              ))}
            </div>
          </div>

          {/* prompt */}
          <div className="shrink-0 border-t border-border px-6 py-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="flex items-center gap-3"
            >
              <span className="text-primary">&gt;</span>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => setMode("INSERT")}
                placeholder="Tell me what you did, or type / for commands"
                className="flex-1 bg-transparent caret-primary outline-none placeholder:text-muted-foreground"
                aria-label="Check-in message"
              />
            </form>
            <p className="mt-3 text-subtle">
              enter send · tab tasks · space toggle done · / commands · ctrl+p plan
              {openProposal && " · a accept · r reject · ? why"}
            </p>
          </div>
        </main>

        {/* sidebar */}
        <aside className="hidden w-[380px] shrink-0 overflow-y-auto border-l border-border bg-panel px-5 py-6 md:block">
          <Section title="GOAL">
            <p className="font-bold">Run a half marathon in under 2:15</p>
            <p className="mt-1 text-muted-foreground">Target 28 Mar 2027</p>
            <div className="mt-3 flex items-center gap-3">
              <Bar pct={goalPct} />
              <span>{goalPct}%</span>
            </div>
          </Section>

          <Section title={`TODAY · ${done}/${planned}`}>
            <ul>
              {tasks.map((t, i) => (
                <li key={t.id}>
                  <button
                    onClick={() => {
                      setCursor(i);
                      toggle(i);
                    }}
                    className={cn(
                      "-mx-1.5 flex w-full items-center gap-2 px-1.5 py-0.5 text-left",
                      mode === "NORMAL" && cursor === i && "bg-accent",
                      t.status === "done" && "text-success",
                      t.status === "skipped" && "text-muted-foreground",
                    )}
                  >
                    <span className="w-2 text-primary">{mode === "NORMAL" && cursor === i ? "▸" : ""}</span>
                    <span>{t.status === "done" ? "[x]" : t.status === "skipped" ? "[-]" : "[ ]"}</span>
                    <span>
                      {t.title}
                      {t.status === "skipped" && " (skipped)"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="MILESTONES">
            <ul className="space-y-1">
              {milestones.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    m.state === "done" && "text-success",
                    m.state === "todo" && "text-muted-foreground",
                  )}
                >
                  <span className={cn(m.state === "active" && "text-primary")}>
                    {m.state === "done" ? "✓" : m.state === "active" ? "●" : "○"}
                  </span>{" "}
                  {m.id} · {m.title} {m.meta}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="THIS WEEK">
            <p className="flex gap-2">
              {week.map((w, i) => (
                <span key={i}>
                  {w.d}{" "}
                  <span className={cn(w.s === "done" && "text-success", w.s === "partial" && "text-primary")}>
                    {w.s === "empty" ? "□" : "■"}
                  </span>
                </span>
              ))}
            </p>
            <p className="mt-1 text-muted-foreground">streak 9 days · best 14</p>
          </Section>

          <Section title="AI USAGE">
            <p>
              {aiCalls} call{aiCalls === 1 ? "" : "s"} today · {aiCalls + 2} this week
            </p>
            <p className="mt-1 text-muted-foreground">tracking, streaks, deadlines run locally</p>
          </Section>
        </aside>
      </div>

      {/* status bar */}
      <footer className="flex h-7 shrink-0 items-center justify-between bg-primary px-4 font-medium text-primary-foreground">
        <span>{mode} · check-in</span>
        <span>on track · next: easy run Tue</span>
      </footer>
    </div>
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

function LogEntry({ entry, onResolve }: { entry: Entry; onResolve: (s: "accepted" | "rejected" | "why") => void }) {
  if (entry.type === "user")
    return (
      <p className="flex gap-3">
        <span className="text-primary">&gt;</span>
        <span>{entry.text}</span>
      </p>
    );
  if (entry.type === "ops")
    return (
      <div className="space-y-1.5 border-l-2 border-border pl-4">
        <p className="text-muted-foreground">{entry.meta}</p>
        {entry.ops.map((o, i) => (
          <p
            key={i}
            className={cn(o.kind === "complete" ? "text-success" : "text-muted-foreground")}
          >
            {o.kind === "complete" ? "✓" : o.kind === "skip" ? "–" : o.kind === "schedule" ? "+" : "·"} {o.text}
          </p>
        ))}
      </div>
    );
  if (entry.type === "reply") return <p>{entry.node}</p>;
  return (
    <div className={cn("border border-border p-4", entry.state !== "open" && "opacity-60")}>
      <p className="font-bold text-primary">proposed change · strength plan</p>
      <p className="mt-1 text-muted-foreground">Strength skipped 3 of the last 4 times. Suggest a lighter routine.</p>
      <p className="mt-3 text-destructive">- Mon / Wed / Fri · Strength A/B · 40 min</p>
      <p className="mt-1 text-success">+ Wed only · Strength A · 25 min</p>
      <p className="mt-3 text-muted-foreground">M2 deadline unchanged (Nov 15)</p>
      <div className="mt-4 flex items-center gap-3 text-muted-foreground">
        {entry.state === "open" ? (
          <>
            <button onClick={() => onResolve("accepted")} className="bg-primary px-2 text-primary-foreground">
              a accept
            </button>
            <button onClick={() => onResolve("why")} className="hover:text-foreground">e edit</button>
            <button onClick={() => onResolve("rejected")} className="hover:text-foreground">r reject</button>
            <button onClick={() => onResolve("why")} className="hover:text-foreground">? ask why</button>
          </>
        ) : (
          <span>{entry.state === "accepted" ? "✓ accepted" : "✗ rejected"}</span>
        )}
      </div>
    </div>
  );
}
