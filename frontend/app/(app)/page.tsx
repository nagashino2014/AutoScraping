import { ArrowUpRight, FileText, Search, AlertCircle, Upload, Calendar, BarChart2, Database, Settings, Activity, Brain } from 'lucide-react';
import Image from 'next/image';

export default function Home() {
  return (
    <div className="flex flex-col gap-6 p-2">
      {/* Welcome Section */}
      <section className="glass-panel p-8 rounded-3xl relative overflow-hidden">
        <div className="relative z-10">
            <h1 className="text-3xl font-bold text-stone-800 mb-2">환영합니다</h1>
            <p className="text-stone-600 text-lg">이번 주에 <span className="text-primary font-bold">3건의 새로운 중요 이슈</span>가 발굴되었습니다.</p>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
      </section>

      {/* Main Grid: 3 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.45fr_0.8fr_0.75fr] gap-6">
        
        {/* 1. Web Scraping Schedule Card */}
        <div className="glass-card p-6 rounded-3xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-stone-700 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-primary" />
                    Web Scraping 스케줄
                </h3>
            </div>
            
            <div className="flex-1 flex gap-4">
                {/* Inner Left: Monthly Calendar Grid */}
                <div className="flex-[0.75] bg-white/50 rounded-2xl p-4 border border-white/60 flex flex-col justify-center">
                     <div className="w-full grid grid-cols-3 gap-2">
                         {Array.from({length: 12}).map((_, i) => {
                             const month = i + 1;
                             const isSelected = month >= 1 && month <= 3; // Q1 Highlight
                             return (
                                 <div 
                                    key={i} 
                                    className={`
                                        h-8 flex items-center justify-center text-xs font-bold rounded-lg transition-all
                                        ${isSelected 
                                            ? 'bg-primary text-white shadow-md shadow-primary/20 scale-105' 
                                            : 'text-stone-400 hover:bg-stone-100 hover:text-stone-600'
                                        }
                                    `}
                                 >
                                     {month}월
                                 </div>
                             );
                         })}
                     </div>
                </div>
                
                {/* Inner Right: Details */}
                <div className="flex-[1.25] flex flex-col justify-center gap-3">
                    <div className="text-xs text-stone-400 font-semibold uppercase">Selected Period</div>
                    <div className="text-sm font-bold text-stone-800">2026 1Q (1월 ~ 3월)</div>
                    <div className="h-px bg-stone-200 my-1" />
                    {/* md(≥768px)부터는 3열 고정: 16:10 정도까지 3열 유지 */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {[
                            { name: '환경부', logo: '/logos/moe.png' },
                            // 요청: 산업통상자원부는 국가기관 로고(공통) 사용
                            { name: '산업통상자원부', logo: '/logos/gov.png' },
                            { name: '법제처', logo: '/logos/mogleg.png' },
                            { name: '국가법령정보센터', logo: '/logos/law.png' },
                            { name: '대한전기협회', logo: '/logos/koea.png' },
                            { name: '한국전력기술인협회', logo: '/logos/keta.png' },
                            { name: '한국전력공사', logo: '/logos/kepco.png' },
                            { name: '한국환경공단', logo: '/logos/keco.png' },
                            { name: '국립환경과학원', logo: '/logos/nier.png' },
                            { name: '환경산업기술원', logo: '/logos/keiti.png' },
                            { name: '한국환경산업협회', logo: '/logos/keia.png' },
                        ].map((agency) => (
                            <div
                                key={agency.name}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/40 border border-white/60 backdrop-blur-md shadow-sm hover:bg-white/60 transition-colors group cursor-pointer w-full"
                                title={agency.name}
                            >
                                <div className="w-7 h-7 rounded-full bg-white/60 border border-white/70 shadow-inner flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                                    <Image
                                        src={agency.logo}
                                        alt={`${agency.name} 로고`}
                                        width={14}
                                        height={14}
                                        className="object-contain"
                                    />
                                </div>
                                {/* 말줄임/줄바꿈 없이 1줄 고정: 내부 가로 스크롤(스크롤바 숨김) */}
                                <span className="flex-1 min-w-0 text-[12px] font-bold text-stone-700 leading-tight whitespace-nowrap overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                    {agency.name}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>

        {/* 2. Issue Discovery Frequency Card */}
        <div className="glass-card p-6 rounded-3xl flex flex-col gap-4">
            <h3 className="font-bold text-stone-700 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-amber-600" />
                이슈 발굴 빈도
            </h3>
            <div className="flex-1 flex gap-4">
                 {/* Inner Left: Bar Chart Mock */}
                 <div className="flex-[0.6] flex items-end justify-between px-2 pb-6 gap-2 h-full relative">
                     {[30, 50, 40, 70, 55, 80].map((h, i) => (
                         <div key={i} className="w-full relative group cursor-pointer flex flex-col justify-end h-full">
                             <div 
                                className="w-full rounded-t-lg transition-all duration-300 bg-gradient-to-t from-amber-500/80 to-amber-300/80 backdrop-blur-sm shadow-lg shadow-amber-500/20 group-hover:from-amber-600/90 group-hover:to-amber-400/90" 
                                style={{ height: `${h}%` }} 
                             />
                             <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-medium text-stone-400 whitespace-nowrap">
                                26/0{i + 1}
                             </div>
                             <div
                                className="absolute left-1/2 -translate-x-1/2 text-[10px] font-bold text-amber-700 opacity-0 group-hover:opacity-100 transition-opacity"
                                style={{ bottom: `calc(${h}% + 6px)` }}
                             >
                                {h}
                             </div>
                         </div>
                     ))}
                 </div>
                 {/* Inner Right: Details */}
                 <div className="flex-[1.4] flex flex-col justify-center gap-4 pl-1 max-w-[280px]">
                    <div className="text-center mb-2">
                        <div className="text-3xl font-extrabold text-stone-800">80건</div>
                        <div className="text-sm text-stone-500 font-medium">이번 달 발굴</div>
                    </div>
                    <div className="flex flex-col gap-2">
                        {[
                            { label: '대기', count: 32, color: 'bg-blue-500' },
                            { label: '수질', count: 18, color: 'bg-cyan-500' },
                            { label: '폐기물', count: 20, color: 'bg-green-500' },
                            { label: '안전', count: 10, color: 'bg-orange-500' },
                        ].map((item) => (
                            <div key={item.label} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${item.color} shadow-sm`} />
                                    <span className="text-stone-600 font-medium">{item.label}</span>
                                </div>
                                <span className="font-bold text-stone-800 text-base">{item.count}</span>
                            </div>
                        ))}
                    </div>
                 </div>
            </div>
        </div>

        {/* 3. Quick Actions (8 Grid) */}
        <div className="glass-card p-6 rounded-3xl flex flex-col gap-4">
             <h3 className="font-bold text-stone-700">빠른 실행</h3>
             <div className="grid grid-cols-4 grid-rows-2 gap-3 h-full">
                {[
                    { icon: Search, label: '새 스캔 시작', iconColor: 'text-primary', grad: 'from-primary/25 via-white/70 to-white/30' },
                    { icon: Upload, label: '파일 업로드', iconColor: 'text-blue-700', grad: 'from-blue-200/70 via-white/70 to-white/30' },
                    { icon: Database, label: 'DB관리', iconColor: 'text-purple-700', grad: 'from-purple-200/70 via-white/70 to-white/30' },
                    { icon: Brain, label: '심층 분석', iconColor: 'text-rose-700', grad: 'from-rose-200/70 via-white/70 to-white/30' },
                    { icon: Settings, label: '스케줄링 설정', iconColor: 'text-stone-700', grad: 'from-stone-200/70 via-white/70 to-white/30' },
                    { icon: Activity, label: '임베딩 현황', iconColor: 'text-indigo-700', grad: 'from-indigo-200/70 via-white/70 to-white/30' },
                    { icon: AlertCircle, label: '이슈 발굴', iconColor: 'text-amber-700', grad: 'from-amber-200/70 via-white/70 to-white/30' },
                    { icon: FileText, label: '보고서 초안 작성', iconColor: 'text-teal-700', grad: 'from-teal-200/70 via-white/70 to-white/30' },
                ].map((action, i) => (
                    <button key={i} className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-white/40 hover:bg-white/80 transition-all border border-transparent hover:border-white/50 active:scale-95 group">
                        <div className={`w-11 h-11 rounded-full flex items-center justify-center shadow-md group-hover:shadow-lg transition-all group-hover:-translate-y-1 bg-gradient-to-br ${action.grad} border border-white/70 backdrop-blur-xl shadow-inner`}>
                            <div className="absolute w-11 h-11 rounded-full bg-white/10" />
                            <action.icon className={`w-5 h-5 drop-shadow-sm relative ${action.iconColor}`} />
                        </div>
                        <span className="text-[13px] font-bold text-stone-600 text-center leading-tight">{action.label}</span>
                    </button>
                ))}
             </div>
        </div>
      </div>

      {/* Bottom Grid: Recent Issues & Report Drafts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Recent Issues List (Span 2) */}
          <section className="glass-panel p-6 rounded-3xl lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-stone-700">최근 발굴 이슈</h3>
                  <button className="text-xs font-semibold text-stone-500 hover:text-primary transition-colors flex items-center gap-1 group">
                      모두 보기 <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </button>
              </div>
              <div className="flex flex-col gap-2">
                  {[
                      { title: '환경부 고시 제2025-12호 (대기환경보전법)', tag: '대기질', color: 'from-blue-200/80 to-blue-50/30 text-blue-800', time: '2시간 전' },
                      { title: '폐기물관리법 시행규칙 일부개정령안 입법예고', tag: '폐기물', color: 'from-green-200/80 to-green-50/30 text-green-800', time: '5시간 전' },
                      { title: '산업안전보건기준에 관한 규칙 개정', tag: '안전', color: 'from-orange-200/80 to-orange-50/30 text-orange-800', time: '1일 전' },
                      { title: '수질오염공정시험기준 일부개정', tag: '수질', color: 'from-cyan-200/80 to-cyan-50/30 text-cyan-900', time: '1일 전' },
                      { title: '온실가스 배출권의 할당 및 거래에 관한 법률', tag: '에너지', color: 'from-rose-200/80 to-rose-50/30 text-rose-800', time: '2일 전' }
                  ].map((item, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/40 hover:bg-white/60 transition-colors border border-white/50 group cursor-pointer">
                          <div className="flex items-center gap-3">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-12 text-center bg-gradient-to-br ${item.color} border border-white/70 backdrop-blur-md shadow-sm`}>{item.tag}</span>
                              <p className="text-sm font-semibold text-stone-800 truncate max-w-md">{item.title}</p>
                          </div>
                          <span className="text-xs text-stone-400 whitespace-nowrap">{item.time}</span>
                      </div>
                  ))}
              </div>
          </section>

          {/* Generated Report Drafts (Span 1) */}
          <section className="glass-panel p-6 rounded-3xl flex flex-col">
              <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-stone-700">생성 보고서 초안</h3>
                  <button className="text-xs font-semibold text-stone-500 hover:text-primary transition-colors flex items-center gap-1 group">
                      모두 보기 <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </button>
              </div>
              <div className="flex-1 flex flex-col gap-3">
                  {[
                      { title: '2026년 1분기 환경규제 동향 보고서', sub: '대기오염물질 배출허용기준 강화 대응 전략 수립', date: '2026 1Q' },
                      { title: '2025년 4분기 환경규제 동향 보고서', sub: '화학물질등록평가법 개정에 따른 이행 조치 분석', date: '2025 4Q' },
                      { title: '2025년 4분기 환경규제 동향 보고서', sub: '사업장 폐기물 처리시설 정기 점검 리포트', date: '2025 4Q' },
                  ].map((report, i) => (
                      <div key={i} className="flex-1 bg-white rounded-xl shadow-sm border border-stone-100 p-4 flex flex-col relative group cursor-pointer hover:shadow-md transition-all hover:scale-[1.02]">
                          <div className="absolute top-0 right-0 w-8 h-8 bg-stone-50 rounded-bl-xl border-l border-b border-stone-100 z-10" />
                          
                          <div className="flex items-start justify-between mb-3">
                              <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center text-stone-500 group-hover:bg-primary group-hover:text-white transition-colors shadow-inner">
                                  <FileText className="w-4 h-4" />
                              </div>
                              <span className="text-[10px] font-bold text-stone-500 bg-stone-100 px-2 py-1 rounded-md border border-stone-200">{report.date}</span>
                          </div>
                          
                          <h4 className="font-bold text-stone-800 text-sm leading-snug mb-1">{report.title}</h4>
                          <p className="text-xs text-stone-500 font-medium line-clamp-2">{report.sub}</p>
                      </div>
                  ))}
              </div>
          </section>

      </div>
    </div>
  );
}


