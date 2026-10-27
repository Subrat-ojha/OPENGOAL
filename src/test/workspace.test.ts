import { describe, it, expect } from "vitest";
import { emptyWorkspace, parseTarget, tasksForDay, updateGoal, type Goal } from "@/lib/goals";
import { migrateWorkspace, validatePlan, mergeGuestGoals } from "@/lib/goal-schemas";
const goal = (id: string): Goal => ({ id, title: id, targetDate: "2026-12-01", startDate: "2026-10-27", milestones: [{ title: "Read", due: "2026-12-01" }], tasks: [{ id: `${id}-task`, title: `${id} task`, date: "2026-10-27", status: "todo", milestone: 0 }], log: [{ type: "user", text: `${id} history` }], aiCalls: [], session: 1 });
describe("multiple goal workspaces", () => {
  it("keeps second goal day plans separate from first", () => {
    const a = goal("first"), b = goal("second");
    const w = { ...emptyWorkspace(), goals: [a, b], activeGoalId: b.id };
    expect(tasksForDay(w.goals.find((g) => g.id === w.activeGoalId) ?? a, "2026-10-27").map((t) => t.title)).toEqual(["second task"]);
  });
  it("updates only the captured goal and preserves other history", () => {
    const a = goal("first"), b = goal("second");
    const w = updateGoal({ ...emptyWorkspace(), goals: [a,b], activeGoalId: b.id }, a.id, (g) => ({ ...g, tasks: g.tasks.map((t) => ({ ...t, status: "done" })) }));
    expect(w.goals[0]?.tasks[0]?.status).toBe("done");
    expect(w.goals[1]).toEqual(b);
  });
  it("migrates old browser goals without losing history", () => {
    const { id, ...legacy } = goal("first");
    const w = migrateWorkspace(legacy);
    expect(w.goals[0]?.log).toEqual(legacy.log);
    expect(w.activeGoalId).toBe("legacy-goal");
  });
  it("rejects corrupt saved data rather than replacing it", () => { expect(() => migrateWorkspace({ version: 2, goals: [{ title: "broken" }] })).toThrow(); });
  it("imports guest goals without duplicating existing goals", () => {
    const w = { ...emptyWorkspace(), goals: [goal("first")], activeGoalId: "first" };
    expect(mergeGuestGoals(w, w).goals).toHaveLength(1);
  });
});
describe("safe planning", () => {
  it("rejects impossible target dates", () => { expect(parseTarget("2027-02-31", "2026-10-27")).toBeNull(); });
  it("rejects zero-day deadlines", () => { expect(parseTarget("0 days", "2026-10-27")).toBeNull(); });
  it("accepts future relative deadlines", () => { expect(parseTarget("2 weeks", "2026-10-27")).toBe("2026-11-10"); });
  it("rejects AI milestones with missing day tasks", () => { expect(validatePlan({ milestones: [{ title: "Read", due: "2026-12-01" }], tasks: [] }, "2026-10-27", "2026-12-01").success).toBe(false); });
  it("rejects tasks assigned to another milestone index", () => { expect(validatePlan({ milestones: [{ title: "Read", due: "2026-12-01" }], tasks: [{ title: "Read", date: "2026-10-27", milestone: 2 }] }, "2026-10-27", "2026-12-01").success).toBe(false); });
});