/**
 * 도로명 주소 검색 API
 * 
 * SQLite DB 기반 고속 검색
 * GET: 키워드로 도로명 주소 검색
 */

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import Database from "better-sqlite3";

// SQLite DB 경로
const DB_PATH = path.join(process.cwd(), "data", "zipcode.db");

// DB 연결 (싱글턴)
let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
  }
  return db;
}

interface AddressResult {
  roadAddress: string;
  roadAddressPart1: string;
  jibunAddress: string;
  zipNo: string;
  sido: string;
  sigungu: string;
  eubmyeondong: string;
  buildingName: string;
}

/**
 * 도로명 주소 조합
 */
function buildRoadAddress(row: any): string {
  let addr = row.sido;
  if (row.sigungu) addr += ` ${row.sigungu}`;
  if (row.eupmyeon) addr += ` ${row.eupmyeon}`;
  if (row.road_name) {
    addr += ` ${row.road_name}`;
    if (row.is_underground) addr += " 지하";
    if (row.building_num_main && row.building_num_main !== "0") {
      addr += ` ${row.building_num_main}`;
      if (row.building_num_sub && row.building_num_sub !== "0") {
        addr += `-${row.building_num_sub}`;
      }
    }
  }
  return addr;
}

/**
 * 지번 주소 조합
 */
function buildJibunAddress(row: any): string {
  let addr = row.sido;
  if (row.sigungu) addr += ` ${row.sigungu}`;
  if (row.eupmyeon) addr += ` ${row.eupmyeon}`;
  if (row.dong_name) addr += ` ${row.dong_name}`;
  if (row.ri_name) addr += ` ${row.ri_name}`;
  if (row.is_mountain) addr += " 산";
  if (row.jibun_main && row.jibun_main !== "0") {
    addr += ` ${row.jibun_main}`;
    if (row.jibun_sub && row.jibun_sub !== "0") {
      addr += `-${row.jibun_sub}`;
    }
  }
  return addr;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get("keyword");

    if (!keyword || keyword.length < 2) {
      return NextResponse.json({
        success: false,
        error: "검색어는 2자 이상 입력해주세요.",
      });
    }

    const database = getDb();
    const keywordParts = keyword.trim().split(/\s+/).filter(p => p.length > 0);
    
    let rows: any[] = [];

    // 키워드 파싱: 도로명 + 건물번호 분리
    let roadNameKeyword = keywordParts[0];
    let buildingNumKeyword: string | null = null;

    if (keywordParts.length >= 2) {
      // 두 번째 파트가 숫자로 시작하면 건물번호로 간주
      if (/^\d/.test(keywordParts[1])) {
        buildingNumKeyword = keywordParts[1].split("-")[0]; // "278-1" -> "278"
      } else {
        // 두 번째 파트도 도로명의 일부일 수 있음
        roadNameKeyword = keywordParts.slice(0, 2).join(" ");
      }
    }

    // SQL 쿼리 구성
    if (buildingNumKeyword) {
      // 도로명 + 건물번호 검색
      const stmt = database.prepare(`
        SELECT * FROM addresses 
        WHERE road_name LIKE ? AND building_num_main = ?
        LIMIT 50
      `);
      rows = stmt.all(`%${roadNameKeyword}%`, buildingNumKeyword);
    }

    // 결과가 없으면 도로명만으로 검색
    if (rows.length === 0) {
      const stmt = database.prepare(`
        SELECT * FROM addresses 
        WHERE road_name LIKE ?
        LIMIT 50
      `);
      rows = stmt.all(`%${roadNameKeyword}%`);
    }

    // 결과가 없으면 FTS 검색 시도
    if (rows.length === 0) {
      try {
        const ftsKeyword = keywordParts.join(" ");
        const ftsStmt = database.prepare(`
          SELECT a.* FROM addresses a
          JOIN addresses_fts fts ON a.id = fts.rowid
          WHERE addresses_fts MATCH ?
          LIMIT 50
        `);
        rows = ftsStmt.all(ftsKeyword);
      } catch (ftsError) {
        // FTS 검색 실패 시 무시
        console.warn("FTS search failed:", ftsError);
      }
    }

    // 결과 가공
    const addresses: AddressResult[] = rows.map(row => ({
      roadAddress: buildRoadAddress(row),
      roadAddressPart1: buildRoadAddress(row),
      jibunAddress: buildJibunAddress(row),
      zipNo: row.zip_code,
      sido: row.sido,
      sigungu: row.sigungu || "",
      eubmyeondong: row.dong_name || row.eupmyeon || "",
      buildingName: row.building_name || "",
    }));

    // 중복 제거
    const uniqueMap = new Map<string, AddressResult>();
    for (const addr of addresses) {
      const key = `${addr.zipNo}-${addr.roadAddress}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, addr);
      }
    }

    return NextResponse.json({
      success: true,
      addresses: Array.from(uniqueMap.values()),
      totalCount: uniqueMap.size,
    });
  } catch (error: any) {
    console.error("[AddressSearch] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
