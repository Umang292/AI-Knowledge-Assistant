import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (password.length < 8 || password.length > 72) {
      return NextResponse.json({ error: "Password must be between 8 and 72 characters." }, { status: 400 });
    }
    await ensureSchema();
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id, email",
      [email, passwordHash],
    );
    if (!result.rowCount) return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    await createSession(result.rows[0].id, result.rows[0].email);
    return NextResponse.json({ user: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Account registration failed:", error);
    return NextResponse.json({ error: "Unable to create your account right now." }, { status: 500 });
  }
}
