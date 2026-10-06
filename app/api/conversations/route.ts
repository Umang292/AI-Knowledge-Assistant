import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Sign in to view conversations." }, { status: 401 });
    const result = await pool.query(
      "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50",
      [user.id],
    );
    return NextResponse.json({ conversations: result.rows });
  } catch (error) {
    console.error("Conversation list failed:", error);
    return NextResponse.json({ error: "Unable to load your conversations." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Sign in to start a conversation." }, { status: 401 });
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
    if (!title) return NextResponse.json({ error: "A conversation title is required." }, { status: 400 });
    await ensureSchema();
    const result = await pool.query(
      "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id, title, created_at, updated_at",
      [user.id, title],
    );
    return NextResponse.json({ conversation: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Conversation creation failed:", error);
    return NextResponse.json({ error: "Unable to start a conversation." }, { status: 500 });
  }
}
