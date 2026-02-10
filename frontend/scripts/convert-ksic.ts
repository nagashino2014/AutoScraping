/**
 * KSIC (한국표준산업분류코드) 엑셀 파일을 JSON으로 변환
 */

import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

interface KSICItem {
  code: string;
  name: string;
  level: number;  // 1: 대분류, 2: 중분류, 3: 소분류, 4: 세분류, 5: 세세분류
  fullPath?: string;  // 전체 분류 경로 (대분류 > 중분류 > ...)
}

async function convertKSIC() {
  const inputPath = path.join(process.cwd(), "public", "KSIC", "한국표준 산업분류코드표 - 11차.xlsx");
  const outputPath = path.join(process.cwd(), "public", "KSIC", "ksic-11th.json");
  
  console.log("Reading Excel file:", inputPath);
  
  const workbook = XLSX.readFile(inputPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // 시트를 JSON으로 변환
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
  
  console.log("Total rows:", rawData.length);
  console.log("Rows 5-10:", rawData.slice(5, 15));
  
  const ksicItems: KSICItem[] = [];
  const codeMap = new Map<string, string>();  // 코드 -> 이름 매핑
  
  // 데이터 시작 행 찾기 (헤더 이후)
  let startRow = 5;
  
  for (let i = startRow; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length < 23) continue;
    
    // 엑셀 구조 분석 (표준산업분류 11차 기준):
    // index 13: 표준산업분류 코드 (5자리)
    // index 14: 대분류 코드 (A, B, C...)
    // index 15: 대분류명
    // index 16: 중분류 코드 (2자리)
    // index 17: 중분류명
    // index 18: 소분류 코드 (3자리)
    // index 19: 소분류명
    // index 20: 세분류 코드 (4자리)
    // index 21: 세분류명
    // index 22: 세세분류명
    
    const ksicCode = String(row[13] || "").trim();
    
    // 대분류
    const majorCode = String(row[14] || "").trim();
    const majorName = String(row[15] || "").trim();
    // 중분류
    const midCode = String(row[16] || "").trim();
    const midName = String(row[17] || "").trim();
    // 소분류
    const minorCode = String(row[18] || "").trim();
    const minorName = String(row[19] || "").trim();
    // 세분류
    const subCode = String(row[20] || "").trim();
    const subName = String(row[21] || "").trim();
    // 세세분류
    const detailName = String(row[22] || "").trim();
    
    // 5자리 코드가 있는 경우만 처리
    if (ksicCode && ksicCode.length === 5 && /^\d{5}$/.test(ksicCode)) {
      // 분류명 경로 구성
      const pathParts = [];
      if (majorName) pathParts.push(majorName);
      if (midName) pathParts.push(midName);
      if (minorName) pathParts.push(minorName);
      if (subName) pathParts.push(subName);
      
      const fullPath = pathParts.join(" > ");
      // 세세분류명 사용, 없으면 세분류명 사용
      const name = detailName || subName || minorName || "";
      
      if (name && !codeMap.has(ksicCode)) {
        codeMap.set(ksicCode, name);
        ksicItems.push({
          code: ksicCode,
          name: name,
          level: 5,
          fullPath: fullPath,
        });
      }
    }
    
    // 상위 분류도 별도로 추가 (중복 제거)
    if (majorCode && majorName && !codeMap.has(majorCode)) {
      codeMap.set(majorCode, majorName);
      ksicItems.push({ code: majorCode, name: majorName, level: 1 });
    }
    if (midCode && midName && !codeMap.has(midCode)) {
      codeMap.set(midCode, midName);
      ksicItems.push({ code: midCode, name: midName, level: 2, fullPath: majorName });
    }
    if (minorCode && minorName && !codeMap.has(minorCode)) {
      codeMap.set(minorCode, minorName);
      ksicItems.push({ code: minorCode, name: minorName, level: 3, fullPath: `${majorName} > ${midName}` });
    }
    if (subCode && subName && !codeMap.has(subCode)) {
      codeMap.set(subCode, subName);
      ksicItems.push({ code: subCode, name: subName, level: 4, fullPath: `${majorName} > ${midName} > ${minorName}` });
    }
  }
  
  // 코드순 정렬
  ksicItems.sort((a, b) => a.code.localeCompare(b.code));
  
  console.log("Parsed items:", ksicItems.length);
  console.log("Sample 5-digit codes:", ksicItems.filter(i => i.level === 5).slice(0, 10));
  
  // JSON 파일로 저장
  fs.writeFileSync(outputPath, JSON.stringify(ksicItems, null, 2), "utf-8");
  console.log("Saved to:", outputPath);
}

convertKSIC().catch(console.error);
