import { generateResponse, GatewayError } from "@lovable.dev/ai-gateway";

export type AiResult<T> = { ok: true; data: T; tokens: number } | { ok: false; error: string };

/** One JSON-returning model call. Callers validate the shape. */
export async function askJson<T>(system: string, user: string): Promise<AiResult<T>> {
  try {
    const res = await generateResponse({
      model: "openai/gpt-6-astra",
      instructions: system,
      input: [{ role: "user", content: `${user}\n\nReturn JSON only.` }],
      text: { format: { type: "json_object" } },
      reasoning: { effort: "low" },
    });
    const r = res as unknown as {
      output_text?: string;
      output?: { type: string; content?: { type: string; text?: string }[] }[];
      usage?: { total_tokens?: number };
    };
    const text =
      r.output_text ??
      (r.output ?? [])
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === "output_text")
        .map((c) => c.text ?? "")
        .join("");
    return { ok: true, data: JSON.parse(text) as T, tokens: r.usage?.total_tokens ?? 0 };
  } catch (e) {
    console.error("AI call failed", e);
    if (e instanceof GatewayError) {
      if (e.httpStatus === 402) return { ok: false, error: "AI credits are used up. Add credits to keep using AI features." };
      if (e.httpStatus === 429) return { ok: false, error: "Too many AI requests right now. Try again in a minute." };
    }
    return { ok: false, error: "The AI couldn't answer. Your data is safe — try again." };
  }
}
