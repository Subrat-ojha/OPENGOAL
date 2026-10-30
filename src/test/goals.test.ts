import { describe, expect, it } from "vitest";
import { goalPct, milestonePct, streak, type Task } from "@/lib/goals";

const t = (date: string, status: Task["status"], milestone = 0): Task => ({ id: date + status + milestone, title: "x", date, status, milestone });

describe("goal tracking", () => {
  it("milestone progress ignores skipped tasks", () => {
    expect(milestonePct([t("2026-10-01", "done"), t("2026-10-02", "todo"), t("2026-10-03", "skipped")], 0)).toBe(50);
  });
  it("goal progress averages milestones", () => {
    const tasks = [t("2026-10-01", "done", 0), t("2026-10-02", "todo", 1)];
    expect(goalPct({ milestones: [{ title: "a", due: "" }, { title: "b", due: "" }], tasks })).toBe(50);
  });
  it("streak counts back from yesterday when today has nothing done", () => {
    const tasks = [t("2026-10-24", "done"), t("2026-10-25", "done"), t("2026-10-26", "todo")];
    expect(streak(tasks, "2026-10-26")).toBe(2);
  });
  it("streak breaks on a missed day", () => {
    expect(streak([t("2026-10-23", "done"), t("2026-10-25", "done")], "2026-10-26")).toBe(1);
  });
});

import { parseTarget as pt } from "@/lib/goals";
describe("natural target dates", () => {
  it("reads '25 dec 2026' inside a sentence", () => expect(pt("i will make deadline to 25 dec 2026 , ok", "2026-10-30")).toBe("2026-12-25"));
  it("reads 'Dec 25th'", () => expect(pt("Dec 25th", "2026-10-30")).toBe("2026-12-25"));
  it("rejects past dates", () => expect(pt("1 jan 2020", "2026-10-30")).toBeNull());
});
