// Local, AI-free goal tracking: progress, streaks, dates.
export type TaskStatus = "todo" | "done" | "skipped";
export type Task = { id: string; title: string; date: string; status: TaskStatus; milestone: number; reason?: string | undefined };
export type Milestone = { title: string; due: string };
export type Op = { kind: "complete" | "skip" | "schedule" | "info"; text: string };
export type Proposal = {
  id: string;
  title: string;
  reason: string;
  removeTaskIds: string[];
  add: { title: string; date: string; milestone: number }[];
  note: string;
  state: "open" | "accepted" | "rejected";
};
export type Entry =
  | { type: "user"; text: string }
  | { type: "ops"; meta: string; ops: Op[] }
  | { type: "reply"; text: string; tone?: "error" }
  | { type: "proposal"; proposal: Proposal };
export type AiCall = { date: string; tokens: number };
export type Goal = {
  id: string;
  title: string;
  targetDate: string;
  startDate: string;
  milestones: Milestone[];
  tasks: Task[];
  log: Entry[];
  aiCalls: AiCall[];
  session: number;
};

export const iso = (d: Date) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
export const parseIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};
export const addDays = (s: string, n: number) => {
  const d = parseIso(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const daysBetween = (a: string, b: string) =>
  Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86400000);
export const fmt = (s: string) =>
  parseIso(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export const fmtLong = (s: string) =>
  parseIso(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Milestone % = done tasks / non-skipped tasks in that milestone. */
export function milestonePct(tasks: Task[], index: number) {
  const ts = tasks.filter((t) => t.milestone === index && t.status !== "skipped");
  if (!ts.length) return 0;
  return Math.round((ts.filter((t) => t.status === "done").length / ts.length) * 100);
}

/** Overall % = average of milestone percentages. */
export function goalPct(goal: Pick<Goal, "milestones" | "tasks">) {
  if (!goal.milestones.length) return 0;
  const sum = goal.milestones.reduce((a, _, i) => a + milestonePct(goal.tasks, i), 0);
  return Math.round(sum / goal.milestones.length);
}

/** First milestone under 100%. */
export function activeMilestone(goal: Pick<Goal, "milestones" | "tasks">) {
  const i = goal.milestones.findIndex((_, i) => milestonePct(goal.tasks, i) < 100);
  return i === -1 ? goal.milestones.length - 1 : i;
}

/** Consecutive days with ≥1 done task, ending today (or yesterday if today has none yet). */
export function streak(tasks: Task[], today: string) {
  const doneDays = new Set(tasks.filter((t) => t.status === "done").map((t) => t.date));
  let day = doneDays.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (doneDays.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function bestStreak(tasks: Task[]) {
  const days = [...new Set(tasks.filter((t) => t.status === "done").map((t) => t.date))].sort();
  let best = 0, cur = 0, prev = "";
  for (const d of days) {
    cur = prev && daysBetween(prev, d) === 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

/** Monday-start week for the given day. */
export function weekDays(today: string) {
  const dow = (parseIso(today).getDay() + 6) % 7;
  const monday = addDays(today, -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function dayState(tasks: Task[], day: string): "done" | "partial" | "empty" {
  const ts = tasks.filter((t) => t.date === day && t.status !== "skipped");
  const done = ts.filter((t) => t.status === "done").length;
  if (!done) return "empty";
  return done === ts.length ? "done" : "partial";
}

/** Behind = active milestone due within its share of time but under expected progress. */
export function paceLabel(goal: Goal, today: string) {
  const overdue = goal.tasks.filter((t) => t.date < today && t.status === "todo").length;
  if (overdue >= 3) return "behind";
  return "on track";
}

export const STORAGE_KEY = "opengoals.v1";

export const WORKSPACE_KEY = "opengoals.v2";
export type Workspace = { version: 2; goals: Goal[]; activeGoalId: string | null };
export const emptyWorkspace = (): Workspace => ({ version: 2, goals: [], activeGoalId: null });

export function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && iso(parseIso(value)) === value;
}

export function parseTarget(input: string, today: string): string | null {
  const value = input.trim().toLowerCase();
  if (isIsoDate(value)) return value > today ? value : null;
  const match = value.match(/^(\d+)\s*(d|day|days|w|week|weeks|m|month|months)$/);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2];
  if (!unit || n < 1 || n > 3650) return null;
  const result = addDays(today, unit.startsWith("d") ? n : unit.startsWith("w") ? n * 7 : n * 30);
  return isIsoDate(result) ? result : null;
}

export function updateGoal(workspace: Workspace, id: string, update: (goal: Goal) => Goal): Workspace {
  return { ...workspace, goals: workspace.goals.map((goal) => goal.id === id ? update(goal) : goal) };
}

export function tasksForDay(goal: Pick<Goal, "tasks">, day: string) {
  return goal.tasks.filter((task) => task.date === day || (task.date < day && task.status === "todo"));
}
