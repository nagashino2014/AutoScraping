/**
 * 문서 유형 아이콘 컴포넌트
 */
import {
  FileText,
  Megaphone,
  Newspaper,
  Scale,
  ScrollText,
} from "lucide-react";

export function DocTypeIcon({ doc_type }: { doc_type?: string }) {
  const t = (doc_type ?? "").trim();
  
  if (!t) return <FileText className="w-4 h-4 text-stone-500" />;
  if (t === "보도자료") return <Newspaper className="w-4 h-4 text-blue-700" />;
  if (t === "공지") return <Megaphone className="w-4 h-4 text-amber-700" />;
  if (t === "고시·훈령·예규") return <ScrollText className="w-4 h-4 text-emerald-700" />;
  if (t === "입법예고") return <Megaphone className="w-4 h-4 text-orange-700" />;
  if (t === "법령") return <Scale className="w-4 h-4 text-indigo-700" />;
  if (t === "기술문서") return <FileText className="w-4 h-4 text-rose-700" />;
  if (t === "정책") return <FileText className="w-4 h-4 text-teal-700" />;
  if (t === "연보·월보") return <FileText className="w-4 h-4 text-cyan-700" />;
  if (t === "통계자료") return <FileText className="w-4 h-4 text-purple-700" />;
  if (t === "산업동향") return <FileText className="w-4 h-4 text-fuchsia-700" />;
  
  return <FileText className="w-4 h-4 text-stone-500" />;
}
