/**
 * 개별 프로파일 API
 * 
 * GET: 프로파일 상세 조회
 * PUT: 프로파일 업데이트
 * DELETE: 프로파일 삭제
 */

import { NextRequest, NextResponse } from "next/server";
import {
  loadProfile,
  saveProfile,
  deleteProfile,
  SiteProfile,
} from "@/lib/rag/site-profile";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const profile = loadProfile(id);
    
    if (!profile) {
      return NextResponse.json(
        { success: false, error: "프로파일을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      profile,
    });
  } catch (error: any) {
    console.error("[Profile] GET error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const profile = loadProfile(id);
    
    if (!profile) {
      return NextResponse.json(
        { success: false, error: "프로파일을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    
    const body = await request.json();
    
    // 기본 필드 업데이트
    if (body.name !== undefined) profile.name = body.name;
    if (body.code !== undefined) profile.code = body.code;
    if (body.industryCategory !== undefined) profile.industryCategory = body.industryCategory;
    
    // 탭 1: 개요
    if (body.overview) {
      if (body.overview.basicInfo) {
        profile.overview.basicInfo = { 
          ...profile.overview.basicInfo, 
          ...body.overview.basicInfo 
        };
        if (body.overview.basicInfo.location) {
          profile.overview.basicInfo.location = {
            ...profile.overview.basicInfo.location,
            ...body.overview.basicInfo.location
          };
        }
      }
      if (body.overview.facilitySummary) {
        profile.overview.facilitySummary = {
          ...profile.overview.facilitySummary,
          ...body.overview.facilitySummary
        };
      }
      if (body.overview.appliedRegimes) {
        profile.overview.appliedRegimes = body.overview.appliedRegimes;
      }
      if (body.overview.certifications) {
        profile.overview.certifications = body.overview.certifications;
      }
    }
    
    // 탭 2: 배출시설
    if (body.emissionFacilities !== undefined) {
      profile.emissionFacilities = body.emissionFacilities;
    }
    
    // 탭 3: 방지시설
    if (body.preventionFacilities !== undefined) {
      profile.preventionFacilities = body.preventionFacilities;
    }
    
    // 탭 4: 굴뚝
    if (body.stacks !== undefined) {
      profile.stacks = body.stacks;
    }
    
    // 탭 5: 공정
    if (body.processes !== undefined) {
      profile.processes = body.processes;
    }
    
    // 탭 6: 물질
    if (body.substances) {
      profile.substances = {
        ...profile.substances,
        ...body.substances
      };
    }
    
    // 탭 7: 허가
    if (body.permits !== undefined) {
      profile.permits = body.permits;
    }
    
    // 탭 8: BAT
    if (body.batStatus !== undefined) {
      profile.batStatus = body.batStatus;
    }
    
    // 탭 9: 모니터링
    if (body.monitoring) {
      profile.monitoring = {
        ...profile.monitoring,
        ...body.monitoring
      };
    }
    
    // 탭 10: 규제현황
    if (body.regulations) {
      profile.regulations = {
        ...profile.regulations,
        ...body.regulations
      };
    }
    
    // 탭 11: RAG 설정
    if (body.ragConfig) {
      profile.ragConfig = {
        ...profile.ragConfig,
        ...body.ragConfig
      };
    }
    
    // 업로드 문서
    if (body.uploadedDocuments !== undefined) {
      profile.uploadedDocuments = body.uploadedDocuments;
    }
    
    saveProfile(profile);
    
    return NextResponse.json({
      success: true,
      profile,
    });
  } catch (error: any) {
    console.error("[Profile] PUT error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = deleteProfile(id);
    
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "프로파일을 찾을 수 없거나 삭제에 실패했습니다." },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: "프로파일이 삭제되었습니다.",
    });
  } catch (error: any) {
    console.error("[Profile] DELETE error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
