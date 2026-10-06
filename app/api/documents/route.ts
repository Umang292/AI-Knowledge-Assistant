import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";
import { createEmbeddings } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 120;

function splitPage(text: string, page: number, startIndex: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const chunks: { content: string; page: number; index: number }[] = [];
  const maxLength = 1100;
  const overlap = 160;
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxLength, normalized.length);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf(" ", end);
      if (boundary > start + maxLength * 0.65) end = boundary;
    }
    const content = normalized.slice(start, end).trim();
    if (content.length >= 30) chunks.push({ content, page, index: startIndex + chunks.length });
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Sign in to view your library." }, { status: 401 });
    const result = await pool.query(
      "SELECT id, name, page_count AS pages, chunk_count AS chunks, created_at FROM documents WHERE user_id = $1 ORDER BY created_at DESC",
      [user.id],
    );
    return NextResponse.json({ documents: result.rows });
  } catch (error) {
    console.error("Document list failed:", error);
    return NextResponse.json({ error: "Unable to load your documents." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Sign in before uploading documents." }, { status: 401 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF file to upload." }, { status: 400 });
    if (file.size === 0 || file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "PDF files must be between 1 byte and 20 MB." }, { status: 413 });
    }
    if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 415 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return NextResponse.json({ error: "This file doesn't appear to be a valid PDF." }, { status: 415 });
    }

    const pdfParse = (await import("pdf-parse")).default;
    const pages: string[] = [];
    const parsed = await pdfParse(buffer, {
      pagerender: async (pageData) => {
        const content = await pageData.getTextContent();
        const text = content.items.map((item: { str?: string }) => item.str ?? "").join(" ");
        pages.push(text);
        return text;
      },
    });
    if (!parsed.numpages || !parsed.text.trim()) {
      return NextResponse.json({ error: "No readable text was found. This PDF may contain scanned images." }, { status: 422 });
    }

    const textPages = pages.length ? pages : [parsed.text];
    const chunks: { content: string; page: number; index: number }[] = [];
    for (let index = 0; index < textPages.length; index++) {
      chunks.push(...splitPage(textPages[index], index + 1, chunks.length));
    }
    if (chunks.length > 600) {
      return NextResponse.json({ error: "This PDF is too long to index at once. Split it into smaller files (maximum 600 text sections)." }, { status: 413 });
    }
    if (!chunks.length) return NextResponse.json({ error: "No searchable text sections could be extracted from this PDF." }, { status: 422 });

    const embeddings: number[][] = [];
    for (let start = 0; start < chunks.length; start += 64) {
      embeddings.push(...await createEmbeddings(chunks.slice(start, start + 64).map((chunk) => chunk.content)));
    }

    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        "INSERT INTO documents (user_id, name, page_count, chunk_count) VALUES ($1, $2, $3, $4) RETURNING id, name, page_count AS pages, chunk_count AS chunks, created_at",
        [user.id, file.name.slice(0, 255), parsed.numpages, chunks.length],
      );
      const document = inserted.rows[0];
      for (let index = 0; index < chunks.length; index++) {
        const embedding = `[${embeddings[index].join(",")}]`;
        await client.query(
          "INSERT INTO chunks (document_id, user_id, chunk_index, page_number, content, embedding) VALUES ($1, $2, $3, $4, $5, $6::vector)",
          [document.id, user.id, chunks[index].index, chunks[index].page, chunks[index].content, embedding],
        );
      }
      await client.query("COMMIT");
      return NextResponse.json({ document }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Document upload failed:", error);
    const message = error instanceof Error && error.message.includes("OPENAI_API_KEY")
      ? "Document indexing is not configured. Add an OpenAI API key and try again."
      : error instanceof Error && error.message.startsWith("Embedding service")
        ? "The embedding service couldn't index this PDF. Please try again later."
        : "Unable to process this PDF. Check that it isn't password-protected and try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Sign in to manage your library." }, { status: 401 });
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "A document id is required." }, { status: 400 });
    const result = await pool.query("DELETE FROM documents WHERE id = $1 AND user_id = $2", [id, user.id]);
    if (!result.rowCount) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Document deletion failed:", error);
    return NextResponse.json({ error: "Unable to remove this document." }, { status: 500 });
  }
}
