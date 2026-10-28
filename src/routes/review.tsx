import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/hooks/use-workspace";
import { activeMilestone, addDays, bestStreak, dayState, daysBetween, fmt, fmtLong, iso, milestonePct, paceLabel, streak, weekDays } from "@/lib/goals";
import { activityWeeks, reviewStats } from "@/lib/review";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/review")({
  validateSearch: (search: Record<string, unknown>): { goal?: string } => ({ goal: typeof search.goal === "string" ? search.goal : undefined }),
  head: () => ({ meta: [
    { title: "OpenGoals — Weekly review" },
    { name: "description", content: "Review your goal's weekly progress, activity, milestones, deadlines and AI usage." },
    { property: "og:title", content: "OpenGoals — Weekly review" },
    { property: "og:description", content: "Your weekly progress and activity, calculated without AI." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Review,
});

function Review() {
  const { workspace, setWorkspace, loaded, error, status, reload } = useWorkspace();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [today, setToday] = useState(() => iso(new Date()));
  const [offset, setOffset] = useState(-1);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(iso(new Date())), 30000);
    return () => clearInterval(timer);
  }, []);
  const goal = workspace.goals.find((goal) => goal.id === (search.goal ?? workspace.activeGoalId));
  const week = weekDays(addDays(today, offset * 7));
  const start = week[0] ?? today;
  const end = week[6] ?? today;
  const stats = goal ? reviewStats(goal, week, today) : null;
  const weeks = activityWeeks(today);
  const active = goal ? activeMilestone(goal) : -1;
  const earliestWeek = goal ? weekDays(goal.startDate)[0] ?? goal.startDate : today;
  useEffect(() => {
    if (loaded && goal && workspace.activeGoalId !== goal.id) setWorkspace((current) => ({ ...current, activeGoalId: goal.id }));
  }, [loaded, goal?.id, workspace.activeGoalId, setWorkspace]);

  return <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <header className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
      <div className="flex min-w-0 items-center gap-2"><Link to="/" className="font-bold text-primary">opengoals</Link><span className="text-subtle">/</span><span className="max-w-52 truncate text-muted-foreground">{goal?.title ?? "workspace"}</span><span className="text-subtle">/</span><span>review</span></div>
      <span className="text-muted-foreground">{fmtLong(today)}</span>
    </header>
    <nav aria-label="Review controls" className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <Button asChild variant="ghost" size="sm"><Link to="/"><ArrowLeft />Workspace</Link></Button>
      <select aria-label="Review goal" value={goal?.id ?? ""} onChange={(event) => { void navigate({ to: "/review", search: { goal: event.target.value } }); setOffset(-1); }} className="min-w-0 max-w-full flex-1 border border-input bg-panel px-2 py-1 sm:max-w-64" disabled={!loaded}>
        {!goal && <option value="">Select a goal</option>}{workspace.goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
      </select>
      {search.goal && <Button variant="ghost" size="sm" asChild><Link to="/review" search={{}}>All goals</Link></Button>}
      <Button asChild variant="ghost" size="sm"><Link to="/docs"><BookOpen />Docs</Link></Button>
      <span role="status" className="text-xs text-muted-foreground">{status}</span>
    </nav>
    {error && <p role="alert" className="px-6 py-3 text-destructive">{error} <Button variant="outline" size="sm" onClick={reload}>Retry</Button></p>}
    {!loaded ? <main className="p-6">{error ? "Your saved review could not be loaded." : "Loading your review…"}</main> : !goal || !stats ? <main className="p-6"><h1 className="text-lg text-primary">{search.goal ? "Goal not found" : "No goals to review yet"}</h1><Button className="mt-4" asChild><Link to="/">Return to workspace<ArrowRight /></Link></Button></main> : <div className="grid flex-1 md:grid-cols-[minmax(0,1fr)_340px]">
      <main className="min-w-0 px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-muted-foreground">/review · week {Math.max(1, Math.floor(daysBetween(earliestWeek, start) / 7) + 1)} · {fmt(start)} to {fmt(end)} {end.slice(0, 4)}</p><div className="flex items-center gap-1"><Button size="icon" variant="ghost" aria-label="Previous week" title="Previous week" disabled={start <= earliestWeek} onClick={() => setOffset((value) => value - 1)}><ChevronLeft /></Button><Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(0)}>This week</Button><Button size="icon" variant="ghost" aria-label="Next week" title="Next week" disabled={offset >= 0} onClick={() => setOffset((value) => value + 1)}><ChevronRight /></Button></div></div>
        <h1 className="mt-5 font-bold"><span className="text-primary">&gt;</span> review {offset === 0 ? "this week" : offset === -1 ? "last week" : "selected week"}</h1>
        <div className="mt-4 space-y-2 border-l-2 border-border pl-4">
          <p className="text-muted-foreground">computed locally · no AI call</p>
          <p>Tasks done <span className="text-success">{stats.done} of {stats.total}</span> <span className="text-primary">{stats.pct}%</span></p>
          <p>Active days <span className="text-success">{stats.activeDays} of 7</span></p>
          <p>Current streak <span className="text-success">{streak(goal.tasks, today)} days</span> <span className="text-muted-foreground">best {bestStreak(goal.tasks.filter((task) => task.date <= today))}</span></p>
          <p>Skipped <span className={stats.skipped.length ? "text-destructive" : "text-muted-foreground"}>{stats.skipped.length ? stats.skipped.map(([title, count]) => `${title} ×${count}`).join(" · ") : "none"}</span></p>
          {!stats.total && <p className="text-muted-foreground">No tasks scheduled for this week.</p>}
        </div>
        <section className="mt-7"><h2 className="text-muted-foreground">ACTIVITY · last 14 weeks</h2><div className="mt-4 grid w-fit grid-cols-[12px_repeat(14,10px)] gap-x-2 gap-y-2" role="img" aria-label="Activity for the last fourteen weeks; completed days green, partial days amber">
          {Array.from({ length: 7 }, (_, day) => <div key={day} className="contents"><span className="text-xs leading-none text-muted-foreground">{"MTWTFSS"[day]}</span>{weeks.map((week) => { const date = week[day] ?? today; const state = date > today ? "empty" : dayState(goal.tasks, date); return <span key={date} title={`${fmtLong(date)}: ${date > today ? "future" : state}`} className={cn("h-2.5 w-2.5", state === "done" ? "bg-success" : state === "partial" ? "bg-primary" : "bg-muted", date > today && "opacity-40")} />; })}</div>)}
        </div></section>
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border border-border px-4 py-3"><p className="min-w-0 break-words"><span className={paceLabel(goal, today) === "behind" ? "text-destructive" : "text-primary"}>{paceLabel(goal, today)}</span><span className="text-muted-foreground"> · {goal.tasks.filter((task) => task.status === "todo" && task.date < today).length} overdue tasks</span></p><Button variant="ghost" size="sm" asChild><Link to="/">Continue check-in<ArrowRight /></Link></Button></div>
      </main>
      <aside aria-label="Review summary" className="min-w-0 border-t border-border px-6 py-6 md:border-l md:border-t-0">
        <section><h2 className="mb-3 text-muted-foreground">MILESTONES</h2><div className="space-y-2">{goal.milestones.map((milestone, index) => { const pct = milestonePct(goal.tasks, index); return <div key={index} title={milestone.title} className="flex gap-2"><span className={pct === 100 ? "text-success" : index === active ? "text-primary" : "text-muted-foreground"}>M{index + 1}</span><span aria-label={`${milestone.title}: ${pct}%`} className={pct === 100 ? "text-success" : index === active ? "text-primary" : "text-subtle"}>{"█".repeat(Math.round(pct / 100 * 14))}{"░".repeat(14 - Math.round(pct / 100 * 14))}</span><span>{pct}%</span></div>; })}</div></section>
        <section className="mt-7"><h2 className="mb-2 text-muted-foreground">DEADLINES</h2>{goal.milestones[active] && <p>M{active + 1} · {fmt(goal.milestones[active].due)} <span className="text-muted-foreground">{deadline(daysBetween(today, goal.milestones[active].due))}</span></p>}<p className="mt-1">Goal · {fmt(goal.targetDate)} <span className="text-muted-foreground">{deadline(daysBetween(today, goal.targetDate))}</span></p></section>
        <section className="mt-7"><h2 className="mb-2 text-muted-foreground">AI USAGE · 30 days</h2><p>{stats.calls.length} calls · {stats.calls.reduce((total, call) => total + call.tokens, 0).toLocaleString()} tokens</p><p className="mt-2 text-muted-foreground">review uses no AI</p></section>
      </aside>
    </div>}
    <footer className="mt-auto bg-primary px-4 py-2 text-xs text-primary-foreground">REVIEW · weekly progress</footer>
  </div>;
}

function deadline(days: number) { return days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? "due today" : `${days} days left`; }