import { NextRequest, NextResponse } from "next/server";
import { DataAPIClient } from "@datastax/astra-db-ts";
import OpenAI from "openai";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { Langfuse } from "langfuse";

const client = new DataAPIClient(process.env.ASTRA_TOKEN);
const db = client.db(process.env.ASTRA_URL!, { keyspace: "default_keyspace" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const openaiSDK = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const ipRequests = new Map<string, { count: number; firstRequest: number }>();
const WINDOW_MS = 120 * 1000;
const DELAY_AFTER = 5;
const DELAY_MS = 10000;

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL!,
});

// ✅ Define allowed origins
const allowedOrigins = [
  "http://localhost:3002",
  "http://localhost:3000",
  "https://chat.babandeep.in",
  "https://profile.babandeep.in",
];

// ✅ CORS helper
function corsResponse(body: any, origin: string | null, status = 200) {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  return new NextResponse(JSON.stringify(body), { status, headers });
}

// ✅ Handle OPTIONS (preflight) requests
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  return corsResponse({}, origin);
}

// ✅ Handle POST requests
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.includes(origin)) {
    return corsResponse({ error: "CORS not allowed" }, origin, 403);
  }

  try {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const now = Date.now();
    const entry = ipRequests.get(ip) || { count: 0, firstRequest: now };

    if (now - entry.firstRequest > WINDOW_MS) {
      entry.count = 0;
      entry.firstRequest = now;
    }

    entry.count += 1;
    ipRequests.set(ip, entry);

    if (entry.count > DELAY_AFTER) {
      const delay = (entry.count - DELAY_AFTER) * DELAY_MS;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const { messages } = await req.json();

    const trace = langfuse.trace({
      name: "portfolio-ai-query",
      input: messages,
      metadata: { source: "Next.js Route" },
    });

    const transformed = messages.map((item: any) => ({
      role: item.role,
      content: item.parts.map((part: any) => part.text).join(" "),
    }));

    const latestMessage = transformed.at(-1)?.content;

    const embeddingObservation = trace.span({
      name: "generate-embedding",
      metadata: { model: "text-embedding-3-small" },
    });

    const { data } = await openai.embeddings.create({
      input: latestMessage,
      model: "text-embedding-3-small",
    });

    embeddingObservation.end({
      output: { vectorLength: data[0]?.embedding.length },
    });

    const dbObservation = trace.span({ name: "astra-db-query" });

    const collection = await db.collection("portfolio");
    const cursor = collection.find({}, {
      sort: { $vector: data[0]?.embedding },
      limit: 5,
    });
    const documents = await cursor.toArray();

    dbObservation.end({
      output: { results: documents.length },
    });

    const prompt = await langfuse.getPrompt("portfolio-assistant");
    const systemPrompt = prompt.compile({
      context: documents.map((d) => d.description).join("\n"),
    });

    const generation = trace.generation({
      name: "assistant-response",
      model: "gpt-3.5-turbo",
      input: { systemPrompt, messages: transformed },
    });

    const result = streamText({
      model: openaiSDK("gpt-3.5-turbo"),
      system: systemPrompt,
      messages: transformed,
      onFinal: async (output: any) => {
        generation.end({ output });
        (await (trace as any).end());
      },
    } as any);

    const response = result.toTextStreamResponse();

    // ✅ Attach CORS headers to the streaming response
    response.headers.set("Access-Control-Allow-Origin", origin || "*");
    response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    return response;
  } catch (error: any) {
    console.error("Error in /api/chat:", error);
    return corsResponse({ error: error.message || "Internal Server Error" }, origin, 500);
  }
}
