/**
 * 이슈 발굴 세션 관리 API
 * 
 * GET: 세션 목록 조회
 * POST: 세션 생성 (발굴 없이)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listSessions,
  createSession,
  DEFAULT_DISCOVERY_CONFIG,
} from "@/lib/rag/discovery-store";

export async function GET() {
  try {
    const sessions = listSessions();
    
    return NextResponse.json({
      success: true,
      sessions,
      count: sessions.length,
    });
  } catch (error: any) {
    console.error("Failed to list sessions:", error);
    return NextResponse.json(
      { success: false, error: error.message, sessions: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, filter, config } = body;
    
    const session = createSession(
      name || `세션 ${new Date().toLocaleString("ko-KR")}`,
      filter || {},
      { ...DEFAULT_DISCOVERY_CONFIG, ...config }
    );
    
    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        name: session.name,
        status: session.status,
        createdAt: session.createdAt,
      },
    });
  } catch (error: any) {
    console.error("Failed to create session:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
