import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "em_token";

function getSecret() {
  const secret = process.env.AUTH_SECRET || "dev-only-secret-change-me";
  return new TextEncoder().encode(secret);
}

export type AuthTokenPayload = {
  sub: string; // user id
  role: "일반사용자" | "관리자";
  mustChangePassword: boolean;
};

export async function signAuthToken(payload: AuthTokenPayload) {
  const secret = getSecret();
  const jwt = await new SignJWT({
    role: payload.role,
    mustChangePassword: payload.mustChangePassword,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("7d");
  return jwt.sign(secret);
}

export async function verifyAuthToken(token: string) {
  const secret = getSecret();
  const { payload } = await jwtVerify(token, secret);
  const sub = payload.sub;
  if (!sub) return null;
  const role = payload.role;
  const mustChangePassword = payload.mustChangePassword;
  if (role !== "일반사용자" && role !== "관리자") return null;
  return {
    sub,
    role,
    mustChangePassword: Boolean(mustChangePassword),
  } satisfies AuthTokenPayload;
}

export const authCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
};




