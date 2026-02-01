import { NextResponse } from "next/server";
import { authCookie } from "@/lib/auth/token";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(authCookie.name, "", { ...authCookie.options, maxAge: 0 });
  return res;
}




