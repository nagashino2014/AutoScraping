import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { authCookie, signAuthToken, verifyAuthToken } from "@/lib/auth/token";
import { readUsers, writeUsers } from "@/lib/auth/users";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(authCookie.name)?.value;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = await verifyAuthToken(token).catch(() => null);
  if (!payload) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.currentPassword || !body?.newPassword) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const currentPassword = String(body.currentPassword);
  const newPassword = String(body.newPassword);
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "weak_password" }, { status: 400 });
  }

  const data = readUsers();
  const idx = data.users.findIndex((u) => u.id === payload.sub);
  if (idx === -1) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = data.users[idx];
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(newPassword, salt);
  data.users[idx] = { ...user, passwordHash, mustChangePassword: false };
  writeUsers(data);

  const nextToken = await signAuthToken({
    sub: data.users[idx].id,
    role: data.users[idx].role,
    mustChangePassword: false,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(authCookie.name, nextToken, authCookie.options);
  return res;
}




