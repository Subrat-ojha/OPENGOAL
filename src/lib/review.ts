import { addDays, weekDays, type Goal } from "@/lib/goals";

export function reviewStats(goal: Goal, week: string[], today: string) {
  const tasks = goal.tasks.filter((task) => week.includes(task.date));
  const done = tasks.filter((task) => task.status === "done").length;
  const skipped = new Map<string, number>();
  for (const task of tasks) if (task.status === "skipped") skipped.set(task.title, (skipped.get(task.title) ?? 0) + 1);
  return {
    done,
    total: tasks.length,
    pct: tasks.length ? Math.round(done / tasks.length * 100) : 0,
    activeDays: new Set(tasks.filter((task) => task.status === "done").map((task) => task.date)).size,
    skipped: [...skipped.entries()],
    calls: goal.aiCalls.filter((call) => call.date >= addDays(today, -29) && call.date <= today),
  };
}

export function activityWeeks(today: string) {
  const monday = weekDays(today)[0] ?? today;
  return Array.from({ length: 14 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(monday, (week - 13) * 7 + day)));
}