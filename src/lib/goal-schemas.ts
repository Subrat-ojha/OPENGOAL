import { z } from "zod";
import { addDays, emptyWorkspace, isIsoDate, uid, type Workspace } from "./goals";

export const dateSchema = z.string().refine(isIsoDate, "Use a real YYYY-MM-DD date");
const title = z.string().trim().min(1).max(300);
export const milestoneSchema = z.object({ title, due: dateSchema });
export const planTaskSchema = z.object({ title, date: dateSchema, milestone: z.number().int().nonnegative() });
export const planSchema = z.object({ milestones: z.array(milestoneSchema).min(1).max(8), tasks: z.array(planTaskSchema).min(1).max(60) });
export function validatePlan(value: unknown, today: string, target: string) {
  return planSchema.superRefine((plan, ctx) => {
    for (const task of plan.tasks) {
      if (task.milestone >= plan.milestones.length || task.date < today || task.date > addDays(today, 13) || task.date > target)
        ctx.addIssue({ code: "custom", message: "Task outside plan dates or milestones" });
    }
    if (plan.milestones.some((m) => m.due < today || m.due > target) || plan.milestones.at(-1)?.due !== target)
      ctx.addIssue({ code: "custom", message: "Invalid milestone deadline" });
  }).safeParse(value);
}
export const suggestionSchema = z.object({ title, targetDate: dateSchema, why: z.string().max(1000) });
export const checkInSchema = z.object({
  ops: z.array(z.discriminatedUnion("op", [
    z.object({ op: z.literal("complete"), taskId: z.string(), reason: z.string().optional() }),
    z.object({ op: z.literal("skip"), taskId: z.string(), reason: z.string().optional() }),
    z.object({ op: z.literal("schedule"), title, date: dateSchema, milestone: z.number().int().nonnegative().optional() }),
  ])).max(60),
  reply: z.string().max(3000),
  proposal: z.object({ title, reason: z.string(), removeTaskIds: z.array(z.string()), add: z.array(planTaskSchema), note: z.string() }).nullable(),
});
const taskSchema = planTaskSchema.extend({ id: z.string().min(1), status: z.enum(["todo", "done", "skipped"]), reason: z.string().optional() });
const proposal = z.object({ id: z.string(), title, reason: z.string(), removeTaskIds: z.array(z.string()), add: z.array(planTaskSchema), note: z.string(), state: z.enum(["open", "accepted", "rejected"]) });
const entry = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), text: z.string() }),
  z.object({ type: z.literal("reply"), text: z.string(), tone: z.literal("error").optional() }),
  z.object({ type: z.literal("ops"), meta: z.string(), ops: z.array(z.object({ kind: z.enum(["complete", "skip", "schedule", "info"]), text: z.string() })) }),
  z.object({ type: z.literal("proposal"), proposal }),
]);
export const goalSchema = z.object({
  id: z.string().min(1), title, targetDate: dateSchema, startDate: dateSchema,
  milestones: z.array(milestoneSchema).min(1).max(8), tasks: z.array(taskSchema), log: z.array(entry),
  aiCalls: z.array(z.object({ date: dateSchema, tokens: z.number().nonnegative() })), session: z.number().int().positive(),
});
export const workspaceSchema = z.object({ version: z.literal(2), goals: z.array(goalSchema), activeGoalId: z.string().nullable() }).superRefine((w, ctx) => {
  if (new Set(w.goals.map((g) => g.id)).size !== w.goals.length || (w.activeGoalId !== null && !w.goals.some((g) => g.id === w.activeGoalId)))
    ctx.addIssue({ code: "custom", message: "Invalid goal selection" });
});
export function migrateWorkspace(value: unknown): Workspace {
  if (value === null) return emptyWorkspace();
  const parsed = workspaceSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (typeof value === "object" && value !== null && !("version" in value)) {
    const legacy = goalSchema.safeParse({ ...value, id: "legacy-goal", session: "session" in value ? value.session : 1 });
    if (legacy.success) return { version: 2, goals: [legacy.data], activeGoalId: legacy.data.id };
  }
  throw new Error("Saved goals could not be read. Your saved copy has not been changed.");
}
export function mergeGuestGoals(account: Workspace, guest: Workspace): Workspace {
  const existing = new Set(account.goals.map((g) => g.id));
  const added = guest.goals.filter((g) => !existing.has(g.id)).map((g) => ({ ...g, id: g.id || uid() }));
  return { ...account, goals: [...account.goals, ...added], activeGoalId: account.activeGoalId ?? added[0]?.id ?? null };
}