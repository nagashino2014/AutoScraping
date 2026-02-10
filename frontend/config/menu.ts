import {
  LayoutDashboard,
  Monitor,
  FileCode,
  Cpu,
  Printer,
  Settings,
} from "lucide-react";

export const MENU_ITEMS = [
  {
    title: "대시보드",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    title: "웹 스크래퍼",
    href: "/scraper",
    icon: Monitor,
    submenu: [
      { title: "대상 기관 관리", href: "/scraper/targets" },
      { title: "스케줄링 설정", href: "/scraper/schedule" },
      { title: "수집 현황", href: "/scraper/status" },
      { title: "설정/에러 수정", href: "/scraper/logs" },
    ],
  },
  {
    title: "추출 및 벡터화",
    href: "/processing",
    icon: FileCode,
    submenu: [
      { title: "텍스트 추출", href: "/processing/extract" },
      { title: "청킹 및 임베딩", href: "/processing/chunking" },
      { title: "벡터화", href: "/processing/vectorize" },
    ],
  },
  {
    title: "RAG 분석",
    href: "/rag",
    icon: Cpu,
    submenu: [
      { title: "RAG 분석", href: "/rag/analysis" },
      { title: "사용자 인터랙션", href: "/rag/interaction" },
      { title: "심층 분석", href: "/rag/deep-analysis" },
      { title: "사업장 프로파일", href: "/rag/profiles" },
      { title: "RAG 설정", href: "/rag/settings" },
    ],
  },
  {
    title: "보고서 생성",
    href: "/report",
    icon: Printer,
    submenu: [
      { title: "보고서 구조화", href: "/report/structure" },
      { title: "보고서 출력", href: "/report/print" },
      { title: "템플릿 관리", href: "/report/templates" },
      { title: "피드백", href: "/report/feedback" },
    ],
  },
];
