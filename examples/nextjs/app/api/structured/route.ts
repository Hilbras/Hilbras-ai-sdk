import { NextRequest } from "next/server";
import { getClient } from "@/lib/client";
import { z } from "zod";

const AnalysisSchema = z.object({
  summary: z.string().describe("One-paragraph summary"),
  sentiment: z.enum(["positive", "negative", "neutral"]),
  keyPoints: z.array(z.string()).describe("Top 3 key points"),
  confidence: z.number().min(0).max(1).describe("Confidence score"),
});

export async function POST(req: NextRequest) {
  const { text, model = "gpt-4o" } = await req.json();
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

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
