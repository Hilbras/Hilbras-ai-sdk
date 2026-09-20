import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getClient } from "$lib/client";
import { z } from "zod";

const AnalysisSchema = z.object({
  summary: z.string(),
  sentiment: z.enum(["positive", "negative", "neutral"]),
  keyPoints: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const POST: RequestHandler = async ({ request }) => {
  const { text, model = "gpt-4o" } = await request.json();
  const client = getClient();

  try {
    const result = await client.complete({
      messages: [
        { role: "system", content: "Analyze the given text and return structured analysis." },
        { role: "user", content: text },
      ],
      model,
      provider: "openai",
      output: { schema: AnalysisSchema },
    });

    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: 500 });
  }
};
