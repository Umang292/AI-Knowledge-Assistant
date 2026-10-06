import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";
import { createEmbeddings, startChatCompletion } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 120;

function event(controller: ReadableStreamDefaultController<Uint8Array>, payload: object) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
}

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Sign in to ask a question." }, { status: 401 });
    const body = await request.json();
    const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!conversationId || !question || question.length > 8000) {
      return NextResponse.json({ error: "Add a question (maximum 8,000 characters) and choose a conversation." }, { status: 400 });
    }
    await ensureSchema();
    const conversation = await pool.query(
      "SELECT id FROM conversations WHERE id = $1 AND user_id = $2",
      [conversationId, user.id],
    );
    if (!conversation.rowCount) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

    const [questionEmbedding] = await createEmbeddings([question]);
    const nearest = await pool.query(
      `SELECT c.content, c.page_number, d.name,
        1 - (c.embedding <=> $1::vector) AS similarity
       FROM chunks c
       JOIN documents d ON d.id = c.document_id AND d.user_id = c.user_id
       WHERE c.user_id = $2
       ORDER BY c.embedding <=> $1::vector
       LIMIT 8`,
      [`[${questionEmbedding.join(",")}]`, user.id],
    );
    if (!nearest.rowCount) {
      return NextResponse.json({ error: "Your library doesn't have any indexed documents yet. Upload a PDF first." }, { status: 422 });
    }

    const sources = nearest.rows.map((row: { name: string; page_number: number; content: string }, index: number) => ({
      id: index + 1,
      document: row.name,
      page: row.page_number,
      text: row.content,
    }));
    const excerpts = sources.map((source) => `[Source ${source.id} | ${source.document} | page ${source.page}]\n${source.text}`).join("\n\n");
    const history = await pool.query(
      "SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT 10",
      [conversationId],
    );
    const messages = [
      {
        role: "system",
        content: "You are Quill, a careful document research assistant. Answer using the supplied excerpts as your primary evidence. Cite supporting claims inline using [1], [2], etc. Never invent document facts or citations. If the excerpts do not answer the question, say what is missing. Keep the response clear and concise.\n\nRetrieved excerpts:\n" + excerpts,
      },
      ...history.rows.reverse(),
      { role: "user", content: question },
    ];
    const completion = await startChatCompletion(messages);
    if (!completion.ok || !completion.body) {
      const detail = (await completion.text()).slice(0, 500);
      console.error("Chat completion request failed:", completion.status, detail);
      return NextResponse.json({ error: "The answer service is temporarily unavailable. Please try again." }, { status: 502 });
    }

    await pool.query("INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)", [conversationId, question]);
    await pool.query("UPDATE conversations SET updated_at = NOW() WHERE id = $1 AND user_id = $2", [conversationId, user.id]);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const reader = completion.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";
        try {
          event(controller, { type: "sources", sources });
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() ?? "";
            for (const block of blocks) {
              const line = block.split("\n").find((part) => part.startsWith("data: "));
              if (!line || line === "data: [DONE]") continue;
              const payload = JSON.parse(line.slice(6));
              const delta = payload.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta) {
                answer += delta;
                event(controller, { type: "delta", text: delta });
              }
            }
          }
          if (!answer.trim()) throw new Error("The answer service returned an empty response.");
          await pool.query(
            "INSERT INTO messages (conversation_id, role, content, sources) VALUES ($1, 'assistant', $2, $3)",
            [conversationId, answer, JSON.stringify(sources.map(({ document, page, text }) => ({ document, page, text })))],
          );
          event(controller, { type: "done" });
        } catch (error) {
          console.error("Streaming answer failed:", error);
          event(controller, { type: "error", message: "The answer stream was interrupted. Please try again." });
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Chat request failed:", error);
    const message = error instanceof Error && error.message.includes("OPENAI_API_KEY")
      ? "Chat is not configured. Add an OpenAI API key and try again."
      : "Unable to answer this question right now. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
