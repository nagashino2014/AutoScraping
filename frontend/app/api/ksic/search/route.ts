/**
 * KSIC (한국표준산업분류코드) 검색 API
 * 
 * GET: 코드 또는 명칭으로 검색
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

interface KSICItem {
  code: string;
  name: string;
  level: number;
  fullPath?: string;
}

// KSIC 데이터 캐시
let ksicData: KSICItem[] | null = null;

function loadKSICData(): KSICItem[] {
  if (ksicData) return ksicData;
  
  const filePath = path.join(process.cwd(), "public", "KSIC", "ksic-11th.json");
  
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    ksicData = JSON.parse(data);
    return ksicData || [];
  } catch (error) {
    console.error("Failed to load KSIC data:", error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const keyword = searchParams.get("keyword");
    const level = searchParams.get("level");
    
    const data = loadKSICData();
    
    // 코드로 정확히 검색
    if (code) {
      const item = data.find((d) => d.code === code);
      
      if (item) {
        return NextResponse.json({
          success: true,
          item,
        });
      } else {
        return NextResponse.json({
          success: false,
          error: "해당 코드를 찾을 수 없습니다.",
        });
      }
    }
    
    // 키워드로 검색
    if (keyword && keyword.length >= 2) {
      let results = data;
      
      // 레벨 필터링 (5 = 세세분류, 5자리 코드만)
      if (level) {
        const levelNum = parseInt(level);
        results = results.filter((d) => d.level === levelNum);
      } else {
        // 기본적으로 5자리 코드만 검색
        results = results.filter((d) => d.level === 5);
      }
      
      // 코드 또는 명칭으로 검색
      const lowerKeyword = keyword.toLowerCase();
      results = results.filter((d) => 
        d.code.includes(keyword) || 
        d.name.toLowerCase().includes(lowerKeyword) ||
        (d.fullPath && d.fullPath.toLowerCase().includes(lowerKeyword))
      );
      
      // 최대 50개 반환
      results = results.slice(0, 50);
      
      return NextResponse.json({
        success: true,
        total: results.length,
        items: results,
      });
    }
    
    return NextResponse.json({
      success: false,
      error: "code 또는 keyword 파라미터가 필요합니다.",
    });
    
  } catch (error: any) {
    console.error("[KSICSearch] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
