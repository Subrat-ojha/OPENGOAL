import { describe, expect, it } from "vitest";
import { activityWeeks, reviewStats } from "@/lib/review";
import { weekDays, type Goal } from "@/lib/goals";

const goal: Goal = { id: "a", title: "Reading", startDate: "2026-10-01", targetDate: "2027-01-01", milestones: [], log: [], session: 1, aiCalls: [{ date: "2026-09-28", tokens: 1 }, { date: "2026-09-29", tokens: 2 }, { date: "2026-10-28", tokens: 3 }, { date: "2026-10-29", tokens: 4 }], tasks: [
  { id: "1", title: "Read", date: "2026-10-19", status: "done", milestone: 0 },
  { id: "2", title: "Read", date: "2026-10-19", status: "done", milestone: 0 },
  { id: "3", title: "Read", date: "2026-10-20", status: "skipped", milestone: 0 },
  { id: "4", title: "Read", date: "2026-10-26", status: "todo", milestone: 0 },
] };

describe("local weekly review", () => {
  it("counts skipped tasks in weekly workload and counts distinct active days", () => {
    expect(reviewStats(goal, weekDays("2026-10-19"), "2026-10-28")).toMatchObject({ done: 2, total: 3, pct: 67, activeDays: 1, skipped: [["Read", 1]] });
  });
  it("restricts usage to the inclusive trailing 30 days", () => {
    expect(reviewStats(goal, weekDays("2026-10-19"), "2026-10-28").calls.map((call) => call.tokens)).toEqual([2, 3]);
  });
  it("has no cross-goal statistics", () => {
    expect(reviewStats({ ...goal, id: "b", tasks: [], aiCalls: [] }, weekDays("2026-10-19"), "2026-10-28")).toMatchObject({ done: 0, total: 0, pct: 0, activeDays: 0, calls: [] });
  });
  it("renders fourteen Monday-start weeks ending in the current week", () => {
    const weeks = activityWeeks("2026-10-28");
    expect(weeks).toHaveLength(14);
    expect(weeks[0]?.[0]).toBe("2026-07-27");
    expect(weeks[13]).toEqual(weekDays("2026-10-28"));
  });
});