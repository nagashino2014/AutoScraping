/**
 * 사업장 프로파일 API
 * 
 * GET: 프로파일 목록 조회
 * POST: 프로파일 생성
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listProfiles,
  createProfile,
  countProfilesByIndustry,
  IndustryCategory,
} from "@/lib/rag/site-profile";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const industryCategory = searchParams.get("industry") as IndustryCategory | null;
    
    let profiles = listProfiles();
    
    // 업종 필터
    if (industryCategory) {
      profiles = profiles.filter(p => p.industryCategory === industryCategory);
    }
    
    // 업종별 카운트
    const industryCounts = countProfilesByIndustry();
    
    return NextResponse.json({
      success: true,
      profiles,
      count: profiles.length,
      industryCounts,
    });
  } catch (error: any) {
    console.error("[Profiles] GET error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, industryCategory, basicInfo } = body;
    
    if (!name) {
      return NextResponse.json(
        { success: false, error: "사업장명이 필요합니다." },
        { status: 400 }
      );
    }
    
    if (!industryCategory) {
      return NextResponse.json(
        { success: false, error: "업종이 필요합니다." },
        { status: 400 }
      );
    }
    
    // 새 프로파일 생성
    const profile = createProfile(
      name,
      industryCategory as IndustryCategory,
      basicInfo ? {
        name: basicInfo.name || name,
        industryCategory: industryCategory as IndustryCategory,
        scale: basicInfo.scale || "medium",
        employees: basicInfo.employees || 0,
        location: {
          address: basicInfo.location?.address || "",
          region: basicInfo.location?.region || "",
          district: basicInfo.location?.district || "",
        },
        establishment: basicInfo.establishment || "",
        businessNumber: basicInfo.businessNumber,
      } : undefined
    );
    
    return NextResponse.json({
      success: true,
      profile,
    });
  } catch (error: any) {
    console.error("[Profiles] POST error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
