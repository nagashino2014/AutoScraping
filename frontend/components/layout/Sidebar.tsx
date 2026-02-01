"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MENU_ITEMS } from '@/config/menu';

export function Sidebar() {
  const pathname = usePathname();
  // Default to keeping sections open for better visibility in a dashboard
  const [openSections, setOpenSections] = useState<string[]>(MENU_ITEMS.map(i => i.title)); 

  const toggleSection = (title: string) => {
    setOpenSections(prev => 
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  };

  return (
    <aside className="w-72 h-[calc(100vh-2rem)] sticky top-4 left-4 glass-panel rounded-3xl flex flex-col p-6 overflow-y-auto hidden xl:flex">
      <div className="mb-6">
        {/* 메인 메뉴 텍스트 대신 KESI 로고 표시 (public 경로에 파일을 두면 자동 반영됨) */}
        <div className="px-2">
          <Image
            src="/brand/kesi.png"
            alt="KESI"
            width={160}
            height={32}
            className="h-[52px] w-auto object-contain opacity-90"
            priority
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {MENU_ITEMS.map((section) => {
          // 서브메뉴(submenu)가 있는 경우와 없는 경우(단일 메뉴) 분기 처리
          const hasSubmenu = section.submenu && section.submenu.length > 0;
          const isActiveSection = hasSubmenu 
            ? section.submenu?.some(item => pathname === item.href || pathname?.startsWith(item.href))
            : pathname === section.href;
            
          const isOpen = openSections.includes(section.title);

          // 단일 메뉴인 경우 (대시보드 등)
          if (!hasSubmenu) {
             return (
              <Link 
                key={section.title}
                href={section.href}
                className={cn(
                  "flex items-center justify-between w-full px-3 py-3 rounded-xl text-sm font-semibold transition-all group mb-1",
                  isActiveSection ? "text-primary bg-primary/5" : "text-stone-600 hover:text-stone-900"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-2 rounded-lg transition-colors shadow-sm",
                    isActiveSection ? "bg-primary text-white" : "bg-white text-stone-500 group-hover:bg-white/80"
                  )}>
                    <section.icon className="w-4 h-4" />
                  </div>
                  <span>{section.title}</span>
                </div>
              </Link>
             );
          }

          // 서브메뉴가 있는 경우 (아코디언)
          return (
            <div key={section.title} className="flex flex-col">
              <button 
                onClick={() => toggleSection(section.title)}
                className={cn(
                  "flex items-center justify-between w-full px-3 py-3 rounded-xl text-sm font-semibold transition-all group mb-1",
                  isActiveSection ? "text-primary" : "text-stone-600 hover:text-stone-900"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-2 rounded-lg transition-colors shadow-sm",
                    isActiveSection ? "bg-primary text-white" : "bg-white text-stone-500 group-hover:bg-white/80"
                  )}>
                    <section.icon className="w-4 h-4" />
                  </div>
                  <span>{section.title}</span>
                </div>
                {isOpen ? <ChevronDown className="w-4 h-4 opacity-40" /> : <ChevronRight className="w-4 h-4 opacity-40" />}
              </button>

              {isOpen && (
                <div className="flex flex-col gap-1 pl-4 relative">
                  {/* Decorative line */}
                  <div className="absolute left-6 top-0 bottom-0 w-px bg-stone-200" />
                  
                  {section.submenu?.map((item) => {
                    const isItemActive = pathname === item.href;
                    return (
                      <Link 
                        key={item.title} 
                        href={item.href}
                        className={cn(
                          "relative block px-3 py-2 text-sm rounded-lg transition-colors ml-4",
                          isItemActive 
                            ? "bg-primary/10 text-primary font-medium" 
                            : "text-stone-500 hover:text-stone-800 hover:bg-stone-100/50"
                        )}
                      >
                        {item.title}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
