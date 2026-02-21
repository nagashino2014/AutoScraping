import { NextResponse } from "next/server";
import { readScraperTargets } from "@/lib/scraper/targets-store";
import path from "node:path";
import fs from "node:fs";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// HTML 엔티티 디코딩
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// HTML 태그 제거하고 텍스트만 추출
function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// 테이블 행에서 셀 데이터 추출
function extractTableRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const rowMatches = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  
  for (const row of rowMatches) {
    const cells: string[] = [];
    const cellMatches = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
    for (const cell of cellMatches) {
      cells.push(stripTags(cell));
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  return rows;
}

// API 상세 정보 타입
interface ApiEndpointInfo {
  title: string;
  category?: string;
  request_url?: string;
  request_params: { name: string; type: string; required: string; description: string }[];
  response_fields: { name: string; type: string; description: string }[];
  detail_url?: string;
  raw_content?: string;
}

// Open Law 세부 페이지에서 구조화된 API 정보 추출
function parseOpenLawDetailPage(html: string, title: string): ApiEndpointInfo {
  const info: ApiEndpointInfo = {
    title,
    request_params: [],
    response_fields: []
  };

  // 1. 요청 URL 추출
  const urlPatterns = [
    /요청\s*URL[^<]*<[^>]*>\s*([^<]+)/i,
    /요청URL[:\s]*([^\s<]+)/i,
    /(https?:\/\/www\.law\.go\.kr\/DRF\/[^\s<"']+)/i,
    /(http:\/\/www\.law\.go\.kr\/[^\s<"']+\.do[^\s<"']*)/i
  ];
  for (const pattern of urlPatterns) {
    const match = html.match(pattern);
    if (match) {
      const extracted = stripTags(match[1] || match[0]).trim();
      if (extracted.startsWith("http")) {
        info.request_url = extracted;
        break;
      }
    }
  }

  // 2. 요청 변수 테이블 파싱
  // 테이블 구조: 요청변수명 | 타입 | 필수여부 | 설명
  const reqSectionPatterns = [
    /요청\s*변수[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i,
    /입력\s*파라미터[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i,
    /<table[^>]*class="[^"]*param[^"]*"[^>]*>([\s\S]*?)<\/table>/i
  ];
  
  for (const pattern of reqSectionPatterns) {
    const reqParamSection = html.match(pattern);
    if (reqParamSection) {
      const rows = extractTableRows(reqParamSection[1]);
      // 헤더 행 감지
      let headerIdx = -1;
      for (let i = 0; i < Math.min(3, rows.length); i++) {
        if (rows[i].some(c => /요청변수|파라미터|변수명|항목명/i.test(c))) {
          headerIdx = i;
          break;
        }
      }
      
      const startIdx = headerIdx >= 0 ? headerIdx + 1 : 0;
      for (let i = startIdx; i < rows.length; i++) {
        const r = rows[i];
        if (r.length >= 2 && r[0] && !r[0].includes("요청변수")) {
          info.request_params.push({
            name: r[0].trim(),
            type: r[1]?.trim() || "string",
            required: r[2]?.trim() || "N",
            description: r.slice(3).join(" ").trim() || r[1]?.trim() || ""
          });
        }
      }
      if (info.request_params.length > 0) break;
    }
  }

  // 3. 출력 결과 테이블 파싱
  const resSectionPatterns = [
    /출력\s*결과[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i,
    /응답\s*필드[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i,
    /출력\s*항목[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i
  ];
  
  for (const pattern of resSectionPatterns) {
    const resFieldSection = html.match(pattern);
    if (resFieldSection) {
      const rows = extractTableRows(resFieldSection[1]);
      let headerIdx = -1;
      for (let i = 0; i < Math.min(3, rows.length); i++) {
        if (rows[i].some(c => /출력결과|필드|항목명|출력항목/i.test(c))) {
          headerIdx = i;
          break;
        }
      }
      
      const startIdx = headerIdx >= 0 ? headerIdx + 1 : 0;
      for (let i = startIdx; i < rows.length; i++) {
        const r = rows[i];
        if (r.length >= 2 && r[0] && !r[0].includes("출력결과") && !r[0].includes("필드명")) {
          info.response_fields.push({
            name: r[0].trim(),
            type: r[1]?.trim() || "string",
            description: r.slice(2).join(" ").trim() || ""
          });
        }
      }
      if (info.response_fields.length > 0) break;
    }
  }

  // 4. Raw content (LLM 분석용 백업)
  info.raw_content = stripTags(html).substring(0, 30000);

  return info;
}

// Open Law guideList 페이지에서 API 목록과 htmlName 추출
function extractOpenLawApiList(listHtml: string): { name: string; htmlName: string; category: string }[] {
  const apiList: { name: string; htmlName: string; category: string }[] = [];
  const seen = new Set<string>();
  
  // 실제 함수명은 openApiGuide (goGuideView가 아님!)
  // 패턴: onclick="javascript:openApiGuide('lsEfYdListGuide')"
  const patterns = [
    /openApiGuide\('([^']+)'\)/g,
    /openApiGuide\("([^"]+)"\)/g,
    /openApiGuide\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(listHtml)) !== null) {
      const htmlName = match[1].trim();
      if (htmlName && !seen.has(htmlName)) {
        seen.add(htmlName);
        console.log(`[Extract] Found htmlName: ${htmlName}`);
      }
    }
  }
  
  console.log(`[Extract] Total unique htmlNames found: ${seen.size}`);
  
  // htmlName들로부터 API 이름 추출
  for (const htmlName of seen) {
    const escapedName = htmlName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // <a> 태그에서 API 이름 추출
    // 패턴: <a href="#" onclick="javascript:openApiGuide('lsEfYdListGuide')">현행법령(시행일) 목록 조회<br />(국가법령정보센터 기준)</a>
    const linkPattern = new RegExp(
      `<a[^>]*openApiGuide\\(['"]${escapedName}['"]\\)[^>]*>([\\s\\S]*?)</a>`,
      'i'
    );
    const linkMatch = listHtml.match(linkPattern);
    
    let apiName = htmlName;
    if (linkMatch && linkMatch[1]) {
      // <br /> 태그를 공백으로 변환하고 태그 제거
      apiName = stripTags(linkMatch[1].replace(/<br\s*\/?>/gi, ' ')).trim();
    }
    
    // 카테고리 추출 (테이블 행에서 rowspan이 있는 첫 번째 td)
    let category = "기타";
    
    // 해당 htmlName이 포함된 행의 상위 행들을 찾아 카테고리 추출
    const tableBody = listHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    if (tableBody) {
      const rows = tableBody[1].split(/<\/tr>/i);
      let currentCategory = "기타";
      let currentSubCategory = "";
      
      for (const row of rows) {
        // rowspan이 있는 td에서 카테고리 추출
        const categoryMatch = row.match(/<td[^>]*rowspan[^>]*>([^<]+)/i);
        if (categoryMatch) {
          const cat = stripTags(categoryMatch[1]).trim();
          if (cat && cat.length < 30) {
            // 첫 번째 rowspan은 대분류, 두 번째는 소분류
            if (!currentSubCategory || row.indexOf(categoryMatch[0]) < row.indexOf(currentSubCategory)) {
              currentCategory = cat;
            } else {
              currentSubCategory = cat;
            }
          }
        }
        
        // 이 행에 현재 htmlName이 있는지 확인
        if (row.includes(htmlName)) {
          category = currentSubCategory || currentCategory;
          break;
        }
      }
    }
    
    apiList.push({
      name: apiName,
      htmlName: htmlName, // .html 확장자 없이 저장 (guideResult.do에서 자동 처리)
      category
    });
  }

  console.log(`[Extract] Found ${apiList.length} APIs from list page`);
  return apiList;
}

// 파일에서 텍스트 추출
async function extractTextFromFile(file: File): Promise<{ kind: string; text: string }> {
  if (file.size > MAX_FILE_BYTES) throw new Error("file_too_large");

  const buf = Buffer.from(await file.arrayBuffer());
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();

  if (type === "application/pdf" || name.endsWith(".pdf")) {
    const mod: any = await import("pdf-parse");
    const pdfParse = mod?.default ?? mod;
    const out = await pdfParse(buf);
    return { kind: "pdf", text: String(out?.text ?? "") };
  }

  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx")) {
    const mod: any = await import("mammoth");
    const mammoth = mod?.default ?? mod;
    const out = await mammoth.extractRawText({ buffer: buf });
    return { kind: "docx", text: String(out?.value ?? "") };
  }

  if (type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || name.endsWith(".xlsx")) {
    const XLSX: any = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    const chunks: string[] = [];
    for (const sheetName of wb.SheetNames ?? []) {
      const ws = wb.Sheets?.[sheetName];
      if (!ws) continue;
      chunks.push(`--- sheet: ${sheetName} ---\n${XLSX.utils.sheet_to_csv(ws)}`);
    }
    return { kind: "xlsx", text: chunks.join("\n\n") };
  }

  if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    return { kind: "text", text: buf.toString("utf8") };
  }

  if (name.endsWith(".hwpx")) {
    const mod: any = await import("adm-zip");
    const AdmZip = mod?.default ?? mod;
    const zip = new AdmZip(buf);
    const entries = zip.getEntries?.() ?? [];
    const xmlFiles = entries
      .map((e: any) => String(e.entryName ?? ""))
      .filter((p: string) => /\/Contents\/section\d+\.xml$/i.test(p));

    const texts: string[] = [];
    for (const p of xmlFiles) {
      const e = entries.find((x: any) => String(x.entryName ?? "") === p);
      if (e) {
        const xml = String(e.getData().toString("utf8") ?? "");
        const extracted = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (extracted) texts.push(decodeHtmlEntities(extracted));
      }
    }
    return { kind: "hwpx", text: texts.join("\n\n") };
  }

  throw new Error("file_type_not_supported");
}

export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  const data = readScraperTargets();
  const org = data.orgs.find((o) => o.org_id === orgId) ?? null;
  if (!org) return NextResponse.json({ error: "org_not_found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_form" }, { status: 400 });

  // URL 정리: 앞뒤 공백, 백틱, 따옴표 등 제거
  const rawUrl = String(form.get("url") ?? "").trim();
  const url = rawUrl.replace(/[`'"<>]/g, '').trim();
  const file = form.get("file");

  if (!url && !(file instanceof File)) {
    return NextResponse.json({ error: "missing_input" }, { status: 400 });
  }
  
  if (url) {
    console.log(`[Extract] Original URL: "${rawUrl}", Cleaned URL: "${url}"`);
  }

  const endpoints: ApiEndpointInfo[] = [];

  // URL 처리
  if (url) {
    try {
      console.log("[Extract] Fetching URL:", url);
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"
      };

      const res = await fetch(url, { 
        headers,
        redirect: 'follow',  // 리다이렉트 자동 따라가기
      });
      if (!res.ok) throw new Error(`url_fetch_failed: ${res.status}`);
      const listHtml = await res.text();
      console.log("[Extract] Fetched HTML length:", listHtml.length);

      // Open Law 사이트 처리
      if (url.includes("open.law.go.kr")) {
        const apiList = extractOpenLawApiList(listHtml);
        console.log("[Extract] API list sample:", apiList.slice(0, 3));
        
        if (apiList.length > 0) {
          const BATCH_SIZE = 5;
          const DELAY_MS = 500;
          
          for (let i = 0; i < apiList.length; i += BATCH_SIZE) {
            const batch = apiList.slice(i, i + BATCH_SIZE);
            console.log(`[Extract] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(apiList.length / BATCH_SIZE)} (${batch.map(b => b.htmlName).join(', ')})`);
            
            await Promise.all(batch.map(async (api) => {
              // htmlName은 확장자 없이 전달 (예: lsEfYdListGuide)
              const detailUrl = `https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=${api.htmlName}`;
              
              try {
                const dRes = await fetch(detailUrl, { headers });
                if (dRes.ok) {
                  const dHtml = await dRes.text();
                  const info = parseOpenLawDetailPage(dHtml, api.name);
                  info.category = api.category;
                  info.detail_url = detailUrl;
                  endpoints.push(info);
                  console.log(`[Extract] ✓ ${api.name}: params=${info.request_params.length}, fields=${info.response_fields.length}`);
                }
              } catch (e) {
                console.error(`[Extract] ✗ Failed: ${api.name}`, e);
              }
            }));
            
            // Rate limiting
            if (i + BATCH_SIZE < apiList.length) {
              await new Promise(r => setTimeout(r, DELAY_MS));
            }
          }
        }
        
        // API 목록을 못 찾은 경우 메인 페이지 내용이라도 추가
        if (endpoints.length === 0) {
          console.log("[Extract] No API links found in table, parsing main page");
          endpoints.push({
            title: "메인 페이지",
            request_params: [],
            response_fields: [],
            raw_content: stripTags(listHtml).substring(0, 50000)
          });
        }
      } else {
        // 일반 URL 처리
        endpoints.push({
          title: "Main Page",
          request_params: [],
          response_fields: [],
          raw_content: stripTags(listHtml).substring(0, 50000),
          detail_url: url
        });
      }

      console.log(`[Extract] Total endpoints: ${endpoints.length}`);
    } catch (e: any) {
      console.error("[Extract] Error:", e);
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  // 파일 처리
  if (file instanceof File) {
    try {
      const out = await extractTextFromFile(file);
      endpoints.push({
        title: file.name,
        request_params: [],
        response_fields: [],
        raw_content: out.text
      });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  // 중복 제거: 같은 title이면 response_fields가 더 많은 것을 유지
  const deduplicatedEndpoints: typeof endpoints = [];
  const seenTitles = new Map<string, number>();
  
  for (const ep of endpoints) {
    const existingIdx = seenTitles.get(ep.title);
    if (existingIdx !== undefined) {
      // 이미 같은 title이 있으면 response_fields 개수 비교
      const existing = deduplicatedEndpoints[existingIdx];
      if (ep.response_fields.length > existing.response_fields.length) {
        console.log(`[Extract] Replacing duplicate "${ep.title}": fields ${existing.response_fields.length} -> ${ep.response_fields.length}`);
        deduplicatedEndpoints[existingIdx] = ep;
      } else {
        console.log(`[Extract] Skipping duplicate "${ep.title}": existing has more fields`);
      }
    } else {
      seenTitles.set(ep.title, deduplicatedEndpoints.length);
      deduplicatedEndpoints.push(ep);
    }
  }
  
  console.log(`[Extract] Deduplicated: ${endpoints.length} -> ${deduplicatedEndpoints.length} endpoints`);
  
  // JSON 저장 (고정 경로 사용)
  let savedPath = "";
  if (deduplicatedEndpoints.length > 0) {
    try {
      const dataDir = path.join(process.cwd(), "data", "APISet");
      
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      savedPath = path.join(dataDir, `${orgId.toUpperCase()}.json`);
      
      const payload = {
        org_id: orgId,
        org_name: org.org_name,
        base_url: org.base_url,
        extracted_at: new Date().toISOString(),
        source: url || (file instanceof File ? file.name : "unknown"),
        total_endpoints: deduplicatedEndpoints.length,
        endpoints: deduplicatedEndpoints.map(ep => ({
          title: ep.title,
          category: ep.category,
          request_url: ep.request_url,
          request_params: ep.request_params,
          response_fields: ep.response_fields,
          detail_url: ep.detail_url
        }))
      };
      
      fs.writeFileSync(savedPath, JSON.stringify(payload, null, 2), "utf8");
      console.log(`[Extract] Saved to: ${savedPath}`);
    } catch (e) {
      console.error("[Extract] Failed to save JSON:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    total: deduplicatedEndpoints.length,
    endpoints: deduplicatedEndpoints.map(ep => ({
      title: ep.title,
      category: ep.category,
      request_url: ep.request_url,
      params_count: ep.request_params.length,
      fields_count: ep.response_fields.length,
      detail_url: ep.detail_url
    })),
    saved_path: savedPath
  });
}
