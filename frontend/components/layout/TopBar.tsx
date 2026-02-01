"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Bell, LogOut, Workflow, ChevronDown, User 
} from "lucide-react";
import { MENU_ITEMS } from "@/config/menu";
import { cn } from "@/lib/utils";

export function TopBar() {
  const pathname = usePathname();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [hoveredMenu, setHoveredMenu] = useState<string | null>(null);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <header className="h-16 glass-panel rounded-2xl flex items-center justify-between px-6 sticky top-0 z-50 mb-4 shrink-0">
      {/* 1. 로고 영역 */}
      <div className="flex items-center gap-2 shrink-0 cursor-pointer" onClick={() => window.location.href = '/'}>
        <Workflow className="w-7 h-7 text-primary" />
        <span className="text-xl font-extrabold text-stone-800">
          WebScraping<span className="text-primary">&</span>RAG
        </span>
        </div>

      {/* 2. 메인 네비게이션 (GNB) - 데스크탑 */}
      <nav className="hidden xl:flex flex-1 justify-center h-full">
        <ul className="flex items-center gap-2 h-full">
          {MENU_ITEMS.map((item) => {
            if (item.title === "대시보드") return null; // 대시보드는 로고 클릭으로 대체하거나 제외

            const isActive = pathname === item.href || pathname?.startsWith(item.href);
            const hasSubmenu = item.submenu && item.submenu.length > 0;

            return (
              <li 
                key={item.title} 
                className="relative h-full flex items-center"
                onMouseEnter={() => setHoveredMenu(item.title)}
                onMouseLeave={() => setHoveredMenu(null)}
              >
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-bold transition-colors px-4 py-2 rounded-xl",
                    isActive 
                      ? "text-primary bg-primary/10" 
                      : "text-stone-600 hover:text-stone-900 hover:bg-stone-100/60"
                  )}
                >
                  <item.icon className="w-4 h-4" />
                  {item.title}
                  {hasSubmenu && <ChevronDown className="w-3 h-3 opacity-40" />}
      </Link>

                {/* 드롭다운 메뉴 */}
                {hasSubmenu && hoveredMenu === item.title && (
                  <div className="absolute top-[calc(100%-10px)] left-1/2 -translate-x-1/2 pt-4 w-48 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="glass-panel rounded-xl shadow-xl border border-white/80 overflow-hidden py-1.5 flex flex-col gap-0.5 bg-white/80 backdrop-blur-xl">
                      {item.submenu?.map((sub) => (
                  <Link 
                          key={sub.title}
                          href={sub.href}
                          className={cn(
                            "block px-4 py-2.5 text-sm font-medium text-stone-600 hover:bg-primary/10 hover:text-primary transition-colors",
                            pathname === sub.href && "text-primary bg-primary/10 font-bold"
                          )}
                  >
                          {sub.title}
                  </Link>
                ))}
                    </div>
              </div>
            )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 3. 우측 유틸리티 */}
      <div className="flex items-center gap-3 shrink-0">
        <button className="relative p-2.5 rounded-xl hover:bg-white/50 transition-colors text-stone-500 hover:text-stone-800 border border-transparent hover:border-white/50">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
        </button>

        <div className="relative" onMouseLeave={() => setShowUserMenu(false)}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            onMouseEnter={() => setShowUserMenu(true)}
            className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full hover:bg-white/50 border border-transparent hover:border-white/60 transition-all group"
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-stone-100 to-stone-200 border border-white flex items-center justify-center text-stone-500 shadow-sm group-hover:shadow-md transition-shadow">
              <User className="w-5 h-5" />
            </div>
            <div className="flex flex-col items-start hidden sm:flex">
                <span className="text-sm font-bold text-stone-700 leading-none">관리자</span>
                <span className="text-[10px] text-stone-400 font-medium">Admin</span>
            </div>
          </button>

          {showUserMenu && (
             <div className="absolute right-0 top-[calc(100%+5px)] w-40 glass-panel rounded-xl shadow-xl z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors font-medium"
                >
                  <LogOut className="w-4 h-4" />
                  로그아웃
                </button>
             </div>
          )}
        </div>
      </div>
    </header>
  );
}
