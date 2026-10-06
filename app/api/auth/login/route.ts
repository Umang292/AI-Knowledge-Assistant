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
    if (!email || !password || email.length > 254 || password.length > 72) {
      return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
    }
    await ensureSchema();
    const result = await pool.query("SELECT id, email, password_hash FROM users WHERE email = $1", [email]);
    const account = result.rows[0];
    if (!account || !(await bcrypt.compare(password, account.password_hash))) {
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    await createSession(account.id, account.email);
    return NextResponse.json({ user: { id: account.id, email: account.email } });
  } catch (error) {
    console.error("Sign-in failed:", error);
    return NextResponse.json({ error: "Unable to sign in right now." }, { status: 500 });
  }
}
