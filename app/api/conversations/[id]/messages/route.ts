import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Sign in to view messages." }, { status: 401 });
    const { id } = await context.params;
    await ensureSchema();
    const conversation = await pool.query(
      "SELECT id FROM conversations WHERE id = $1 AND user_id = $2",
      [id, user.id],
    );
    if (!conversation.rowCount) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    const result = await pool.query(
      "SELECT role, content, sources FROM messages WHERE conversation_id = $1 ORDER BY created_at, id",
      [id],
    );
    return NextResponse.json({ messages: result.rows });
  } catch (error) {
    console.error("Message history lookup failed:", error);
    return NextResponse.json({ error: "Unable to load this conversation." }, { status: 500 });
  }
}
