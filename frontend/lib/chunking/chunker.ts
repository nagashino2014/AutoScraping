import {
  ChunkingSettings,
  Chunk,
  ChunkMetadata,
  ChunkType,
} from "./chunking-store";

// ============================================================================
// 토큰 계산 (간단한 추정)
// ============================================================================

/**
 * 토큰 수 추정 (한국어/영어 혼합 기준)
 * - 영어: 약 4자 = 1토큰
 * - 한국어: 약 1.5-2자 = 1토큰
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  
  // 한국어 문자 수
  const koreanChars = (text.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g) || []).length;
  // 영어/숫자/기호 문자 수
  const otherChars = text.length - koreanChars;
  
  // 한국어: 1.7자당 1토큰, 영어: 4자당 1토큰
  const koreanTokens = koreanChars / 1.7;
  const otherTokens = otherChars / 4;
  
  return Math.ceil(koreanTokens + otherTokens);
}

// ============================================================================
// 테이블 데이터 구조
// ============================================================================

interface TableInfo {
  startIndex: number;
  endIndex: number;
  content: string;
  title?: string;
  headers: string[];
  rows: string[][];
  type: "markdown" | "semantic";  // 테이블 형식 구분
}

// ============================================================================
// 시맨틱 테이블 감지 (<!-- 표 N -->[표 데이터]... 형식)
// ============================================================================

/**
 * 시맨틱 형식의 테이블 감지 및 파싱
 * 형식: <!-- 표 N -->[표 데이터]\n\n항목 1:\n- 키: 값\n...
 */
function detectSemanticTables(content: string): TableInfo[] {
  const tables: TableInfo[] = [];
  
  // 시맨틱 테이블 패턴: <!-- 표 N -->[표 데이터] 이후 항목들
  // 다음 <!-- 표 --> 또는 문단 끝까지 캡처
  const semanticTablePattern = /(<!-- 표 (\d+) -->\[표 데이터\])([\s\S]*?)(?=<!-- 표 \d+ -->|\n\n(?![항목\[\-])|\n\n\n|$)/g;
  
  let match;
  while ((match = semanticTablePattern.exec(content)) !== null) {
    const fullMatch = match[0];
    const tableNum = match[2];
    const tableContent = match[3]?.trim() || "";
    
    // 항목 파싱
    const items: { headers: string[]; rows: string[][] } = parseSemanticTableContent(tableContent);
    
    tables.push({
      startIndex: match.index,
      endIndex: match.index + fullMatch.length,
      content: fullMatch,
      title: `표 ${tableNum}`,
      headers: items.headers,
      rows: items.rows,
      type: "semantic",
    });
  }
  
  return tables;
}

/**
 * 시맨틱 테이블 내용 파싱
 * 형식 예시:
 * [담당 부서]
 * - 부서: 통상정책국 통상정책총괄과
 * - 이름: 김영만
 * 
 * 항목 2:
 * - 시 간: 10:00~10:05 (5')
 * - 주요 내용: 모두 발언
 */
function parseSemanticTableContent(content: string): { headers: string[]; rows: string[][] } {
  const headers: string[] = [];
  const rows: string[][] = [];
  const headerSet = new Set<string>();
  
  // 항목별로 분리 (항목 N: 또는 [제목] 형식)
  const itemPattern = /(?:항목 \d+:|^\[([^\]]+)\]|\n\[([^\]]+)\])/gm;
  const items = content.split(/(?=항목 \d+:|\n\[)/);
  
  for (const item of items) {
    if (!item.trim()) continue;
    
    const row: Record<string, string> = {};
    
    // 키-값 쌍 추출 (- 키: 값 형식)
    const kvPattern = /- ([^:：]+)[：:][\s]*([^\n]+)/g;
    let kvMatch;
    
    while ((kvMatch = kvPattern.exec(item)) !== null) {
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();
      
      if (key && value) {
        row[key] = value;
        headerSet.add(key);
      }
    }
    
    if (Object.keys(row).length > 0) {
      rows.push(Object.values(row));
      
      // 첫 번째 항목에서 헤더 추출
      if (headers.length === 0) {
        headers.push(...Object.keys(row));
      }
    }
  }
  
  // 헤더가 없으면 headerSet에서 추출
  if (headers.length === 0 && headerSet.size > 0) {
    headers.push(...Array.from(headerSet));
  }
  
  return { headers, rows };
}

// ============================================================================
// 마크다운 테이블 감지 (| 헤더 | 헤더 | 형식)
// ============================================================================

/**
 * 마크다운 테이블 감지 및 파싱
 */
function detectMarkdownTables(content: string): TableInfo[] {
  const tables: TableInfo[] = [];
  
  // 마크다운 테이블 패턴 (주석 포함)
  const tablePattern = /(<!-- 표 \d+ -->[\s\S]*?)?((?:\|[^\n]+\|\n)(?:\|[-:|]+\|\n)((?:\|[^\n]+\|\n?)+))/g;
  
  let match;
  while ((match = tablePattern.exec(content)) !== null) {
    const fullMatch = match[0];
    const titleComment = match[1];
    const tableContent = match[2];
    
    // 제목 추출
    let title: string | undefined;
    if (titleComment) {
      const titleMatch = titleComment.match(/표 (\d+)/);
      title = titleMatch ? `표 ${titleMatch[1]}` : undefined;
    }
    
    // 테이블 파싱
    const lines = tableContent.trim().split("\n");
    if (lines.length < 2) continue;
    
    // 헤더 파싱
    const headerLine = lines[0];
    const headers = headerLine
      .split("|")
      .filter(h => h.trim())
      .map(h => h.trim());
    
    // 데이터 행 파싱 (구분선 제외)
    const rows: string[][] = [];
    for (let i = 2; i < lines.length; i++) {
      const cells = lines[i]
        .split("|")
        .filter(c => c.trim() !== "")
        .map(c => c.trim());
      if (cells.length > 0) {
        rows.push(cells);
      }
    }
    
    tables.push({
      startIndex: match.index,
      endIndex: match.index + fullMatch.length,
      content: fullMatch,
      title,
      headers,
      rows,
      type: "markdown",
    });
  }
  
  return tables;
}

// ============================================================================
// 통합 테이블 감지 (마크다운 + 시맨틱)
// ============================================================================

/**
 * 모든 테이블 감지 (마크다운 및 시맨틱 형식 모두)
 */
function detectAllTables(content: string): TableInfo[] {
  const markdownTables = detectMarkdownTables(content);
  const semanticTables = detectSemanticTables(content);
  
  // 중복 제거 및 위치순 정렬
  const allTables = [...markdownTables, ...semanticTables];
  allTables.sort((a, b) => a.startIndex - b.startIndex);
  
  // 겹치는 테이블 제거 (마크다운 우선)
  const filteredTables: TableInfo[] = [];
  for (const table of allTables) {
    const overlaps = filteredTables.some(
      t => (table.startIndex >= t.startIndex && table.startIndex < t.endIndex) ||
           (table.endIndex > t.startIndex && table.endIndex <= t.endIndex)
    );
    if (!overlaps) {
      filteredTables.push(table);
    }
  }
  
  return filteredTables;
}

// ============================================================================
// 공통 세그먼트 구조
// ============================================================================

interface TextSegment {
  content: string;
  startIndex: number;
  endIndex: number;
  isTable: boolean;
  tableInfo?: TableInfo;
}

/**
 * 텍스트를 테이블과 일반 텍스트로 분리 (마크다운 + 시맨틱 테이블 모두 감지)
 */
function segmentContent(content: string, detectTables: boolean): TextSegment[] {
  const segments: TextSegment[] = [];
  
  if (!detectTables) {
    return [{ content, startIndex: 0, endIndex: content.length, isTable: false }];
  }
  
  // 마크다운 및 시맨틱 테이블 모두 감지
  const tables = detectAllTables(content);
  
  if (tables.length === 0) {
    return [{ content, startIndex: 0, endIndex: content.length, isTable: false }];
  }
  
  let lastEnd = 0;
  
  for (const table of tables) {
    // 테이블 이전 텍스트
    if (table.startIndex > lastEnd) {
      const textBefore = content.slice(lastEnd, table.startIndex);
      if (textBefore.trim()) {
        segments.push({
          content: textBefore,
          startIndex: lastEnd,
          endIndex: table.startIndex,
          isTable: false,
        });
      }
    }
    
    // 테이블
    segments.push({
      content: table.content,
      startIndex: table.startIndex,
      endIndex: table.endIndex,
      isTable: true,
      tableInfo: table,
    });
    
    lastEnd = table.endIndex;
  }
  
  // 마지막 테이블 이후 텍스트
  if (lastEnd < content.length) {
    const textAfter = content.slice(lastEnd);
    if (textAfter.trim()) {
      segments.push({
        content: textAfter,
        startIndex: lastEnd,
        endIndex: content.length,
        isTable: false,
      });
    }
  }
  
  return segments;
}

// ============================================================================
// Sentence 전략: 문장 단위 분할
// ============================================================================

/**
 * 한국어/영어 문장 종결 패턴
 */
const SENTENCE_ENDINGS = /([.!?。！？][\s\n]+|[.!?。！？]$|(?<=[가-힣])[다요죠니까지만][\s\n]*(?=[가-힣A-Z]|$))/g;

/**
 * 문장 단위로 텍스트 분할
 */
function splitBySentence(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  if (!text.trim()) return [];
  
  // 문장 분리 (마침표, 물음표, 느낌표 기준)
  const sentences: string[] = [];
  let lastIndex = 0;
  let match;
  
  // 문장 종결 패턴으로 분할
  const sentencePattern = /[^.!?。！？\n]+[.!?。！？]+[\s\n]*/g;
  while ((match = sentencePattern.exec(text)) !== null) {
    sentences.push(match[0].trim());
    lastIndex = sentencePattern.lastIndex;
  }
  
  // 남은 텍스트 처리
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) {
      sentences.push(remaining);
    }
  }
  
  // 문장이 없으면 줄바꿈 기준으로 분할
  if (sentences.length === 0) {
    const lines = text.split(/\n+/).filter(l => l.trim());
    sentences.push(...lines);
  }
  
  // 청크 생성
  const chunks: string[] = [];
  let currentChunk = "";
  let currentTokens = 0;
  
  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    
    // 단일 문장이 청크 크기를 초과하면 그대로 추가
    if (sentenceTokens > chunkSize) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      chunks.push(sentence);
      currentChunk = "";
      currentTokens = 0;
      continue;
    }
    
    // 현재 청크에 문장 추가 가능한지 확인
    if (currentTokens + sentenceTokens <= chunkSize) {
      currentChunk += (currentChunk ? " " : "") + sentence;
      currentTokens += sentenceTokens;
    } else {
      // 현재 청크 저장 후 새 청크 시작
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
      currentTokens = sentenceTokens;
    }
  }
  
  // 마지막 청크 저장
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  // 오버랩 적용
  if (chunkOverlap > 0 && chunks.length > 1) {
    return applySentenceOverlap(chunks, chunkOverlap);
  }
  
  return chunks;
}

/**
 * 문장 단위 오버랩 적용
 */
function applySentenceOverlap(chunks: string[], overlapTokens: number): string[] {
  const result: string[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      result.push(chunks[i]);
    } else {
      // 이전 청크의 마지막 문장들을 오버랩으로 추가
      const prevSentences = chunks[i - 1].split(/(?<=[.!?。！？])\s+/);
      let overlapText = "";
      let tokenCount = 0;
      
      for (let j = prevSentences.length - 1; j >= 0 && tokenCount < overlapTokens; j--) {
        const sentence = prevSentences[j];
        tokenCount += estimateTokens(sentence);
        overlapText = sentence + (overlapText ? " " + overlapText : "");
      }
      
      result.push(overlapText + " " + chunks[i]);
    }
  }
  
  return result;
}

// ============================================================================
// Semantic 전략: 의미 블록 기반 분할
// ============================================================================

/**
 * 의미적 블록 경계 패턴
 * - 빈 줄 두 개 이상
 * - 숫자로 시작하는 목록 항목
 * - 불릿 포인트 (-, *, •, ▲, ○ 등)
 * - 헤더 패턴 (□, ■, ◆ 등)
 */
const SEMANTIC_BLOCK_PATTERNS = [
  /\n\n+/,                          // 빈 줄
  /(?=\n\d+\.\s)/,                  // 숫자 목록
  /(?=\n[-*•▲○◆■□]\s)/,            // 불릿 포인트
  /(?=\n[가-힣]+\s*[：:]\s)/,       // 한글 레이블: 값 형식
];

/**
 * 의미 블록 기반 텍스트 분할
 */
function splitBySemanticBlocks(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  if (!text.trim()) return [];
  
  // 1차: 빈 줄 2개 이상으로 분할 (문단 단위)
  let blocks = text.split(/\n{2,}/).filter(b => b.trim());
  
  // 각 블록이 너무 크면 추가 분할
  const refinedBlocks: string[] = [];
  
  for (const block of blocks) {
    const blockTokens = estimateTokens(block);
    
    if (blockTokens <= chunkSize) {
      refinedBlocks.push(block);
    } else {
      // 의미 단위로 추가 분할 시도
      // 1. 불릿 포인트나 번호 목록으로 분할
      const subBlocks = block.split(/(?=\n[-*•▲○◆■□]\s|\n\d+[.)\]]\s)/).filter(b => b.trim());
      
      if (subBlocks.length > 1) {
        // 분할된 하위 블록들을 청크 크기에 맞게 병합
        let currentBlock = "";
        
        for (const sub of subBlocks) {
          const subTokens = estimateTokens(sub);
          const currentTokens = estimateTokens(currentBlock);
          
          if (currentTokens + subTokens <= chunkSize) {
            currentBlock += (currentBlock ? "\n" : "") + sub;
          } else {
            if (currentBlock.trim()) {
              refinedBlocks.push(currentBlock.trim());
            }
            
            // 하위 블록이 여전히 너무 크면 문장 분할
            if (subTokens > chunkSize) {
              const sentenceChunks = splitBySentence(sub, chunkSize, 0);
              refinedBlocks.push(...sentenceChunks);
              currentBlock = "";
            } else {
              currentBlock = sub;
            }
          }
        }
        
        if (currentBlock.trim()) {
          refinedBlocks.push(currentBlock.trim());
        }
      } else {
        // 분할 불가능하면 문장 단위로 분할
        const sentenceChunks = splitBySentence(block, chunkSize, 0);
        refinedBlocks.push(...sentenceChunks);
      }
    }
  }
  
  // 작은 블록들 병합
  const chunks: string[] = [];
  let currentChunk = "";
  let currentTokens = 0;
  
  for (const block of refinedBlocks) {
    const blockTokens = estimateTokens(block);
    
    if (currentTokens + blockTokens <= chunkSize) {
      currentChunk += (currentChunk ? "\n\n" : "") + block;
      currentTokens += blockTokens;
    } else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = block;
      currentTokens = blockTokens;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  // 오버랩 적용
  if (chunkOverlap > 0 && chunks.length > 1) {
    return applySemanticOverlap(chunks, chunkOverlap);
  }
  
  return chunks;
}

/**
 * 의미 블록 오버랩 적용
 */
function applySemanticOverlap(chunks: string[], overlapTokens: number): string[] {
  const result: string[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      result.push(chunks[i]);
    } else {
      // 이전 청크의 마지막 블록/문장을 오버랩으로 추가
      const prevParts = chunks[i - 1].split(/\n\n/);
      let overlapText = "";
      let tokenCount = 0;
      
      for (let j = prevParts.length - 1; j >= 0 && tokenCount < overlapTokens; j--) {
        const part = prevParts[j];
        tokenCount += estimateTokens(part);
        overlapText = part + (overlapText ? "\n\n" + overlapText : "");
      }
      
      result.push(overlapText + "\n\n" + chunks[i]);
    }
  }
  
  return result;
}

// ============================================================================
// MarkdownHeader 전략: 헤더 기반 분할
// ============================================================================

/**
 * 마크다운 헤더 패턴
 */
const MARKDOWN_HEADER_PATTERNS = [
  /^#{1,6}\s+.+$/gm,               // # 헤더
  /^[^\n]+\n[=]+$/gm,              // 언더라인 헤더 (=)
  /^[^\n]+\n[-]+$/gm,              // 언더라인 헤더 (-)
];

/**
 * 한국어 문서의 일반적인 섹션 패턴
 */
const KOREAN_SECTION_PATTERNS = [
  /^[□■◆●○◇]\s*.+$/gm,            // 불릿 섹션 헤더
  /^\d+\.\s+[가-힣].+$/gm,          // 번호 섹션 (1. 제목)
  /^[가-힣]+\s*[：:]\s*$/gm,        // 레이블: 형식
  /^<.+>$/gm,                       // <제목> 형식
  /^\[.+\]$/gm,                     // [제목] 형식
  /^【.+】$/gm,                     // 【제목】 형식
];

/**
 * 마크다운 헤더 및 섹션 기반 텍스트 분할
 */
function splitByMarkdownHeader(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  if (!text.trim()) return [];
  
  // 헤더/섹션 패턴으로 분할 지점 찾기
  const splitPoints: { index: number; header: string; level: number }[] = [];
  
  // 마크다운 헤더 (#, ##, ###)
  const mdHeaderRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  while ((match = mdHeaderRegex.exec(text)) !== null) {
    splitPoints.push({
      index: match.index,
      header: match[2],
      level: match[1].length,
    });
  }
  
  // 한국어 섹션 패턴
  const koreanSectionRegex = /^([□■◆●○◇])\s*(.+)$|^(\d+)\.\s+([가-힣].+)$|^<([^>]+)>$|^\[([^\]]+)\]$|^【([^】]+)】$/gm;
  while ((match = koreanSectionRegex.exec(text)) !== null) {
    const header = match[2] || match[4] || match[5] || match[6] || match[7];
    if (header) {
      splitPoints.push({
        index: match.index,
        header: header,
        level: match[1] ? 2 : (match[3] ? 3 : 2),  // 불릿=레벨2, 번호=레벨3
      });
    }
  }
  
  // 분할 지점이 없으면 문단 단위로 분할
  if (splitPoints.length === 0) {
    return splitBySemanticBlocks(text, chunkSize, chunkOverlap);
  }
  
  // 위치순 정렬
  splitPoints.sort((a, b) => a.index - b.index);
  
  // 섹션별로 분할
  const sections: { header: string; content: string; level: number }[] = [];
  
  for (let i = 0; i < splitPoints.length; i++) {
    const start = splitPoints[i].index;
    const end = i < splitPoints.length - 1 ? splitPoints[i + 1].index : text.length;
    const content = text.slice(start, end).trim();
    
    sections.push({
      header: splitPoints[i].header,
      content: content,
      level: splitPoints[i].level,
    });
  }
  
  // 시작 부분에 헤더가 없는 텍스트가 있으면 추가
  if (splitPoints.length > 0 && splitPoints[0].index > 0) {
    const preamble = text.slice(0, splitPoints[0].index).trim();
    if (preamble) {
      sections.unshift({
        header: "",
        content: preamble,
        level: 0,
      });
    }
  }
  
  // 섹션을 청크로 변환 (크기 조절)
  const chunks: string[] = [];
  let currentChunk = "";
  let currentTokens = 0;
  
  for (const section of sections) {
    const sectionTokens = estimateTokens(section.content);
    
    if (sectionTokens > chunkSize) {
      // 섹션이 너무 크면 내부 분할
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
        currentTokens = 0;
      }
      
      // 의미 블록으로 추가 분할
      const subChunks = splitBySemanticBlocks(section.content, chunkSize, 0);
      chunks.push(...subChunks);
    } else if (currentTokens + sectionTokens <= chunkSize) {
      // 현재 청크에 추가
      currentChunk += (currentChunk ? "\n\n" : "") + section.content;
      currentTokens += sectionTokens;
    } else {
      // 새 청크 시작
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = section.content;
      currentTokens = sectionTokens;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  // 오버랩 적용
  if (chunkOverlap > 0 && chunks.length > 1) {
    return applySemanticOverlap(chunks, chunkOverlap);
  }
  
  return chunks;
}

// ============================================================================
// RecursiveCharacter 전략: 기존 구현
// ============================================================================

/**
 * RecursiveCharacter 방식으로 텍스트 분할
 */
function splitTextRecursive(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
  separators: string[]
): string[] {
  const chunks: string[] = [];
  
  if (estimateTokens(text) <= chunkSize) {
    return [text];
  }
  
  // 첫 번째 구분자로 분할
  const separator = separators[0] || " ";
  const remainingSeparators = separators.slice(1);
  
  const parts = text.split(separator);
  let currentChunk = "";
  
  for (const part of parts) {
    const testChunk = currentChunk ? currentChunk + separator + part : part;
    
    if (estimateTokens(testChunk) <= chunkSize) {
      currentChunk = testChunk;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      
      // 현재 파트가 여전히 너무 크면 재귀적으로 분할
      if (estimateTokens(part) > chunkSize && remainingSeparators.length > 0) {
        const subChunks = splitTextRecursive(part, chunkSize, chunkOverlap, remainingSeparators);
        chunks.push(...subChunks);
        currentChunk = "";
      } else {
        currentChunk = part;
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  // 오버랩 적용
  if (chunkOverlap > 0 && chunks.length > 1) {
    return applyOverlap(chunks, chunkOverlap, separator);
  }
  
  return chunks;
}

/**
 * 청크 간 오버랩 적용
 */
function applyOverlap(chunks: string[], overlapTokens: number, separator: string): string[] {
  const result: string[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      result.push(chunks[i]);
    } else {
      // 이전 청크의 끝 부분을 현재 청크 앞에 추가
      const prevChunk = chunks[i - 1];
      const prevWords = prevChunk.split(/\s+/);
      
      // 오버랩할 단어 수 계산
      let overlapText = "";
      let tokenCount = 0;
      
      for (let j = prevWords.length - 1; j >= 0 && tokenCount < overlapTokens; j--) {
        const word = prevWords[j];
        tokenCount += estimateTokens(word);
        overlapText = word + (overlapText ? " " + overlapText : "");
      }
      
      result.push(overlapText + separator + chunks[i]);
    }
  }
  
  return result;
}

// ============================================================================
// 테이블 청킹
// ============================================================================

interface TableChunkResult {
  chunks: string[];
  metadata: Partial<ChunkMetadata>[];
}

/**
 * 테이블을 청크로 분할 (마크다운 및 시맨틱 테이블 모두 지원)
 */
function chunkTable(
  tableInfo: TableInfo,
  maxRowsPerChunk: number,
  docId: string,
  tableIndex: number
): TableChunkResult {
  const { headers, rows, title, type, content: originalContent } = tableInfo;
  const tableId = `${docId}_table_${tableIndex.toString().padStart(3, "0")}`;
  
  const chunks: string[] = [];
  const metadata: Partial<ChunkMetadata>[] = [];
  
  const totalRows = rows.length;
  
  // 행이 없는 경우 (시맨틱 테이블 파싱 실패 등) 원본 콘텐츠 그대로 사용
  if (totalRows === 0) {
    chunks.push(originalContent);
    metadata.push({
      chunk_type: "table_full",
      table_id: tableId,
      table_title: title,
      total_rows: 0,
      total_cols: headers.length,
      headers: headers.length > 0 ? headers : [],
      row_start: 0,
      row_end: 0,
      is_first_chunk: true,
      is_last_chunk: true,
    });
    return { chunks, metadata };
  }
  
  const totalChunks = totalRows <= maxRowsPerChunk ? 1 : Math.ceil(totalRows / maxRowsPerChunk);
  
  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    const rowStart = chunkIdx * maxRowsPerChunk;
    const rowEnd = Math.min(rowStart + maxRowsPerChunk, totalRows);
    const chunkRows = rows.slice(rowStart, rowEnd);
    
    // 자연어 설명 생성 (LLM이 이해하기 쉬운 형태)
    let content = `[표: ${title || tableId}] (${rowStart + 1}~${rowEnd}행 / 전체 ${totalRows}행)\n`;
    
    if (headers.length > 0) {
      content += `이 표의 열: ${headers.join(", ")}\n`;
    }
    
    for (let i = 0; i < chunkRows.length; i++) {
      const row = chunkRows[i];
      const rowNum = rowStart + i + 1;
      
      // 헤더가 있으면 헤더=값 형식, 없으면 값만
      if (headers.length > 0 && headers.length >= row.length) {
        const cellDescriptions = row
          .map((cell, j) => (j < headers.length && cell ? `${headers[j]}=${cell}` : null))
          .filter(Boolean)
          .join(", ");
        content += `- ${rowNum}행: ${cellDescriptions}\n`;
      } else {
        content += `- ${rowNum}행: ${row.join(", ")}\n`;
      }
    }
    
    // 마크다운 테이블 형식일 경우에만 원본 마크다운 테이블 추가
    if (type === "markdown" && headers.length > 0) {
      const headerLine = `| ${headers.join(" | ")} |`;
      const separatorLine = `|${headers.map(() => "---").join("|")}|`;
      const dataLines = chunkRows.map(row => `| ${row.join(" | ")} |`).join("\n");
      content += `\n${headerLine}\n${separatorLine}\n${dataLines}`;
    }
    
    chunks.push(content);
    
    metadata.push({
      chunk_type: totalChunks === 1 ? "table_full" : "table_segment",
      table_id: tableId,
      table_title: title,
      total_rows: totalRows,
      total_cols: headers.length,
      headers: headers.length > 0 ? headers : undefined,
      row_start: rowStart,
      row_end: rowEnd,
      is_first_chunk: chunkIdx === 0,
      is_last_chunk: chunkIdx === totalChunks - 1,
    });
  }
  
  return { chunks, metadata };
}

// ============================================================================
// 메인 청킹 함수
// ============================================================================

export interface ChunkingResult {
  chunks: Chunk[];
  totalTokens: number;
  textChunks: number;
  tableChunks: number;
}

/**
 * 전략에 따른 텍스트 분할 함수 선택
 */
function splitTextByStrategy(
  text: string,
  settings: ChunkingSettings
): string[] {
  const { strategy, chunkSize, chunkOverlap, separators } = settings;
  
  switch (strategy) {
    case "sentence":
      // 문장 단위 분할
      return splitBySentence(text, chunkSize, chunkOverlap);
    
    case "semantic":
      // 의미 블록 기반 분할
      return splitBySemanticBlocks(text, chunkSize, chunkOverlap);
    
    case "markdown":
      // 마크다운 헤더/섹션 기반 분할
      return splitByMarkdownHeader(text, chunkSize, chunkOverlap);
    
    case "recursive":
    default:
      // RecursiveCharacter 방식 (기본값)
      return splitTextRecursive(text, chunkSize, chunkOverlap, separators);
  }
}

/**
 * 문서 청킹 실행
 */
export function chunkDocument(
  content: string,
  docId: string,
  baseMetadata: Omit<ChunkMetadata, "chunk_type" | "chunk_index" | "total_chunks" | "doc_id">,
  settings: ChunkingSettings
): ChunkingResult {
  const chunks: Chunk[] = [];
  let textChunkCount = 0;
  let tableChunkCount = 0;
  let tableIndex = 0;
  
  // 1. 테이블과 텍스트 분리 (마크다운 + 시맨틱 테이블 모두 감지)
  const segments = segmentContent(content, settings.tableChunking.enabled);
  
  const allTextChunks: { content: string; metadata: Partial<ChunkMetadata> }[] = [];
  
  for (const segment of segments) {
    if (segment.isTable && segment.tableInfo) {
      // 테이블 청킹 (테이블 타입에 관계없이 동일하게 처리)
      const result = chunkTable(
        segment.tableInfo,
        settings.tableChunking.maxRowsPerChunk,
        docId,
        tableIndex
      );
      
      for (let i = 0; i < result.chunks.length; i++) {
        allTextChunks.push({
          content: result.chunks[i],
          metadata: result.metadata[i],
        });
      }
      
      tableChunkCount += result.chunks.length;
      tableIndex++;
    } else {
      // 텍스트 청킹: 설정된 전략에 따라 분할
      const textChunks = splitTextByStrategy(segment.content, settings);
      
      for (const text of textChunks) {
        if (text.trim()) {
          allTextChunks.push({
            content: text,
            metadata: { chunk_type: "text" as ChunkType },
          });
          textChunkCount++;
        }
      }
    }
  }
  
  // 2. 청크 객체 생성
  const now = new Date().toISOString();
  let totalTokens = 0;
  
  for (let i = 0; i < allTextChunks.length; i++) {
    const { content: chunkContent, metadata: chunkMeta } = allTextChunks[i];
    const tokenCount = estimateTokens(chunkContent);
    totalTokens += tokenCount;
    
    const chunkType = chunkMeta.chunk_type || "text";
    const chunkId = chunkMeta.table_id
      ? `${chunkMeta.table_id}_chunk_${(chunkMeta.is_first_chunk ? 0 : i).toString().padStart(3, "0")}`
      : `${docId}_text_${i.toString().padStart(3, "0")}`;
    
    chunks.push({
      chunk_id: chunkId,
      content: chunkContent,
      raw_content: chunkContent,
      token_count: tokenCount,
      metadata: {
        ...baseMetadata,
        doc_id: docId,
        chunk_type: chunkType,
        chunk_index: i,
        total_chunks: allTextChunks.length,
        ...chunkMeta,
      },
      created_at: now,
    });
  }
  
  return {
    chunks,
    totalTokens,
    textChunks: textChunkCount,
    tableChunks: tableChunkCount,
  };
}

// ============================================================================
// Export
// ============================================================================

export { 
  detectMarkdownTables, 
  detectSemanticTables,
  detectAllTables,
  splitTextRecursive,
  splitBySentence,
  splitBySemanticBlocks,
  splitByMarkdownHeader,
};
