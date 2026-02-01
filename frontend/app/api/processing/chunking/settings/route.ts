import { NextRequest, NextResponse } from "next/server";
import {
  getChunkingSettings,
  updateChunkingSettings,
  ChunkingSettings,
} from "@/lib/chunking/chunking-store";

// GET: 청킹 설정 조회
export async function GET() {
  try {
    const settings = getChunkingSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error("Error getting chunking settings:", error);
    return NextResponse.json(
      { success: false, error: "설정을 불러오는데 실패했습니다." },
      { status: 500 }
    );
  }
}

// PUT: 청킹 설정 업데이트
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const settings = body as Partial<ChunkingSettings>;
    
    // 유효성 검사
    if (settings.chunkSize !== undefined) {
      if (settings.chunkSize < 100 || settings.chunkSize > 4000) {
        return NextResponse.json(
          { success: false, error: "청크 크기는 100-4000 사이여야 합니다." },
          { status: 400 }
        );
      }
    }
    
    if (settings.chunkOverlap !== undefined) {
      if (settings.chunkOverlap < 0 || settings.chunkOverlap > 1000) {
        return NextResponse.json(
          { success: false, error: "오버랩은 0-1000 사이여야 합니다." },
          { status: 400 }
        );
      }
    }
    
    const updated = updateChunkingSettings(settings);
    
    return NextResponse.json({ success: true, settings: updated });
  } catch (error) {
    console.error("Error updating chunking settings:", error);
    return NextResponse.json(
      { success: false, error: "설정을 저장하는데 실패했습니다." },
      { status: 500 }
    );
  }
}
