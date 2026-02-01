import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authCookie, verifyAuthToken } from "@/lib/auth/token";
import { findUserById } from "@/lib/auth/users";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(authCookie.name)?.value;
  if (!token) return NextResponse.json({ user: null });

  const payload = await verifyAuthToken(token).catch(() => null);
  if (!payload) return NextResponse.json({ user: null });

  const user = findUserById(payload.sub);
  if (!user) return NextResponse.json({ user: null });

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  });
}




