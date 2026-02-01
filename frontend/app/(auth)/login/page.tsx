"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Mail, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError("이메일 또는 비밀번호가 올바르지 않습니다.");
        return;
      }
      if (data.mustChangePassword) {
        router.replace("/change-password");
        return;
      }
      router.replace(next);
    } catch {
      setError("로그인 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md relative">
      {/* Background accents */}
      <div className="absolute -top-24 -left-24 w-72 h-72 bg-gradient-to-br from-primary/25 to-transparent blur-3xl" />
      <div className="absolute -bottom-28 -right-20 w-80 h-80 bg-gradient-to-tr from-amber-200/40 to-transparent blur-3xl" />

      <div className="relative glass-panel rounded-3xl p-8 shadow-xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/30 via-white/70 to-white/30 border border-white/70 backdrop-blur-xl shadow-inner flex items-center justify-center shadow-md">
            <ShieldCheck className="w-6 h-6 text-primary drop-shadow-sm" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-stone-800">EcoMonitor AI</h1>
            <p className="text-sm text-stone-500">로그인 후 대시보드로 이동합니다.</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-bold text-stone-500">이메일</span>
            <div className="flex items-center gap-2 bg-white/50 border border-white/70 rounded-2xl px-4 py-3 backdrop-blur-md shadow-sm transition-all hover:bg-white/60 hover:shadow-md hover:shadow-stone-200/40 focus-within:ring-2 focus-within:ring-primary/20 focus-within:bg-white/70">
              <Mail className="w-4 h-4 text-stone-400" />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="name@company.com"
                className="w-full bg-transparent outline-none text-sm text-stone-700 placeholder:text-stone-400"
                required
              />
            </div>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs font-bold text-stone-500">비밀번호</span>
            <div className="flex items-center gap-2 bg-white/50 border border-white/70 rounded-2xl px-4 py-3 backdrop-blur-md shadow-sm transition-all hover:bg-white/60 hover:shadow-md hover:shadow-stone-200/40 focus-within:ring-2 focus-within:ring-primary/20 focus-within:bg-white/70">
              <Lock className="w-4 h-4 text-stone-400" />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
                className="w-full bg-transparent outline-none text-sm text-stone-700 placeholder:text-stone-400"
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
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        <div className="mt-6 text-xs text-stone-400 leading-relaxed">
          최초 로그인 계정은 <b>초기 비밀번호</b>로 로그인 후 <b>비밀번호 변경</b>이 필요합니다.
        </div>
      </div>
    </div>
  );
}


