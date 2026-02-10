"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Building2, Plus, Search, Trash2, Edit3, Save,
  ChevronRight, Loader2, X, Upload, FileText,
  Zap, Thermometer, Trash, Droplet, Circle, Hammer,
  Hexagon, Fuel, FlaskConical, Beaker, Cpu, Car,
  Wine, Shirt, Package, Microchip, Building, Battery,
  MoreHorizontal, Factory, MapPin, Users, Calendar,
  Shield, CheckCircle2, AlertTriangle, Settings,
  Beef, RefreshCw, Database, Brain, Layers, Play,
  CheckCircle, XCircle, Clock, ChevronDown, ChevronUp,
  PlusCircle, MinusCircle, Sparkles, Check, Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import GoogleMapRegionSelector, { preloadMapData } from "@/components/GoogleMapRegionSelector";

// ============================================================
// 타입 정의
// ============================================================

type IndustryCategory =
  | "power" | "steam" | "waste" | "petrochemical" | "rubber"
  | "steel" | "nonferrous" | "refinery" | "inorganic" | "otherchemical"
  | "pulp" | "electronics" | "meat" | "alcohol" | "textile"
  | "plastic" | "semiconductor" | "autoparts" | "cement" | "battery" | "other";

type FacilityScale = "small" | "medium" | "large" | "conglomerate";

interface ProfileListItem {
  id: string;
  name: string;
  code?: string;
  logo?: string;
  industryCategory: IndustryCategory;
  industryLabel: string;
  scale: FacilityScale;
  scaleLabel: string;
  location: string;
  emissionFacilityCount: number;
  preventionFacilityCount: number;
  permitCount: number;
  hasIntegratedPermit: boolean;
  updatedAt: string;
}

interface IndustryCategoryInfo {
  id: IndustryCategory;
  label: string;
  code: string;
  icon: React.ComponentType<{ className?: string }>;
  applicableYear?: number;
}

// ============================================================
// 21개 업종 정의
// ============================================================

const INDUSTRY_CATEGORIES: IndustryCategoryInfo[] = [
  { id: "power", label: "발전업", code: "351", icon: Zap, applicableYear: 2017 },
  { id: "steam", label: "증기/냉온수", code: "353", icon: Thermometer, applicableYear: 2017 },
  { id: "waste", label: "폐기물", code: "382", icon: Trash, applicableYear: 2017 },
  { id: "petrochemical", label: "석유화학", code: "20111", icon: Droplet, applicableYear: 2018 },
  { id: "rubber", label: "고무", code: "203", icon: Circle, applicableYear: 2018 },
  { id: "steel", label: "철강", code: "241", icon: Hammer, applicableYear: 2018 },
  { id: "nonferrous", label: "비철", code: "242", icon: Hexagon, applicableYear: 2018 },
  { id: "refinery", label: "석유정제/비료", code: "192,202", icon: Fuel, applicableYear: 2019 },
  { id: "inorganic", label: "무기/유기화학", code: "201", icon: FlaskConical, applicableYear: 2019 },
  { id: "otherchemical", label: "기타화학", code: "204", icon: Beaker, applicableYear: 2019 },
  { id: "pulp", label: "종이/펄프", code: "171,179", icon: FileText, applicableYear: 2020 },
  { id: "electronics", label: "전자부품", code: "262", icon: Cpu, applicableYear: 2020 },
  { id: "meat", label: "도축/육가공", code: "101", icon: Beef, applicableYear: 2021 },
  { id: "alcohol", label: "알콜음료", code: "111", icon: Wine, applicableYear: 2021 },
  { id: "textile", label: "섬유/염색", code: "134", icon: Shirt, applicableYear: 2021 },
  { id: "plastic", label: "플라스틱", code: "222", icon: Package, applicableYear: 2021 },
  { id: "semiconductor", label: "반도체", code: "261", icon: Microchip, applicableYear: 2021 },
  { id: "autoparts", label: "자동차부품", code: "303", icon: Car, applicableYear: 2021 },
  { id: "cement", label: "시멘트", code: "2394", icon: Building, applicableYear: 2022 },
  { id: "battery", label: "2차전지", code: "2640", icon: Battery, applicableYear: 2026 },
  { id: "other", label: "기타", code: "9999", icon: MoreHorizontal },
];

const SCALE_OPTIONS: { id: FacilityScale; label: string }[] = [
  { id: "small", label: "소규모" },
  { id: "medium", label: "중규모" },
  { id: "large", label: "대규모" },
  { id: "conglomerate", label: "대기업" },
];


// 탭 정의
const TABS = [
  { id: "overview", label: "개요", icon: Building2 },
  { id: "emission", label: "배출시설", icon: Factory },
  { id: "prevention", label: "방지시설", icon: Shield },
  { id: "stacks", label: "오염물질 배출량", icon: Building },
  { id: "process", label: "공정", icon: Settings },
  { id: "substances", label: "사용물질", icon: FlaskConical },
  { id: "permits", label: "허가", icon: FileText },
  { id: "bat", label: "BAT", icon: CheckCircle2 },
  { id: "monitoring", label: "모니터링", icon: RefreshCw },
  { id: "regulations", label: "규제현황", icon: AlertTriangle },
  { id: "ragconfig", label: "RAG설정", icon: Settings },
];

// ============================================================
// 메인 컴포넌트
// ============================================================

export default function ProfilesPage() {
  // 상태
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndustry, setSelectedIndustry] = useState<IndustryCategory | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  
  // 생성 모달 상태
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newProfile, setNewProfile] = useState({
    name: "",
    industryCategory: "petrochemical" as IndustryCategory,
    scale: "medium" as FacilityScale,
    region: "",
    address: "",
    sido: "",
    sigungu: "",
  });
  
  // 업로드 모달 상태
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [uploadDocType, setUploadDocType] = useState<"full_plan" | "partial">("full_plan");
  const [targetTabs, setTargetTabs] = useState<string[]>([]);
  
  // 편집 상태
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedProfile, setEditedProfile] = useState<any | null>(null);
  
  // 추출 상태
  const [extractionStatus, setExtractionStatus] = useState<{
    isExtracting: boolean;
    progress: string;
    currentTab: string;
    completedTabs: string[];
    failedTabs: string[];
  }>({
    isExtracting: false,
    progress: "",
    currentTab: "",
    completedTabs: [],
    failedTabs: [],
  });

  // 업종별 프로파일 수 계산
  const industryCounts = profiles.reduce((acc, p) => {
    acc[p.industryCategory] = (acc[p.industryCategory] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // 프로파일 목록 로드
  const loadProfiles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/rag/profiles");
      const data = await res.json();
      
      if (data.success) {
        setProfiles(data.profiles || []);
      }
    } catch (error) {
      console.error("Failed to load profiles:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 프로파일 상세 로드
  const loadProfileDetail = useCallback(async (id: string) => {
    try {
      setDetailLoading(true);
      const res = await fetch(`/api/rag/profiles/${id}`);
      const data = await res.json();
      
      if (data.success) {
        setSelectedProfile(data.profile);
        setEditedProfile(data.profile);
        setIsEditing(false);
      }
    } catch (error) {
      console.error("Failed to load profile detail:", error);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // 수동 입력 저장
  const saveManualChanges = async () => {
    if (!editedProfile) return;
    
    try {
      setSaving(true);
      const res = await fetch(`/api/rag/profiles/${editedProfile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editedProfile),
      });
      
      const data = await res.json();
      
      if (data.success) {
        setSelectedProfile(data.profile);
        setEditedProfile(data.profile);
        setIsEditing(false);
      }
    } catch (error) {
      console.error("Failed to save profile:", error);
    } finally {
      setSaving(false);
    }
  };

  // 수동 입력 토글
  const toggleManualEdit = () => {
    if (isEditing) {
      saveManualChanges();
    } else {
      setEditedProfile(selectedProfile);
      setIsEditing(true);
    }
  };

  // 프로파일 생성
  const createNewProfile = async () => {
    if (!newProfile.name) return;
    
    try {
      setCreating(true);
      const res = await fetch("/api/rag/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProfile.name,
          industryCategory: newProfile.industryCategory,
          basicInfo: {
            name: newProfile.name,
            industryCategory: newProfile.industryCategory,
            scale: newProfile.scale,
            location: {
              address: newProfile.address,
              region: newProfile.region,
              district: "",
            },
          },
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        setShowCreateModal(false);
        setNewProfile({
          name: "",
          industryCategory: "petrochemical",
          scale: "medium",
          region: "",
          address: "",
          sido: "",
          sigungu: "",
        });
        loadProfiles();
        setSelectedIndustry(data.profile.industryCategory);
        setSelectedProfileId(data.profile.id);
        loadProfileDetail(data.profile.id);
      }
    } catch (error) {
      console.error("Failed to create profile:", error);
    } finally {
      setCreating(false);
    }
  };

  // 프로파일 삭제
  const deleteProfileById = async (id: string) => {
    if (!confirm("이 프로파일을 삭제하시겠습니까?")) return;
    
    try {
      const res = await fetch(`/api/rag/profiles/${id}`, {
        method: "DELETE",
      });
      
      const data = await res.json();
      
      if (data.success) {
        if (selectedProfileId === id) {
          setSelectedProfileId(null);
          setSelectedProfile(null);
        }
        loadProfiles();
      }
    } catch (error) {
      console.error("Failed to delete profile:", error);
    }
  };

  useEffect(() => {
    loadProfiles();
    // 지도 GeoJSON 데이터 미리 로드 (모달 열기 전에 완료)
    preloadMapData();
  }, [loadProfiles]);

  useEffect(() => {
    if (selectedProfileId) {
      loadProfileDetail(selectedProfileId);
    }
  }, [selectedProfileId, loadProfileDetail]);

  // 필터링된 프로파일
  const filteredProfiles = profiles.filter((p) => {
    const matchesIndustry = !selectedIndustry || p.industryCategory === selectedIndustry;
    const matchesSearch = !searchQuery || 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.location.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesIndustry && matchesSearch;
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 헤더 - 고정 */}
      <div className="glass-panel p-4 rounded-3xl mb-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-stone-800">사업장 프로파일</h1>
            <p className="text-xs text-stone-500 mt-0.5">
              통합환경관리계획서 기반 사업장별 맞춤형 RAG 분석
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <span className="text-sm text-stone-500">
              총 {profiles.length}개 사업장
            </span>
            <button
              onClick={() => {
                // 선택된 업종이 있으면 기본값으로 설정
                if (selectedIndustry) {
                  setNewProfile(prev => ({ ...prev, industryCategory: selectedIndustry }));
                }
                setShowCreateModal(true);
              }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium bg-primary text-white hover:bg-primary/90 transition-all"
            >
              <Plus className="w-4 h-4" />
              프로파일 추가
            </button>
          </div>
        </div>
      </div>

      {/* 메인 컨텐츠 - 남은 공간 채움 */}
      <div className="grid grid-cols-[380px_1fr] gap-4 flex-1 min-h-0 overflow-hidden">
        {/* 왼쪽: 업종 태그 + 사업장 목록 */}
        <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
          {/* 업종 태그 버튼 - 2열 배치 */}
          <div className="glass-panel p-4 rounded-2xl shrink-0">
            <h3 className="text-xs font-semibold text-stone-600 mb-3">통합허가 대상업종</h3>
            <div className="grid grid-cols-2 gap-2">
              {INDUSTRY_CATEGORIES.map((industry) => {
                const Icon = industry.icon;
                const count = industryCounts[industry.id] || 0;
                const isSelected = selectedIndustry === industry.id;
                
                return (
                  <button
                    key={industry.id}
                    onClick={() => setSelectedIndustry(isSelected ? null : industry.id)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all",
                      isSelected
                        ? "bg-primary text-white"
                        : count > 0
                        ? "bg-stone-100 text-stone-700 hover:bg-stone-200"
                        : "bg-stone-50 text-stone-400 hover:bg-stone-100"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{industry.label}</span>
                    {count > 0 && (
                      <span className={cn(
                        "px-1.5 py-0.5 rounded-full text-[10px] shrink-0",
                        isSelected ? "bg-white/20" : "bg-stone-200"
                      )}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 검색 */}
          <div className="glass-panel p-3 rounded-xl shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="사업장 검색..."
                className="w-full pl-10 pr-4 py-2 text-sm rounded-lg bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* 사업장 목록 */}
          <div className="glass-panel rounded-2xl flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
              <span className="text-xs font-medium text-stone-600">
                {selectedIndustry 
                  ? `${INDUSTRY_CATEGORIES.find(i => i.id === selectedIndustry)?.label} (${filteredProfiles.length})`
                  : `전체 사업장 (${filteredProfiles.length})`
                }
              </span>
              {selectedIndustry && (
                <button
                  onClick={() => setSelectedIndustry(null)}
                  className="text-xs text-stone-400 hover:text-stone-600"
                >
                  전체 보기
                </button>
              )}
            </div>
            
            {loading ? (
              <div className="p-8 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
              </div>
            ) : filteredProfiles.length === 0 ? (
              <div className="p-8 text-center">
                <Building2 className="w-10 h-10 text-stone-300 mx-auto mb-3" />
                <p className="text-sm text-stone-500">
                  {selectedIndustry ? "해당 업종에 등록된 사업장이 없습니다." : "등록된 프로파일이 없습니다."}
                </p>
                <button
                  onClick={() => {
                    if (selectedIndustry) {
                      setNewProfile(prev => ({ ...prev, industryCategory: selectedIndustry }));
                    }
                    setShowCreateModal(true);
                  }}
                  className="mt-3 text-xs text-primary hover:underline"
                >
                  새 프로파일 추가
                </button>
              </div>
            ) : (
              <div className="divide-y divide-stone-100 flex-1 overflow-y-auto">
                {filteredProfiles.map((profile) => {
                  const industry = INDUSTRY_CATEGORIES.find((i) => i.id === profile.industryCategory);
                  // CI 로고 경로 (profile.logo가 있으면 사용, 없으면 기본 경로 체크)
                  const logoUrl = profile.logo || `/logos/CI/${profile.id}.png`;
                  
                  return (
                    <button
                      key={profile.id}
                      onClick={() => setSelectedProfileId(profile.id)}
                      className={cn(
                        "w-full px-4 py-3 text-left hover:bg-stone-50/50 transition-all",
                        selectedProfileId === profile.id && "bg-primary/5 border-l-2 border-primary"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden",
                          selectedProfileId === profile.id ? "bg-primary/10" : "bg-stone-100"
                        )}>
                          {profile.logo ? (
                            <img 
                              src={profile.logo} 
                              alt={`${profile.name} CI`} 
                              className="w-full h-full object-contain p-1"
                              onError={(e) => {
                                // 로고 로드 실패 시 기본 아이콘 표시
                                (e.target as HTMLImageElement).style.display = "none";
                                (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                              }}
                            />
                          ) : null}
                          <Building2 className={cn(
                            "w-5 h-5",
                            selectedProfileId === profile.id ? "text-primary" : "text-stone-400",
                            profile.logo ? "hidden" : ""
                          )} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-stone-700 truncate">
                            {profile.name}
                          </div>
                          <div className="text-[10px] text-stone-400 mt-0.5 flex items-center gap-2">
                            <span>{industry?.label || profile.industryCategory}</span>
                            <span>•</span>
                            <span>{profile.location || "위치 미지정"}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1.5">
                            {profile.hasIntegratedPermit && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-600">
                                통합허가
                              </span>
                            )}
                            {profile.emissionFacilityCount > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">
                                배출 {profile.emissionFacilityCount}
                              </span>
                            )}
                            {profile.preventionFacilityCount > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-600">
                                방지 {profile.preventionFacilityCount}
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 오른쪽: 상세 정보 (11개 탭) */}
        <div className="flex flex-col min-h-0 overflow-hidden">
          {selectedProfile ? (
            <>
              {/* 상세 헤더 */}
              <div className="glass-panel p-4 rounded-2xl mb-3 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* CI 로고 또는 기본 아이콘 */}
                    {(() => {
                      // 편집 중이면 editedProfile, 아니면 selectedProfile에서 로고 가져오기
                      const currentLogo = isEditing 
                        ? editedProfile?.overview?.basicInfo?.logo 
                        : (selectedProfile?.overview?.basicInfo?.logo || selectedProfile?.logo);
                      return (
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden">
                          {currentLogo ? (
                            <img 
                              src={currentLogo} 
                              alt="사업장 CI" 
                              className="w-full h-full object-contain"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                                (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                              }}
                            />
                          ) : null}
                          <Building2 className={cn("w-6 h-6 text-primary", currentLogo && "hidden")} />
                        </div>
                      );
                    })()}
                    <div>
                      <h2 className="font-semibold text-stone-800">{selectedProfile.name}</h2>
                      <p className="text-xs text-stone-500">
                        {INDUSTRY_CATEGORIES.find(i => i.id === selectedProfile.industryCategory)?.label} •{" "}
                        {SCALE_OPTIONS.find(s => s.id === selectedProfile.overview?.basicInfo?.scale)?.label || "중규모"}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {/* 편집 모드일 때 나가기 버튼 */}
                    {isEditing && (
                      <button
                        onClick={() => {
                          setEditedProfile(selectedProfile);
                          setIsEditing(false);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 transition-colors"
                      >
                        <X className="w-3 h-3" />
                        나가기
                      </button>
                    )}
                    {/* 수동 입력 / 변경사항 저장 버튼 */}
                    <button
                      onClick={toggleManualEdit}
                      disabled={saving}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                        isEditing
                          ? "bg-green-500 text-white hover:bg-green-600"
                          : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                      )}
                    >
                      {saving ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : isEditing ? (
                        <Save className="w-3 h-3" />
                      ) : (
                        <Edit3 className="w-3 h-3" />
                      )}
                      {isEditing ? "변경사항 저장" : "수동 입력"}
                    </button>
                    {/* 문서 업로드 버튼 */}
                    <button
                      onClick={() => setShowUploadModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20"
                    >
                      <Upload className="w-3 h-3" />
                      문서 업로드
                    </button>
                    <button
                      onClick={() => deleteProfileById(selectedProfile.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-3 h-3" />
                      삭제
                    </button>
                  </div>
                </div>
              </div>

              {/* 탭 네비게이션 */}
              <div className="glass-panel p-2 rounded-2xl mb-3 shrink-0">
                <div className="flex gap-1 overflow-x-auto">
                  {TABS.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all",
                          activeTab === tab.id
                            ? "bg-primary text-white"
                            : "text-stone-600 hover:bg-stone-100"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 탭 컨텐츠 */}
              <div className="glass-panel p-6 rounded-2xl flex-1 overflow-y-auto min-h-0">
                {detailLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
                  </div>
                ) : (
                  <TabContent
                    activeTab={activeTab}
                    profile={selectedProfile}
                    editedProfile={editedProfile}
                    setEditedProfile={setEditedProfile}
                    isEditing={isEditing}
                    setIsEditing={setIsEditing}
                    extractionStatus={extractionStatus}
                    setExtractionStatus={setExtractionStatus}
                    onRefresh={() => loadProfileDetail(selectedProfile.id)}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="glass-panel p-12 rounded-2xl flex flex-col items-center justify-center flex-1 min-h-0">
              <Building2 className="w-16 h-16 text-stone-300 mb-4" />
              <p className="font-semibold text-stone-500">프로파일을 선택하세요</p>
              <p className="text-sm text-stone-400 mt-1 text-center">
                왼쪽에서 업종을 선택하고 사업장을 클릭하거나<br />
                새 프로파일을 추가하세요.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 생성 모달 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="p-4 border-b border-stone-100 flex items-center justify-between">
              <h3 className="font-semibold text-stone-800">새 프로파일 추가</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded hover:bg-stone-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs text-stone-600 mb-1 block">사업장명 *</label>
                <input
                  type="text"
                  value={newProfile.name}
                  onChange={(e) => setNewProfile(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="예: OO화학 대전공장"
                  className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              
              <div>
                <label className="text-xs text-stone-600 mb-2 block">업종 *</label>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-stone-50 rounded-lg">
                  {INDUSTRY_CATEGORIES.map((industry) => {
                    const Icon = industry.icon;
                    return (
                      <button
                        key={industry.id}
                        onClick={() => setNewProfile(prev => ({ ...prev, industryCategory: industry.id }))}
                        className={cn(
                          "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all",
                          newProfile.industryCategory === industry.id
                            ? "bg-primary text-white"
                            : "bg-white text-stone-600 hover:bg-stone-100 border border-stone-200"
                        )}
                      >
                        <Icon className="w-3 h-3" />
                        {industry.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              
              <div>
                <label className="text-xs text-stone-600 mb-1 block">규모 *</label>
                <div className="flex gap-2">
                  {SCALE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setNewProfile(prev => ({ ...prev, scale: opt.id }))}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all",
                        newProfile.scale === opt.id
                          ? "bg-primary text-white"
                          : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              
              <div>
                <label className="text-xs text-stone-600 mb-1 block">지역 (지도에서 선택)</label>
                <GoogleMapRegionSelector
                  onSelect={(sido, sigungu, fullRegion) => {
                    setNewProfile(prev => ({
                      ...prev,
                      sido,
                      sigungu,
                      region: fullRegion,
                    }));
                  }}
                  initialSido={newProfile.sido}
                  initialSigungu={newProfile.sigungu}
                />
              </div>
            </div>
            
            <div className="p-4 border-t border-stone-100 flex justify-end gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-stone-600 hover:bg-stone-100"
              >
                취소
              </button>
              <button
                onClick={createNewProfile}
                disabled={!newProfile.name || creating}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
                  newProfile.name
                    ? "bg-primary text-white hover:bg-primary/90"
                    : "bg-stone-200 text-stone-400 cursor-not-allowed"
                )}
              >
                {creating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 업로드 모달 */}
      {showUploadModal && selectedProfile && (
        <UploadModal
          profile={selectedProfile}
          onClose={() => {
            setShowUploadModal(false);
            setUploadProgress("");
          }}
          onUploadComplete={() => {
            setShowUploadModal(false);
            loadProfileDetail(selectedProfile.id);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// 업로드 모달 컴포넌트 (확장 버전 - 단계별 워크플로우)
// ============================================================

// 파이프라인 단계 타입
type PipelineStep = "upload" | "extract" | "parse" | "complete";

// 업로드된 문서 상태
interface UploadedDocState {
  id: string;
  fileName: string;
  originalName: string;
  savedPath?: string;
  targetTabs: string[];
  fileSize: number;
  status: "pending" | "uploading" | "uploaded" | "extracting" | "extracted" | "parsing" | "parsed" | "failed";
  extractionProgress?: number;
  error?: string;
  textLength?: number;
  tableCount?: number;
  pageCount?: number;
}

// 파이프라인 상태 인터페이스
interface PipelineState {
  currentStep: PipelineStep;
  docs: UploadedDocState[];
  logs: string[];
  errors: string[];
  overallProgress: number;
}

// 파일-탭 매핑 타입
interface FileWithTabs {
  file: File;
  id: string;
  targetTabs: string[];
}

// 탭 옵션 상수
const TAB_OPTIONS = [
  { id: "emissionFacilities", label: "배출시설" },
  { id: "preventionFacilities", label: "방지시설" },
  { id: "stacks", label: "오염물질 배출량" },
  { id: "processes", label: "공정" },
  { id: "substances", label: "사용물질" },
  { id: "permits", label: "허가" },
  { id: "batStatus", label: "BAT" },
  { id: "monitoring", label: "모니터링" },
  { id: "regulations", label: "규제현황" },
];

// 파이프라인 단계 정보
const PIPELINE_STEPS: { id: PipelineStep; label: string; description: string }[] = [
  { id: "upload", label: "문서 업로드", description: "PDF/HWP 파일 업로드" },
  { id: "extract", label: "텍스트 추출", description: "문서에서 텍스트 추출" },
  { id: "parse", label: "데이터 파싱", description: "표 구조 분석 및 프로파일 데이터 추출" },
  { id: "complete", label: "완료", description: "파싱 완료" },
];

function UploadModal({
  profile,
  onClose,
  onUploadComplete,
}: {
  profile: any;
  onClose: () => void;
  onUploadComplete: () => void;
}) {
  // ============ 파이프라인 상태 (단계별 워크플로우) ============
  const [pipeline, setPipeline] = useState<PipelineState>({
    currentStep: "upload",
    docs: [],
    logs: [],
    errors: [],
    overallProgress: 0,
  });
  
  // 파일 업로드 대기열
  const [pendingFiles, setPendingFiles] = useState<FileWithTabs[]>([]);
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // 기존 업로드된 문서 (프로파일에서)
  const existingDocs = profile?.uploadedDocuments || [];
  
  // ============ 하단 카드: 테스트 상태 ============
  const [testFile, setTestFile] = useState<File | null>(null);
  const [testLogs, setTestLogs] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [detectingTable, setDetectingTable] = useState(false);
  const logContainerRef = React.useRef<HTMLDivElement>(null);
  const pipelineLogRef = React.useRef<HTMLDivElement>(null);
  
  // 로그 뷰 모드 및 표 데이터
  const [logViewMode, setLogViewMode] = useState<"logs" | "tables">("logs");
  const [detectedTables, setDetectedTables] = useState<{
    table_index: number;
    page_num: number;
    row_count: number;
    col_count: number;
    rows: string[][];
    is_merged: boolean;
    page_span: number[] | null;
    merge_confidence: number;
  }[]>([]);
  const [selectedTableIndex, setSelectedTableIndex] = useState(0);
  
  // ============ 파이프라인 로그 함수 ============
  const addPipelineLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setPipeline(prev => ({
      ...prev,
      logs: [...prev.logs, `[${timestamp}] ${message}`],
    }));
    setTimeout(() => {
      if (pipelineLogRef.current) {
        pipelineLogRef.current.scrollTop = pipelineLogRef.current.scrollHeight;
      }
    }, 50);
  };
  
  const clearPipelineLogs = () => {
    setPipeline(prev => ({ ...prev, logs: [], errors: [] }));
  };
  
  // ============ 파일 관리 함수 ============
  const addPendingFiles = (files: FileList) => {
    const newFiles: FileWithTabs[] = Array.from(files).map(file => ({
      file,
      id: crypto.randomUUID(),
      targetTabs: [],
    }));
    setPendingFiles(prev => [...prev, ...newFiles]);
  };
  
  const removePendingFile = (id: string) => {
    setPendingFiles(prev => prev.filter(f => f.id !== id));
  };
  
  const toggleFileTab = (fileId: string, tabId: string) => {
    setPendingFiles(prev => prev.map(f => {
      if (f.id !== fileId) return f;
      const newTabs = f.targetTabs.includes(tabId)
        ? f.targetTabs.filter(t => t !== tabId)
        : [...f.targetTabs, tabId];
      return { ...f, targetTabs: newTabs };
    }));
  };
  
  // ============ 파이프라인 문서 삭제 함수 ============
  const deleteUploadedDoc = async (docId: string, stage: "file" | "extract") => {
    try {
      const endpoint = `/api/rag/profiles/upload/${stage}`;
      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, profileId: profile.id }),
      });
      const data = await res.json();
      
      if (data.success) {
        setPipeline(prev => ({
          ...prev,
          docs: prev.docs.filter(d => d.id !== docId),
        }));
        addPipelineLog(`문서 삭제됨: ${data.message || docId}`);
        onUploadComplete(); // 프로파일 새로고침
      } else {
        addPipelineLog(`삭제 실패: ${data.error}`);
      }
    } catch (err: any) {
      addPipelineLog(`삭제 오류: ${err.message}`);
    }
  };
  
  // ============ Step 1: 파일 업로드 ============
  const handleFileUpload = async () => {
    if (pendingFiles.length === 0) return;
    
    setIsProcessing(true);
    clearPipelineLogs();
    addPipelineLog("파일 업로드 시작...");
    
    const newDocs: UploadedDocState[] = [];
    
    for (const fileWithTabs of pendingFiles) {
      addPipelineLog(`업로드 중: ${fileWithTabs.file.name}`);
      
      const formData = new FormData();
      formData.append("file", fileWithTabs.file);
      formData.append("profileId", profile.id);
      formData.append("docType", "full_plan");
      formData.append("targetTabs", JSON.stringify(fileWithTabs.targetTabs));
      
      try {
        const res = await fetch("/api/rag/profiles/upload/file", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        
        if (data.success) {
          newDocs.push({
            id: data.documentId,
            fileName: fileWithTabs.file.name,
            originalName: fileWithTabs.file.name,
            savedPath: data.savedPath,
            targetTabs: fileWithTabs.targetTabs,
            fileSize: fileWithTabs.file.size,
            status: "uploaded",
          });
          addPipelineLog(`업로드 완료: ${fileWithTabs.file.name}`);
        } else {
          addPipelineLog(`업로드 실패: ${data.error}`);
        }
      } catch (err: any) {
        addPipelineLog(`업로드 오류: ${err.message}`);
      }
    }
    
    setPipeline(prev => ({
      ...prev,
      docs: [...prev.docs, ...newDocs],
      currentStep: newDocs.length > 0 ? "extract" : "upload",
      overallProgress: newDocs.length > 0 ? 25 : 0,
    }));
    
    setPendingFiles([]);
    setIsProcessing(false);
    
    if (newDocs.length > 0) {
      addPipelineLog("업로드 완료. '텍스트 추출' 단계로 진행하세요.");
    }
  };
  
  // ============ Step 2: 텍스트 추출 ============
  const handleExtraction = async () => {
    const docsToExtract = pipeline.docs.filter(d => d.status === "uploaded");
    if (docsToExtract.length === 0) return;
    
    setIsProcessing(true);
    addPipelineLog("텍스트 추출 시작...");
    
    for (const doc of docsToExtract) {
      addPipelineLog(`추출 중: ${doc.originalName}`);
      
      // 상태 업데이트
      setPipeline(prev => ({
        ...prev,
        docs: prev.docs.map(d => 
          d.id === doc.id ? { ...d, status: "extracting" as const } : d
        ),
      }));
      
      try {
        const res = await fetch("/api/rag/profiles/upload/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId: doc.id, profileId: profile.id }),
        });
        
        // SSE 스트림 처리
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let extractionCompleted = false;
        
        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || ""; // 마지막 불완전한 이벤트는 버퍼에 유지
          
          for (const event of events) {
            const lines = event.split("\n");
            let eventType = "";
            let eventData: any = null;
            
            for (const line of lines) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7).trim();
              }
              if (line.startsWith("data: ")) {
                try {
                  eventData = JSON.parse(line.slice(6));
                } catch {}
              }
            }
            
            if (eventData) {
              if (eventData.message) {
                addPipelineLog(eventData.message);
              }
              if (eventData.textLength) {
                setPipeline(prev => ({
                  ...prev,
                  docs: prev.docs.map(d =>
                    d.id === doc.id ? { ...d, textLength: eventData.textLength, pageCount: eventData.pageCount, tableCount: eventData.tableCount } : d
                  ),
                }));
              }
              
              // complete 이벤트 또는 success 필드로 완료 감지
              if (eventType === "complete" || eventData.success === true) {
                extractionCompleted = true;
                setPipeline(prev => ({
                  ...prev,
                  docs: prev.docs.map(d =>
                    d.id === doc.id ? { ...d, status: "extracted" as const } : d
                  ),
                }));
              }
              
              // error 이벤트
              if (eventType === "error" || eventData.error) {
                setPipeline(prev => ({
                  ...prev,
                  docs: prev.docs.map(d =>
                    d.id === doc.id ? { ...d, status: "failed" as const, error: eventData.error } : d
                  ),
                }));
              }
            }
          }
        }
        
        // SSE 완료 후 상태가 아직 extracting이면 extracted로 변경 (fallback)
        if (!extractionCompleted) {
          setPipeline(prev => ({
            ...prev,
            docs: prev.docs.map(d =>
              d.id === doc.id && d.status === "extracting" ? { ...d, status: "extracted" as const } : d
            ),
          }));
        }
        
        addPipelineLog(`추출 완료: ${doc.originalName}`);
      } catch (err: any) {
        addPipelineLog(`추출 오류: ${err.message}`);
        setPipeline(prev => ({
          ...prev,
          docs: prev.docs.map(d =>
            d.id === doc.id ? { ...d, status: "failed" as const, error: err.message } : d
          ),
        }));
      }
    }
    
    // 최신 상태를 기반으로 단계 전환
    setPipeline(prev => {
      const extractedCount = prev.docs.filter(d => 
        d.status === "extracted" || d.status === "parsed"
      ).length;
      return {
        ...prev,
        currentStep: extractedCount > 0 ? "parse" : "extract",
        overallProgress: extractedCount > 0 ? 50 : prev.overallProgress,
      };
    });
    
    setIsProcessing(false);
    addPipelineLog("텍스트 추출 완료. '데이터 파싱' 단계로 진행하세요.");
  };
  
  // ============ Step 3: 데이터 파싱 (직접 파싱) ============
  const handleDirectParsing = async () => {
    const docsToParse = pipeline.docs.filter(d => d.status === "extracted");
    if (docsToParse.length === 0) return;
    
    setIsProcessing(true);
    addPipelineLog("데이터 파싱 시작...");
    
    // 파싱 중 상태로 업데이트
    for (const doc of docsToParse) {
      setPipeline(prev => ({
        ...prev,
        docs: prev.docs.map(d =>
          d.id === doc.id ? { ...d, status: "parsing" as const } : d
        ),
      }));
    }
    
    try {
      addPipelineLog(`파싱 대상 문서: ${docsToParse.map(d => d.originalName).join(", ")}`);
      
      const res = await fetch("/api/rag/profiles/upload/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          docIds: docsToParse.map(d => d.id),
        }),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        addPipelineLog(`API 오류: ${errorData.error || res.statusText}`);
        throw new Error(errorData.error || `API 오류: ${res.status}`);
      }
      
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("응답 스트림을 읽을 수 없습니다.");
      }
      
      const decoder = new TextDecoder();
      let buffer = "";
      let parsingCompleted = false;
      
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        
        for (const event of events) {
          const lines = event.split("\n");
          let eventType = "";
          let eventData: any = null;
          
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            }
            if (line.startsWith("data: ")) {
              try {
                eventData = JSON.parse(line.slice(6));
              } catch {}
            }
          }
          
          if (eventData) {
            if (eventData.message) {
              addPipelineLog(eventData.message);
            }
            if (eventData.currentTab) {
              addPipelineLog(`파싱 중: ${eventData.currentTab}`);
            }
            
            // complete 이벤트
            if (eventType === "complete" || eventData.success === true) {
              parsingCompleted = true;
              for (const doc of docsToParse) {
                setPipeline(prev => ({
                  ...prev,
                  docs: prev.docs.map(d =>
                    d.id === doc.id ? { ...d, status: "parsed" as const } : d
                  ),
                }));
              }
            }
            
            // error 이벤트
            if (eventType === "error" || eventData.error) {
              addPipelineLog(`파싱 오류: ${eventData.error || "알 수 없는 오류"}`);
            }
          }
        }
      }
      
      // fallback: complete 이벤트 없이 SSE 종료된 경우
      if (!parsingCompleted) {
        for (const doc of docsToParse) {
          setPipeline(prev => ({
            ...prev,
            docs: prev.docs.map(d =>
              d.id === doc.id && d.status === "parsing" ? { ...d, status: "parsed" as const } : d
            ),
          }));
        }
      }
      
      addPipelineLog("데이터 파싱 완료!");
      
      setPipeline(prev => ({
        ...prev,
        currentStep: "complete",
        overallProgress: 100,
      }));
      setIsProcessing(false);
      onUploadComplete();
    } catch (err: any) {
      addPipelineLog(`파싱 오류: ${err.message}`);
      for (const doc of docsToParse) {
        setPipeline(prev => ({
          ...prev,
          docs: prev.docs.map(d =>
            d.id === doc.id ? { ...d, status: "failed" as const, error: err.message } : d
          ),
        }));
      }
      setIsProcessing(false);
    }
  };
  
  // ============ 테스트용 로그 함수 ============
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setTestLogs(prev => [...prev, `[${timestamp}] ${message}`]);
    setTimeout(() => {
      if (logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      }
    }, 50);
  };
  
  const clearLogs = () => setTestLogs([]);
  
  // ============ 텍스트 추출 테스트 ============
  const runExtractionTest = async () => {
    if (!testFile) return;
    
    setExtracting(true);
    clearLogs();
    addLog(`파일: ${testFile.name} (${(testFile.size / 1024 / 1024).toFixed(2)}MB)`);
    addLog("텍스트 추출 시작...");
    
    try {
      const formData = new FormData();
      formData.append("file", testFile);
      
      const res = await fetch("/api/processing/extract", {
        method: "POST",
        body: formData,
      });
      
      const data = await res.json();
      
      if (data.ok || data.success || data.text) {
        const textLength = data.text?.length || data.extractedLength || 0;
        const pageCount = data.page_count || data.pageCount || "N/A";
        
        addLog(`추출 완료!`);
        addLog(`- 텍스트 길이: ${textLength.toLocaleString()}자`);
        addLog(`- 페이지 수: ${pageCount}`);
        
        if (data.tables && data.tables.length > 0) {
          addLog(`- 감지된 표: ${data.tables.length}개`);
        }
        
        if (data.quality_score) {
          addLog(`- 품질 점수: ${(data.quality_score * 100).toFixed(1)}%`);
        }
        
        addLog("테스트 성공!");
      } else {
        addLog(`추출 실패: ${data.error || "알 수 없는 오류"}`);
      }
    } catch (err: any) {
      addLog(`오류 발생: ${err.message}`);
    } finally {
      setExtracting(false);
    }
  };
  
  // ============ 표 구조 감지 테스트 ============
  const runTableDetectionTest = async () => {
    if (!testFile) return;
    
    setDetectingTable(true);
    setLogViewMode("logs"); // 로그 뷰로 시작
    setDetectedTables([]); // 이전 표 데이터 초기화
    setSelectedTableIndex(0);
    clearLogs();
    addLog(`파일: ${testFile.name}`);
    addLog("표 구조 감지 테스트 시작...");
    addLog("텍스트 추출 중...");
    
    try {
      const formData = new FormData();
      formData.append("file", testFile);
      
      const res = await fetch("/api/processing/extract", {
        method: "POST",
        body: formData,
      });
      
      const data = await res.json();
      
      if (data.ok || data.success || data.text) {
        addLog("텍스트 추출 완료");
        addLog("표 구조 분석 중...");
        
        const tables = data.tables || [];
        
        if (tables.length === 0) {
          addLog("감지된 표가 없습니다.");
          setDetectedTables([]);
        } else {
          // 표 데이터 저장
          setDetectedTables(tables);
          
          addLog(`총 ${tables.length}개 표 감지됨`);
          addLog("----------------------------");
          
          // 병합된 표 분석
          const mergedTables = tables.filter((t: any) => t.is_merged);
          const normalTables = tables.filter((t: any) => !t.is_merged);
          
          if (mergedTables.length > 0) {
            addLog(`Cross-page 병합된 표: ${mergedTables.length}개`);
            mergedTables.forEach((t: any, i: number) => {
              const pageSpan = t.page_span?.join(", ") || "N/A";
              const confidence = t.merge_confidence 
                ? `${(t.merge_confidence * 100).toFixed(1)}%` 
                : "N/A";
              addLog(`  [병합 ${i + 1}] 페이지: ${pageSpan}`);
              addLog(`           행: ${t.row_count || "?"}, 열: ${t.col_count || "?"}`);
              addLog(`           병합 신뢰도: ${confidence}`);
            });
          }
          
          if (normalTables.length > 0) {
            addLog(`일반 표: ${normalTables.length}개`);
            normalTables.slice(0, 5).forEach((t: any, i: number) => {
              const pageNum = t.page_num || "N/A";
              addLog(`  [표 ${i + 1}] 페이지: ${pageNum}, 행: ${t.row_count || "?"}, 열: ${t.col_count || "?"}`);
            });
            if (normalTables.length > 5) {
              addLog(`  ... 외 ${normalTables.length - 5}개`);
            }
          }
          
          addLog("----------------------------");
          addLog("표 구조 감지 테스트 완료!");
          addLog("'표 구조 보기' 버튼을 눌러 표 데이터를 확인하세요.");
        }
      } else {
        addLog(`추출 실패: ${data.error || "알 수 없는 오류"}`);
        setDetectedTables([]);
      }
    } catch (err: any) {
      addLog(`오류 발생: ${err.message}`);
      setDetectedTables([]);
    } finally {
      setDetectingTable(false);
    }
  };
  
  // ============ 렌더링 ============
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-xl flex flex-col">
        {/* 헤더 */}
        <div className="p-4 border-b border-stone-100 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-stone-800 flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" />
            문서 업로드 및 테스트
          </h3>
          <button 
            onClick={onClose} 
            className="p-1 rounded hover:bg-stone-100" 
            disabled={isProcessing || extracting || detectingTable}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* 컨텐츠 - 스크롤 가능 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ========== 상단 카드: 통합환경관리 계획서 업로드 (단계별 워크플로우) ========== */}
          <div className="border border-stone-200 rounded-xl overflow-hidden">
            <div className="bg-stone-50 px-4 py-3 border-b border-stone-200">
              <h4 className="font-medium text-stone-700 flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                통합환경관리 계획서 업로드
              </h4>
              <p className="text-xs text-stone-500 mt-1">
                단계별로 문서 업로드, 텍스트 추출, 데이터 파싱을 수행합니다.
              </p>
            </div>
            
            {/* 단계 인디케이터 */}
            <div className="px-4 py-3 border-b border-stone-100 bg-white">
              <div className="flex items-center justify-between">
                {PIPELINE_STEPS.slice(0, 3).map((step, idx) => {
                  const stepIndex = PIPELINE_STEPS.findIndex(s => s.id === pipeline.currentStep);
                  const isActive = step.id === pipeline.currentStep;
                  const isCompleted = idx < stepIndex || pipeline.currentStep === "complete";
                  
                  return (
                    <React.Fragment key={step.id}>
                      <div className="flex flex-col items-center">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all",
                          isCompleted ? "bg-green-500 text-white" :
                          isActive ? "bg-primary text-white" :
                          "bg-stone-200 text-stone-500"
                        )}>
                          {isCompleted ? (
                            <Check className="w-4 h-4" />
                          ) : (
                            idx + 1
                          )}
                        </div>
                        <span className={cn(
                          "text-[10px] mt-1",
                          isActive ? "text-primary font-medium" :
                          isCompleted ? "text-green-600" :
                          "text-stone-400"
                        )}>
                          {step.label}
                        </span>
                      </div>
                      {idx < 2 && (
                        <div className={cn(
                          "flex-1 h-0.5 mx-2",
                          idx < stepIndex || pipeline.currentStep === "complete" ? "bg-green-500" : "bg-stone-200"
                        )} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
              {/* 전체 진행률 */}
              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px] text-stone-500 mb-1">
                  <span>전체 진행률</span>
                  <span>{pipeline.overallProgress}%</span>
                </div>
                <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300" 
                    style={{ width: `${pipeline.overallProgress}%` }}
                  />
                </div>
              </div>
            </div>
            
            <div className="p-4">
              {/* Step 1: 업로드 단계 */}
              {pipeline.currentStep === "upload" && (
                <div className="space-y-3">
                  <div className="flex gap-4">
                    {/* 왼쪽: 파일 목록 */}
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs text-stone-600 font-medium">업로드 대기 파일</label>
                        <span className="text-xs text-stone-400">{pendingFiles.length}개</span>
                      </div>
                      
                      <div className="border border-stone-200 rounded-lg overflow-hidden min-h-[150px] max-h-[200px] overflow-y-auto">
                        {pendingFiles.length === 0 ? (
                          <div className="flex items-center justify-center h-[150px] text-stone-400 text-sm">
                            파일을 추가해주세요
                          </div>
                        ) : (
                          <div className="divide-y divide-stone-100">
                            {pendingFiles.map((fw) => (
                              <div key={fw.id} className="bg-white">
                                <div className="flex items-center gap-2 p-2 hover:bg-stone-50">
                                  <FileText className="w-4 h-4 text-stone-400 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-stone-700 truncate">{fw.file.name}</p>
                                    <p className="text-[10px] text-stone-400">{(fw.file.size / 1024 / 1024).toFixed(2)} MB</p>
                                  </div>
                                  <button
                                    onClick={() => setExpandedFileId(expandedFileId === fw.id ? null : fw.id)}
                                    className="text-xs text-primary hover:underline shrink-0"
                                  >
                                    {fw.targetTabs.length === 0 ? "전체" : `${fw.targetTabs.length}개 탭`}
                                    {expandedFileId === fw.id ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />}
                                  </button>
                                  <button
                                    onClick={() => removePendingFile(fw.id)}
                                    disabled={isProcessing}
                                    className="p-1 hover:bg-red-50 rounded text-red-400 hover:text-red-600 shrink-0"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                                {expandedFileId === fw.id && (
                                  <div className="px-3 pb-3 bg-stone-50">
                                    <p className="text-[10px] text-stone-500 mb-2">연관 탭 선택 (미선택 시 전체 탭 대상)</p>
                                    <div className="flex flex-wrap gap-1">
                                      {TAB_OPTIONS.map((tab) => (
                                        <button
                                          key={tab.id}
                                          onClick={() => toggleFileTab(fw.id, tab.id)}
                                          disabled={isProcessing}
                                          className={cn(
                                            "px-2 py-1 rounded text-[10px] font-medium transition-all",
                                            fw.targetTabs.includes(tab.id)
                                              ? "bg-primary text-white"
                                              : "bg-white border border-stone-200 text-stone-600 hover:border-primary"
                                          )}
                                        >
                                          {tab.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* 오른쪽: 파일 추가 버튼 */}
                    <div className="w-40 flex flex-col gap-2">
                      <label className={cn(
                        "flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer transition-all",
                        isProcessing ? "border-stone-200 bg-stone-50 cursor-not-allowed" : "border-stone-300 hover:border-primary hover:bg-primary/5"
                      )}>
                        <Plus className="w-6 h-6 text-stone-400 mb-1" />
                        <span className="text-xs text-stone-500">파일 추가</span>
                        <span className="text-[10px] text-stone-400">PDF, HWP, HWPX</span>
                        <input
                          type="file"
                          accept=".pdf,.hwp,.hwpx"
                          multiple
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              addPendingFiles(e.target.files);
                            }
                            e.target.value = "";
                          }}
                          className="hidden"
                          disabled={isProcessing}
                        />
                      </label>
                      
                      <button
                        onClick={handleFileUpload}
                        disabled={pendingFiles.length === 0 || isProcessing}
                        className={cn(
                          "flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
                          pendingFiles.length > 0 && !isProcessing
                            ? "bg-primary text-white hover:bg-primary/90"
                            : "bg-stone-200 text-stone-400 cursor-not-allowed"
                        )}
                      >
                        {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        업로드
                      </button>
                    </div>
                  </div>
                  
                  {/* 기존 업로드 문서 */}
                  {existingDocs.length > 0 && (
                    <div className="mt-3 p-2 bg-stone-50 rounded-lg">
                      <label className="text-xs text-stone-500 mb-1 block">
                        기존 업로드 문서 ({existingDocs.length}개)
                      </label>
                      <div className="text-xs space-y-1 max-h-[100px] overflow-y-auto">
                        {existingDocs.map((doc: any, i: number) => {
                          const isExtracted = doc.extractionStatus === "completed";
                          return (
                            <div 
                              key={i} 
                              className="flex items-center gap-2 p-1.5 rounded bg-white border border-stone-100"
                            >
                              {isExtracted ? (
                                <FileText className="w-3 h-3 text-green-500 shrink-0" />
                              ) : (
                                <CheckCircle className="w-3 h-3 text-stone-400 shrink-0" />
                              )}
                              <span className="truncate flex-1 text-stone-500">
                                {doc.originalName || doc.filename}
                              </span>
                              {isExtracted ? (
                                <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                                  추출 완료
                                </span>
                              ) : (
                                <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
                                  업로드됨
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Step 2: 텍스트 추출 단계 */}
              {pipeline.currentStep === "extract" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-stone-600 font-medium">업로드된 문서 ({pipeline.docs.length}개)</label>
                    <button
                      onClick={handleExtraction}
                      disabled={isProcessing || pipeline.docs.filter(d => d.status === "uploaded").length === 0}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                        !isProcessing && pipeline.docs.filter(d => d.status === "uploaded").length > 0
                          ? "bg-blue-500 text-white hover:bg-blue-600"
                          : "bg-stone-200 text-stone-400 cursor-not-allowed"
                      )}
                    >
                      {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      추출 시작
                    </button>
                  </div>
                  
                  <div className="border border-stone-200 rounded-lg overflow-hidden max-h-[200px] overflow-y-auto">
                    {pipeline.docs.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-2 p-2 border-b border-stone-100 last:border-0">
                        <FileText className="w-4 h-4 text-stone-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-stone-700 truncate">{doc.originalName}</p>
                          <p className="text-[10px] text-stone-400">
                            {doc.status === "uploaded" && "대기 중"}
                            {doc.status === "extracting" && "추출 중..."}
                            {doc.status === "extracted" && `추출 완료 (${doc.textLength?.toLocaleString() || 0}자)`}
                            {doc.status === "failed" && `실패: ${doc.error}`}
                          </p>
                        </div>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded shrink-0",
                          doc.status === "extracted" ? "bg-green-100 text-green-700" :
                          doc.status === "extracting" ? "bg-blue-100 text-blue-700" :
                          doc.status === "failed" ? "bg-red-100 text-red-700" :
                          "bg-stone-100 text-stone-600"
                        )}>
                          {doc.status === "uploaded" && "대기"}
                          {doc.status === "extracting" && "진행중"}
                          {doc.status === "extracted" && "완료"}
                          {doc.status === "failed" && "실패"}
                        </span>
                        <button
                          onClick={() => deleteUploadedDoc(doc.id, "extract")}
                          disabled={isProcessing}
                          className="p-1 hover:bg-red-50 rounded text-red-400 hover:text-red-600 shrink-0"
                          title="삭제"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  
                  {pipeline.docs.filter(d => d.status === "extracted").length > 0 && (
                    <button
                      onClick={() => setPipeline(prev => ({ ...prev, currentStep: "parse", overallProgress: 50 }))}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
                    >
                      다음 단계 <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
              
              {/* Step 3: 데이터 파싱 단계 */}
              {pipeline.currentStep === "parse" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-stone-600 font-medium">추출된 문서</label>
                    <button
                      onClick={handleDirectParsing}
                      disabled={isProcessing || pipeline.docs.filter(d => d.status === "extracted").length === 0}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                        !isProcessing && pipeline.docs.filter(d => d.status === "extracted").length > 0
                          ? "bg-amber-500 text-white hover:bg-amber-600"
                          : "bg-stone-200 text-stone-400 cursor-not-allowed"
                      )}
                    >
                      {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                      파싱 시작
                    </button>
                  </div>
                  
                  <div className="border border-stone-200 rounded-lg overflow-hidden max-h-[200px] overflow-y-auto">
                    {pipeline.docs.filter(d => ["extracted", "parsing", "parsed", "failed"].includes(d.status)).map((doc) => (
                      <div key={doc.id} className="flex items-center gap-2 p-2 border-b border-stone-100 last:border-0">
                        <FileText className="w-4 h-4 text-stone-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-stone-700 truncate">{doc.originalName}</p>
                          <p className="text-[10px] text-stone-400">
                            {doc.status === "extracted" && `${doc.textLength?.toLocaleString() || 0}자 추출됨 - 파싱 대기`}
                            {doc.status === "parsing" && "파싱 중..."}
                            {doc.status === "parsed" && "파싱 완료"}
                            {doc.status === "failed" && `실패: ${doc.error}`}
                          </p>
                        </div>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded shrink-0",
                          doc.status === "parsed" ? "bg-green-100 text-green-700" :
                          doc.status === "parsing" ? "bg-amber-100 text-amber-700" :
                          doc.status === "failed" ? "bg-red-100 text-red-700" :
                          "bg-stone-100 text-stone-600"
                        )}>
                          {doc.status === "extracted" && "대기"}
                          {doc.status === "parsing" && "진행중"}
                          {doc.status === "parsed" && "완료"}
                          {doc.status === "failed" && "실패"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* 완료 단계 */}
              {pipeline.currentStep === "complete" && (
                <div className="text-center py-6">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                  <h4 className="font-medium text-stone-800 mb-1">파싱 완료</h4>
                  <p className="text-sm text-stone-500 mb-4">
                    {pipeline.docs.length}개 문서의 데이터 파싱이 완료되었습니다.
                  </p>
                  <button
                    onClick={() => {
                      setPipeline({
                        currentStep: "upload",
                        docs: [],
                        logs: [],
                        errors: [],
                        overallProgress: 0,
                      });
                    }}
                    className="px-4 py-2 bg-stone-100 text-stone-700 rounded-lg text-sm font-medium hover:bg-stone-200"
                  >
                    새 문서 업로드
                  </button>
                </div>
              )}
              
              {/* 로그 창 */}
              {pipeline.logs.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-stone-500">처리 로그</label>
                    <button onClick={clearPipelineLogs} className="text-[10px] text-stone-400 hover:text-stone-600">
                      지우기
                    </button>
                  </div>
                  <div
                    ref={pipelineLogRef}
                    className="bg-stone-900 text-stone-300 text-xs font-mono p-2 rounded-lg h-[80px] overflow-y-auto"
                  >
                    {pipeline.logs.map((log, i) => (
                      <div key={i}>{log}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* ========== 하단 카드: 텍스트 추출 / 표 구조 감지 테스트 ========== */}
          <div className="border border-stone-200 rounded-xl overflow-hidden">
            <div className="bg-stone-50 px-4 py-3 border-b border-stone-200">
              <h4 className="font-medium text-stone-700 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                텍스트 추출 / 표 구조 감지 테스트
              </h4>
              <p className="text-xs text-stone-500 mt-1">
                문서의 텍스트 추출 및 표 구조 감지(Cross-page 병합 포함) 기능을 테스트합니다.
              </p>
            </div>
            
            <div className="p-4 space-y-3">
              {/* 상단: 파일 선택 + 업로드 버튼 */}
              <div className="flex items-center gap-3">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-stone-100 rounded-lg">
                  <FileText className="w-4 h-4 text-stone-400" />
                  <span className={cn(
                    "text-sm truncate",
                    testFile ? "text-stone-700" : "text-stone-400"
                  )}>
                    {testFile ? testFile.name : "테스트할 문서를 선택하세요"}
                  </span>
                  {testFile && (
                    <button
                      onClick={() => setTestFile(null)}
                      className="ml-auto p-0.5 hover:bg-stone-200 rounded"
                    >
                      <X className="w-3 h-3 text-stone-500" />
                    </button>
                  )}
                </div>
                <label className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all",
                  extracting || detectingTable
                    ? "bg-stone-200 text-stone-400 cursor-not-allowed"
                    : "bg-stone-700 text-white hover:bg-stone-800"
                )}>
                  <Upload className="w-4 h-4" />
                  문서 업로드
                  <input
                    type="file"
                    accept=".pdf,.hwp,.hwpx"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        setTestFile(e.target.files[0]);
                        clearLogs();
                      }
                    }}
                    className="hidden"
                    disabled={extracting || detectingTable}
                  />
                </label>
              </div>
              
              {/* 중단: 테스트 버튼들 */}
              <div className="flex gap-2">
                <button
                  onClick={runExtractionTest}
                  disabled={!testFile || extracting || detectingTable}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
                    testFile && !extracting && !detectingTable
                      ? "bg-blue-500 text-white hover:bg-blue-600"
                      : "bg-stone-200 text-stone-400 cursor-not-allowed"
                  )}
                >
                  {extracting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                  텍스트 추출 테스트
                </button>
                <button
                  onClick={runTableDetectionTest}
                  disabled={!testFile || extracting || detectingTable}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
                    testFile && !extracting && !detectingTable
                      ? "bg-amber-500 text-white hover:bg-amber-600"
                      : "bg-stone-200 text-stone-400 cursor-not-allowed"
                  )}
                >
                  {detectingTable ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Layers className="w-4 h-4" />
                  )}
                  표 구조 감지 테스트
                </button>
              </div>
              
              {/* 하단: 로그 창 (탭 전환 지원) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-stone-600 font-medium">테스트 로그</label>
                  <div className="flex items-center gap-2">
                    {/* 탭 전환 버튼 */}
                    <div className="flex items-center gap-1 bg-stone-100 rounded-lg p-0.5">
                      <button
                        onClick={() => setLogViewMode("logs")}
                        className={cn(
                          "px-2 py-1 rounded text-[10px] font-medium transition-all",
                          logViewMode === "logs"
                            ? "bg-white text-stone-700 shadow-sm"
                            : "text-stone-500 hover:text-stone-700"
                        )}
                      >
                        로그
                      </button>
                      <button
                        onClick={() => setLogViewMode("tables")}
                        disabled={detectedTables.length === 0}
                        className={cn(
                          "px-2 py-1 rounded text-[10px] font-medium transition-all",
                          logViewMode === "tables"
                            ? "bg-white text-stone-700 shadow-sm"
                            : detectedTables.length > 0
                            ? "text-stone-500 hover:text-stone-700"
                            : "text-stone-300 cursor-not-allowed"
                        )}
                      >
                        표 구조 보기 {detectedTables.length > 0 && `(${detectedTables.length})`}
                      </button>
                    </div>
                    {/* 지우기 버튼 */}
                    {testLogs.length > 0 && logViewMode === "logs" && (
                      <button
                        onClick={clearLogs}
                        className="text-[10px] text-stone-400 hover:text-stone-600"
                      >
                        지우기
                      </button>
                    )}
                  </div>
                </div>
                
                {/* 로그 뷰 */}
                {logViewMode === "logs" && (
                  <div 
                    ref={logContainerRef}
                    className="bg-stone-900 rounded-lg p-3 h-[160px] overflow-y-auto font-mono text-xs"
                  >
                    {testLogs.length === 0 ? (
                      <div className="text-stone-500 text-center py-8">
                        테스트 결과가 여기에 표시됩니다
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {testLogs.map((log, i) => (
                          <div 
                            key={i} 
                            className={cn(
                              "whitespace-pre-wrap",
                              log.includes("오류") || log.includes("실패") 
                                ? "text-red-400"
                                : log.includes("완료") || log.includes("성공")
                                ? "text-green-400"
                                : log.includes("병합")
                                ? "text-amber-400"
                                : "text-stone-300"
                            )}
                          >
                            {log}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                
                {/* 표 디스플레이 뷰 */}
                {logViewMode === "tables" && detectedTables.length > 0 && (
                  <div className="bg-stone-50 border border-stone-200 rounded-lg h-[160px] overflow-hidden flex flex-col">
                    {/* 표 선택 및 메타 정보 */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-stone-200 bg-white shrink-0">
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedTableIndex}
                          onChange={(e) => setSelectedTableIndex(Number(e.target.value))}
                          className="text-xs border border-stone-200 rounded px-2 py-1 bg-white"
                        >
                          {detectedTables.map((t, i) => (
                            <option key={i} value={i}>
                              표 {i + 1} (p.{t.page_num}, {t.row_count}x{t.col_count})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-stone-500">
                        {detectedTables[selectedTableIndex]?.is_merged && (
                          <span className="flex items-center gap-1 text-amber-600">
                            <Layers className="w-3 h-3" />
                            병합됨 (p.{detectedTables[selectedTableIndex]?.page_span?.join("-")})
                          </span>
                        )}
                        <span>
                          행: {detectedTables[selectedTableIndex]?.row_count}, 
                          열: {detectedTables[selectedTableIndex]?.col_count}
                        </span>
                        {detectedTables[selectedTableIndex]?.merge_confidence > 0 && (
                          <span>
                            신뢰도: {(detectedTables[selectedTableIndex]?.merge_confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {/* 표 데이터 */}
                    <div className="flex-1 overflow-auto p-2">
                      <table className="w-full text-xs border-collapse">
                        <tbody>
                          {detectedTables[selectedTableIndex]?.rows.slice(0, 10).map((row, rowIdx) => (
                            <tr 
                              key={rowIdx} 
                              className={cn(
                                rowIdx === 0 ? "bg-stone-200 font-medium" : "bg-white",
                                "border-b border-stone-200"
                              )}
                            >
                              {row.map((cell, cellIdx) => (
                                <td 
                                  key={cellIdx} 
                                  className="px-2 py-1 border-r border-stone-200 last:border-r-0 truncate max-w-[150px]"
                                  title={cell}
                                >
                                  {cell || "-"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {detectedTables[selectedTableIndex]?.rows.length > 10 && (
                        <div className="text-center text-[10px] text-stone-400 mt-2">
                          {detectedTables[selectedTableIndex]?.rows.length}행 중 10행 표시
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* 푸터 */}
        <div className="p-4 border-t border-stone-100 flex justify-end shrink-0">
          <button
            onClick={onClose}
            disabled={isProcessing || extracting || detectingTable}
            className="px-4 py-2 rounded-lg text-sm font-medium text-stone-600 hover:bg-stone-100"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 탭 컨텐츠 컴포넌트
// ============================================================

interface TabContentProps {
  activeTab: string;
  profile: any;
  editedProfile: any;
  setEditedProfile: (p: any) => void;
  isEditing: boolean;
  setIsEditing: (v: boolean) => void;
  extractionStatus: {
    isExtracting: boolean;
    progress: string;
    currentTab: string;
    completedTabs: string[];
    failedTabs: string[];
  };
  setExtractionStatus: (s: any) => void;
  onRefresh: () => void;
}

function TabContent(props: TabContentProps) {
  const { activeTab, profile, editedProfile, setEditedProfile, isEditing, extractionStatus, setExtractionStatus, onRefresh } = props;
  
  switch (activeTab) {
    case "overview":
      return <OverviewTab profile={profile} editedProfile={editedProfile} setEditedProfile={setEditedProfile} isEditing={isEditing} />;
    case "emission":
      return <EmissionFacilitiesTab profile={profile} editedProfile={editedProfile} setEditedProfile={setEditedProfile} isEditing={isEditing} />;
    case "prevention":
      return <PreventionFacilitiesTab profile={profile} editedProfile={editedProfile} setEditedProfile={setEditedProfile} isEditing={isEditing} />;
    case "stacks":
      return <StacksTab profile={profile} editedProfile={editedProfile} setEditedProfile={setEditedProfile} isEditing={isEditing} />;
    case "process":
      return <ProcessesTab profile={profile} editedProfile={editedProfile} setEditedProfile={setEditedProfile} isEditing={isEditing} />;
    case "substances":
      return <SubstancesTab profile={profile} editedProfile={editedProfile} setEditedProfile={setEditedProfile} isEditing={isEditing} />;
    case "permits":
      return <PermitsTab profile={profile} editedProfile={editedProfile} setEditedProfile={setEditedProfile} isEditing={isEditing} />;
    case "bat":
      return <BATStatusTab profile={profile} editedProfile={editedProfile} setEditedProfile={setEditedProfile} isEditing={isEditing} />;
    case "monitoring":
      return <MonitoringTab profile={profile} editedProfile={editedProfile} setEditedProfile={setEditedProfile} isEditing={isEditing} />;
    case "regulations":
      return <RegulationsTab profile={profile} editedProfile={editedProfile} setEditedProfile={setEditedProfile} isEditing={isEditing} />;
    case "ragconfig":
      return <RAGConfigTab profile={profile} editedProfile={editedProfile} setEditedProfile={setEditedProfile} isEditing={isEditing} extractionStatus={extractionStatus} setExtractionStatus={setExtractionStatus} onRefresh={onRefresh} />;
    default:
      return null;
  }
}

// ============================================================
// 개요 탭
// ============================================================

function OverviewTab({ profile, editedProfile, setEditedProfile, isEditing }: {
  profile: any;
  editedProfile: any;
  setEditedProfile: (p: any) => void;
  isEditing: boolean;
}) {
  const data = isEditing ? editedProfile : profile;
  const overview = data?.overview || {};
  const basicInfo = overview.basicInfo || {};
  const facilitySummary = overview.facilitySummary || {};
  const mediaPermits = overview.mediaPermits || {};
  const industry = INDUSTRY_CATEGORIES.find(i => i.id === data?.industryCategory);

  // 주소 검색 모달 상태
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [addressSearchQuery, setAddressSearchQuery] = useState("");
  const [addressResults, setAddressResults] = useState<any[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<any>(null);
  const [searchingAddress, setSearchingAddress] = useState(false);

  // KSIC 검색 상태
  const [ksicQuery, setKsicQuery] = useState("");
  const [ksicResults, setKsicResults] = useState<any[]>([]);
  const [showKsicDropdown, setShowKsicDropdown] = useState(false);

  // 담당자 체크박스 상태
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);

  const updateBasicInfo = (field: string, value: any) => {
    if (!isEditing || !editedProfile) return;
    setEditedProfile({
      ...editedProfile,
      overview: {
        ...editedProfile.overview,
        basicInfo: {
          ...editedProfile.overview?.basicInfo,
          [field]: value,
        },
      },
    });
  };

  const updateLocation = (field: string, value: any) => {
    if (!isEditing || !editedProfile) return;
    setEditedProfile({
      ...editedProfile,
      overview: {
        ...editedProfile.overview,
        basicInfo: {
          ...editedProfile.overview?.basicInfo,
          location: {
            ...editedProfile.overview?.basicInfo?.location,
            [field]: value,
          },
        },
      },
    });
  };

  const updateNestedField = (parentField: string, field: string, value: any) => {
    if (!isEditing || !editedProfile) return;
    setEditedProfile({
      ...editedProfile,
      overview: {
        ...editedProfile.overview,
        basicInfo: {
          ...editedProfile.overview?.basicInfo,
          [parentField]: {
            ...editedProfile.overview?.basicInfo?.[parentField],
            [field]: value,
          },
        },
      },
    });
  };

  const updateContact = (field: string, value: any) => {
    updateNestedField("contact", field, value);
  };

  const updateArea = (field: string, value: any) => {
    updateNestedField("area", field, value);
  };

  const updateFacilityClass = (field: string, value: any) => {
    updateNestedField("facilityClass", field, value);
  };

  const updateAnnualEmissions = (field: string, value: any) => {
    updateNestedField("annualEmissions", field, value);
  };

  const updateFacilitySummary = (field: string, value: any) => {
    if (!isEditing || !editedProfile) return;
    setEditedProfile({
      ...editedProfile,
      overview: {
        ...editedProfile.overview,
        facilitySummary: {
          ...editedProfile.overview?.facilitySummary,
          [field]: value,
        },
      },
    });
  };

  // 도로명 주소 검색 (모달에서 사용)
  const searchAddress = async () => {
    if (addressSearchQuery.length < 2) {
      setAddressResults([]);
      return;
    }
    setSearchingAddress(true);
    try {
      const res = await fetch(`/api/address/search?keyword=${encodeURIComponent(addressSearchQuery)}`);
      const data = await res.json();
      if (data.success) {
        setAddressResults(data.addresses || []);
      } else {
        setAddressResults([]);
      }
    } catch (error) {
      console.error("Address search error:", error);
      setAddressResults([]);
    } finally {
      setSearchingAddress(false);
    }
  };

  // 주소 선택 완료
  const confirmAddressSelection = () => {
    if (selectedAddress && isEditing && editedProfile) {
      // 모든 location 필드를 한 번에 업데이트
      setEditedProfile({
        ...editedProfile,
        overview: {
          ...editedProfile.overview,
          basicInfo: {
            ...editedProfile.overview?.basicInfo,
            location: {
              ...editedProfile.overview?.basicInfo?.location,
              zipCode: selectedAddress.zipNo,
              roadAddress: selectedAddress.roadAddressPart1 || selectedAddress.roadAddress,
              jibunAddress: selectedAddress.jibunAddress,
              region: selectedAddress.sido,
              district: selectedAddress.sigungu,
            },
          },
        },
      });
    }
    setShowAddressModal(false);
    setAddressSearchQuery("");
    setAddressResults([]);
    setSelectedAddress(null);
  };

  // KSIC 검색
  const searchKsic = async (query: string) => {
    if (query.length < 2) {
      setKsicResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/ksic/search?keyword=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.success) {
        setKsicResults(data.items || []);
        setShowKsicDropdown(true);
      }
    } catch (error) {
      console.error("KSIC search error:", error);
    }
  };

  // KSIC 코드로 직접 조회
  const lookupKsicCode = async (code: string) => {
    if (code.length !== 5) return null;
    try {
      const res = await fetch(`/api/ksic/search?code=${code}`);
      const data = await res.json();
      if (data.success && data.item) {
        return data.item;
      }
    } catch (error) {
      console.error("KSIC lookup error:", error);
    }
    return null;
  };

  // KSIC 추가
  const addKsicCode = (item: any) => {
    const current = basicInfo.industryCodes || [];
    if (!current.find((c: any) => c.code === item.code)) {
      updateBasicInfo("industryCodes", [...current, {
        code: item.code,
        name: item.name,
        fullPath: item.fullPath,
      }]);
    }
    setKsicQuery("");
    setShowKsicDropdown(false);
  };

  // KSIC 삭제
  const removeKsicCode = (code: string) => {
    const current = basicInfo.industryCodes || [];
    updateBasicInfo("industryCodes", current.filter((c: any) => c.code !== code));
  };

  // 주요 생산품 추가/삭제
  const addProduct = (product: string) => {
    if (!product.trim()) return;
    const current = basicInfo.mainProducts || [];
    if (!current.includes(product.trim())) {
      updateBasicInfo("mainProducts", [...current, product.trim()]);
    }
  };

  const removeProduct = (product: string) => {
    const current = basicInfo.mainProducts || [];
    updateBasicInfo("mainProducts", current.filter((p: string) => p !== product));
  };

  // 법인등록번호 포맷팅
  const formatCorporateRegNumber = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 13);
    if (digits.length <= 6) return digits;
    return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  };

  // 복수 담당자 관리
  const getContacts = () => {
    // contacts 배열이 있으면 사용, 없으면 contact를 배열로 변환
    if (basicInfo.contacts && basicInfo.contacts.length > 0) {
      return basicInfo.contacts;
    }
    if (basicInfo.contact && (basicInfo.contact.name || basicInfo.contact.department)) {
      return [{ ...basicInfo.contact, id: "contact-0" }];
    }
    return [];
  };

  const addContact = () => {
    if (!isEditing || !editedProfile) return;
    const current = getContacts();
    const newContact = { id: `contact-${Date.now()}`, department: "", position: "", name: "", phone: "", email: "" };
    updateBasicInfo("contacts", [...current, newContact]);
  };

  const removeContact = (id: string) => {
    if (!isEditing || !editedProfile) return;
    const current = getContacts();
    updateBasicInfo("contacts", current.filter((c: any) => c.id !== id));
  };

  const updateContactField = (id: string, field: string, value: any) => {
    if (!isEditing || !editedProfile) return;
    const current = getContacts();
    updateBasicInfo("contacts", current.map((c: any) => c.id === id ? { ...c, [field]: value } : c));
  };

  // 담당자 체크박스 토글
  const toggleContactSelection = (id: string) => {
    setSelectedContactIds(prev => 
      prev.includes(id) ? prev.filter(cId => cId !== id) : [...prev, id]
    );
  };

  // 선택된 담당자 삭제
  const removeSelectedContacts = () => {
    if (!isEditing || !editedProfile || selectedContactIds.length === 0) return;
    const current = getContacts();
    updateBasicInfo("contacts", current.filter((c: any) => !selectedContactIds.includes(c.id)));
    setSelectedContactIds([]);
  };

  // 선택된 담당자 편집 모드 토글
  const toggleEditSelectedContacts = () => {
    if (selectedContactIds.length === 1) {
      setEditingContactId(editingContactId === selectedContactIds[0] ? null : selectedContactIds[0]);
    } else if (selectedContactIds.length > 1) {
      alert("한 번에 한 명의 담당자만 변경할 수 있습니다.");
    }
  };

  // 로고 업로드 핸들러
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const profileId = data?.id || profile?.id;
    if (!profileId) {
      alert("프로파일을 먼저 저장해주세요.");
      return;
    }
    
    // 파일 크기 체크 (2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert("파일 크기는 2MB 이하여야 합니다.");
      return;
    }
    
    // 파일 타입 체크
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      alert("png, jpg, webp 형식만 지원합니다.");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("profileId", profileId);

      const res = await fetch("/api/logo/upload", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();
      if (result.success) {
        // 캐시 방지를 위해 타임스탬프 추가
        updateBasicInfo("logo", `${result.logoUrl}?t=${Date.now()}`);
      } else {
        alert(result.error || "로고 업로드 실패");
      }
    } catch (error) {
      console.error("Logo upload error:", error);
      alert("로고 업로드 중 오류가 발생했습니다.");
    }
  };

  // 로고 삭제 핸들러
  const handleLogoDelete = async () => {
    const profileId = data?.id || profile?.id;
    if (!profileId) return;

    try {
      const res = await fetch(`/api/logo/upload?profileId=${profileId}`, {
        method: "DELETE",
      });

      const result = await res.json();
      if (result.success) {
        updateBasicInfo("logo", undefined);
      }
    } catch (error) {
      console.error("Logo delete error:", error);
    }
  };

  return (
    <>
      {/* 메인 2열 레이아웃 */}
      <div className="flex gap-6">
        {/* ==================== 왼쪽 절반 (2열 분할) ==================== */}
        <div className="flex-1 pr-6 border-r border-stone-200">
          <div className="flex gap-4 h-full">
            {/* 왼쪽 절반의 좌측: 기본 정보 + 종 규모 및 배출량 */}
            <div className="flex-1 pr-4 border-r border-stone-100 grid grid-rows-2 gap-0">
              {/* 상반부: 기본 정보 (정확히 50%) */}
              <div className="pb-4 overflow-y-auto">
                <h3 className="font-semibold text-stone-700 mb-4 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" />
                  기본 정보
                </h3>
                <div className="space-y-3">
                  <EditableField label="사업장명" value={basicInfo.name || data?.name || ""} isEditing={isEditing} onChange={(v) => updateBasicInfo("name", v)} />
                  <EditableField label="업종 (통합허가 대상)" value={industry?.label || data?.industryCategory || ""} isEditing={false} />
                  
                  {/* 사업장 CI/로고 */}
                  <div>
                    <span className="text-xs text-stone-500">사업장 CI</span>
                    <div className="mt-1.5 flex items-center gap-3">
                      <div className="w-14 h-14 border border-stone-200 rounded-lg flex items-center justify-center bg-stone-50 overflow-hidden">
                        {basicInfo.logo ? (
                          <img src={basicInfo.logo} alt="사업장 CI" className="w-full h-full object-contain" />
                        ) : (
                          <Building2 className="w-6 h-6 text-stone-300" />
                        )}
                      </div>
                      <div className="flex-1 text-[10px] text-stone-500">
                        <p>png/jpg/webp, 최대 2MB</p>
                        {basicInfo.logo && <p className="text-primary mt-0.5 truncate">현재: 로고 등록됨</p>}
                        {isEditing && (
                          <div className="mt-1 flex gap-2">
                            <label className="cursor-pointer text-primary hover:underline">
                              파일 선택
                              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} className="hidden" />
                            </label>
                            {basicInfo.logo && (
                              <button onClick={handleLogoDelete} className="text-red-500 hover:underline">삭제</button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 법인등록번호 + 사업자등록번호 같은 행 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs text-stone-500">법인등록번호</span>
                      {isEditing ? (
                        <input type="text" value={basicInfo.corporateRegistrationNumber || ""} onChange={(e) => updateBasicInfo("corporateRegistrationNumber", formatCorporateRegNumber(e.target.value))} placeholder="000000-0000000" className="w-full px-2 py-1 mt-0.5 text-sm border border-stone-200 rounded focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      ) : (
                        <p className="text-sm text-stone-700 mt-0.5">{basicInfo.corporateRegistrationNumber || "-"}</p>
                      )}
                    </div>
                    <div>
                      <span className="text-xs text-stone-500">사업자등록번호</span>
                      {isEditing ? (
                        <input type="text" value={basicInfo.businessNumber || ""} onChange={(e) => {
                          // OOO-OO-OOOOO 형식으로 포맷팅
                          const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
                          let formatted = v;
                          if (v.length > 3) formatted = v.slice(0, 3) + "-" + v.slice(3);
                          if (v.length > 5) formatted = v.slice(0, 3) + "-" + v.slice(3, 5) + "-" + v.slice(5);
                          updateBasicInfo("businessNumber", formatted);
                        }} placeholder="000-00-00000" className="w-full px-2 py-1 mt-0.5 text-sm border border-stone-200 rounded focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      ) : (
                        <p className="text-sm text-stone-700 mt-0.5">{basicInfo.businessNumber || "-"}</p>
                      )}
                    </div>
                  </div>
                  
                  {/* 대표자 + 설립일 같은 행 */}
                  <div className="grid grid-cols-2 gap-3">
                    <EditableField label="대표자" value={basicInfo.representative || ""} isEditing={isEditing} onChange={(v) => updateBasicInfo("representative", v)} />
                    <EditableField label="설립일" value={basicInfo.establishment || ""} isEditing={isEditing} type="date" onChange={(v) => updateBasicInfo("establishment", v)} icon={<Calendar className="w-3 h-3" />} />
                  </div>
                </div>
              </div>

              {/* 하반부: 종 규모 및 배출량 등 (정확히 50%) */}
              <div className="border-t border-stone-200 pt-4 overflow-y-auto">
                {/* 종 규모 및 배출량 */}
                <div className="mb-4">
                  <h3 className="font-semibold text-stone-700 mb-2 flex items-center gap-2">
                    <Factory className="w-4 h-4 text-primary" />
                    종 규모 및 배출량
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {/* 대기 - 파란색 미색 배경 */}
                    <div className="p-2 border border-blue-200 rounded-lg bg-gradient-to-br from-blue-50/80 to-blue-50/30">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-medium text-blue-700">대기</span>
                        {isEditing ? (
                          <select value={basicInfo.facilityClass?.airClass || ""} onChange={(e) => updateFacilityClass("airClass", e.target.value ? parseInt(e.target.value) : undefined)} className="px-1.5 py-0.5 text-[10px] border border-blue-200 rounded bg-white">
                            <option value="">선택</option>
                            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}종</option>)}
                          </select>
                        ) : (
                          <span className="text-[10px] font-bold text-blue-700">{basicInfo.facilityClass?.airClass ? `${basicInfo.facilityClass.airClass}종` : "-"}</span>
                        )}
                      </div>
                      <div className="space-y-1 text-[9px]">
                        {["dust", "sox", "nox"].map((key) => (
                          <div key={key} className="flex justify-between items-center">
                            <span className="text-blue-600/70">{key === "dust" ? "먼지" : key.toUpperCase()}</span>
                            {isEditing ? (
                              <input type="number" value={basicInfo.annualEmissions?.[key] || ""} onChange={(e) => updateAnnualEmissions(key, e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="톤/년" className="w-16 px-1 py-0.5 text-[9px] text-right border border-blue-200 rounded bg-white/70" />
                            ) : (
                              <span className="text-blue-700">{basicInfo.annualEmissions?.[key] ? `${basicInfo.annualEmissions[key]} 톤/년` : "-"}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* 수질 - 녹색 미색 배경 */}
                    <div className="p-2 border border-emerald-200 rounded-lg bg-gradient-to-br from-emerald-50/80 to-emerald-50/30">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-medium text-emerald-700">수질</span>
                        {isEditing ? (
                          <select value={basicInfo.facilityClass?.waterClass || ""} onChange={(e) => updateFacilityClass("waterClass", e.target.value ? parseInt(e.target.value) : undefined)} className="px-1.5 py-0.5 text-[10px] border border-emerald-200 rounded bg-white">
                            <option value="">선택</option>
                            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}종</option>)}
                          </select>
                        ) : (
                          <span className="text-[10px] font-bold text-emerald-700">{basicInfo.facilityClass?.waterClass ? `${basicInfo.facilityClass.waterClass}종` : "-"}</span>
                        )}
                      </div>
                      <div className="flex justify-between items-center text-[9px]">
                        <span className="text-emerald-600/70">폐수 배출량</span>
                        {isEditing ? (
                          <input type="number" value={basicInfo.annualEmissions?.wastewater || ""} onChange={(e) => updateAnnualEmissions("wastewater", e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="㎥/년" className="w-20 px-1 py-0.5 text-[9px] text-right border border-emerald-200 rounded bg-white/70" />
                        ) : (
                          <span className="text-emerald-700">{basicInfo.annualEmissions?.wastewater ? `${basicInfo.annualEmissions.wastewater.toLocaleString()} ㎥/년` : "-"}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 주요 생산품 */}
                <div className="mb-5">
                  <h3 className="font-semibold text-stone-700 mb-2 flex items-center gap-2">
                    <Package className="w-4 h-4 text-primary" />
                    주요 생산품
                  </h3>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {(basicInfo.mainProducts || []).length > 0 ? basicInfo.mainProducts.map((product: string, i: number) => (
                      <span key={i} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200 text-[9px] text-stone-600">
                        {product}
                        {isEditing && <button onClick={() => removeProduct(product)}><X className="w-2 h-2" /></button>}
                      </span>
                    )) : <p className="text-[10px] text-stone-400">없음</p>}
                  </div>
                  {isEditing && <input type="text" placeholder="입력 후 Enter" className="w-full px-2 py-1 text-[10px] border border-stone-200 rounded" onKeyDown={(e) => { if (e.key === "Enter") { addProduct(e.currentTarget.value); e.currentTarget.value = ""; }}} />}
                </div>

                {/* 면적 정보 - 2열 배치 */}
                <div>
                  <h3 className="font-semibold text-stone-700 mb-2 flex items-center gap-2">
                    <Building className="w-4 h-4 text-primary" />
                    면적 정보
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <EditableField label="공장 부지" value={basicInfo.area?.factorySite ? String(basicInfo.area.factorySite) : ""} isEditing={isEditing} type="number" suffix="㎡" onChange={(v) => updateArea("factorySite", v ? parseFloat(v) : undefined)} />
                    <EditableField label="제조시설" value={basicInfo.area?.manufacturingFacility ? String(basicInfo.area.manufacturingFacility) : ""} isEditing={isEditing} type="number" suffix="㎡" onChange={(v) => updateArea("manufacturingFacility", v ? parseFloat(v) : undefined)} />
                    <EditableField label="부대시설" value={basicInfo.area?.supportFacility ? String(basicInfo.area.supportFacility) : ""} isEditing={isEditing} type="number" suffix="㎡" onChange={(v) => updateArea("supportFacility", v ? parseFloat(v) : undefined)} />
                  </div>
                </div>
              </div>
            </div>

            {/* 왼쪽 절반의 우측: 소재지 + KSIC + 담당자 */}
            <div className="flex-1 grid grid-rows-2 gap-0">
              {/* 상반부: 소재지 + KSIC (정확히 50%) */}
              <div className="pb-4 overflow-y-auto">
                {/* 소재지 */}
                <div className="mb-5">
                  <h3 className="font-semibold text-stone-700 mb-3 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-primary" />
                    소재지
                  </h3>
                  <div className="space-y-2.5">
                    <div className="flex gap-2 items-end">
                      <div className="w-20">
                        <span className="text-xs text-stone-500">우편번호</span>
                        <input type="text" value={basicInfo.location?.zipCode || ""} readOnly className="w-full px-2 py-1 mt-0.5 text-xs border border-stone-200 rounded bg-stone-50" placeholder="00000" />
                      </div>
                      {isEditing && <button onClick={() => setShowAddressModal(true)} className="px-2 py-1 text-[10px] font-medium bg-primary text-white rounded hover:bg-primary/90 h-[26px]">주소 검색</button>}
                    </div>
                    <div>
                      <span className="text-xs text-stone-500">도로명 주소</span>
                      <input type="text" value={basicInfo.location?.roadAddress || ""} readOnly className="w-full px-2 py-1 mt-0.5 text-xs border border-stone-200 rounded bg-stone-50" />
                    </div>
                    <EditableField label="상세주소" value={basicInfo.location?.detailAddress || ""} isEditing={isEditing} onChange={(v) => updateLocation("detailAddress", v)} placeholder="동, 호수 등" />
                    <div className="grid grid-cols-2 gap-2">
                      <EditableField label="시/도" value={basicInfo.location?.region || ""} isEditing={false} />
                      <EditableField label="시/군/구" value={basicInfo.location?.district || ""} isEditing={false} />
                    </div>
                  </div>
                </div>

                {/* KSIC */}
                <div>
                  <h3 className="font-semibold text-stone-700 mb-2 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />
                    표준산업분류코드 (KSIC)
                  </h3>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {(basicInfo.industryCodes || []).length > 0 ? basicInfo.industryCodes.map((item: any, i: number) => (
                      <div key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200">
                        <span className="text-[9px] font-mono text-stone-700">{item.code}</span>
                        <span className="text-[9px] text-stone-600">{item.name}</span>
                        {isEditing && <button onClick={() => removeKsicCode(item.code)}><X className="w-2 h-2 text-stone-500" /></button>}
                      </div>
                    )) : <p className="text-[10px] text-stone-400">없음</p>}
                  </div>
                  {isEditing && (
                    <div className="relative">
                      <div className="flex gap-1">
                        <input type="text" value={ksicQuery} onChange={(e) => { setKsicQuery(e.target.value); searchKsic(e.target.value); }} placeholder="코드/업종명 검색" className="flex-1 px-2 py-1 text-[10px] border border-stone-200 rounded" />
                        <button onClick={async () => { if (ksicQuery.length === 5 && /^\d{5}$/.test(ksicQuery)) { const item = await lookupKsicCode(ksicQuery); if (item) addKsicCode(item); }}} className="px-1.5 py-1 text-[10px] bg-primary text-white rounded"><PlusCircle className="w-3 h-3" /></button>
                      </div>
                      {showKsicDropdown && ksicResults.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-stone-200 rounded shadow-lg max-h-32 overflow-y-auto">
                          {ksicResults.map((item, i) => <button key={i} onClick={() => addKsicCode(item)} className="w-full px-2 py-1 text-left hover:bg-stone-50 border-b border-stone-100 last:border-0"><span className="text-[9px] font-mono text-primary mr-1">{item.code}</span><span className="text-[9px] text-stone-700">{item.name}</span></button>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 하반부: 담당자 정보 (정확히 50%) */}
              <div className="border-t border-stone-200 pt-4 overflow-y-auto">
                {/* 담당자 정보 (복수) */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-stone-700 flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" />
                      담당자 정보
                      {isEditing && selectedContactIds.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                          {selectedContactIds.length}명 선택
                        </span>
                      )}
                    </h3>
                    {isEditing && (
                      <div className="flex items-center gap-1">
                        {/* 삭제 버튼 */}
                        <button 
                          onClick={removeSelectedContacts}
                          disabled={selectedContactIds.length === 0}
                          className={cn(
                            "flex items-center gap-1 px-2 py-1 text-[10px] rounded transition-colors",
                            selectedContactIds.length > 0
                              ? "text-red-600 border border-red-200 hover:bg-red-50"
                              : "text-stone-300 border border-stone-200 cursor-not-allowed"
                          )}
                        >
                          <Trash2 className="w-3 h-3" />
                          삭제
                        </button>
                        {/* 변경 버튼 */}
                        <button 
                          onClick={toggleEditSelectedContacts}
                          disabled={selectedContactIds.length !== 1}
                          className={cn(
                            "flex items-center gap-1 px-2 py-1 text-[10px] rounded transition-colors",
                            selectedContactIds.length === 1
                              ? "text-amber-600 border border-amber-200 hover:bg-amber-50"
                              : "text-stone-300 border border-stone-200 cursor-not-allowed"
                          )}
                        >
                          <Edit3 className="w-3 h-3" />
                          변경
                        </button>
                        {/* 추가 버튼 */}
                        <button 
                          onClick={addContact} 
                          className="flex items-center gap-1 px-2 py-1 text-[10px] text-primary border border-primary rounded hover:bg-primary/5"
                        >
                          <PlusCircle className="w-3 h-3" />
                          추가
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3">
                    {getContacts().length > 0 ? getContacts().map((contact: any, idx: number) => (
                      <div 
                        key={contact.id || idx} 
                        className={cn(
                          "p-2 border rounded-lg relative transition-colors",
                          isEditing && selectedContactIds.includes(contact.id) 
                            ? "border-primary bg-primary/5" 
                            : "border-stone-200"
                        )}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {/* 체크박스 (편집 모드에서만) */}
                            {isEditing && (
                              <input 
                                type="checkbox" 
                                checked={selectedContactIds.includes(contact.id)}
                                onChange={() => toggleContactSelection(contact.id)}
                                className="w-3.5 h-3.5 rounded border-stone-300 text-primary focus:ring-primary/30"
                              />
                            )}
                            <span className="text-[10px] font-medium text-stone-500">담당자 {idx + 1}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {/* 담당자 유형 선택 */}
                            {isEditing ? (
                              <select 
                                value={contact.contactType || ""} 
                                onChange={(e) => updateContactField(contact.id, "contactType", e.target.value)} 
                                className="px-1.5 py-0.5 text-[10px] border border-stone-200 rounded bg-white"
                              >
                                <option value="">유형 선택</option>
                                <option value="contract">계약파트</option>
                                <option value="environment">환경파트</option>
                                <option value="manufacturing">제조파트</option>
                              </select>
                            ) : contact.contactType && (
                              <span className={cn(
                                "text-[9px] px-1.5 py-0.5 rounded-full",
                                contact.contactType === "contract" && "bg-blue-100 text-blue-700",
                                contact.contactType === "environment" && "bg-green-100 text-green-700",
                                contact.contactType === "manufacturing" && "bg-amber-100 text-amber-700"
                              )}>
                                {contact.contactType === "contract" ? "계약파트" : contact.contactType === "environment" ? "환경파트" : "제조파트"}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-[9px] text-stone-500">부서</span>
                              {isEditing ? (
                                <input type="text" value={contact.department || ""} onChange={(e) => updateContactField(contact.id, "department", e.target.value)} className="w-full px-1.5 py-0.5 mt-0.5 text-[10px] border border-stone-200 rounded" />
                              ) : (
                                <p className="text-[10px] text-stone-700 mt-0.5">{contact.department || "-"}</p>
                              )}
                            </div>
                            <div>
                              <span className="text-[9px] text-stone-500">직함</span>
                              {isEditing ? (
                                <input type="text" value={contact.position || ""} onChange={(e) => updateContactField(contact.id, "position", e.target.value)} className="w-full px-1.5 py-0.5 mt-0.5 text-[10px] border border-stone-200 rounded" />
                              ) : (
                                <p className="text-[10px] text-stone-700 mt-0.5">{contact.position || "-"}</p>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-[9px] text-stone-500">성함</span>
                              {isEditing ? (
                                <input type="text" value={contact.name || ""} onChange={(e) => updateContactField(contact.id, "name", e.target.value)} className="w-full px-1.5 py-0.5 mt-0.5 text-[10px] border border-stone-200 rounded" />
                              ) : (
                                <p className="text-[10px] text-stone-700 mt-0.5">{contact.name || "-"}</p>
                              )}
                            </div>
                            <div>
                              <span className="text-[9px] text-stone-500">연락처</span>
                              {isEditing ? (
                                <input type="text" value={contact.phone || ""} onChange={(e) => updateContactField(contact.id, "phone", e.target.value)} className="w-full px-1.5 py-0.5 mt-0.5 text-[10px] border border-stone-200 rounded" />
                              ) : (
                                <p className="text-[10px] text-stone-700 mt-0.5">{contact.phone || "-"}</p>
                              )}
                            </div>
                          </div>
                          <div>
                            <span className="text-[9px] text-stone-500">이메일</span>
                            {isEditing ? (
                              <input type="email" value={contact.email || ""} onChange={(e) => updateContactField(contact.id, "email", e.target.value)} className="w-full px-1.5 py-0.5 mt-0.5 text-[10px] border border-stone-200 rounded" />
                            ) : (
                              <p className="text-[10px] text-stone-700 mt-0.5">{contact.email || "-"}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )) : (
                      <div className="p-3 text-center text-[10px] text-stone-400 border border-dashed border-stone-200 rounded-lg">
                        {isEditing ? "담당자를 추가해주세요" : "등록된 담당자가 없습니다"}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== 오른쪽 절반 ==================== */}
        <div className="flex-1 space-y-6 overflow-y-auto">
          {/* 시설 현황 요약 KPI - 은은한 네온 효과 */}
          <div>
            <h3 className="font-semibold text-stone-700 mb-4 flex items-center gap-2">
              <Factory className="w-4 h-4 text-primary" />
              시설 현황 요약
            </h3>
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: "배출시설", value: facilitySummary.emissionFacilityCount || 0, color: "blue" },
                { label: "일반굴뚝", value: facilitySummary.generalStackCount || 0, color: "slate" },
                { label: "CleanSYS", value: facilitySummary.cleansysStackCount || 0, color: "emerald" },
                { label: "플레어스택", value: facilitySummary.flareStackCount || 0, color: "amber" },
                { label: "방류구", value: facilitySummary.dischargePointCount || 0, color: "cyan" },
              ].map((item, i) => (
                <div 
                  key={i} 
                  className={cn(
                    "p-3 bg-white rounded-lg text-center transition-all duration-300",
                    item.color === "blue" && "border border-blue-200 hover:border-blue-300 hover:shadow-[0_0_12px_rgba(59,130,246,0.15)]",
                    item.color === "slate" && "border border-slate-200 hover:border-slate-300 hover:shadow-[0_0_12px_rgba(100,116,139,0.15)]",
                    item.color === "emerald" && "border border-emerald-200 hover:border-emerald-300 hover:shadow-[0_0_12px_rgba(16,185,129,0.15)]",
                    item.color === "amber" && "border border-amber-200 hover:border-amber-300 hover:shadow-[0_0_12px_rgba(245,158,11,0.15)]",
                    item.color === "cyan" && "border border-cyan-200 hover:border-cyan-300 hover:shadow-[0_0_12px_rgba(6,182,212,0.15)]",
                  )}
                >
                  <div className={cn(
                    "text-2xl font-bold",
                    item.color === "blue" && "text-blue-600",
                    item.color === "slate" && "text-slate-600",
                    item.color === "emerald" && "text-emerald-600",
                    item.color === "amber" && "text-amber-600",
                    item.color === "cyan" && "text-cyan-600",
                  )}>{item.value}</div>
                  <div className="text-[10px] text-stone-500 mt-1">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 현재 이슈 상황 */}
          <div>
            <h3 className="font-semibold text-stone-700 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              현재 이슈 상황
              {isEditing && (
                <button
                  onClick={() => {
                    const newIssue = {
                      id: `issue_${Date.now()}`,
                      label: "",
                      memo: "",
                      severity: "info",
                      createdAt: new Date().toISOString(),
                    };
                    setEditedProfile((prev: any) => ({
                      ...prev,
                      overview: {
                        ...prev.overview,
                        currentIssues: [...(prev.overview?.currentIssues || []), newIssue],
                      },
                    }));
                  }}
                  className="ml-auto px-2 py-1 text-[10px] font-medium rounded bg-amber-100 text-amber-700 hover:bg-amber-200 transition-all"
                >
                  + 이슈 추가
                </button>
              )}
            </h3>
            {(data?.overview?.currentIssues || []).length === 0 ? (
              <div className="p-4 text-center text-[11px] text-stone-400 bg-white border border-stone-200 rounded-lg">
                등록된 이슈가 없습니다{isEditing ? ". 위 '이슈 추가' 버튼을 클릭하여 추가하세요." : "."}
              </div>
            ) : (
              <div className="space-y-2">
                {(data?.overview?.currentIssues || []).map((issue: any, idx: number) => (
                  <div
                    key={issue.id || idx}
                    className={cn(
                      "p-3 rounded-lg border transition-all",
                      issue.severity === "critical" ? "bg-red-50/50 border-red-200" :
                      issue.severity === "warning" ? "bg-amber-50/50 border-amber-200" :
                      "bg-blue-50/50 border-blue-200"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        issue.severity === "critical" ? "bg-red-500" :
                        issue.severity === "warning" ? "bg-amber-500" :
                        "bg-blue-500"
                      )} />
                      {isEditing ? (
                        <>
                          <input
                            type="text"
                            value={issue.label || ""}
                            onChange={(e) => {
                              const updated = [...(editedProfile.overview?.currentIssues || [])];
                              updated[idx] = { ...updated[idx], label: e.target.value };
                              setEditedProfile((prev: any) => ({
                                ...prev,
                                overview: { ...prev.overview, currentIssues: updated },
                              }));
                            }}
                            placeholder="이슈명 (예: 설비 증설, 민원 발생)"
                            className="flex-1 text-[11px] font-medium px-2 py-1 border border-stone-200 rounded bg-white"
                          />
                          <select
                            value={issue.severity || "info"}
                            onChange={(e) => {
                              const updated = [...(editedProfile.overview?.currentIssues || [])];
                              updated[idx] = { ...updated[idx], severity: e.target.value };
                              setEditedProfile((prev: any) => ({
                                ...prev,
                                overview: { ...prev.overview, currentIssues: updated },
                              }));
                            }}
                            className="text-[10px] px-1.5 py-1 border border-stone-200 rounded bg-white"
                          >
                            <option value="info">정보</option>
                            <option value="warning">주의</option>
                            <option value="critical">긴급</option>
                          </select>
                          <button
                            onClick={() => {
                              const updated = (editedProfile.overview?.currentIssues || []).filter((_: any, i: number) => i !== idx);
                              setEditedProfile((prev: any) => ({
                                ...prev,
                                overview: { ...prev.overview, currentIssues: updated },
                              }));
                            }}
                            className="text-stone-400 hover:text-red-500 transition-colors shrink-0"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-[11px] font-medium text-stone-700 flex-1">{issue.label || "이슈명 없음"}</span>
                          <span className={cn(
                            "text-[9px] px-1.5 py-0.5 rounded font-medium",
                            issue.severity === "critical" ? "bg-red-100 text-red-700" :
                            issue.severity === "warning" ? "bg-amber-100 text-amber-700" :
                            "bg-blue-100 text-blue-700"
                          )}>
                            {issue.severity === "critical" ? "긴급" : issue.severity === "warning" ? "주의" : "정보"}
                          </span>
                        </>
                      )}
                    </div>
                    {isEditing ? (
                      <textarea
                        value={issue.memo || ""}
                        onChange={(e) => {
                          const updated = [...(editedProfile.overview?.currentIssues || [])];
                          updated[idx] = { ...updated[idx], memo: e.target.value };
                          setEditedProfile((prev: any) => ({
                            ...prev,
                            overview: { ...prev.overview, currentIssues: updated },
                          }));
                        }}
                        placeholder="메모 (선택)"
                        className="mt-1.5 w-full text-[10px] px-2 py-1.5 border border-stone-200 rounded bg-white resize-none"
                        rows={2}
                      />
                    ) : issue.memo ? (
                      <p className="mt-1 text-[10px] text-stone-500 pl-4">{issue.memo}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 매체별 인허가 사항 - 통합허가 / 통합허가 외 */}
          <div>
            <h3 className="font-semibold text-stone-700 mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              매체별 인허가 사항
            </h3>
            
            {/* 통합허가 */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1 h-4 bg-primary rounded-full"></div>
                <span className="text-xs font-semibold text-stone-700">통합허가</span>
              </div>
              <div className="space-y-2 pl-3">
                {[
                  { key: "air", label: "대기", data: mediaPermits.air, color: "blue" },
                  { key: "water", label: "수질", data: mediaPermits.water, color: "cyan" },
                  { key: "waste", label: "폐기물", data: mediaPermits.waste, color: "amber" },
                  { key: "noise", label: "소음·진동", data: mediaPermits.noise, color: "purple" },
                  { key: "other", label: "기타", data: mediaPermits.other, color: "stone" },
                ].map((media) => (
                  <div key={media.key} className="p-2.5 bg-white border border-stone-200 rounded-lg hover:border-stone-300 transition-colors">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        media.color === "blue" && "bg-blue-400",
                        media.color === "cyan" && "bg-cyan-400",
                        media.color === "amber" && "bg-amber-400",
                        media.color === "purple" && "bg-purple-400",
                        media.color === "stone" && "bg-stone-400",
                      )}></span>
                      <span className="text-[11px] font-medium text-stone-700">{media.label}</span>
                    </div>
                    <div className="text-[10px] text-stone-600 space-y-0.5 pl-3">
                      {media.data?.length > 0 ? media.data.map((item: string, i: number) => (
                        <p key={i}>• {item}</p>
                      )) : <p className="text-stone-400 italic">등록된 인허가 사항 없음</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 통합허가 외 */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1 h-4 bg-stone-400 rounded-full"></div>
                <span className="text-xs font-semibold text-stone-700">통합허가 외</span>
              </div>
              <div className="space-y-2 pl-3">
                {[
                  { key: "totalControl", label: "총량관리대상", data: mediaPermits.totalControl || [], color: "rose" },
                  { key: "totalAllocation", label: "총량할당관리", data: mediaPermits.totalAllocation || [], color: "orange" },
                  { key: "wastePermit", label: "폐기물 관련 허가", data: mediaPermits.wastePermit || [], color: "lime" },
                ].map((media) => (
                  <div key={media.key} className="p-2.5 bg-stone-50/50 border border-stone-200 rounded-lg hover:border-stone-300 transition-colors">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        media.color === "rose" && "bg-rose-400",
                        media.color === "orange" && "bg-orange-400",
                        media.color === "lime" && "bg-lime-500",
                      )}></span>
                      <span className="text-[11px] font-medium text-stone-700">{media.label}</span>
                    </div>
                    <div className="text-[10px] text-stone-600 space-y-0.5 pl-3">
                      {media.data?.length > 0 ? media.data.map((item: string, i: number) => (
                        <p key={i}>• {item}</p>
                      )) : <p className="text-stone-400 italic">해당 없음</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* 주소 검색 모달 */}
      {showAddressModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddressModal(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-red-500 text-white px-5 py-3 flex items-center justify-between">
              <h3 className="font-bold">주소찾기</h3>
              <button onClick={() => setShowAddressModal(false)} className="p-1 hover:bg-white/20 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 border-b border-stone-200">
              <div className="flex gap-2">
                <span className="text-sm text-stone-600 shrink-0 py-1.5">검색어</span>
                <input type="text" value={addressSearchQuery} onChange={(e) => setAddressSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") searchAddress(); }} placeholder="도로명, 건물명, 지번 입력" className="flex-1 px-3 py-1.5 border border-stone-300 rounded focus:outline-none focus:ring-2 focus:ring-red-400" autoFocus />
                <button onClick={searchAddress} disabled={searchingAddress} className="px-4 py-1.5 bg-red-500 text-white rounded font-medium hover:bg-red-600 disabled:opacity-50">{searchingAddress ? <Loader2 className="w-4 h-4 animate-spin" /> : "검색"}</button>
              </div>
              <div className="mt-3 text-xs text-stone-500 space-y-1">
                <p><span className="font-medium text-red-500">■ 정확한 주소를 모르시는 경우</span></p>
                <p className="pl-2">› 시/군/구 + 도로명, 동명 또는 건물명</p>
              </div>
            </div>
            <div className="p-5 max-h-[300px] overflow-y-auto">
              {searchingAddress ? <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-stone-400" /></div>
              : addressResults.length > 0 ? (
                <>
                  <p className="text-sm text-stone-600 mb-3">검색결과 <span className="text-red-500 font-bold">{addressResults.length}</span>건</p>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-stone-200"><th className="text-left py-2 px-2 text-stone-500 font-medium w-20">우편번호</th><th className="text-left py-2 px-2 text-stone-500 font-medium">주소</th></tr></thead>
                    <tbody>
                      {addressResults.map((addr, i) => (
                        <tr key={i} onClick={() => setSelectedAddress(addr)} className={cn("border-b border-stone-100 cursor-pointer hover:bg-stone-50", selectedAddress === addr && "bg-red-50")}>
                          <td className="py-2 px-2 text-stone-600">{addr.zipNo}</td>
                          <td className="py-2 px-2"><p className="text-stone-700">{addr.roadAddress}</p><p className="text-xs text-stone-400">{addr.jibunAddress}</p></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : addressSearchQuery ? <div className="text-center py-10 text-stone-400">검색 결과가 없습니다.</div>
              : <div className="text-center py-10 text-stone-400">검색어를 입력하고 검색 버튼을 클릭하세요.</div>}
            </div>
            <div className="p-4 border-t border-stone-200 flex justify-center gap-3">
              <button onClick={confirmAddressSelection} disabled={!selectedAddress} className="flex items-center gap-2 px-6 py-2 border border-stone-300 rounded hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed"><Check className="w-4 h-4 text-red-500" /><span className="font-medium">완료</span></button>
              <button onClick={() => { setShowAddressModal(false); setAddressSearchQuery(""); setAddressResults([]); setSelectedAddress(null); }} className="px-6 py-2 border border-stone-300 rounded hover:bg-stone-50">취소 ›</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// 배출시설 탭
// 통합환경관리계획서 3.1.1 배출시설 등 표 양식 기준
// ============================================================

// 샘플 배출시설 데이터 (UI 미리보기용 - 통합환경관리계획서 양식 기준)
const SAMPLE_EMISSION_FACILITIES = [
  {
    id: "sample-1",
    // 통합환경관리계획서 정규 양식 필드
    managementNumber: "I-PUI1001",        // 관리번호
    processNumber: "PU-01-01",            // 공정번호
    facilityNumber: "A-1",                // 시설번호
    name: "고체입자상물질 저장시설 (원료투입구) BE-800-H",  // 시설명
    capacity: 13.7,                       // 용량
    capacityUnit: "m³",                   // 단위
    quantity: 1,                          // 수량
    emissionMedia: "air",                 // 처리/발생 (대기)
    pollutants: ["먼지"],                 // 오염물질
    operatingFactorDetail: "가동상태",    // 운전인자
    installationLocation: "3.2 시설 배치도 참조",  // 설치지점
    dischargePortNumber: "#A8",           // 배출(방류)구 번호
    changeStatus: "existing",             // 변경사항 (기존)
    isLegalTarget: true,                  // 법적대상여부 (대상)
    pidNumber: "JR-PFD-발효-001",         // P&ID No.
    notes: "",                            // 비고
    // UI 표시용 부가 필드
    facilityType: "storage",
    status: "operating",
  },
  {
    id: "sample-2",
    managementNumber: "I-PUI1002",
    processNumber: "PU-01-01",
    facilityNumber: "A-2",
    name: "그 밖의 시설 (원료투입 BUCKET CONVERYR) BE-800",
    capacity: 66,
    capacityUnit: "톤/시",
    quantity: 1,
    emissionMedia: "air",
    pollutants: ["먼지"],
    operatingFactorDetail: "가동상태",
    installationLocation: "3.2 시설 배치도 참조",
    dischargePortNumber: "#A8",
    changeStatus: "existing",
    isLegalTarget: true,
    pidNumber: "JR-PFD-발효-001",
    notes: "",
    facilityType: "transfer",
    status: "operating",
  },
  {
    id: "sample-3",
    managementNumber: "I-PUI1003",
    processNumber: "PU-01-01",
    facilityNumber: "A-3",
    name: "고체입자상물질 저장시설 (저장시설(SILO)) TK-800A",
    capacity: 200,
    capacityUnit: "m³",
    quantity: 1,
    emissionMedia: "air",
    pollutants: ["먼지"],
    operatingFactorDetail: "레벨",
    installationLocation: "3.2 시설 배치도 참조",
    dischargePortNumber: "#A1",
    changeStatus: "existing",
    isLegalTarget: true,
    pidNumber: "DSP-18060-1-FS-001",
    notes: "",
    facilityType: "storage",
    status: "operating",
  },
  {
    id: "sample-4",
    managementNumber: "I-PUI1004",
    processNumber: "PU-01-01",
    facilityNumber: "A-4",
    name: "고체입자상물질 저장시설 (저장시설(SILO)) TK-800B",
    capacity: 200,
    capacityUnit: "m³",
    quantity: 1,
    emissionMedia: "air",
    pollutants: ["먼지"],
    operatingFactorDetail: "레벨",
    installationLocation: "3.2 시설 배치도 참조",
    dischargePortNumber: "#A2",
    changeStatus: "existing",
    isLegalTarget: true,
    pidNumber: "DSP-18060-1-FS-001",
    notes: "",
    facilityType: "storage",
    status: "maintenance",
  },
  {
    id: "sample-5",
    managementNumber: "I-PUI1005",
    processNumber: "PU-01-01",
    facilityNumber: "A-5",
    name: "기타시설(이송시설) (A-SILO TRANSFER CONVERYR) CC-800A",
    capacity: 30,
    capacityUnit: "톤/시",
    quantity: 1,
    emissionMedia: "air",
    pollutants: [],
    operatingFactorDetail: "원료 투입량",
    installationLocation: "3.2 시설 배치도 참조",
    dischargePortNumber: "-",
    changeStatus: "existing",
    isLegalTarget: false,
    pidNumber: "DSP-18060-1-FS-001",
    notes: "",
    facilityType: "transfer",
    status: "operating",
  },
  {
    id: "sample-6",
    managementNumber: "I-PWI1001",
    processNumber: "PW-01-01",
    facilityNumber: "W-1",
    name: "폐수배출시설 (산세공정) WW-100",
    capacity: 100,
    capacityUnit: "㎥/일",
    quantity: 1,
    emissionMedia: "water",
    pollutants: ["pH", "SS", "COD"],
    operatingFactorDetail: "가동상태",
    installationLocation: "3.2 시설 배치도 참조",
    dischargePortNumber: "방류구-001",
    changeStatus: "existing",
    isLegalTarget: true,
    pidNumber: "WW-PFD-001",
    notes: "",
    facilityType: "discharge",
    status: "operating",
  },
  // 복수 시설번호/배출정보를 가진 시설 (예: I-PU11012 케이스)
  {
    id: "sample-7",
    managementNumber: "I-PUI1012",
    processNumber: "PU-01-01",
    name: "그 밖의 시설 (검불제거장치) GS-800",
    capacity: 0.16,
    capacityUnit: "m³",
    quantity: 1,
    operatingFactorDetail: "가동상태",
    installationLocation: "3.2 시설 배치도 참조",
    changeStatus: "existing",
    pidNumber: "JR-PFD-발효-001",
    notes: "",
    facilityType: "other",
    status: "operating",
    // 복수 시설번호/배출정보
    emissionDetails: [
      {
        facilityNumber: "A-7",
        emissionMedia: "air",
        pollutants: ["먼지"],
        dischargePortNumber: "#A8",
        isLegalTarget: true,
      },
      {
        facilityNumber: "Ws-4",
        emissionMedia: "waste",
        pollutants: ["폐합성수지"],
        dischargePortNumber: "-",
        isLegalTarget: false,
      },
    ],
  },
];

// 변경사항 라벨
const CHANGE_STATUS_LABELS: Record<string, string> = {
  existing: "기존",
  new: "신설",
  changed: "변경",
  abolished: "폐지",
};

// 배출 매체 라벨
const EMISSION_MEDIA_LABELS: Record<string, string> = {
  air: "대기",
  water: "수질",
  waste: "폐기물",
};

// 시설분류 라벨
const FACILITY_TYPE_LABELS: Record<string, string> = {
  combustion: "연소시설",
  reaction: "반응시설",
  drying: "건조시설",
  storage: "저장시설",
  transfer: "이송시설",
  heating: "가열시설",
  coating: "도장시설",
  discharge: "배출시설",
  treatment: "처리시설",
  cooling: "냉각시설",
  other: "기타시설",
};

function EmissionFacilitiesTab({ profile, editedProfile, setEditedProfile, isEditing }: {
  profile: any;
  editedProfile: any;
  setEditedProfile: (p: any) => void;
  isEditing: boolean;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const data = isEditing ? editedProfile : profile;
  const actualFacilities = data?.emissionFacilities || [];
  
  // 미리보기 모드일 때는 샘플 데이터 사용
  const facilities = showPreview ? SAMPLE_EMISSION_FACILITIES : actualFacilities;

  // 시설 분류 헬퍼 함수
  const getFacilityMedia = (f: any): string[] => {
    // emissionDetails가 있으면 복수 매체
    if (f.emissionDetails && f.emissionDetails.length > 0) {
      const mediaList = f.emissionDetails.map((d: any) => String(d.emissionMedia));
      return Array.from(new Set(mediaList));
    }
    // 단일 매체
    return [f.emissionMedia || f.type || "air"];
  };

  const hasMedia = (f: any, media: string) => getFacilityMedia(f).includes(media);

  // 대기/수질/복수매체 분류
  const airFacilities = facilities.filter((f: any) => {
    const media = getFacilityMedia(f);
    // 대기만 있거나, 대기가 포함되고 복수 매체가 아닌 경우
    return media.includes("air") && media.length === 1;
  });
  const waterFacilities = facilities.filter((f: any) => {
    const media = getFacilityMedia(f);
    return media.includes("water") && media.length === 1;
  });
  const multiMediaFacilities = facilities.filter((f: any) => {
    const media = getFacilityMedia(f);
    return media.length > 1;
  });

  // 오염물질/시설번호 필드 호환성
  const getPollutants = (facility: any, detail?: any) => {
    if (detail) return detail.pollutants || [];
    return facility.pollutants || facility.mainPollutants || [];
  };
  
  const getFacilityNumber = (facility: any, detail?: any) => {
    if (detail) return detail.facilityNumber;
    return facility.facilityNumber;
  };

  const getDischargePort = (facility: any, detail?: any) => {
    if (detail) return detail.dischargePortNumber;
    return facility.dischargePortNumber || facility.linkedStackId;
  };

  const getIsLegalTarget = (facility: any, detail?: any) => {
    if (detail) return detail.isLegalTarget;
    return facility.isLegalTarget;
  };

  return (
    <div className="space-y-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-stone-700 flex items-center gap-2">
          <Factory className="w-4 h-4 text-primary" />
          배출시설 현황 ({facilities.length}개)
          {showPreview && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              샘플 데이터 미리보기
            </span>
          )}
        </h3>
        {actualFacilities.length === 0 && (
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={cn(
              "text-xs px-3 py-1.5 rounded-lg transition-colors",
              showPreview 
                ? "bg-amber-100 text-amber-700 hover:bg-amber-200" 
                : "bg-primary/10 text-primary hover:bg-primary/20"
            )}
          >
            {showPreview ? "미리보기 닫기" : "샘플 데이터 미리보기"}
          </button>
        )}
      </div>

      {facilities.length > 0 ? (
        <div className="space-y-6">
          {/* 대기 배출시설 */}
          {airFacilities.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                <h4 className="text-sm font-medium text-stone-600">대기 배출시설 ({airFacilities.length}개)</h4>
              </div>
              <div className="space-y-3">
                {airFacilities.map((facility: any, index: number) => (
                  <div key={facility.id || index} className="p-4 bg-gradient-to-br from-blue-50/50 to-white rounded-xl border border-blue-100 hover:border-blue-200 transition-colors">
                    {/* 헤더: 관리번호, 시설명, 상태 */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                            {facility.managementNumber || facility.code || `AE-${index + 1}`}
                          </span>
                          {facility.facilityNumber && (
                            <span className="text-xs font-mono text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                              {facility.facilityNumber}
                            </span>
                          )}
                          {facility.isLegalTarget !== undefined && (
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded",
                              facility.isLegalTarget 
                                ? "bg-green-100 text-green-700" 
                                : "bg-stone-100 text-stone-500"
                            )}>
                              {facility.isLegalTarget ? "법적대상" : "비대상"}
                            </span>
                          )}
                        </div>
                        <h4 className="font-medium text-stone-700 mt-1.5 leading-tight">{facility.name || "미입력"}</h4>
                        <p className="text-[10px] text-stone-400 mt-0.5">
                          {facility.facilityType ? FACILITY_TYPE_LABELS[facility.facilityType] || facility.facilityType : facility.subType || "미분류"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn(
                          "text-[10px] px-2.5 py-1 rounded-full font-medium",
                          facility.status === "operating" ? "bg-green-100 text-green-700" :
                          facility.status === "stopped" ? "bg-red-100 text-red-700" :
                          "bg-amber-100 text-amber-700"
                        )}>
                          {facility.status === "operating" ? "● 가동중" : facility.status === "stopped" ? "● 정지" : "● 점검중"}
                        </span>
                        {facility.changeStatus && (
                          <span className="text-[10px] text-stone-400">
                            {CHANGE_STATUS_LABELS[facility.changeStatus] || facility.changeStatus}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {/* 모든 정보를 1행에 표시 */}
                    <div className="grid grid-cols-8 gap-2 text-xs">
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">용량</span>
                        <span className="text-stone-700 font-medium">
                          {facility.capacity ?? "-"}{facility.capacityUnit ? ` ${facility.capacityUnit}` : ""}
                        </span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">수량</span>
                        <span className="text-stone-700 font-medium">{facility.quantity ?? 1}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">공정번호</span>
                        <span className="text-stone-700 font-medium">{facility.processNumber || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">배출구</span>
                        <span className="text-stone-700 font-medium">{facility.dischargePortNumber || facility.linkedStackId || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">운전인자</span>
                        <span className="text-stone-700 font-medium">{facility.operatingFactorDetail || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">설치지점</span>
                        <span className="text-stone-700 font-medium text-[11px] truncate block">{facility.installationLocation || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">P&ID No.</span>
                        <span className="text-stone-700 font-medium truncate block">{facility.pidNumber || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">오염물질</span>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {getPollutants(facility).length > 0 ? getPollutants(facility).map((p: string, i: number) => (
                            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                              {p}
                            </span>
                          )) : <span className="text-stone-500">-</span>}
                        </div>
                      </div>
                    </div>

                    {/* 비고 (있을 경우) */}
                    {facility.notes && (
                      <div className="mt-2 pt-2 border-t border-blue-100/30">
                        <span className="text-[10px] text-stone-400">비고: </span>
                        <span className="text-[10px] text-stone-600">{facility.notes}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 수질 배출시설 */}
          {waterFacilities.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-500"></div>
                <h4 className="text-sm font-medium text-stone-600">수질 배출시설 ({waterFacilities.length}개)</h4>
              </div>
              <div className="space-y-3">
                {waterFacilities.map((facility: any, index: number) => (
                  <div key={facility.id || index} className="p-4 bg-gradient-to-br from-cyan-50/50 to-white rounded-xl border border-cyan-100 hover:border-cyan-200 transition-colors">
                    {/* 헤더: 관리번호, 시설명, 상태 */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-cyan-600 bg-cyan-100 px-2 py-0.5 rounded">
                            {facility.managementNumber || facility.code || `WE-${index + 1}`}
                          </span>
                          {facility.facilityNumber && (
                            <span className="text-xs font-mono text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                              {facility.facilityNumber}
                            </span>
                          )}
                          {facility.isLegalTarget !== undefined && (
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded",
                              facility.isLegalTarget 
                                ? "bg-green-100 text-green-700" 
                                : "bg-stone-100 text-stone-500"
                            )}>
                              {facility.isLegalTarget ? "법적대상" : "비대상"}
                            </span>
                          )}
                        </div>
                        <h4 className="font-medium text-stone-700 mt-1.5 leading-tight">{facility.name || "미입력"}</h4>
                        <p className="text-[10px] text-stone-400 mt-0.5">
                          {facility.facilityType ? FACILITY_TYPE_LABELS[facility.facilityType] || facility.facilityType : facility.subType || "미분류"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn(
                          "text-[10px] px-2.5 py-1 rounded-full font-medium",
                          facility.status === "operating" ? "bg-green-100 text-green-700" :
                          facility.status === "stopped" ? "bg-red-100 text-red-700" :
                          "bg-amber-100 text-amber-700"
                        )}>
                          {facility.status === "operating" ? "● 가동중" : facility.status === "stopped" ? "● 정지" : "● 점검중"}
                        </span>
                        {facility.changeStatus && (
                          <span className="text-[10px] text-stone-400">
                            {CHANGE_STATUS_LABELS[facility.changeStatus] || facility.changeStatus}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {/* 모든 정보를 1행에 표시 */}
                    <div className="grid grid-cols-8 gap-2 text-xs">
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">용량</span>
                        <span className="text-stone-700 font-medium">
                          {facility.capacity ?? "-"}{facility.capacityUnit ? ` ${facility.capacityUnit}` : ""}
                        </span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">수량</span>
                        <span className="text-stone-700 font-medium">{facility.quantity ?? 1}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">공정번호</span>
                        <span className="text-stone-700 font-medium">{facility.processNumber || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">방류구</span>
                        <span className="text-stone-700 font-medium">{facility.dischargePortNumber || facility.linkedStackId || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">운전인자</span>
                        <span className="text-stone-700 font-medium">{facility.operatingFactorDetail || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">설치지점</span>
                        <span className="text-stone-700 font-medium text-[11px] truncate block">{facility.installationLocation || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">P&ID No.</span>
                        <span className="text-stone-700 font-medium truncate block">{facility.pidNumber || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">오염물질</span>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {getPollutants(facility).length > 0 ? getPollutants(facility).map((p: string, i: number) => (
                            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                              {p}
                            </span>
                          )) : <span className="text-stone-500">-</span>}
                        </div>
                      </div>
                    </div>

                    {/* 비고 (있을 경우) */}
                    {facility.notes && (
                      <div className="mt-2 pt-2 border-t border-cyan-100/30">
                        <span className="text-[10px] text-stone-400">비고: </span>
                        <span className="text-[10px] text-stone-600">{facility.notes}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 복수 매체 배출시설 */}
          {multiMediaFacilities.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div>
                <h4 className="text-sm font-medium text-stone-600">복수 매체 배출시설 ({multiMediaFacilities.length}개)</h4>
              </div>
              <div className="space-y-3">
                {multiMediaFacilities.map((facility: any, index: number) => (
                  <div key={facility.id || index} className="p-4 bg-gradient-to-br from-purple-50/50 to-white rounded-xl border border-purple-100 hover:border-purple-200 transition-colors">
                    {/* 헤더: 관리번호, 시설명, 상태 */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-purple-600 bg-purple-100 px-2 py-0.5 rounded">
                            {facility.managementNumber || facility.code || `ME-${index + 1}`}
                          </span>
                          {/* 복수 시설번호 표시 */}
                          {facility.emissionDetails?.map((detail: any, i: number) => (
                            <span key={i} className="text-xs font-mono text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                              {detail.facilityNumber}
                            </span>
                          ))}
                        </div>
                        <h4 className="font-medium text-stone-700 mt-1.5 leading-tight">{facility.name || "미입력"}</h4>
                        <p className="text-[10px] text-stone-400 mt-0.5">
                          {facility.facilityType ? FACILITY_TYPE_LABELS[facility.facilityType] || facility.facilityType : facility.subType || "미분류"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn(
                          "text-[10px] px-2.5 py-1 rounded-full font-medium",
                          facility.status === "operating" ? "bg-green-100 text-green-700" :
                          facility.status === "stopped" ? "bg-red-100 text-red-700" :
                          "bg-amber-100 text-amber-700"
                        )}>
                          {facility.status === "operating" ? "● 가동중" : facility.status === "stopped" ? "● 정지" : "● 점검중"}
                        </span>
                        {facility.changeStatus && (
                          <span className="text-[10px] text-stone-400">
                            {CHANGE_STATUS_LABELS[facility.changeStatus] || facility.changeStatus}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {/* 공통 정보 (1행) */}
                    <div className="grid grid-cols-5 gap-2 text-xs mb-3">
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">용량</span>
                        <span className="text-stone-700 font-medium">
                          {facility.capacity ?? "-"}{facility.capacityUnit ? ` ${facility.capacityUnit}` : ""}
                        </span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">수량</span>
                        <span className="text-stone-700 font-medium">{facility.quantity ?? 1}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">공정번호</span>
                        <span className="text-stone-700 font-medium">{facility.processNumber || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">운전인자</span>
                        <span className="text-stone-700 font-medium">{facility.operatingFactorDetail || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">설치지점</span>
                        <span className="text-stone-700 font-medium text-[11px] truncate block">{facility.installationLocation || "-"}</span>
                      </div>
                    </div>

                    {/* 배출 상세 정보 (각 시설번호별) */}
                    <div className="mt-3 pt-3 border-t border-purple-100/50">
                      <span className="text-[10px] text-stone-400 mb-2 block">배출 상세 (시설번호별)</span>
                      <div className="space-y-2">
                        {facility.emissionDetails?.map((detail: any, i: number) => (
                          <div key={i} className={cn(
                            "grid grid-cols-5 gap-2 text-xs p-2 rounded-lg",
                            detail.emissionMedia === "air" ? "bg-blue-50/50 border border-blue-100" :
                            detail.emissionMedia === "water" ? "bg-cyan-50/50 border border-cyan-100" :
                            "bg-amber-50/50 border border-amber-100"
                          )}>
                            <div>
                              <span className="text-stone-400 block text-[10px]">시설번호</span>
                              <span className="text-stone-700 font-medium">{detail.facilityNumber}</span>
                            </div>
                            <div>
                              <span className="text-stone-400 block text-[10px]">처리/발생</span>
                              <span className={cn(
                                "text-xs font-medium",
                                detail.emissionMedia === "air" ? "text-blue-600" :
                                detail.emissionMedia === "water" ? "text-cyan-600" :
                                "text-amber-600"
                              )}>
                                {EMISSION_MEDIA_LABELS[detail.emissionMedia] || detail.emissionMedia}
                              </span>
                            </div>
                            <div>
                              <span className="text-stone-400 block text-[10px]">오염물질</span>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {(detail.pollutants || []).length > 0 ? detail.pollutants.map((p: string, j: number) => (
                                  <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                                    {p}
                                  </span>
                                )) : <span className="text-stone-500">-</span>}
                              </div>
                            </div>
                            <div>
                              <span className="text-stone-400 block text-[10px]">배출구</span>
                              <span className="text-stone-700 font-medium">{detail.dischargePortNumber || "-"}</span>
                            </div>
                            <div>
                              <span className="text-stone-400 block text-[10px]">법적대상</span>
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded",
                                detail.isLegalTarget 
                                  ? "bg-green-100 text-green-700" 
                                  : "bg-stone-100 text-stone-500"
                              )}>
                                {detail.isLegalTarget ? "대상" : "비대상"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* P&ID No. */}
                    <div className="mt-2 text-xs">
                      <span className="text-stone-400">P&ID No.: </span>
                      <span className="text-stone-700">{facility.pidNumber || "-"}</span>
                    </div>

                    {/* 비고 (있을 경우) */}
                    {facility.notes && (
                      <div className="mt-2 pt-2 border-t border-purple-100/30">
                        <span className="text-[10px] text-stone-400">비고: </span>
                        <span className="text-[10px] text-stone-600">{facility.notes}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyDataPlaceholder
          icon={<Factory className="w-12 h-12 text-stone-300" />}
          title="배출시설"
          description="통합환경관리계획서의 배출시설 목록 양식에 맞춘 데이터를 관리합니다."
        />
      )}
    </div>
  );
}

// ============================================================
// 방지시설 탭
// 통합환경관리계획서 3.1.2 방지(저감)시설 표 양식 기준
// ============================================================

// 샘플 방지시설 데이터 (UI 미리보기용 - 통합환경관리계획서 양식 기준)
const SAMPLE_PREVENTION_FACILITIES = [
  // 단일 시설번호 케이스 (대기 집진시설)
  {
    id: "prev-sample-1",
    managementNumber: "C-PU41001",
    processNumber: "PU-04-01",
    facilityNumber: "AT-4",
    name: "연소조절에 의한 시설 (저녹스버너) LB-2300",
    capacity: 33.33,
    capacityUnit: "Nm³/분",
    quantity: 1,
    treatmentType: "treatment",
    pollutants: ["질소산화물"],
    operatingFactor: "바이오가스 사용량",
    installationLocation: "3.2 시설 배치도 참조",
    dischargePortNumber: "#A4",
    changeStatus: "existing",
    isLegalTarget: true,
    pidNumber: "-",
    notes: "",
    facilityType: "air_denox",
    status: "operating",
  },
  // 복수 시설번호 케이스 (집진시설 - 폐기물 발생 + 대기 처리)
  {
    id: "prev-sample-2",
    managementNumber: "C-PUI1001",
    processNumber: "PU-01-01",
    name: "여과집진시설 (ROOF MOUNT BAG FILTER(방-18)) BF-800A",
    capacity: 12,
    capacityUnit: "m³/분",
    quantity: 1,
    operatingFactor: "차압",
    installationLocation: "3.2 시설 배치도 참조",
    changeStatus: "existing",
    pidNumber: "DSP-1806-01-FS-001",
    notes: "",
    facilityType: "air_dust",
    status: "operating",
    preventionDetails: [
      {
        facilityNumber: "Ws-1",
        treatmentType: "generation",
        pollutants: ["폐합성수지"],
        dischargePortNumber: "-",
        isLegalTarget: false,
      },
      {
        facilityNumber: "AT-1",
        treatmentType: "treatment",
        pollutants: ["먼지"],
        dischargePortNumber: "#A1",
        isLegalTarget: true,
      },
    ],
  },
  // 복수 시설번호 케이스 (SCR - 폐기물 발생 + 대기 처리)
  {
    id: "prev-sample-3",
    managementNumber: "C-PU41003",
    processNumber: "PU-04-01",
    name: "촉매반응을 이용하는 시설 (SCR CONVERTER(방-16)) TK-707A",
    capacity: 101.47,
    capacityUnit: "Nm³/분",
    quantity: 1,
    operatingFactor: "요소수 사용량",
    installationLocation: "3.2 시설 배치도 참조",
    changeStatus: "existing",
    pidNumber: "JR-P-300-2",
    notes: "",
    facilityType: "air_denox",
    status: "operating",
    preventionDetails: [
      {
        facilityNumber: "Ws-6",
        treatmentType: "generation",
        pollutants: ["급속성 폐촉매"],
        dischargePortNumber: "-",
        isLegalTarget: false,
      },
      {
        facilityNumber: "AT-6",
        treatmentType: "treatment",
        pollutants: ["질소산화물", "암모니아"],
        dischargePortNumber: "#A6",
        isLegalTarget: true,
      },
    ],
  },
  // 3개 시설번호 케이스 (흡수시설 - 수질 발생 + 대기 처리 + 악취 처리)
  {
    id: "prev-sample-4",
    managementNumber: "C-PP12001",
    processNumber: "P-01-02",
    name: "흡수에 의한 시설 (응축시설) T-PP-1108",
    capacity: 160,
    capacityUnit: "m³/분",
    quantity: 1,
    operatingFactor: "가동상태",
    installationLocation: "3.2 시설 배치도 참조",
    changeStatus: "existing",
    pidNumber: "JR-PFD-악취-001",
    notes: "",
    facilityType: "water_physical",
    status: "operating",
    preventionDetails: [
      {
        facilityNumber: "W-17",
        treatmentType: "generation",
        pollutants: ["생물화학적산소요구량", "총유기탄소", "부유물질", "수소이온농도", "노말헥산추출물질함유량-동식물류", "온도", "총질소", "총인"],
        dischargePortNumber: "#W1",
        isLegalTarget: true,
      },
      {
        facilityNumber: "AT-9",
        treatmentType: "treatment",
        pollutants: ["먼지"],
        dischargePortNumber: "#A9",
        isLegalTarget: true,
      },
      {
        facilityNumber: "OT-1",
        treatmentType: "treatment",
        pollutants: ["복합악취"],
        dischargePortNumber: "#O9",
        isLegalTarget: true,
      },
    ],
  },
  // 4개 시설번호 케이스 (폐가스 소각시설)
  {
    id: "prev-sample-5",
    managementNumber: "C-PW12015",
    processNumber: "PW-01-02",
    name: "폐가스 소각시설 (폐가스 소각시설(촉매연소시설)) CO-661",
    capacity: 14.2,
    capacityUnit: "m³",
    quantity: 1,
    operatingFactor: "온도, 촉매교체주기",
    installationLocation: "3.2 시설 배치도 참조",
    changeStatus: "existing",
    pidNumber: "JR-P-210-3",
    notes: "",
    facilityType: "air_other",
    status: "operating",
    preventionDetails: [
      {
        facilityNumber: "A-34",
        treatmentType: "generation",
        pollutants: ["먼지", "황산화물", "질소산화물", "암모니아", "황화수소", "아세트알데히드", "페놀화합물"],
        dischargePortNumber: "#A11",
        isLegalTarget: true,
      },
      {
        facilityNumber: "Ws-28",
        treatmentType: "generation",
        pollutants: ["폐촉매"],
        dischargePortNumber: "-",
        isLegalTarget: false,
      },
      {
        facilityNumber: "AT-21",
        treatmentType: "treatment",
        pollutants: ["탄화수소"],
        dischargePortNumber: "#A11",
        isLegalTarget: true,
      },
      {
        facilityNumber: "OT-24",
        treatmentType: "treatment",
        pollutants: ["복합악취", "아세트알데히드", "황화수소", "암모니아"],
        dischargePortNumber: "#O11",
        isLegalTarget: true,
      },
    ],
  },
];

// 처리/발생 라벨
const TREATMENT_TYPE_LABELS: Record<string, string> = {
  generation: "발생물질",
  treatment: "처리물질",
};

// 방지시설 유형 라벨
const PREVENTION_TYPE_LABELS: Record<string, string> = {
  air_dust: "집진시설",
  air_desulfur: "탈황시설",
  air_denox: "탈질시설",
  air_voc: "VOC처리시설",
  air_odor: "악취처리시설",
  air_other: "기타대기처리",
  water_physical: "물리적처리",
  water_chemical: "화학적처리",
  water_biological: "생물학적처리",
  water_advanced: "고도처리",
  waste_treatment: "폐기물처리",
  noise_reduction: "소음저감",
};

function PreventionFacilitiesTab({ profile, editedProfile, setEditedProfile, isEditing }: {
  profile: any;
  editedProfile: any;
  setEditedProfile: (p: any) => void;
  isEditing: boolean;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const data = isEditing ? editedProfile : profile;
  const actualFacilities = data?.preventionFacilities || [];
  
  // 미리보기 모드일 때는 샘플 데이터 사용
  const facilities = showPreview ? SAMPLE_PREVENTION_FACILITIES : actualFacilities;

  // 시설 분류
  const hasMultipleDetails = (f: any) => f.preventionDetails && f.preventionDetails.length > 1;
  const singleFacilities = facilities.filter((f: any) => !hasMultipleDetails(f));
  const multiFacilities = facilities.filter((f: any) => hasMultipleDetails(f));

  // 오염물질/시설번호 필드 호환성
  const getPollutants = (facility: any, detail?: any) => {
    if (detail) return detail.pollutants || [];
    return facility.pollutants || [];
  };

  return (
    <div className="space-y-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-stone-700 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          방지시설 현황 ({facilities.length}개)
          {showPreview && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              샘플 데이터 미리보기
            </span>
          )}
        </h3>
        {actualFacilities.length === 0 && (
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={cn(
              "text-xs px-3 py-1.5 rounded-lg transition-colors",
              showPreview 
                ? "bg-amber-100 text-amber-700 hover:bg-amber-200" 
                : "bg-primary/10 text-primary hover:bg-primary/20"
            )}
          >
            {showPreview ? "미리보기 닫기" : "샘플 데이터 미리보기"}
          </button>
        )}
      </div>

      {facilities.length > 0 ? (
        <div className="space-y-6">
          {/* 단일 시설번호 방지시설 */}
          {singleFacilities.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                <h4 className="text-sm font-medium text-stone-600">단일 방지시설 ({singleFacilities.length}개)</h4>
              </div>
              <div className="space-y-3">
                {singleFacilities.map((facility: any, index: number) => (
                  <div key={facility.id || index} className="p-4 bg-gradient-to-br from-emerald-50/50 to-white rounded-xl border border-emerald-100 hover:border-emerald-200 transition-colors">
                    {/* 헤더: 관리번호, 시설명, 상태 */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded">
                            {facility.managementNumber || facility.code || `CP-${index + 1}`}
                          </span>
                          {(facility.facilityNumber || facility.preventionDetails?.[0]?.facilityNumber) && (
                            <span className="text-xs font-mono text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                              {facility.facilityNumber || facility.preventionDetails?.[0]?.facilityNumber}
                            </span>
                          )}
                          {(facility.isLegalTarget !== undefined || facility.preventionDetails?.[0]?.isLegalTarget !== undefined) && (
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded",
                              (facility.isLegalTarget ?? facility.preventionDetails?.[0]?.isLegalTarget)
                                ? "bg-green-100 text-green-700" 
                                : "bg-stone-100 text-stone-500"
                            )}>
                              {(facility.isLegalTarget ?? facility.preventionDetails?.[0]?.isLegalTarget) ? "법적대상" : "비대상"}
                            </span>
                          )}
                        </div>
                        <h4 className="font-medium text-stone-700 mt-1.5 leading-tight">{facility.name || "미입력"}</h4>
                        <p className="text-[10px] text-stone-400 mt-0.5">
                          {facility.facilityType ? PREVENTION_TYPE_LABELS[facility.facilityType] || facility.facilityType : "미분류"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn(
                          "text-[10px] px-2.5 py-1 rounded-full font-medium",
                          facility.status === "operating" ? "bg-green-100 text-green-700" :
                          facility.status === "stopped" ? "bg-red-100 text-red-700" :
                          "bg-amber-100 text-amber-700"
                        )}>
                          {facility.status === "operating" ? "● 가동중" : facility.status === "stopped" ? "● 정지" : "● 점검중"}
                        </span>
                        {facility.changeStatus && (
                          <span className="text-[10px] text-stone-400">
                            {CHANGE_STATUS_LABELS[facility.changeStatus] || facility.changeStatus}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {/* 모든 정보를 1행에 표시 */}
                    <div className="grid grid-cols-8 gap-2 text-xs">
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">용량</span>
                        <span className="text-stone-700 font-medium">
                          {facility.capacity ?? "-"}{facility.capacityUnit ? ` ${facility.capacityUnit}` : ""}
                        </span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">수량</span>
                        <span className="text-stone-700 font-medium">{facility.quantity ?? 1}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">공정번호</span>
                        <span className="text-stone-700 font-medium">{facility.processNumber || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">배출구</span>
                        <span className="text-stone-700 font-medium">{facility.dischargePortNumber || facility.preventionDetails?.[0]?.dischargePortNumber || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">운전인자</span>
                        <span className="text-stone-700 font-medium truncate block">{facility.operatingFactor || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">설치지점</span>
                        <span className="text-stone-700 font-medium text-[11px] truncate block">{facility.installationLocation || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">P&ID No.</span>
                        <span className="text-stone-700 font-medium truncate block">{facility.pidNumber || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">처리물질</span>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {getPollutants(facility, facility.preventionDetails?.[0]).length > 0 ? getPollutants(facility, facility.preventionDetails?.[0]).slice(0, 2).map((p: string, i: number) => (
                            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                              {p}
                            </span>
                          )) : <span className="text-stone-500">-</span>}
                          {getPollutants(facility, facility.preventionDetails?.[0]).length > 2 && (
                            <span className="text-[9px] text-stone-400">+{getPollutants(facility, facility.preventionDetails?.[0]).length - 2}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 비고 (있을 경우) */}
                    {facility.notes && (
                      <div className="mt-2 pt-2 border-t border-emerald-100/30">
                        <span className="text-[10px] text-stone-400">비고: </span>
                        <span className="text-[10px] text-stone-600">{facility.notes}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 복수 시설번호 방지시설 */}
          {multiFacilities.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-500"></div>
                <h4 className="text-sm font-medium text-stone-600">복수 매체 방지시설 ({multiFacilities.length}개)</h4>
              </div>
              <div className="space-y-3">
                {multiFacilities.map((facility: any, index: number) => (
                  <div key={facility.id || index} className="p-4 bg-gradient-to-br from-violet-50/50 to-white rounded-xl border border-violet-100 hover:border-violet-200 transition-colors">
                    {/* 헤더: 관리번호, 시설명, 상태 */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-violet-600 bg-violet-100 px-2 py-0.5 rounded">
                            {facility.managementNumber || facility.code || `CP-${index + 1}`}
                          </span>
                          {/* 복수 시설번호 표시 */}
                          {facility.preventionDetails?.map((detail: any, i: number) => (
                            <span key={i} className="text-xs font-mono text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                              {detail.facilityNumber}
                            </span>
                          ))}
                        </div>
                        <h4 className="font-medium text-stone-700 mt-1.5 leading-tight">{facility.name || "미입력"}</h4>
                        <p className="text-[10px] text-stone-400 mt-0.5">
                          {facility.facilityType ? PREVENTION_TYPE_LABELS[facility.facilityType] || facility.facilityType : "미분류"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn(
                          "text-[10px] px-2.5 py-1 rounded-full font-medium",
                          facility.status === "operating" ? "bg-green-100 text-green-700" :
                          facility.status === "stopped" ? "bg-red-100 text-red-700" :
                          "bg-amber-100 text-amber-700"
                        )}>
                          {facility.status === "operating" ? "● 가동중" : facility.status === "stopped" ? "● 정지" : "● 점검중"}
                        </span>
                        {facility.changeStatus && (
                          <span className="text-[10px] text-stone-400">
                            {CHANGE_STATUS_LABELS[facility.changeStatus] || facility.changeStatus}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {/* 공통 정보 (1행) */}
                    <div className="grid grid-cols-5 gap-2 text-xs mb-3">
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">용량</span>
                        <span className="text-stone-700 font-medium">
                          {facility.capacity ?? "-"}{facility.capacityUnit ? ` ${facility.capacityUnit}` : ""}
                        </span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">수량</span>
                        <span className="text-stone-700 font-medium">{facility.quantity ?? 1}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">공정번호</span>
                        <span className="text-stone-700 font-medium">{facility.processNumber || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">운전인자</span>
                        <span className="text-stone-700 font-medium truncate block">{facility.operatingFactor || "-"}</span>
                      </div>
                      <div className="bg-white/60 p-2 rounded-lg">
                        <span className="text-stone-400 block text-[10px]">설치지점</span>
                        <span className="text-stone-700 font-medium text-[11px] truncate block">{facility.installationLocation || "-"}</span>
                      </div>
                    </div>

                    {/* 방지 상세 정보 (각 시설번호별) */}
                    <div className="mt-3 pt-3 border-t border-violet-100/50">
                      <span className="text-[10px] text-stone-400 mb-2 block">처리/발생 상세 (시설번호별)</span>
                      <div className="space-y-2">
                        {facility.preventionDetails?.map((detail: any, i: number) => (
                          <div key={i} className={cn(
                            "grid grid-cols-5 gap-2 text-xs p-2 rounded-lg",
                            detail.treatmentType === "generation" ? "bg-amber-50/50 border border-amber-100" :
                            "bg-emerald-50/50 border border-emerald-100"
                          )}>
                            <div>
                              <span className="text-stone-400 block text-[10px]">시설번호</span>
                              <span className="text-stone-700 font-medium">{detail.facilityNumber}</span>
                            </div>
                            <div>
                              <span className="text-stone-400 block text-[10px]">처리/발생</span>
                              <span className={cn(
                                "text-xs font-medium",
                                detail.treatmentType === "generation" ? "text-amber-600" : "text-emerald-600"
                              )}>
                                {TREATMENT_TYPE_LABELS[detail.treatmentType] || detail.treatmentType}
                              </span>
                            </div>
                            <div>
                              <span className="text-stone-400 block text-[10px]">오염물질</span>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {(detail.pollutants || []).length > 0 ? detail.pollutants.slice(0, 2).map((p: string, j: number) => (
                                  <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                                    {p.length > 6 ? p.substring(0, 6) + "..." : p}
                                  </span>
                                )) : <span className="text-stone-500">-</span>}
                                {(detail.pollutants || []).length > 2 && (
                                  <span className="text-[9px] text-stone-400">+{detail.pollutants.length - 2}</span>
                                )}
                              </div>
                            </div>
                            <div>
                              <span className="text-stone-400 block text-[10px]">배출구</span>
                              <span className="text-stone-700 font-medium">{detail.dischargePortNumber || "-"}</span>
                            </div>
                            <div>
                              <span className="text-stone-400 block text-[10px]">법적대상</span>
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded",
                                detail.isLegalTarget 
                                  ? "bg-green-100 text-green-700" 
                                  : "bg-stone-100 text-stone-500"
                              )}>
                                {detail.isLegalTarget ? "대상" : "비대상"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* P&ID No. */}
                    <div className="mt-2 text-xs">
                      <span className="text-stone-400">P&ID No.: </span>
                      <span className="text-stone-700">{facility.pidNumber || "-"}</span>
                    </div>

                    {/* 비고 (있을 경우) */}
                    {facility.notes && (
                      <div className="mt-2 pt-2 border-t border-violet-100/30">
                        <span className="text-[10px] text-stone-400">비고: </span>
                        <span className="text-[10px] text-stone-600">{facility.notes}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyDataPlaceholder
          icon={<Shield className="w-12 h-12 text-stone-300" />}
          title="방지시설"
          description="통합환경관리계획서의 방지시설 목록 양식에 맞춘 데이터를 관리합니다."
        />
      )}
    </div>
  );
}

// ============================================================
// 오염물질 배출량 탭 (기존명: 배출/방류구)
// 통합환경관리계획서 2.3.2 최근 5년간 오염물질 배출실적 양식 기준
// ============================================================

// 샘플 오염물질 배출량 데이터 (UI 미리보기용)
const SAMPLE_STACKS = [
  // 대기 배출구 #A-1 (먼지 단일)
  {
    id: "stack-sample-1",
    code: "#A-1",
    legacyCode: "12",
    semsNumber: "9",
    name: "여과집진시설 배출구",
    type: "air",
    height: 15,
    diameter: 0.8,
    tmsInstalled: false,
    status: "active",
    pollutantData: [
      {
        pollutant: "먼지",
        emissionAmount: [
          { year: 2019, value: 1.628 },
          { year: 2020, value: 2.855 },
          { year: 2021, value: 2.107 },
          { year: 2022, value: 2.35 },
          { year: 2023, value: 2.072 },
        ],
        concentration: [
          { year: 2019, value: 1.2 },
          { year: 2020, value: 3.7 },
          { year: 2021, value: 2.7 },
          { year: 2022, value: 2.7 },
          { year: 2023, value: 2 },
        ],
        concentrationUnit: "mg/Sm³",
        statistics: { max: 2.855, min: 1.628, avg: 2.2 },
      },
    ],
  },
  // 대기 배출구 #A-6 (먼지, 질소산화물, 황산화물 복수)
  {
    id: "stack-sample-2",
    code: "#A-6",
    legacyCode: "10",
    semsNumber: "7",
    name: "연소시설 배출구",
    type: "air",
    height: 25,
    diameter: 1.2,
    tmsInstalled: true,
    tmsItems: ["먼지", "NOx", "SOx"],
    status: "active",
    pollutantData: [
      {
        pollutant: "먼지",
        emissionAmount: [
          { year: 2019, value: 77.83 },
          { year: 2020, value: 32.918 },
          { year: 2021, value: 29.27 },
          { year: 2022, value: 18.06 },
          { year: 2023, value: 4.406 },
        ],
        concentration: [
          { year: 2019, value: 3.97 },
          { year: 2020, value: 0.7 },
          { year: 2021, value: 2.8 },
          { year: 2022, value: 3 },
          { year: 2023, value: 2.5 },
        ],
        concentrationUnit: "mg/Sm³",
        statistics: { max: 77.83, min: 4.406, avg: 32.5 },
      },
      {
        pollutant: "질소산화물",
        emissionAmount: [
          { year: 2019, value: 2738.293 },
          { year: 2020, value: 2425.617 },
          { year: 2021, value: 741.195 },
          { year: 2022, value: 670.681 },
          { year: 2023, value: 173.222 },
        ],
        concentration: [
          { year: 2019, value: 31.8 },
          { year: 2020, value: 40.29 },
          { year: 2021, value: 41.57 },
          { year: 2022, value: 56.3 },
          { year: 2023, value: 17.1 },
        ],
        concentrationUnit: "ppm",
        statistics: { max: 2738.293, min: 173.222, avg: 1349.8 },
      },
      {
        pollutant: "황산화물",
        emissionAmount: [
          { year: 2019, value: 48.407 },
          { year: 2020, value: 0.674 },
          { year: 2021, value: 0 },
          { year: 2022, value: 0 },
          { year: 2023, value: 0 },
        ],
        concentration: [
          { year: 2019, value: 0.53 },
          { year: 2020, value: 0.01 },
          { year: 2021, value: 0.00001 },
          { year: 2022, value: 0 },
          { year: 2023, value: 0 },
        ],
        concentrationUnit: "ppm",
        statistics: { max: 48.407, min: 0, avg: 9.82 },
      },
    ],
    emissionAllowances: [
      {
        pollutant: "질소산화물",
        yearlyAllowance: [
          { year: 2021, value: 3389 },
          { year: 2022, value: 3389 },
          { year: 2023, value: 3389 },
          { year: 2024, value: 3389 },
          { year: 2025, value: 3389 },
        ],
        isProvisional: false,
      },
    ],
  },
  // 대기 배출구 #A-11 (복수 오염물질 + 총량관리)
  {
    id: "stack-sample-3",
    code: "#A-11",
    legacyCode: "1",
    semsNumber: "1",
    name: "폐가스 소각시설 배출구",
    type: "air",
    height: 35,
    diameter: 1.5,
    tmsInstalled: true,
    tmsItems: ["먼지", "NOx", "SOx", "THC"],
    status: "active",
    pollutantData: [
      {
        pollutant: "먼지",
        emissionAmount: [
          { year: 2019, value: null },
          { year: 2020, value: null },
          { year: 2021, value: null },
          { year: 2022, value: 136.732 },
          { year: 2023, value: 139.887 },
        ],
        concentration: [
          { year: 2019, value: null },
          { year: 2020, value: null },
          { year: 2021, value: null },
          { year: 2022, value: 8.2 },
          { year: 2023, value: 4 },
        ],
        concentrationUnit: "mg/Sm³",
        statistics: { max: 139.887, min: 136.732, avg: 138.31 },
      },
      {
        pollutant: "질소산화물",
        emissionAmount: [
          { year: 2019, value: null },
          { year: 2020, value: null },
          { year: 2021, value: null },
          { year: 2022, value: 1756.33 },
          { year: 2023, value: 2027.42 },
        ],
        concentration: [
          { year: 2019, value: null },
          { year: 2020, value: null },
          { year: 2021, value: null },
          { year: 2022, value: 10.3 },
          { year: 2023, value: 25 },
        ],
        concentrationUnit: "ppm",
        statistics: { max: 2027.42, min: 1756.33, avg: 1891.88 },
      },
      {
        pollutant: "탄화수소(THC)",
        emissionAmount: [
          { year: 2019, value: null },
          { year: 2020, value: null },
          { year: 2021, value: null },
          { year: 2022, value: 4245.71 },
          { year: 2023, value: 6695.15 },
        ],
        concentration: [
          { year: 2019, value: null },
          { year: 2020, value: null },
          { year: 2021, value: null },
          { year: 2022, value: 71.6 },
          { year: 2023, value: 196 },
        ],
        concentrationUnit: "ppm",
        statistics: { max: 6695.15, min: 4245.71, avg: 5470.43 },
      },
      {
        pollutant: "암모니아",
        emissionAmount: [
          { year: 2019, value: null },
          { year: 2020, value: null },
          { year: 2021, value: null },
          { year: 2022, value: 113.61 },
          { year: 2023, value: 86.66 },
        ],
        concentration: [
          { year: 2019, value: null },
          { year: 2020, value: null },
          { year: 2021, value: null },
          { year: 2022, value: 1.8 },
          { year: 2023, value: 8.5 },
        ],
        concentrationUnit: "ppm",
        statistics: { max: 113.61, min: 86.66, avg: 100.14 },
      },
    ],
    emissionAllowances: [
      {
        pollutant: "질소산화물",
        yearlyAllowance: [
          { year: 2021, value: 1406 },
          { year: 2022, value: 1406 },
          { year: 2023, value: 1406 },
          { year: 2024, value: 1406 },
          { year: 2025, value: 1406 },
        ],
        isProvisional: false,
      },
    ],
    notes: "방지시설 설치 면제시설로서 2019년도부터 2020년도까지는 자가측정 대상시설이 아님",
  },
  // 수질 방류구 #W-1
  {
    id: "stack-sample-4",
    code: "#W-1",
    name: "폐수 방류구",
    type: "water",
    tmsInstalled: false,
    status: "active",
    dischargePath: ["(주)진로발효", "안산시 공공하수처리장", "시화호(해양방류)"],
    wastewaterDischarge: {
      avgDaily: 1015,
      maxDaily: 1583,
    },
    pollutantData: [
      {
        pollutant: "수소이온농도",
        concentration: [
          { year: 2019, value: 6.4 },
          { year: 2020, value: 7.3 },
          { year: 2021, value: 7.6 },
          { year: 2022, value: 6.8 },
          { year: 2023, value: 6.3 },
        ],
        concentrationUnit: "pH",
        statistics: { max: 7.6, min: 6.3, avg: 6.88 },
      },
      {
        pollutant: "생물화학적산소요구량",
        concentration: [
          { year: 2019, value: 17.8 },
          { year: 2020, value: 3.8 },
          { year: 2021, value: 9.6 },
          { year: 2022, value: 21.1 },
          { year: 2023, value: 47.6 },
        ],
        concentrationUnit: "mg/L",
        statistics: { max: 47.6, min: 3.8, avg: 19.98 },
      },
      {
        pollutant: "화학적산소요구량",
        concentration: [
          { year: 2019, value: 92.9 },
          { year: 2020, value: 74.2 },
          { year: 2021, value: 82.6 },
          { year: 2022, value: null },
          { year: 2023, value: null },
        ],
        concentrationUnit: "mg/L",
        statistics: { max: 92.9, min: 74.2, avg: 83.23 },
      },
      {
        pollutant: "총유기탄소량",
        concentration: [
          { year: 2019, value: null },
          { year: 2020, value: null },
          { year: 2021, value: null },
          { year: 2022, value: 56.9 },
          { year: 2023, value: 47.8 },
        ],
        concentrationUnit: "mg/L",
        statistics: { max: 56.9, min: 47.8, avg: 52.35 },
      },
      {
        pollutant: "부유물질량",
        concentration: [
          { year: 2019, value: 18.7 },
          { year: 2020, value: 7.4 },
          { year: 2021, value: 19 },
          { year: 2022, value: 18 },
          { year: 2023, value: 36.5 },
        ],
        concentrationUnit: "mg/L",
        statistics: { max: 36.5, min: 7.4, avg: 19.92 },
      },
      {
        pollutant: "총질소",
        concentration: [
          { year: 2019, value: 19.3 },
          { year: 2020, value: 16.9 },
          { year: 2021, value: 16.58 },
          { year: 2022, value: 35.61 },
          { year: 2023, value: 80.66 },
        ],
        concentrationUnit: "mg/L",
        statistics: { max: 80.66, min: 16.58, avg: 33.81 },
      },
      {
        pollutant: "총인",
        concentration: [
          { year: 2019, value: 1.224 },
          { year: 2020, value: 0.88 },
          { year: 2021, value: 0.403 },
          { year: 2022, value: 0.678 },
          { year: 2023, value: 1.549 },
        ],
        concentrationUnit: "mg/L",
        statistics: { max: 1.549, min: 0.403, avg: 0.95 },
      },
    ],
  },
];

function StacksTab({ profile, editedProfile, setEditedProfile, isEditing }: {
  profile: any;
  editedProfile: any;
  setEditedProfile: (p: any) => void;
  isEditing: boolean;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const data = isEditing ? editedProfile : profile;
  const actualStacks = data?.stacks || [];
  
  // 미리보기 모드일 때는 샘플 데이터 사용
  const stacks = showPreview ? SAMPLE_STACKS : actualStacks;

  // 대기/수질 분류
  const airStacks = stacks.filter((s: any) => s.type === "air");
  const waterStacks = stacks.filter((s: any) => s.type === "water");

  // 연도별 값 가져오기 헬퍼
  const getYearValue = (data: any[] | undefined, year: number): number | null => {
    if (!data) return null;
    const found = data.find((d: any) => d.year === year);
    return found ? found.value : null;
  };

  // 값 포맷팅
  const formatValue = (value: number | null): string => {
    if (value === null || value === undefined) return "-";
    if (value === 0) return "0";
    if (value < 0.001) return value.toExponential(2);
    if (value < 1) return value.toFixed(3);
    if (value >= 1000) return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
    return value.toFixed(2);
  };

  return (
    <div className="space-y-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-stone-700 flex items-center gap-2">
          <Building className="w-4 h-4 text-primary" />
          오염물질 배출량 현황 ({stacks.length}개)
          {showPreview && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              샘플 데이터 미리보기
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {/* 보기 모드 전환 */}
          <div className="flex items-center gap-1 bg-stone-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("cards")}
              className={cn(
                "text-xs px-2 py-1 rounded transition-colors",
                viewMode === "cards" ? "bg-white shadow text-stone-700" : "text-stone-500 hover:text-stone-700"
              )}
            >
              카드
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={cn(
                "text-xs px-2 py-1 rounded transition-colors",
                viewMode === "table" ? "bg-white shadow text-stone-700" : "text-stone-500 hover:text-stone-700"
              )}
            >
              표
            </button>
          </div>
          {actualStacks.length === 0 && (
            <button
              onClick={() => setShowPreview(!showPreview)}
              className={cn(
                "text-xs px-3 py-1.5 rounded-lg transition-colors",
                showPreview 
                  ? "bg-amber-100 text-amber-700 hover:bg-amber-200" 
                  : "bg-primary/10 text-primary hover:bg-primary/20"
              )}
            >
              {showPreview ? "미리보기 닫기" : "샘플 데이터 미리보기"}
            </button>
          )}
        </div>
      </div>

      {stacks.length > 0 ? (
        <div className="space-y-6">
          {/* 대기 배출구 섹션 */}
          {airStacks.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                <h4 className="text-sm font-medium text-stone-600">대기 배출구 ({airStacks.length}개)</h4>
              </div>
              
              {viewMode === "cards" ? (
                <div className="space-y-4">
                  {airStacks.map((stack: any, index: number) => (
                    <div key={stack.id || index} className="p-4 bg-gradient-to-br from-blue-50/50 to-white rounded-xl border border-blue-100 hover:border-blue-200 transition-colors">
                      {/* 헤더 */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                              {stack.code}
                            </span>
                            {stack.legacyCode && (
                              <span className="text-xs text-stone-500">기존: {stack.legacyCode}</span>
                            )}
                            {stack.semsNumber && (
                              <span className="text-xs text-stone-500">SEMs: {stack.semsNumber}</span>
                            )}
                          </div>
                          <h4 className="font-medium text-stone-700 mt-1.5">{stack.name || "미입력"}</h4>
                        </div>
                        <div className="flex items-center gap-2">
                          {stack.tmsInstalled && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                              TMS
                            </span>
                          )}
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                            대기배출구
                          </span>
                        </div>
                      </div>

                      {/* 기본 정보 */}
                      <div className="grid grid-cols-4 gap-2 text-xs mb-3">
                        <div className="bg-white/60 p-2 rounded-lg">
                          <span className="text-stone-400 block text-[10px]">높이</span>
                          <span className="text-stone-700 font-medium">{stack.height ? `${stack.height}m` : "-"}</span>
                        </div>
                        <div className="bg-white/60 p-2 rounded-lg">
                          <span className="text-stone-400 block text-[10px]">직경</span>
                          <span className="text-stone-700 font-medium">{stack.diameter ? `${stack.diameter}m` : "-"}</span>
                        </div>
                        {stack.tmsItems && stack.tmsItems.length > 0 && (
                          <div className="bg-white/60 p-2 rounded-lg col-span-2">
                            <span className="text-stone-400 block text-[10px]">TMS 측정항목</span>
                            <span className="text-stone-700 font-medium">{stack.tmsItems.join(", ")}</span>
                          </div>
                        )}
                      </div>

                      {/* 오염물질 배출 데이터 테이블 */}
                      {stack.pollutantData && stack.pollutantData.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-blue-100/50">
                          <span className="text-[10px] text-stone-400 mb-2 block">최근 5년간 배출량/농도</span>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs table-fixed">
                              <thead>
                                <tr className="text-stone-500">
                                  <th className="text-left py-1 px-2 bg-stone-50/50 rounded-l-lg w-36">오염물질</th>
                                  <th className="text-center py-1 px-2 bg-stone-50/50">단위</th>
                                  <th className="text-right py-1 px-2 bg-stone-50/50">2019</th>
                                  <th className="text-right py-1 px-2 bg-stone-50/50">2020</th>
                                  <th className="text-right py-1 px-2 bg-stone-50/50">2021</th>
                                  <th className="text-right py-1 px-2 bg-stone-50/50">2022</th>
                                  <th className="text-right py-1 px-2 bg-stone-50/50">2023</th>
                                  <th className="text-right py-1 px-2 bg-stone-50/50 rounded-r-lg">평균</th>
                                </tr>
                              </thead>
                              <tbody>
                                {stack.pollutantData.map((pd: any, pi: number) => (
                                  <React.Fragment key={pi}>
                                    {/* 배출량 행 */}
                                    {pd.emissionAmount && (
                                      <tr className="border-t border-stone-100">
                                        <td className="py-1.5 px-2 text-stone-700 truncate">{pd.pollutant}</td>
                                        <td className="py-1.5 px-2 text-center text-stone-500">kg</td>
                                        {[2019, 2020, 2021, 2022, 2023].map(year => (
                                          <td key={year} className="py-1.5 px-2 text-right text-stone-600">
                                            {formatValue(getYearValue(pd.emissionAmount, year))}
                                          </td>
                                        ))}
                                        <td className="py-1.5 px-2 text-right font-medium text-stone-700">
                                          {formatValue(pd.statistics?.avg)}
                                        </td>
                                      </tr>
                                    )}
                                    {/* 농도 행 */}
                                    {pd.concentration && (
                                      <tr className="border-t border-stone-100 bg-blue-50/30">
                                        <td className="py-1.5 px-2 text-stone-500 text-[10px]">└ 농도</td>
                                        <td className="py-1.5 px-2 text-center text-stone-500">{pd.concentrationUnit || "-"}</td>
                                        {[2019, 2020, 2021, 2022, 2023].map(year => (
                                          <td key={year} className="py-1.5 px-2 text-right text-stone-500">
                                            {formatValue(getYearValue(pd.concentration, year))}
                                          </td>
                                        ))}
                                        <td className="py-1.5 px-2 text-right text-stone-500">-</td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* 총량관리 정보 */}
                      {stack.emissionAllowances && stack.emissionAllowances.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-blue-100/50">
                          <span className="text-[10px] text-stone-400 mb-2 block">총량관리대상 배출허용총량 (kg/년)</span>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs table-fixed">
                              <thead>
                                <tr className="text-stone-500">
                                  <th className="text-left py-1 px-2 bg-amber-50/50 rounded-l-lg w-36">오염물질</th>
                                  <th className="text-right py-1 px-2 bg-amber-50/50">2021</th>
                                  <th className="text-right py-1 px-2 bg-amber-50/50">2022</th>
                                  <th className="text-right py-1 px-2 bg-amber-50/50">2023</th>
                                  <th className="text-right py-1 px-2 bg-amber-50/50">2024</th>
                                  <th className="text-right py-1 px-2 bg-amber-50/50">2025</th>
                                  <th className="text-center py-1 px-2 bg-amber-50/50 rounded-r-lg">비고</th>
                                </tr>
                              </thead>
                              <tbody>
                                {stack.emissionAllowances.map((ea: any, ei: number) => (
                                  <tr key={ei} className="border-t border-amber-100">
                                    <td className="py-1.5 px-2 text-stone-700 truncate">{ea.pollutant}</td>
                                    {[2021, 2022, 2023, 2024, 2025].map(year => (
                                      <td key={year} className="py-1.5 px-2 text-right text-stone-600">
                                        {formatValue(getYearValue(ea.yearlyAllowance, year))}
                                      </td>
                                    ))}
                                    <td className="py-1.5 px-2 text-center">
                                      {ea.isProvisional && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">가할당</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* 비고 */}
                      {stack.notes && (
                        <div className="mt-2 pt-2 border-t border-blue-100/30">
                          <span className="text-[10px] text-stone-400">비고: </span>
                          <span className="text-[10px] text-stone-600">{stack.notes}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                // 표 보기 모드 (대기)
                <div className="bg-white rounded-xl border border-blue-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-blue-50 text-stone-600">
                          <th className="py-2 px-3 text-left">통합배출구</th>
                          <th className="py-2 px-2 text-center">기존</th>
                          <th className="py-2 px-2 text-center">SEMs</th>
                          <th className="py-2 px-2 text-left">오염물질</th>
                          <th className="py-2 px-2 text-right">2019</th>
                          <th className="py-2 px-2 text-right">2020</th>
                          <th className="py-2 px-2 text-right">2021</th>
                          <th className="py-2 px-2 text-right">2022</th>
                          <th className="py-2 px-2 text-right">2023</th>
                          <th className="py-2 px-2 text-right">최대</th>
                          <th className="py-2 px-2 text-right">최소</th>
                          <th className="py-2 px-2 text-right">평균</th>
                        </tr>
                      </thead>
                      <tbody>
                        {airStacks.flatMap((stack: any) => 
                          (stack.pollutantData || []).map((pd: any, pi: number) => (
                            <tr key={`${stack.id}-${pi}`} className="border-t border-stone-100 hover:bg-stone-50">
                              <td className="py-2 px-3 font-mono text-blue-600">{stack.code}</td>
                              <td className="py-2 px-2 text-center text-stone-500">{stack.legacyCode || "-"}</td>
                              <td className="py-2 px-2 text-center text-stone-500">{stack.semsNumber || "-"}</td>
                              <td className="py-2 px-2 text-stone-700">{pd.pollutant}</td>
                              {[2019, 2020, 2021, 2022, 2023].map(year => (
                                <td key={year} className="py-2 px-2 text-right text-stone-600">
                                  {formatValue(getYearValue(pd.emissionAmount || pd.concentration, year))}
                                </td>
                              ))}
                              <td className="py-2 px-2 text-right text-stone-600">{formatValue(pd.statistics?.max)}</td>
                              <td className="py-2 px-2 text-right text-stone-600">{formatValue(pd.statistics?.min)}</td>
                              <td className="py-2 px-2 text-right font-medium text-stone-700">{formatValue(pd.statistics?.avg)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 수질 방류구 섹션 */}
          {waterStacks.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-500"></div>
                <h4 className="text-sm font-medium text-stone-600">수질 방류구 ({waterStacks.length}개)</h4>
              </div>
              
              {viewMode === "cards" ? (
                <div className="space-y-4">
                  {waterStacks.map((stack: any, index: number) => (
                    <div key={stack.id || index} className="p-4 bg-gradient-to-br from-cyan-50/50 to-white rounded-xl border border-cyan-100 hover:border-cyan-200 transition-colors">
                      {/* 헤더 */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono text-cyan-600 bg-cyan-100 px-2 py-0.5 rounded">
                              {stack.code}
                            </span>
                          </div>
                          <h4 className="font-medium text-stone-700 mt-1.5">{stack.name || "미입력"}</h4>
                          {/* 방류 경로 */}
                          {stack.dischargePath && stack.dischargePath.length > 0 && (
                            <div className="flex items-center gap-1 mt-1 text-[10px] text-stone-500">
                              {stack.dischargePath.map((path: string, pi: number) => (
                                <React.Fragment key={pi}>
                                  {pi > 0 && <span className="text-stone-400">→</span>}
                                  <span>{path}</span>
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700">
                          수질방류구
                        </span>
                      </div>

                      {/* 폐수 배출량 */}
                      {stack.wastewaterDischarge && (
                        <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                          <div className="bg-white/60 p-2 rounded-lg">
                            <span className="text-stone-400 block text-[10px]">평균 폐수배출량</span>
                            <span className="text-stone-700 font-medium">
                              {stack.wastewaterDischarge.avgDaily?.toLocaleString() || "-"} m³/일
                            </span>
                          </div>
                          <div className="bg-white/60 p-2 rounded-lg">
                            <span className="text-stone-400 block text-[10px]">최대 폐수배출량</span>
                            <span className="text-stone-700 font-medium">
                              {stack.wastewaterDischarge.maxDaily?.toLocaleString() || "-"} m³/일
                            </span>
                          </div>
                        </div>
                      )}

                      {/* 수질오염물질 배출농도 테이블 */}
                      {stack.pollutantData && stack.pollutantData.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-cyan-100/50">
                          <span className="text-[10px] text-stone-400 mb-2 block">최근 5년간 배출농도 (mg/L)</span>
                          <div className="overflow-x-auto max-h-64 overflow-y-auto">
                            <table className="w-full text-xs table-fixed">
                              <thead className="sticky top-0">
                                <tr className="text-stone-500">
                                  <th className="text-left py-1 px-2 bg-stone-50 w-36">항목</th>
                                  <th className="text-right py-1 px-2 bg-stone-50">2019</th>
                                  <th className="text-right py-1 px-2 bg-stone-50">2020</th>
                                  <th className="text-right py-1 px-2 bg-stone-50">2021</th>
                                  <th className="text-right py-1 px-2 bg-stone-50">2022</th>
                                  <th className="text-right py-1 px-2 bg-stone-50">2023</th>
                                  <th className="text-right py-1 px-2 bg-stone-50">최대</th>
                                  <th className="text-right py-1 px-2 bg-stone-50">최소</th>
                                  <th className="text-right py-1 px-2 bg-stone-50">평균</th>
                                </tr>
                              </thead>
                              <tbody>
                                {stack.pollutantData.map((pd: any, pi: number) => (
                                  <tr key={pi} className="border-t border-stone-100">
                                    <td className="py-1.5 px-2 text-stone-700 truncate">{pd.pollutant}</td>
                                    {[2019, 2020, 2021, 2022, 2023].map(year => (
                                      <td key={year} className="py-1.5 px-2 text-right text-stone-600">
                                        {formatValue(getYearValue(pd.concentration, year))}
                                      </td>
                                    ))}
                                    <td className="py-1.5 px-2 text-right text-stone-600">{formatValue(pd.statistics?.max)}</td>
                                    <td className="py-1.5 px-2 text-right text-stone-600">{formatValue(pd.statistics?.min)}</td>
                                    <td className="py-1.5 px-2 text-right font-medium text-stone-700">{formatValue(pd.statistics?.avg)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* 비고 */}
                      {stack.notes && (
                        <div className="mt-2 pt-2 border-t border-cyan-100/30">
                          <span className="text-[10px] text-stone-400">비고: </span>
                          <span className="text-[10px] text-stone-600">{stack.notes}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                // 표 보기 모드 (수질)
                <div className="bg-white rounded-xl border border-cyan-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-cyan-50 text-stone-600">
                          <th className="py-2 px-3 text-left">방류구</th>
                          <th className="py-2 px-2 text-left">항목</th>
                          <th className="py-2 px-2 text-right">2019</th>
                          <th className="py-2 px-2 text-right">2020</th>
                          <th className="py-2 px-2 text-right">2021</th>
                          <th className="py-2 px-2 text-right">2022</th>
                          <th className="py-2 px-2 text-right">2023</th>
                          <th className="py-2 px-2 text-right">최대</th>
                          <th className="py-2 px-2 text-right">최소</th>
                          <th className="py-2 px-2 text-right">평균</th>
                        </tr>
                      </thead>
                      <tbody>
                        {waterStacks.flatMap((stack: any) => 
                          (stack.pollutantData || []).map((pd: any, pi: number) => (
                            <tr key={`${stack.id}-${pi}`} className="border-t border-stone-100 hover:bg-stone-50">
                              <td className="py-2 px-3 font-mono text-cyan-600">{stack.code}</td>
                              <td className="py-2 px-2 text-stone-700">{pd.pollutant}</td>
                              {[2019, 2020, 2021, 2022, 2023].map(year => (
                                <td key={year} className="py-2 px-2 text-right text-stone-600">
                                  {formatValue(getYearValue(pd.concentration, year))}
                                </td>
                              ))}
                              <td className="py-2 px-2 text-right text-stone-600">{formatValue(pd.statistics?.max)}</td>
                              <td className="py-2 px-2 text-right text-stone-600">{formatValue(pd.statistics?.min)}</td>
                              <td className="py-2 px-2 text-right font-medium text-stone-700">{formatValue(pd.statistics?.avg)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <EmptyDataPlaceholder
          icon={<Building className="w-12 h-12 text-stone-300" />}
          title="오염물질 배출량"
          description="통합환경관리계획서의 오염물질 배출량(대기/수질/토양/폐기물) 데이터를 관리합니다."
        />
      )}
    </div>
  );
}

// ============================================================
// 공정 탭
// 통합환경관리계획서 공정 설명 및 단위공정별 배출시설 표 기반
// ============================================================

// 샘플 공정 데이터 (계층 구조 반영)
const SAMPLE_PROCESSES = [
  // 대분류: 유틸리티 공정 (PU-01 ~ PU-05)
  {
    id: "proc-major-1",
    code: "PU-01",
    name: "원료 저장공정",
    level: "major",
    description: "입고된 원료를 저장시설에 저장, 이송하는 공정",
  },
  {
    id: "proc-major-2",
    code: "PU-02",
    name: "사용물질저장공정",
    level: "major",
    description: "공정에 사용하는 약품 및 연료를 저장하는 공정",
  },
  {
    id: "proc-major-3",
    code: "PU-03",
    name: "용수 공급공정",
    level: "major",
    description: "공정에 사용하는 용수 및 냉각수를 저장, 생산, 공급하는 공정",
  },
  {
    id: "proc-major-4",
    code: "PU-04",
    name: "스팀 및 발전공정",
    level: "major",
    description: "공정에 사용하는 스팀을 생산하고 발전기를 통해 전력을 생산하는 공정",
  },
  {
    id: "proc-major-5",
    code: "PU-05",
    name: "실험실 공정",
    level: "major",
    description: "제품 품질향상 및 운영을 위한 실험실 공정",
  },

  // 중분류: PU-01 하위
  {
    id: "proc-medium-1",
    code: "PU-01-01",
    parentCode: "PU-01",
    name: "원료 저장공정",
    level: "medium",
    description: "원료가 투입되는 호퍼 및 저장시설",
  },

  // 단위공정: PU-01-01 하위 (단위공정별 배출시설 표 데이터)
  {
    id: "proc-unit-1",
    code: "I-PU11001",
    parentCode: "PU-01-01",
    name: "고체입자상물질 저장시설 (원료투입구)",
    level: "unit",
    description: "원료가 투입되는 호퍼",
    inputs: ["원료(곡물)"],
    outputs: ["배출가스"],
    linkedEmissionIds: ["I-PU11001"],
    linkedPreventionIds: ["C-PP11001"],
    linkedStackIds: ["#A-1"],
    capacity: "18.7 m³",
    notes: "원료투입고, 저장, 분쇄, 선별-계량 등 공정에서 발생하는 먼지의 배출을 줄이기 위하여 여과집진시설 등 방지시설을 설치/운영해야 한다.",
  },
  {
    id: "proc-unit-2",
    code: "I-PU11002",
    parentCode: "PU-01-01",
    name: "그 밖의 시설 (원료투입 BUCKET CONVEYOR)",
    level: "unit",
    description: "호퍼로 투입된 원료가 원료저장 사일로에 투입될 수 있는 높이까지 올려주는 시설",
    inputs: ["원료(곡물)"],
    outputs: ["배출가스"],
    linkedEmissionIds: ["I-PU11002"],
    linkedPreventionIds: ["C-PP11001"],
    linkedStackIds: ["#A-2"],
    capacity: "66 톤/시",
    notes: "원료투입고, 저장, 분쇄, 선별-계량 등 공정에서 발생하는 먼지의 배출을 줄이기 위하여 여과집진시설 등 방지시설을 설치/운영해야 한다.",
  },
  {
    id: "proc-unit-3",
    code: "I-PU11003",
    parentCode: "PU-01-01",
    name: "고체입자상물질 저장시설 (저장시설(SILO))",
    level: "unit",
    description: "호퍼 및 버켓 컨베이어로 투입된 원료를 저장하는 시설로 저장된 원료는 하단의 컨베이어를 통해 원료분쇄 및 선별 공정에 투입된다",
    inputs: ["원료(곡물)"],
    outputs: ["배출가스"],
    linkedEmissionIds: ["I-PU11003"],
    linkedPreventionIds: ["C-PU11001"],
    linkedStackIds: ["#A-1"],
    capacity: "200 m³",
    notes: "원료투입고, 저장, 분쇄, 선별-계량 등 공정에서 발생하는 먼지의 배출을 줄이기 위하여 여과집진시설 등 방지시설을 설치/운영해야 한다.",
  },
  {
    id: "proc-unit-4",
    code: "I-PU11004",
    parentCode: "PU-01-01",
    name: "고체입자상물질 저장시설 (저장시설(SILO))",
    level: "unit",
    description: "호퍼 및 버켓 컨베이어로 투입된 원료를 저장하는 시설로 저장된 원료는 하단의 컨베이어를 통해 원료분쇄 및 선별 공정에 투입된다",
    inputs: ["원료(곡물)"],
    outputs: ["배출가스"],
    linkedEmissionIds: ["I-PU11004"],
    linkedPreventionIds: ["C-PU11002"],
    linkedStackIds: ["#A-2"],
    capacity: "200 m³",
    notes: "원료투입고, 저장, 분쇄, 선별-계량 등 공정에서 발생하는 먼지의 배출을 줄이기 위하여 여과집진시설 등 방지시설을 설치/운영해야 한다.",
  },
];

function ProcessesTab({ profile, editedProfile, setEditedProfile, isEditing }: {
  profile: any;
  editedProfile: any;
  setEditedProfile: (p: any) => void;
  isEditing: boolean;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);

  const data = isEditing ? editedProfile : profile;
  const actualProcesses = data?.processes || [];

  // 미리보기 모드일 때는 샘플 데이터 사용
  const processes = showPreview ? SAMPLE_PROCESSES : actualProcesses;

  // 트리 구조 생성
  const buildProcessTree = useCallback(() => {
    const majors = processes.filter((p: any) => p.level === "major");
    const mediums = processes.filter((p: any) => p.level === "medium");
    const units = processes.filter((p: any) => p.level === "unit");

    return majors.map((major: any) => ({
      ...major,
      children: mediums
        .filter((medium: any) => medium.parentCode === major.code)
        .map((medium: any) => ({
          ...medium,
          children: units.filter((unit: any) => unit.parentCode === medium.code)
        }))
    }));
  }, [processes]);

  const processTree = buildProcessTree();
  const selectedProcess = processes.find((p: any) => p.id === selectedProcessId);

  // 초기 선택
  useEffect(() => {
    if (processes.length > 0 && !selectedProcessId) {
      setSelectedProcessId(processes[0].id);
    }
  }, [processes, selectedProcessId]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-stone-700 flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" />
          공정 현황 ({processes.length}개)
          {showPreview && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              샘플 데이터 미리보기
            </span>
          )}
        </h3>
        {actualProcesses.length === 0 && (
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={cn(
              "text-xs px-3 py-1.5 rounded-lg transition-colors",
              showPreview
                ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                : "bg-primary/10 text-primary hover:bg-primary/20"
            )}
          >
            {showPreview ? "미리보기 닫기" : "샘플 데이터 미리보기"}
          </button>
        )}
      </div>

      {processes.length > 0 ? (
        <div className="flex-1 flex gap-4 min-h-0">
          {/* 좌측: 공정 계통도 (트리) */}
          <div className="w-1/3 border border-stone-200 rounded-xl bg-stone-50/50 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-stone-200 bg-stone-100/50">
              <h4 className="text-xs font-semibold text-stone-600 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5" />
                공정 계통도
              </h4>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {processTree.map((major: any) => (
                <div key={major.id} className="space-y-1">
                  {/* 대분류 */}
                  <button
                    onClick={() => setSelectedProcessId(major.id)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2",
                      selectedProcessId === major.id
                        ? "bg-white shadow-sm text-primary border border-primary/20"
                        : "hover:bg-stone-100 text-stone-700"
                    )}
                  >
                    <span className="bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded text-[10px] font-mono">
                      {major.code}
                    </span>
                    <span className="truncate">{major.name}</span>
                  </button>

                  {/* 중분류 & 단위공정 */}
                  {major.children?.map((medium: any) => (
                    <div key={medium.id} className="pl-4 space-y-1 border-l border-stone-200 ml-2">
                      <button
                        onClick={() => setSelectedProcessId(medium.id)}
                        className={cn(
                          "w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-2",
                          selectedProcessId === medium.id
                            ? "bg-white shadow-sm text-primary border border-primary/20"
                            : "hover:bg-stone-100 text-stone-600"
                        )}
                      >
                        <span className="bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded text-[10px] font-mono">
                          {medium.code}
                        </span>
                        <span className="truncate">{medium.name}</span>
                      </button>

                      {/* 단위공정 */}
                      {medium.children?.map((unit: any) => (
                        <button
                          key={unit.id}
                          onClick={() => setSelectedProcessId(unit.id)}
                          className={cn(
                            "w-full text-left pl-6 pr-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-2 relative",
                            selectedProcessId === unit.id
                              ? "bg-white shadow-sm text-primary border border-primary/20"
                              : "hover:bg-stone-100 text-stone-500"
                          )}
                        >
                          <div className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-px bg-stone-300"></div>
                          <span className="truncate">{unit.name}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* 우측: 공정 상세 정보 */}
          <div className="flex-1 border border-stone-200 rounded-xl bg-white flex flex-col overflow-hidden">
            {selectedProcess ? (
              <div className="flex-1 overflow-y-auto">
                {/* 헤더 */}
                <div className="p-5 border-b border-stone-100 bg-stone-50/30">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-medium border",
                      selectedProcess.level === "major" ? "bg-blue-50 text-blue-600 border-blue-100" :
                      selectedProcess.level === "medium" ? "bg-purple-50 text-purple-600 border-purple-100" :
                      "bg-emerald-50 text-emerald-600 border-emerald-100"
                    )}>
                      {selectedProcess.level === "major" ? "대분류" :
                       selectedProcess.level === "medium" ? "중분류" : "단위공정"}
                    </span>
                    <span className="font-mono text-stone-400 text-xs">{selectedProcess.code}</span>
                  </div>
                  <h2 className="text-lg font-bold text-stone-800">{selectedProcess.name}</h2>
                  {selectedProcess.description && (
                    <p className="mt-2 text-sm text-stone-600 leading-relaxed bg-white p-3 rounded-lg border border-stone-100">
                      {selectedProcess.description}
                    </p>
                  )}
                </div>

                <div className="p-5 space-y-6">
                  {/* 단위 공정일 경우 상세 정보 표시 */}
                  {selectedProcess.level === "unit" ? (
                    <>
                      {/* 흐름도 카드 (Input -> Process -> Output) */}
                      <div>
                        <h4 className="text-xs font-semibold text-stone-500 mb-3 flex items-center gap-2">
                          <RefreshCw className="w-3.5 h-3.5" />
                          공정 흐름
                        </h4>
                        <div className="flex items-stretch gap-2 text-xs">
                          {/* Input */}
                          <div className="flex-1 bg-amber-50 rounded-lg p-3 border border-amber-100 flex flex-col items-center justify-center text-center gap-1">
                            <span className="text-[10px] text-amber-600 font-medium">투입 (원료/연료)</span>
                            <div className="font-medium text-stone-700">
                              {(selectedProcess.inputs || []).length > 0
                                ? selectedProcess.inputs.join(", ")
                                : <span className="text-stone-400">-</span>}
                            </div>
                          </div>

                          <div className="flex items-center text-stone-300">
                            <ChevronRight className="w-5 h-5" />
                          </div>

                          {/* Process */}
                          <div className="flex-[1.5] bg-white rounded-lg p-3 border border-stone-200 shadow-sm flex flex-col items-center justify-center text-center gap-1">
                            <span className="text-[10px] text-stone-500 font-medium">공정 수행</span>
                            <div className="font-bold text-primary">{selectedProcess.name}</div>
                            {selectedProcess.capacity && (
                              <div className="text-[10px] text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full mt-1">
                                용량: {selectedProcess.capacity}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center text-stone-300">
                            <ChevronRight className="w-5 h-5" />
                          </div>

                          {/* Output */}
                          <div className="flex-1 bg-blue-50 rounded-lg p-3 border border-blue-100 flex flex-col items-center justify-center text-center gap-1">
                            <span className="text-[10px] text-blue-600 font-medium">산출 (제품/배출)</span>
                            <div className="font-medium text-stone-700">
                              {(selectedProcess.outputs || []).length > 0
                                ? selectedProcess.outputs.join(", ")
                                : <span className="text-stone-400">-</span>}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 연결 시설 정보 */}
                      <div className="grid grid-cols-2 gap-4">
                        {/* 배출시설 연결 */}
                        <div className="bg-stone-50 rounded-xl p-4 border border-stone-200">
                          <h4 className="text-xs font-semibold text-stone-500 mb-3 flex items-center gap-2">
                            <Factory className="w-3.5 h-3.5" />
                            연결 배출시설
                          </h4>
                          {(selectedProcess.linkedEmissionIds || []).length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {selectedProcess.linkedEmissionIds.map((id: string) => (
                                <span key={id} className="text-xs px-2 py-1 bg-white border border-stone-200 rounded-md text-stone-600 font-mono shadow-sm">
                                  {id}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-stone-400">-</span>
                          )}
                        </div>

                        {/* 방지시설 연결 */}
                        <div className="bg-stone-50 rounded-xl p-4 border border-stone-200">
                          <h4 className="text-xs font-semibold text-stone-500 mb-3 flex items-center gap-2">
                            <Shield className="w-3.5 h-3.5" />
                            연결 방지시설
                          </h4>
                          {(selectedProcess.linkedPreventionIds || []).length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {selectedProcess.linkedPreventionIds.map((id: string) => (
                                <span key={id} className="text-xs px-2 py-1 bg-white border border-stone-200 rounded-md text-stone-600 font-mono shadow-sm">
                                  {id}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-stone-400">-</span>
                          )}
                        </div>
                      </div>

                      {/* 배출구 연결 */}
                      <div className="bg-stone-50 rounded-xl p-4 border border-stone-200">
                        <h4 className="text-xs font-semibold text-stone-500 mb-3 flex items-center gap-2">
                          <Building className="w-3.5 h-3.5" />
                          연결 배출구
                        </h4>
                        {(selectedProcess.linkedStackIds || []).length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {selectedProcess.linkedStackIds.map((id: string) => (
                              <span key={id} className="text-xs px-2 py-1 bg-white border border-stone-200 rounded-md text-stone-600 font-mono shadow-sm">
                                {id}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-stone-400">-</span>
                        )}
                      </div>

                      {/* 비고 */}
                      {selectedProcess.notes && (
                        <div className="bg-amber-50/50 rounded-xl p-4 border border-amber-100">
                          <h4 className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-2">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            참고사항
                          </h4>
                          <p className="text-xs text-stone-600 leading-relaxed">
                            {selectedProcess.notes}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    // 대분류/중분류일 경우 하위 공정 목록 표시
                    <div>
                      <h4 className="text-xs font-semibold text-stone-500 mb-3">하위 공정 목록</h4>
                      <div className="grid grid-cols-2 gap-3">
                        {processTree
                          .find((p: any) => p.code === selectedProcess.code || p.children?.some((c: any) => c.code === selectedProcess.code))
                          ?.children?.filter((c: any) => selectedProcess.level === "major" || c.parentCode === selectedProcess.code)
                          .map((child: any) => (
                            <button
                              key={child.id}
                              onClick={() => setSelectedProcessId(child.id)}
                              className="text-left p-3 rounded-lg border border-stone-200 hover:border-primary/50 hover:bg-primary/5 transition-all group"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-mono text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded group-hover:bg-white">
                                  {child.code}
                                </span>
                                <ChevronRight className="w-3 h-3 text-stone-300 group-hover:text-primary" />
                              </div>
                              <div className="text-sm font-medium text-stone-700 group-hover:text-primary">
                                {child.name}
                              </div>
                            </button>
                          )) || <div className="text-xs text-stone-400 col-span-2">하위 공정이 없습니다.</div>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-stone-400">
                <Settings className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm">좌측 목록에서 공정을 선택하세요</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <EmptyDataPlaceholder
          icon={<Settings className="w-12 h-12 text-stone-300" />}
          title="공정"
          description="통합환경관리계획서의 공정 계통도 및 단위공정 정보를 관리합니다."
        />
      )}
    </div>
  );
}

// ============================================================
// 물질 탭
// ============================================================

function SubstancesTab({ profile, editedProfile, setEditedProfile, isEditing }: {
  profile: any;
  editedProfile: any;
  setEditedProfile: (p: any) => void;
  isEditing: boolean;
}) {
  const data = isEditing ? editedProfile : profile;
  const substances = data?.substances || {};
  const chemicals = substances.chemicals || [];
  const airPollutants = substances.airPollutants || [];
  const ghgEmissions = substances.ghgEmissions || [];

  const totalCount = chemicals.length + airPollutants.length + ghgEmissions.length;

  return (
    <div className="space-y-6">
      {/* 화학물질 */}
      <div>
        <h3 className="font-semibold text-stone-700 mb-3 flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-primary" />
          유해화학물질 ({chemicals.length}개)
        </h3>
        {chemicals.length > 0 ? (
          <div className="space-y-2">
            {chemicals.map((chem: any, i: number) => (
              <div key={i} className="p-3 bg-red-50 rounded-lg border border-red-100">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-stone-700">{chem.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700">
                    {chem.classification === "toxic" ? "유독물질" : chem.classification === "cmr" ? "CMR" : chem.classification}
                  </span>
                </div>
                <div className="text-xs text-stone-500 mt-1">
                  CAS: {chem.casNumber || "-"} | 사용량: {chem.annualUsage || "-"} {chem.unit || ""}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-400">등록된 화학물질이 없습니다.</p>
        )}
      </div>

      {/* 대기오염물질 */}
      <div>
        <h3 className="font-semibold text-stone-700 mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          대기오염물질 ({airPollutants.length}개)
        </h3>
        {airPollutants.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {airPollutants.map((p: any, i: number) => (
              <div key={i} className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-stone-700">{p.name}</span>
                </div>
                <div className="text-xs text-stone-500 mt-1">
                  허가기준: {p.permitLimit || "-"} {p.permitUnit || ""} | 연간: {p.annualEmission || "-"} {p.annualUnit || ""}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-400">등록된 대기오염물질이 없습니다.</p>
        )}
      </div>

      {/* 온실가스 */}
      <div>
        <h3 className="font-semibold text-stone-700 mb-3 flex items-center gap-2">
          <Thermometer className="w-4 h-4 text-primary" />
          온실가스 배출 ({ghgEmissions.length}개)
        </h3>
        {ghgEmissions.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {ghgEmissions.map((g: any, i: number) => (
              <div key={i} className="p-3 bg-green-50 rounded-lg border border-green-100">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-stone-700">{g.gasType}</span>
                </div>
                <div className="text-xs text-stone-500 mt-1">
                  배출원: {g.source || "-"} | 배출량: {g.annualEmission?.toLocaleString() || "-"} tCO2eq
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-400">등록된 온실가스 배출 정보가 없습니다.</p>
        )}
      </div>

      {totalCount === 0 && (
        <EmptyDataPlaceholder
          icon={<FlaskConical className="w-12 h-12 text-stone-300" />}
          title="사용물질"
          description="물질수지, 연료, 원료, 화학물질, 에너지 정보를 관리합니다."
        />
      )}
    </div>
  );
}

// ============================================================
// 허가 탭
// ============================================================

function PermitsTab({ profile, editedProfile, setEditedProfile, isEditing }: {
  profile: any;
  editedProfile: any;
  setEditedProfile: (p: any) => void;
  isEditing: boolean;
}) {
  const data = isEditing ? editedProfile : profile;
  const permits = data?.permits || [];

  const PERMIT_TYPE_LABELS: Record<string, string> = {
    integrated: "통합환경허가",
    air_emission: "대기배출시설",
    water_discharge: "수질배출시설",
    waste_disposal: "폐기물처리",
    chemical_handling: "화학물질취급",
    ghg_emission: "온실가스배출권",
    other: "기타",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-stone-700 flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          인허가 현황 ({permits.length}개)
        </h3>
      </div>

      {permits.length > 0 ? (
        <div className="space-y-3">
          {permits.map((permit: any, index: number) => (
            <div key={permit.id || index} className="p-4 bg-stone-50 rounded-xl border border-stone-200">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    permit.type === "integrated" ? "bg-primary/10 text-primary" : "bg-stone-200 text-stone-600"
                  )}>
                    {PERMIT_TYPE_LABELS[permit.type] || permit.type}
                  </span>
                  <h4 className="font-medium text-stone-700 mt-1">{permit.permitNumber}</h4>
                </div>
                <span className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full",
                  permit.status === "valid" ? "bg-green-100 text-green-700" :
                  permit.status === "expired" ? "bg-red-100 text-red-700" :
                  "bg-amber-100 text-amber-700"
                )}>
                  {permit.status === "valid" ? "유효" : permit.status === "expired" ? "만료" : "갱신예정"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-stone-400">발급일:</span> <span className="text-stone-600">{permit.issuedDate || "-"}</span></div>
                <div><span className="text-stone-400">만료일:</span> <span className="text-stone-600">{permit.expiryDate || "-"}</span></div>
                {permit.conditions && permit.conditions.length > 0 && (
                  <div className="col-span-2"><span className="text-stone-400">허가조건:</span> <span className="text-stone-600">{permit.conditions.join(", ")}</span></div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyDataPlaceholder
          icon={<FileText className="w-12 h-12 text-stone-300" />}
          title="허가"
          description="통합환경허가 등 인허가 현황을 관리합니다."
        />
      )}
    </div>
  );
}

// ============================================================
// BAT 탭
// ============================================================

function BATStatusTab({ profile, editedProfile, setEditedProfile, isEditing }: {
  profile: any;
  editedProfile: any;
  setEditedProfile: (p: any) => void;
  isEditing: boolean;
}) {
  const data = isEditing ? editedProfile : profile;
  const batItems = data?.batStatus || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-stone-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          BAT 적용 현황 ({batItems.length}개)
        </h3>
      </div>

      {batItems.length > 0 ? (
        <div className="space-y-3">
          {batItems.map((item: any, index: number) => (
            <div key={item.id || index} className="p-4 bg-stone-50 rounded-xl border border-stone-200">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="text-xs text-stone-400">{item.category}</span>
                  <h4 className="font-medium text-stone-700">{item.name}</h4>
                </div>
                <span className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full",
                  item.status === "applied" ? "bg-green-100 text-green-700" :
                  item.status === "in_progress" ? "bg-blue-100 text-blue-700" :
                  item.status === "planned" ? "bg-amber-100 text-amber-700" :
                  "bg-stone-100 text-stone-600"
                )}>
                  {item.status === "applied" ? "적용완료" : item.status === "in_progress" ? "진행중" : item.status === "planned" ? "예정" : "해당없음"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-stone-400">BAT-AEL:</span> <span className="text-stone-600">{item.batAelStandard || "-"}</span></div>
                <div><span className="text-stone-400">현재수준:</span> <span className="text-stone-600">{item.currentLevel || "-"}</span></div>
                {item.investmentCost && (
                  <div><span className="text-stone-400">투자비용:</span> <span className="text-stone-600">{item.investmentCost}억원</span></div>
                )}
                {item.annualSavings && (
                  <div><span className="text-stone-400">연간절감:</span> <span className="text-stone-600">{item.annualSavings}억원</span></div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyDataPlaceholder
          icon={<CheckCircle2 className="w-12 h-12 text-stone-300" />}
          title="BAT"
          description="최적가용기법(BAT) 적용 현황을 관리합니다."
        />
      )}
    </div>
  );
}

// ============================================================
// 모니터링 탭
// ============================================================

function MonitoringTab({ profile, editedProfile, setEditedProfile, isEditing }: {
  profile: any;
  editedProfile: any;
  setEditedProfile: (p: any) => void;
  isEditing: boolean;
}) {
  const data = isEditing ? editedProfile : profile;
  const monitoring = data?.monitoring || {};
  const tmsPoints = monitoring.tmsPoints || [];
  const selfMeasurements = monitoring.selfMeasurements || [];

  return (
    <div className="space-y-6">
      {/* TMS */}
      <div>
        <h3 className="font-semibold text-stone-700 mb-3 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-primary" />
          TMS 측정지점 ({tmsPoints.length}개)
        </h3>
        {tmsPoints.length > 0 ? (
          <div className="space-y-2">
            {tmsPoints.map((point: any, i: number) => (
              <div key={i} className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-stone-700">{point.location}</span>
                  <span className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full",
                    point.status === "normal" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  )}>
                    {point.status === "normal" ? "정상" : "점검필요"}
                  </span>
                </div>
                <div className="text-xs text-stone-500 mt-1">
                  측정항목: {(point.measuredItems || []).join(", ") || "-"} | 전송주기: {point.transmissionInterval || "-"}분
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-400">등록된 TMS 측정지점이 없습니다.</p>
        )}
      </div>

      {/* 자가측정 */}
      <div>
        <h3 className="font-semibold text-stone-700 mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          자가측정 계획 ({selfMeasurements.length}개)
        </h3>
        {selfMeasurements.length > 0 ? (
          <div className="space-y-2">
            {selfMeasurements.map((m: any, i: number) => (
              <div key={i} className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-stone-700">{m.target}</span>
                  <span className="text-xs text-stone-500">{m.frequency}</span>
                </div>
                <div className="text-xs text-stone-500 mt-1">
                  측정항목: {(m.items || []).join(", ") || "-"} | 측정기관: {m.measuringAgency || "-"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-400">등록된 자가측정 계획이 없습니다.</p>
        )}
      </div>

      {tmsPoints.length === 0 && selfMeasurements.length === 0 && (
        <EmptyDataPlaceholder
          icon={<RefreshCw className="w-12 h-12 text-stone-300" />}
          title="모니터링"
          description="TMS 및 자가측정 현황을 관리합니다."
        />
      )}
    </div>
  );
}

// ============================================================
// 규제현황 탭
// ============================================================

function RegulationsTab({ profile, editedProfile, setEditedProfile, isEditing }: {
  profile: any;
  editedProfile: any;
  setEditedProfile: (p: any) => void;
  isEditing: boolean;
}) {
  const data = isEditing ? editedProfile : profile;
  const regulations = data?.regulations || {};
  const domesticLaws = regulations.domesticLaws || [];
  const internationalRegs = regulations.internationalRegulations || [];

  return (
    <div className="space-y-6">
      {/* 국내 법령 */}
      <div>
        <h3 className="font-semibold text-stone-700 mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-primary" />
          적용 법령 ({domesticLaws.length}개)
        </h3>
        {domesticLaws.length > 0 ? (
          <div className="space-y-2">
            {domesticLaws.map((law: any, i: number) => (
              <div key={i} className="p-3 bg-stone-50 rounded-lg border border-stone-200">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-stone-700">{law.name}</span>
                  <span className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full",
                    law.complianceStatus === "compliant" ? "bg-green-100 text-green-700" :
                    law.complianceStatus === "partial" ? "bg-amber-100 text-amber-700" :
                    "bg-red-100 text-red-700"
                  )}>
                    {law.complianceStatus === "compliant" ? "준수" : law.complianceStatus === "partial" ? "일부준수" : "미준수"}
                  </span>
                </div>
                <div className="text-xs text-stone-500 mt-1">
                  적용조항: {(law.articles || []).join(", ") || "-"}
                </div>
                {law.obligations && law.obligations.length > 0 && (
                  <div className="text-xs text-stone-500 mt-1">
                    의무사항: {law.obligations.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-400">등록된 적용 법령이 없습니다.</p>
        )}
      </div>

      {/* 국제 규제 */}
      <div>
        <h3 className="font-semibold text-stone-700 mb-3 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-primary" />
          국제 규제 ({internationalRegs.length}개)
        </h3>
        {internationalRegs.length > 0 ? (
          <div className="space-y-2">
            {internationalRegs.map((reg: any, i: number) => (
              <div key={i} className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-stone-700">{reg.name}</span>
                  <span className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full",
                    reg.responseStatus === "completed" ? "bg-green-100 text-green-700" :
                    reg.responseStatus === "in_progress" ? "bg-blue-100 text-blue-700" :
                    "bg-amber-100 text-amber-700"
                  )}>
                    {reg.responseStatus === "completed" ? "대응완료" : reg.responseStatus === "in_progress" ? "대응중" : "대응예정"}
                  </span>
                </div>
                <div className="text-xs text-stone-500 mt-1">{reg.relevance || "-"}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-400">등록된 국제 규제가 없습니다.</p>
        )}
      </div>

      {domesticLaws.length === 0 && internationalRegs.length === 0 && (
        <EmptyDataPlaceholder
          icon={<AlertTriangle className="w-12 h-12 text-stone-300" />}
          title="규제현황"
          description="적용 법령 및 국제 규제 현황을 관리합니다."
        />
      )}
    </div>
  );
}

// ============================================================
// RAG 설정 탭 (강화 버전)
// ============================================================

function RAGConfigTab({ profile, editedProfile, setEditedProfile, isEditing, extractionStatus, setExtractionStatus, onRefresh }: {
  profile: any;
  editedProfile: any;
  setEditedProfile: (p: any) => void;
  isEditing: boolean;
  extractionStatus: any;
  setExtractionStatus: (s: any) => void;
  onRefresh: () => void;
}) {
  const data = isEditing ? editedProfile : profile;
  const ragConfig = data?.ragConfig || {};
  const uploadedDocs = data?.uploadedDocuments || [];
  const [showExtractionPanel, setShowExtractionPanel] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState("");

  const INTEREST_SECTORS = [
    { id: "air_emission", label: "대기배출 규제" },
    { id: "water_discharge", label: "수질배출 규제" },
    { id: "waste_management", label: "폐기물 규제" },
    { id: "chemical_safety", label: "화학물질 규제" },
    { id: "climate_ghg", label: "기후/온실가스" },
    { id: "bat_technology", label: "BAT 동향" },
    { id: "emission_trading", label: "배출권거래" },
    { id: "international_eu", label: "EU 환경규제" },
    { id: "international_us", label: "미국 환경규제" },
    { id: "energy_efficiency", label: "에너지 효율" },
  ];


  // LLM 추출 실행
  const runExtraction = async () => {
    if (!profile?.id) return;
    
    setExtracting(true);
    setExtractProgress("LLM 정보 추출을 시작합니다...");
    
    try {
      const res = await fetch("/api/rag/profiles/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          mode: "all",
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        setExtractProgress(`추출 완료! ${data.extractedTabs?.length || 0}개 탭 업데이트됨`);
        setTimeout(() => {
          onRefresh();
          setExtracting(false);
          setExtractProgress("");
        }, 1500);
      } else {
        setExtractProgress(`추출 실패: ${data.error}`);
        setExtracting(false);
      }
    } catch (err: any) {
      setExtractProgress(`오류: ${err.message}`);
      setExtracting(false);
    }
  };

  const toggleSector = (sectorId: string) => {
    if (!isEditing || !editedProfile) return;
    const currentSectors = editedProfile.ragConfig?.prioritySectors || [];
    const newSectors = currentSectors.includes(sectorId)
      ? currentSectors.filter((s: string) => s !== sectorId)
      : [...currentSectors, sectorId];
    setEditedProfile({
      ...editedProfile,
      ragConfig: {
        ...editedProfile.ragConfig,
        prioritySectors: newSectors,
      },
    });
  };

  const updateWeight = (field: string, value: number) => {
    if (!isEditing || !editedProfile) return;
    setEditedProfile({
      ...editedProfile,
      ragConfig: {
        ...editedProfile.ragConfig,
        issueWeights: {
          ...editedProfile.ragConfig?.issueWeights,
          [field]: value,
        },
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* 문서 추출 상태 패널 */}
      <div className="p-4 bg-gradient-to-r from-primary/5 to-blue-50 rounded-xl border border-primary/20">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-stone-700 flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            데이터 추출 상태
          </h3>
          <button
            onClick={() => setShowExtractionPanel(!showExtractionPanel)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            {showExtractionPanel ? "접기" : "상세보기"}
            {showExtractionPanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* 요약 상태 */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="p-2 bg-white rounded-lg text-center">
            <div className="text-lg font-bold text-stone-700">{uploadedDocs.length}</div>
            <div className="text-[10px] text-stone-500">업로드 문서</div>
          </div>
          <div className="p-2 bg-white rounded-lg text-center">
            <div className="text-lg font-bold text-green-600">
              {uploadedDocs.filter((d: any) => d.extractionStatus === "completed").length}
            </div>
            <div className="text-[10px] text-stone-500">추출 완료</div>
          </div>
        </div>

        {/* 상세 패널 */}
        {showExtractionPanel && (
          <div className="space-y-3 pt-3 border-t border-primary/10">
            {/* 업로드 문서 목록 */}
            <div>
              <h4 className="text-xs font-medium text-stone-600 mb-2">업로드 문서</h4>
              {uploadedDocs.length > 0 ? (
                <div className="space-y-1.5">
                  {uploadedDocs.map((doc: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-white rounded-lg text-xs">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-stone-400" />
                        <span className="text-stone-700 truncate max-w-[200px]">{doc.originalName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[10px]",
                          doc.extractionStatus === "completed" ? "bg-green-100 text-green-700" :
                          doc.extractionStatus === "failed" ? "bg-red-100 text-red-700" :
                          "bg-amber-100 text-amber-700"
                        )}>
                          {doc.extractionStatus === "completed" ? "완료" : doc.extractionStatus === "failed" ? "실패" : "대기"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-stone-400">업로드된 문서가 없습니다.</p>
              )}
            </div>

            {/* 추출 실행 버튼 */}
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={runExtraction}
                disabled={extracting || uploadedDocs.length === 0}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
                  extracting || uploadedDocs.length === 0
                    ? "bg-stone-200 text-stone-400 cursor-not-allowed"
                    : "bg-primary text-white hover:bg-primary/90"
                )}
              >
                {extracting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Brain className="w-3 h-3" />
                )}
                LLM 정보 추출 실행
              </button>
              {extractProgress && (
                <span className="text-xs text-primary">{extractProgress}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 우선 모니터링 분야 */}
      <div>
        <h3 className="font-semibold text-stone-700 mb-3 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          우선 모니터링 분야
        </h3>
        <div className="flex flex-wrap gap-2">
          {INTEREST_SECTORS.map((sector) => {
            const isSelected = (ragConfig.prioritySectors || []).includes(sector.id);
            return (
              <button
                key={sector.id}
                onClick={() => toggleSector(sector.id)}
                disabled={!isEditing}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  isSelected ? "bg-primary text-white" : "bg-stone-100 text-stone-600",
                  isEditing ? "cursor-pointer hover:opacity-80" : "cursor-default"
                )}
              >
                {sector.label}
              </button>
            );
          })}
        </div>
      </div>
      
      {/* 우선 키워드 */}
      <div>
        <h3 className="font-semibold text-stone-700 mb-3">우선 키워드</h3>
        <div className="flex flex-wrap gap-2">
          {(ragConfig.priorityKeywords || []).length > 0 ? (
            ragConfig.priorityKeywords.map((kw: string, i: number) => (
              <span key={i} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-700">
                {kw}
              </span>
            ))
          ) : (
            <p className="text-xs text-stone-400">등록된 키워드가 없습니다.</p>
          )}
        </div>
        {isEditing && (
          <input
            type="text"
            placeholder="새 키워드 입력 후 Enter..."
            className="mt-2 w-full px-3 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.currentTarget.value.trim()) {
                const newKeyword = e.currentTarget.value.trim();
                const currentKeywords = editedProfile?.ragConfig?.priorityKeywords || [];
                if (!currentKeywords.includes(newKeyword)) {
                  setEditedProfile({
                    ...editedProfile,
                    ragConfig: {
                      ...editedProfile.ragConfig,
                      priorityKeywords: [...currentKeywords, newKeyword],
                    },
                  });
                }
                e.currentTarget.value = "";
              }
            }}
          />
        )}
      </div>
      
      {/* 이슈 발굴 가중치 */}
      <div>
        <h3 className="font-semibold text-stone-700 mb-3">이슈 발굴 가중치</h3>
        <div className="space-y-3">
          <EditableWeightSlider
            label="법적 강제성"
            value={ragConfig.issueWeights?.legalMandatory || 80}
            isEditing={isEditing}
            onChange={(v) => updateWeight("legalMandatory", v)}
          />
          <EditableWeightSlider
            label="신규성"
            value={ragConfig.issueWeights?.novelty || 60}
            isEditing={isEditing}
            onChange={(v) => updateWeight("novelty", v)}
          />
          <EditableWeightSlider
            label="파급력"
            value={ragConfig.issueWeights?.impact || 90}
            isEditing={isEditing}
            onChange={(v) => updateWeight("impact", v)}
          />
          <EditableWeightSlider
            label="국제 연관성"
            value={ragConfig.issueWeights?.international || 70}
            isEditing={isEditing}
            onChange={(v) => updateWeight("international", v)}
          />
        </div>
      </div>
      
      {/* 맞춤 프롬프트 */}
      <div>
        <h3 className="font-semibold text-stone-700 mb-3">맞춤 LLM 프롬프트</h3>
        <textarea
          value={isEditing ? (editedProfile?.ragConfig?.customPrompt || "") : (ragConfig.customPrompt || "")}
          onChange={(e) => {
            if (isEditing && editedProfile) {
              setEditedProfile({
                ...editedProfile,
                ragConfig: {
                  ...editedProfile.ragConfig,
                  customPrompt: e.target.value,
                },
              });
            }
          }}
          readOnly={!isEditing}
          placeholder="이 사업장 분석 시 LLM에게 전달할 추가 지침을 입력하세요..."
          className={cn(
            "w-full p-3 text-sm border border-stone-200 rounded-lg min-h-[100px]",
            isEditing ? "bg-white focus:outline-none focus:ring-2 focus:ring-primary/30" : "bg-stone-50"
          )}
        />
      </div>

    </div>
  );
}

// ============================================================
// 유틸리티 컴포넌트
// ============================================================

// 편집 가능한 필드
function EditableField({ label, value, isEditing, onChange, type = "text", suffix, icon, placeholder }: {
  label: string;
  value: string;
  isEditing: boolean;
  onChange?: (v: string) => void;
  type?: "text" | "number" | "date" | "email";
  suffix?: string;
  icon?: React.ReactNode;
  placeholder?: string;
}) {
  return (
    <div>
      <span className="text-xs text-stone-500">{label}</span>
      {isEditing && onChange ? (
        <div className="flex items-center gap-1 mt-0.5">
          {icon}
          <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 px-2 py-1 text-sm border border-stone-200 rounded focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {suffix && <span className="text-xs text-stone-500">{suffix}</span>}
        </div>
      ) : (
        <p className="text-sm text-stone-700 flex items-center gap-1 mt-0.5">
          {icon}
          {value || "-"}{suffix && value ? ` ${suffix}` : ""}
        </p>
      )}
    </div>
  );
}

// 편집 가능한 가중치 슬라이더
function EditableWeightSlider({ label, value, isEditing, onChange }: {
  label: string;
  value: number;
  isEditing: boolean;
  onChange?: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-stone-600 w-24">{label}</span>
      {isEditing && onChange ? (
        <input
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="flex-1 h-2 accent-primary"
        />
      ) : (
        <div className="flex-1 h-2 bg-stone-200 rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${value}%` }}
          />
        </div>
      )}
      <span className="text-xs text-stone-500 w-12 text-right">{value}%</span>
    </div>
  );
}

// 빈 데이터 플레이스홀더
function EmptyDataPlaceholder({ icon, title, description }: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon}
      <p className="font-semibold text-stone-500 mt-4">{title}</p>
      <p className="text-sm text-stone-400 mt-1">{description}</p>
      <p className="text-xs text-stone-400 mt-4">
        문서를 업로드하거나 수동 입력 버튼을 눌러 정보를 추가하세요.
      </p>
    </div>
  );
}

// 요약 카드 컴포넌트
function SummaryCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="p-3 bg-stone-50 rounded-xl text-center">
      <p className="text-2xl font-bold text-stone-700">{value}</p>
      <p className="text-xs text-stone-500 mt-0.5">{label} ({unit})</p>
    </div>
  );
}
