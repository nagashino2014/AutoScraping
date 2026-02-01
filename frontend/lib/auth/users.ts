import fs from "node:fs";
import path from "node:path";

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  role: "일반사용자" | "관리자";
  passwordHash: string;
  mustChangePassword: boolean;
};

type UsersFile = { users: UserRecord[] };

function usersFilePath() {
  // frontend/data/users.json
  return path.join(process.cwd(), "data", "users.json");
}

export function readUsers(): UsersFile {
  const p = usersFilePath();
  if (!fs.existsSync(p)) return { users: [] };
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as UsersFile;
}

export function writeUsers(next: UsersFile) {
  const p = usersFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf8");
}

export function findUserById(id: string): UserRecord | null {
  const { users } = readUsers();
  return users.find((u) => u.id === id) ?? null;
}

export function findUserByEmail(email: string): UserRecord | null {
  const { users } = readUsers();
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
}




