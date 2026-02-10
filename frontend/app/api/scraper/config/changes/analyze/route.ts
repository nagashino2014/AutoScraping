import { NextResponse } from "next/server";
import { llmChatJson } from "@/lib/llm/client";
import { readScraperTargets } from "@/lib/scraper/targets-store";
import { CHANGE_TYPE_LABELS, type ChangeType } from "../types";

interface AnalysisResult {
  summary: string;
  impact_assessment: string;
  recommended_changes: string[];
  auto_fix_possible: boolean;
  manual_steps?: string[];
  confidence: "high" | "medium" | "low";
}

/**
 * POST /api/scraper/config/changes/analyze
 * 변경 사항 LLM 분석
 * 
 * Body:
 * - boardId: 분석할 보드 ID
 * - changeDetails: 변경 사항 상세 내용
 * - changeType: 변경 유형
 * - provider: "openai" | "gemini" | "anthropic"
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { boardId, changeDetails, changeType, provider = "openai", model } = body;
    
    if (!boardId || !changeDetails) {
      return NextResponse.json({ error: "boardId and changeDetails are required" }, { status: 400 });
    }
    
    // 보드 설정 조회
    const targets = await readScraperTargets();
    let boardConfig: any = null;
    let orgConfig: any = null;
    
    const boardMap = new Map(targets.boards.map((b) => [b.board_id, b]));
    const orgMap = new Map(targets.orgs.map((o) => [o.org_id, o]));
    const board = boardMap.get(boardId);
    if (board) {
      boardConfig = board;
      const org = orgMap.get(board.org_id);
      if (org) {
        orgConfig = {
          org_id: org.org_id,
          org_name: org.org_name,
          base_url: org.base_url,
        };
      }
    }
    
    const changeTypeLabel = changeType ? CHANGE_TYPE_LABELS[changeType as ChangeType] : "알 수 없음";
    
    // LLM 프롬프트 구성
    const systemPrompt = `당신은 웹 스크래핑 시스템의 사이트 구조 변경 분석 전문가입니다.
감지된 사이트 구조 변경 사항과 현재 보드 설정을 분석하여:
1. 변경 사항이 스크래핑에 미치는 영향을 평가하고
2. 보드 설정 수정 방안을 제시하고
3. 자동 수정 가능 여부를 판단해주세요.

분석 결과는 반드시 아래 JSON 형식으로 출력하세요:
{
  "summary": "변경 사항 요약 및 영향 (1-2문장)",
  "impact_assessment": "스크래핑에 미치는 영향 상세 설명",
  "recommended_changes": ["권장 설정 변경 1", "권장 설정 변경 2", ...],
  "auto_fix_possible": true/false,
  "manual_steps": ["수동 조치 단계 1", "수동 조치 단계 2", ...],
  "confidence": "high" | "medium" | "low"
}`;

    const userPrompt = `## 감지된 변경 사항

- **보드 ID**: ${boardId}
- **변경 유형**: ${changeTypeLabel}

### 변경 상세 내용
\`\`\`
${changeDetails}
\`\`\`

## 현재 보드 설정

${boardConfig ? `
- **기관명**: ${orgConfig?.org_name || "알 수 없음"}
- **기관 ID**: ${orgConfig?.org_id || "알 수 없음"}
- **기관 URL**: ${orgConfig?.base_url || "알 수 없음"}
- **보드명**: ${boardConfig.board_name || boardConfig.board_id}
- **수집 모드**: ${boardConfig.access_mode || "web"}
- **목록 URL**: ${boardConfig.list_url || "설정 안됨"}
- **상세 URL 패턴**: ${boardConfig.detail_url_pattern || "설정 안됨"}
- **페이지네이션 타입**: ${boardConfig.pagination?.type || "설정 안됨"}
${boardConfig.selectors ? `
### 현재 셀렉터 설정
- 리스트 행: ${boardConfig.selectors.list_row || "설정 안됨"}
- 제목: ${boardConfig.selectors.title || "설정 안됨"}
- 링크: ${boardConfig.selectors.link || "설정 안됨"}
- 날짜: ${boardConfig.selectors.date || "설정 안됨"}
- 첨부파일: ${boardConfig.selectors.attachment || "설정 안됨"}
` : ""}
` : "보드 설정 정보를 찾을 수 없음"}

---

위 정보를 분석하여 변경 사항의 영향과 권장 조치를 JSON 형식으로 제시해주세요.
특히 어떤 설정을 어떻게 변경해야 하는지 구체적으로 알려주세요.`;

    // LLM 호출
    const result = await llmChatJson<AnalysisResult>({
      provider,
      model_mode: model ? "manual" : "auto",
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    
    return NextResponse.json({
      analysis: result,
      board_id: boardId,
      change_type: changeType,
      change_type_label: changeTypeLabel,
      provider_used: provider,
    });
    
  } catch (err: any) {
    console.error("[config/changes/analyze] POST error:", err);
    
    // LLM 설정 오류 처리
    if (err.message?.includes("llm_not_configured")) {
      const provider = err.message.replace("llm_not_configured_", "");
      return NextResponse.json({
        error: `${provider.toUpperCase()} API 키가 설정되지 않았습니다. .env.local 파일에 API 키를 설정해주세요.`,
        code: "LLM_NOT_CONFIGURED",
      }, { status: 400 });
    }
    
    return NextResponse.json({ error: err.message || "분석 실패" }, { status: 500 });
  }
}
