import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { askJson } from "./ai.server";
import { isIsoDate } from "./goals";
import { checkInSchema, dateSchema, suggestionSchema, validatePlan } from "./goal-schemas";

const planTask = z.object({ title: z.string(), date: z.string(), milestone: z.number().int() });

export const suggestGoal = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ idea: z.string().max(500), today: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const r = await askJson<{ title: string; targetDate: string; why: string }>(
      "You help people pick realistic, specific, measurable personal goals. Keys: title (short, measurable), targetDate (YYYY-MM-DD, realistic), why (one sentence).",
      `Today is ${data.today}. The person's interest: "${data.idea || "anything — suggest a good starter goal"}".`,
    );
    if (!r.ok) return r;
    const parsed = suggestionSchema.safeParse(r.data);
    if (!parsed.success || parsed.data.targetDate <= data.today) return { ok: false as const, error: "AI returned an invalid goal. Try another suggestion." };
    return { ...r, data: parsed.data };
  });

export const generatePlan = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        title: z.string().max(300),
        targetDate: dateSchema,
        today: dateSchema,
        notes: z.string().max(1000).optional(),
        existingMilestones: z.array(z.object({ title: z.string(), due: z.string(), pct: z.number() })).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const r = await askJson<{
      milestones: { title: string; due: string }[];
      tasks: z.infer<typeof planTask>[];
    }>(
      `You are a goal planner. Break a goal into 3-6 milestones (title, due YYYY-MM-DD, last one due on the target date) and concrete daily tasks for the next 14 days starting today (title under 40 chars, date YYYY-MM-DD, milestone = 0-based milestone index). 1-3 tasks per day, rest days allowed. Keys: milestones, tasks, title (the goal title, updated only if the notes change the goal, e.g. a new daily amount; otherwise repeat it).${
        data.existingMilestones ? " Keep existing milestones exactly (same order, titles and due dates, including past dates); plan new tasks for the current one." : ""
      }`,
      `Today: ${data.today}\nGoal: ${data.title}\nTarget: ${data.targetDate}${data.notes ? `\nNotes: ${data.notes}` : ""}${
        data.existingMilestones ? `\nExisting milestones: ${JSON.stringify(data.existingMilestones)}` : ""
      }`,
    );
    if (!r.ok) return r;
    const parsed = validatePlan(r.data, data.today, data.targetDate, Boolean(data.existingMilestones));
    if (!parsed.success) return { ok: false as const, error: "AI returned an incomplete or invalid day plan. Your existing plan is unchanged. Try again." };
    if (data.existingMilestones && (parsed.data.milestones.length !== data.existingMilestones.length || parsed.data.milestones.some((m, i) => m.title !== data.existingMilestones?.[i]?.title)))
      return { ok: false as const, error: "AI changed the milestone order. Your existing plan is unchanged; try again." };
    const raw = r.data as { title?: unknown };
    const newTitle = data.notes && typeof raw.title === "string" && raw.title.trim() && raw.title.length <= 300 ? raw.title.trim() : data.title;
    return { ...r, data: { ...parsed.data, title: newTitle } };
  });

export const interpretCheckIn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        text: z.string().min(1).max(2000),
        today: z.string(),
        goal: z.string(),
        tasks: z.array(z.object({ id: z.string(), title: z.string(), date: z.string(), status: z.string() })),
        milestones: z.array(z.object({ index: z.number(), title: z.string(), due: z.string(), pct: z.number() })),
        skipHistory: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const r = await askJson<{
      ops: { op: "complete" | "skip" | "schedule"; taskId?: string; title?: string; date?: string; milestone?: number; reason?: string }[];
      reply: string;
      proposal: null | {
        title: string;
        reason: string;
        removeTaskIds: string[];
        add: { title: string; date: string; milestone: number }[];
        note: string;
      };
    }>(
      `You read a daily goal check-in and turn it into operations. Keys:
ops: array of {op:"complete"|"skip", taskId, reason?} for listed tasks the person mentions, or {op:"schedule", title, date YYYY-MM-DD, milestone} for new things they say they'll do (only dates within the next 14 days, max 14 schedule ops; for recurring habits schedule one per day). Never use null; omit optional keys.
reply: 1-2 short sentences, plain, encouraging but not cheesy.
proposal: null unless the person is falling behind, repeatedly skipping something, or their priorities changed. Then {title (e.g. "strength plan"), reason (one sentence), removeTaskIds (upcoming task ids to drop), add (replacement tasks {title,date,milestone}), note (effect on deadlines)}.
Only use task ids from the list.`,
      `Today: ${data.today}\nGoal: ${data.goal}\nMilestones: ${JSON.stringify(data.milestones)}\nTasks (today and upcoming): ${JSON.stringify(
        data.tasks,
      )}\nRecent skips: ${data.skipHistory || "none"}\nCheck-in: "${data.text}"`,
    );
    if (!r.ok) return r;
    const ids = new Set(data.tasks.map((t) => t.id));
    const parsed = checkInSchema.safeParse(sanitizeCheckIn(r.data, ids, data.milestones.length));
    if (!parsed.success) return { ok: false as const, error: "I couldn't understand that check-in. Try something like \"done with today's reading\" or \"skip run, knee hurts\"." };
    if (parsed.data.ops.some((o) => o.op === "schedule" ? (o.milestone ?? 0) >= data.milestones.length : !ids.has(o.taskId)) || parsed.data.proposal?.add.some((t) => t.milestone >= data.milestones.length) || parsed.data.proposal?.removeTaskIds.some((id) => !ids.has(id)))
      return { ok: false as const, error: "AI referenced tasks outside this goal. No changes were made." };
    return { ...r, data: parsed.data };
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const stripNulls = (o: Record<string, unknown>): Loose => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

/** Keep valid ops, drop bad ones, so one malformed op does not fail the whole check-in. */
export function sanitizeCheckIn(value: unknown, ids: Set<string>, milestoneCount: number) {
  if (!value || typeof value !== "object") return value;
  const v = value as { ops?: unknown; reply?: unknown; proposal?: unknown };
  const ops = (Array.isArray(v.ops) ? v.ops : [])
    .filter((o: Loose) => !!o && typeof o === "object")
    .map(stripNulls)
    .map((o) => (o.op === "schedule" && typeof o.milestone === "number" ? { ...o, milestone: Math.min(Math.max(0, Math.round(o.milestone)), Math.max(0, milestoneCount - 1)) } : o))
    .filter((o) => (o.op === "schedule" ? typeof o.title === "string" && typeof o.date === "string" && isIsoDate(o.date) : typeof o.taskId === "string" && ids.has(o.taskId)))
    .slice(0, 60);
  let proposal: unknown = v.proposal && typeof v.proposal === "object" ? stripNulls(v.proposal as Record<string, unknown>) as Loose : null;
  if (proposal) {
    const p = proposal as Loose;
    proposal = { title: p.title ?? "plan change", reason: p.reason ?? "", note: p.note ?? "",
      removeTaskIds: (Array.isArray(p.removeTaskIds) ? p.removeTaskIds : []).filter((id: Loose) => typeof id === "string" && ids.has(id)),
      add: (Array.isArray(p.add) ? p.add : []).filter((t: Loose) => t && typeof t === "object" && typeof t.title === "string" && typeof t.date === "string" && isIsoDate(t.date))
        .map((t: Loose) => ({ title: t.title, date: t.date, milestone: Math.min(Math.max(0, Math.round(Number(t.milestone) || 0)), Math.max(0, milestoneCount - 1)) })) };
  }
  return { ops, reply: typeof v.reply === "string" ? v.reply.slice(0, 3000) : "", proposal };
}
