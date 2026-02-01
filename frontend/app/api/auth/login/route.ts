import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { authCookie, signAuthToken } from "@/lib/auth/token";
import { findUserByEmail } from "@/lib/auth/users";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const email = String(body.email).trim();
  const password = String(body.password);

  const user = findUserByEmail(email);
  if (!user) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const token = await signAuthToken({
    sub: user.id,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });

  const res = NextResponse.json({
    id: user.id,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
  res.cookies.set(authCookie.name, token, authCookie.options);
  return res;
}




