import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { ensureSchema, pool } from "@/lib/db";

const COOKIE_NAME = "quill_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

function sessionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(userId: string, email: string) {
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(sessionKey());
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const key = sessionKey();
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key));
  } catch {
    return null;
  }
  if (!payload.sub || typeof payload.email !== "string") return null;
  await ensureSchema();
  const result = await pool.query("SELECT id, email FROM users WHERE id = $1", [payload.sub]);
  return result.rows[0] as { id: string; email: string } | undefined ?? null;
}
