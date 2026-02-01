"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock } from "lucide-react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error === "invalid_credentials") {
          setError("현재 비밀번호가 올바르지 않습니다.");
        } else if (data?.error === "weak_password") {
          setError("새 비밀번호는 8자 이상이어야 합니다.");
        } else {
          setError("비밀번호 변경 중 오류가 발생했습니다.");
        }
        return;
      }
      router.replace("/");
    } catch {
      setError("비밀번호 변경 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md relative">
      <div className="absolute -top-24 -left-24 w-72 h-72 bg-gradient-to-br from-primary/25 to-transparent blur-3xl" />
      <div className="absolute -bottom-28 -right-20 w-80 h-80 bg-gradient-to-tr from-amber-200/40 to-transparent blur-3xl" />

      <div className="relative glass-panel rounded-3xl p-8 shadow-xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/25 via-white/70 to-white/30 border border-white/70 backdrop-blur-xl shadow-inner flex items-center justify-center shadow-md">
            <KeyRound className="w-6 h-6 text-primary drop-shadow-sm" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-stone-800">비밀번호 변경</h1>
            <p className="text-sm text-stone-500">최초 로그인 시 비밀번호 변경이 필요합니다.</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-bold text-stone-500">현재 비밀번호</span>
            <div className="flex items-center gap-2 bg-white/50 border border-white/70 rounded-2xl px-4 py-3 backdrop-blur-md shadow-sm transition-all hover:bg-white/60 hover:shadow-md hover:shadow-stone-200/40 focus-within:ring-2 focus-within:ring-primary/20 focus-within:bg-white/70">
              <Lock className="w-4 h-4 text-stone-400" />
              <input
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                type="password"
                className="w-full bg-transparent outline-none text-sm text-stone-700 placeholder:text-stone-400"
                required
              />
            </div>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs font-bold text-stone-500">새 비밀번호</span>
            <div className="flex items-center gap-2 bg-white/50 border border-white/70 rounded-2xl px-4 py-3 backdrop-blur-md shadow-sm transition-all hover:bg-white/60 hover:shadow-md hover:shadow-stone-200/40 focus-within:ring-2 focus-within:ring-primary/20 focus-within:bg-white/70">
              <Lock className="w-4 h-4 text-stone-400" />
              <input
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                type="password"
                className="w-full bg-transparent outline-none text-sm text-stone-700 placeholder:text-stone-400"
                placeholder="8자 이상"
                required
              />
            </div>
          </label>

          {error && (
            <div className="text-sm text-red-600 bg-red-50/60 border border-red-200 rounded-2xl px-4 py-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full rounded-2xl bg-primary text-white font-bold py-3 shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-[0.99] disabled:opacity-60"
          >
            {loading ? "변경 중..." : "변경하기"}
          </button>
        </form>
      </div>
    </div>
  );
}


