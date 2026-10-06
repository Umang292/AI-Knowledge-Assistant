import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

export async function GET() {
  try {
    return NextResponse.json({ user: await getUser() });
  } catch (error) {
    console.error("Session lookup failed:", error);
    return NextResponse.json({ error: "Unable to check your session." }, { status: 500 });
  }
}
