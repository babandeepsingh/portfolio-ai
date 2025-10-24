import { NextRequest } from "next/server";
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
const WINDOW_MS = 120 * 1000; // 2 minute
const DELAY_AFTER = 5;        // start delaying after 5 requests
const DELAY_MS = 10000;        // 10 second per request after limit
// Initialize Langfuse client
const langfuse = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    baseUrl: process.env.LANGFUSE_BASE_URL!,
});

export async function POST(req: NextRequest) {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const now = Date.now();
    const entry = ipRequests.get(ip) || { count: 0, firstRequest: now };

    if (now - entry.firstRequest > WINDOW_MS) {
        entry.count = 0;
        entry.firstRequest = now;
    }

    entry.count += 1;
    ipRequests.set(ip, entry);
    console.log(ip, entry, now, "here:::")

    if (entry.count > DELAY_AFTER) {
        const delay = (entry.count - DELAY_AFTER) * DELAY_MS;
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const { messages } = await req.json();

    // Start a trace
    const trace = langfuse.trace({
        name: "portfolio-ai-query",
        input: messages,
        metadata: { source: "Next.js Route" },
    });

    const transformed = messages.map((item: any) => ({
        role: item.role,
        content: item.parts.map((part: any) => part.text).join(" "),
    }));

    const latestMessage = transformed[transformed?.length - 1]?.content;

    // Observation: get embeddings
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

    // Observation: vector DB query
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

    // --- Langfuse prompt management ---
    const prompt = await langfuse.getPrompt("portfolio-assistant");
    const systemPrompt = prompt.compile({
        context: documents.map((d) => d.description).join("\n"),
    });

    // Context for model
    const docContext = `
    START CONTEXT
    ${documents.map((doc) => doc.description).join("\n")}
    END CONTEXT
  `;

    //   const systemPrompt = `
    //     You are an AI assistant answering questions as Babandeep Singh in his Portfolio App. 
    //     Format responses using markdown where applicable.
    //     ${docContext}
    //     If the answer is not provided in the context, the AI assistant will say, 
    //     "I'm sorry, I do not know the answer".
    //   `;

    // Record generation
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
            await trace.end();
        },
    });

    return result.toTextStreamResponse();
}
