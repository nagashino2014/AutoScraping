/**
 * 데이터 파싱 API (Step 3)
 *
 * POST: extracted.json을 기반으로 표 구조 직접 파싱 수행 (SSE 스트리밍)
 * 
 * 각 탭별로 특화된 데이터 구조(EmissionFacility, PreventionFacility 등)로
 * 데이터를 추출하여 프로파일의 실제 탭 필드에 저장합니다.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { loadProfile, saveProfile } from "@/lib/rag/site-profile";
import {
  ExtractedDocument,
  parseAllTables,
  ParsedOverview,
  ParsedOtherPermits,
  ParsedMajorProcess,
  ParsedUnitProcess,
  ParsedProcessEmission,
  ParsedFuel,
  ParsedRawMaterial,
  ParsedChemical,
  ParsedEnergy,
  ParsedPollutantEmission,
  ParsedPermitEvent,
  ParsedPermitEmissionChange,
  FacilitySummary,
  buildProcessTree,
} from "@/lib/rag/table-parser";

export const runtime = "nodejs";
export const maxDuration = 300; // 5분

// 프로파일 탭 정의
const PROFILE_TABS = [
  { id: "emissionFacilities", name: "배출시설" },
  { id: "preventionFacilities", name: "방지시설" },
  { id: "stacks", name: "오염물질 배출량" },
  { id: "processes", name: "공정" },
  { id: "substances", name: "사용물질" },
  { id: "permits", name: "허가" },
  { id: "batStatus", name: "BAT" },
  { id: "monitoring", name: "모니터링" },
  { id: "regulations", name: "규제현황" },
];

/**
 * POST: 데이터 파싱 (SSE 스트리밍)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { profileId, docIds, targetTabs } = body;

    if (!profileId) {
      return NextResponse.json(
        { success: false, error: "profileId가 필요합니다." },
        { status: 400 }
      );
    }

    // 프로파일 확인
    const profile = loadProfile(profileId);
    if (!profile) {
      return NextResponse.json(
        { success: false, error: "프로파일을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 직접 파싱용: extractionStatus === "completed"
    const docsForParsing = docIds
      ? profile.uploadedDocuments.filter((d) => docIds.includes(d.id) && d.extractionStatus === "completed")
      : profile.uploadedDocuments.filter((d) => d.extractionStatus === "completed");

    console.log("[Parse] 파싱 대상 문서:", docsForParsing.length);

    if (docsForParsing.length === 0) {
      return NextResponse.json(
        { success: false, error: "파싱할 문서가 없습니다. 텍스트 추출이 완료된 문서가 필요합니다." },
        { status: 400 }
      );
    }

    // 분석할 탭 목록
    const tabsToAnalyze = targetTabs && targetTabs.length > 0
      ? PROFILE_TABS.filter((t) => targetTabs.includes(t.id))
      : PROFILE_TABS;

    // SSE 스트리밍 설정
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendEvent = async (event: string, data: any) => {
      const eventData = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      await writer.write(encoder.encode(eventData));
    };

    // 비동기 파싱 프로세스
    (async () => {
      try {
        await sendEvent("progress", { stage: "start", message: "데이터 파싱 시작..." });

        // 분석 결과 저장
        const analysisResults: Record<string, any> = {};

        // ============================================================================
        // 직접 파싱: extracted.json에서 표 데이터 로드
        // ============================================================================
        let extractedDocuments: ExtractedDocument[] = [];
        let directParsingResults: {
          emissionFacilities: any[];
          nonEmissionFacilities: any[];
          preventionFacilities: any[];
          overview: ParsedOverview | null;
          otherPermits: ParsedOtherPermits | null;
          majorProcesses: ParsedMajorProcess[];
          unitProcesses: ParsedUnitProcess[];
          processEmissions: ParsedProcessEmission[];
          fuels: ParsedFuel[];
          rawMaterials: ParsedRawMaterial[];
          chemicals: ParsedChemical[];
          energies: ParsedEnergy[];
          pollutantEmissions: {
            air: ParsedPollutantEmission[];
            water: ParsedPollutantEmission[];
            soil: ParsedPollutantEmission[];
            waste: ParsedPollutantEmission[];
          };
          permitEvents: ParsedPermitEvent[];
          permitEmissionChanges: ParsedPermitEmissionChange[];
          facilitySummary: FacilitySummary[];
        } = {
          emissionFacilities: [],
          nonEmissionFacilities: [],
          preventionFacilities: [],
          overview: null,
          otherPermits: null,
          majorProcesses: [],
          unitProcesses: [],
          processEmissions: [],
          fuels: [],
          rawMaterials: [],
          chemicals: [],
          energies: [],
          pollutantEmissions: {
            air: [],
            water: [],
            soil: [],
            waste: [],
          },
          permitEvents: [],
          permitEmissionChanges: [],
          facilitySummary: [],
        };

        // 문서별로 extracted.json 로드 및 직접 파싱
        for (const doc of docsForParsing) {
          if (doc.extractedPath) {
            try {
              const extractedPath = path.resolve(process.cwd(), doc.extractedPath);
              if (fs.existsSync(extractedPath)) {
                const extractedContent = fs.readFileSync(extractedPath, "utf-8");
                const extractedDoc: ExtractedDocument = JSON.parse(extractedContent);
                extractedDocuments.push(extractedDoc);

                await sendEvent("progress", {
                  stage: "parsing",
                  message: `${doc.originalName} 파싱 중...`,
                });

                // 표 직접 파싱 (모든 데이터 추출)
                const parseResult = parseAllTables(extractedDoc);
                
                // 배출/방지시설
                directParsingResults.emissionFacilities.push(...parseResult.emissionFacilities);
                directParsingResults.nonEmissionFacilities.push(...parseResult.nonEmissionFacilities);
                directParsingResults.preventionFacilities.push(...parseResult.preventionFacilities);
                
                // 개요
                if (parseResult.overview && !directParsingResults.overview) {
                  directParsingResults.overview = parseResult.overview;
                }
                if (parseResult.otherPermits && !directParsingResults.otherPermits) {
                  directParsingResults.otherPermits = parseResult.otherPermits;
                }
                
                // 공정
                directParsingResults.majorProcesses.push(...parseResult.majorProcesses);
                directParsingResults.unitProcesses.push(...parseResult.unitProcesses);
                directParsingResults.processEmissions.push(...parseResult.processEmissions);
                
                // 사용물질
                directParsingResults.fuels.push(...parseResult.fuels);
                directParsingResults.rawMaterials.push(...parseResult.rawMaterials);
                directParsingResults.chemicals.push(...parseResult.chemicals);
                directParsingResults.energies.push(...parseResult.energies);
                
                // 오염물질 배출량
                directParsingResults.pollutantEmissions.air.push(...parseResult.pollutantEmissions.air);
                directParsingResults.pollutantEmissions.water.push(...parseResult.pollutantEmissions.water);
                directParsingResults.pollutantEmissions.soil.push(...parseResult.pollutantEmissions.soil);
                directParsingResults.pollutantEmissions.waste.push(...parseResult.pollutantEmissions.waste);
                
                // 허가 추진경과
                directParsingResults.permitEvents.push(...parseResult.permitEvents);
                directParsingResults.permitEmissionChanges.push(...parseResult.permitEmissionChanges);

                console.log(`[Parse] 직접 파싱 결과 (${doc.originalName}):`, {
                  emissions: parseResult.emissionFacilities.length,
                  nonEmissions: parseResult.nonEmissionFacilities.length,
                  preventions: parseResult.preventionFacilities.length,
                  overview: parseResult.overview ? "있음" : "없음",
                  majorProcesses: parseResult.majorProcesses.length,
                  fuels: parseResult.fuels.length,
                  rawMaterials: parseResult.rawMaterials.length,
                  chemicals: parseResult.chemicals.length,
                  pollutantAir: parseResult.pollutantEmissions.air.length,
                  pollutantWater: parseResult.pollutantEmissions.water.length,
                  tableTypes: parseResult.tableTypes.filter(t => t.type !== "unknown").length,
                });

                await sendEvent("progress", {
                  stage: "parsing",
                  message: `${doc.originalName} 파싱 완료 - 배출시설 ${parseResult.emissionFacilities.length}개, 방지시설 ${parseResult.preventionFacilities.length}개`,
                });
              }
            } catch (parseError: any) {
              console.error(`[Parse] 직접 파싱 오류 (${doc.originalName}):`, parseError.message);
              await sendEvent("progress", {
                stage: "error",
                message: `${doc.originalName} 파싱 오류: ${parseError.message}`,
              });
            }
          }
        }

        // 총괄표 생성
        if (directParsingResults.emissionFacilities.length > 0 || directParsingResults.preventionFacilities.length > 0) {
          directParsingResults.facilitySummary = extractedDocuments.length > 0
            ? parseAllTables(extractedDocuments[0]).facilitySummary
            : [];
        }

        console.log("[Parse] 전체 직접 파싱 결과:", {
          emissionFacilities: directParsingResults.emissionFacilities.length,
          nonEmissionFacilities: directParsingResults.nonEmissionFacilities.length,
          preventionFacilities: directParsingResults.preventionFacilities.length,
          overview: directParsingResults.overview ? "있음" : "없음",
          majorProcesses: directParsingResults.majorProcesses.length,
          substances: directParsingResults.fuels.length + directParsingResults.rawMaterials.length + directParsingResults.chemicals.length,
          pollutants: Object.values(directParsingResults.pollutantEmissions).flat().length,
        });

        // 각 탭별 결과 매핑
        for (let i = 0; i < tabsToAnalyze.length; i++) {
          const tab = tabsToAnalyze[i];
          const progress = Math.round(((i + 1) / tabsToAnalyze.length) * 90) + 5;

          await sendEvent("progress", {
            stage: "mapping",
            message: `${tab.name} 데이터 매핑 중...`,
            progress,
            currentTab: tab.id,
          });

          // 해당 탭에 관련된 문서 필터링
          const relevantDocs = docsForParsing.filter((doc) => {
            if (!doc.targetTabs || doc.targetTabs.length === 0) return true;
            return doc.targetTabs.includes(tab.id);
          });

          if (relevantDocs.length === 0) {
            analysisResults[tab.id] = { status: "skipped", reason: "관련 문서 없음" };
            continue;
          }

          // 탭별 직접 파싱 결과 매핑
          switch (tab.id) {
            case "emissionFacilities":
              if (directParsingResults.emissionFacilities.length > 0) {
                analysisResults[tab.id] = {
                  status: "completed",
                  data: {
                    summary: `직접 파싱으로 배출시설 ${directParsingResults.emissionFacilities.length}개, 비대상시설 ${directParsingResults.nonEmissionFacilities.length}개를 추출했습니다.`,
                    facilities: directParsingResults.emissionFacilities,
                  },
                  structuredData: directParsingResults.emissionFacilities,
                  summary: `직접 파싱으로 배출시설 ${directParsingResults.emissionFacilities.length}개를 추출했습니다.`,
                  confidence: 0.95,
                  sources: relevantDocs.map((d) => d.originalName),
                  parsingMethod: "direct",
                };
              } else {
                analysisResults[tab.id] = { status: "skipped", reason: "배출시설 데이터 없음" };
              }
              break;

            case "preventionFacilities":
              if (directParsingResults.preventionFacilities.length > 0) {
                analysisResults[tab.id] = {
                  status: "completed",
                  data: {
                    summary: `직접 파싱으로 방지시설 ${directParsingResults.preventionFacilities.length}개를 추출했습니다.`,
                    facilities: directParsingResults.preventionFacilities,
                  },
                  structuredData: directParsingResults.preventionFacilities,
                  summary: `직접 파싱으로 방지시설 ${directParsingResults.preventionFacilities.length}개를 추출했습니다.`,
                  confidence: 0.95,
                  sources: relevantDocs.map((d) => d.originalName),
                  parsingMethod: "direct",
                };
              } else {
                analysisResults[tab.id] = { status: "skipped", reason: "방지시설 데이터 없음" };
              }
              break;

            case "stacks": {
              const totalPollutants = directParsingResults.pollutantEmissions.air.length +
                                      directParsingResults.pollutantEmissions.water.length +
                                      directParsingResults.pollutantEmissions.soil.length +
                                      directParsingResults.pollutantEmissions.waste.length;
              if (totalPollutants > 0) {
                analysisResults[tab.id] = {
                  status: "completed",
                  data: {
                    summary: `직접 파싱으로 오염물질 배출량 데이터 ${totalPollutants}건을 추출했습니다.`,
                    air: directParsingResults.pollutantEmissions.air,
                    water: directParsingResults.pollutantEmissions.water,
                    soil: directParsingResults.pollutantEmissions.soil,
                    waste: directParsingResults.pollutantEmissions.waste,
                  },
                  structuredData: directParsingResults.pollutantEmissions,
                  summary: `대기 ${directParsingResults.pollutantEmissions.air.length}건, 수질 ${directParsingResults.pollutantEmissions.water.length}건, 토양 ${directParsingResults.pollutantEmissions.soil.length}건, 폐기물 ${directParsingResults.pollutantEmissions.waste.length}건`,
                  confidence: 0.95,
                  sources: relevantDocs.map((d) => d.originalName),
                  parsingMethod: "direct",
                };
              } else {
                analysisResults[tab.id] = { status: "skipped", reason: "오염물질 배출량 데이터 없음" };
              }
              break;
            }

            case "processes":
              if (directParsingResults.majorProcesses.length > 0) {
                const processTree = buildProcessTree(
                  directParsingResults.majorProcesses,
                  directParsingResults.unitProcesses,
                  directParsingResults.processEmissions
                );
                analysisResults[tab.id] = {
                  status: "completed",
                  data: {
                    summary: `직접 파싱으로 대분류공정 ${directParsingResults.majorProcesses.length}개, 단위공정 ${directParsingResults.unitProcesses.length}개를 추출했습니다.`,
                    majorProcesses: directParsingResults.majorProcesses,
                    unitProcesses: directParsingResults.unitProcesses,
                    processEmissions: directParsingResults.processEmissions,
                    processTree,
                  },
                  structuredData: {
                    majorProcesses: directParsingResults.majorProcesses,
                    unitProcesses: directParsingResults.unitProcesses,
                    processEmissions: directParsingResults.processEmissions,
                    processTree,
                  },
                  summary: `대분류공정 ${directParsingResults.majorProcesses.length}개, 단위공정 ${directParsingResults.unitProcesses.length}개 추출`,
                  confidence: 0.95,
                  sources: relevantDocs.map((d) => d.originalName),
                  parsingMethod: "direct",
                };
              } else {
                analysisResults[tab.id] = { status: "skipped", reason: "공정 데이터 없음" };
              }
              break;

            case "substances": {
              const totalSubstances = directParsingResults.fuels.length + 
                                      directParsingResults.rawMaterials.length + 
                                      directParsingResults.chemicals.length + 
                                      directParsingResults.energies.length;
              if (totalSubstances > 0) {
                analysisResults[tab.id] = {
                  status: "completed",
                  data: {
                    summary: `직접 파싱으로 사용물질 ${totalSubstances}개를 추출했습니다.`,
                    fuels: directParsingResults.fuels,
                    rawMaterials: directParsingResults.rawMaterials,
                    chemicals: directParsingResults.chemicals,
                    energies: directParsingResults.energies,
                  },
                  structuredData: {
                    fuels: directParsingResults.fuels,
                    rawMaterials: directParsingResults.rawMaterials,
                    chemicals: directParsingResults.chemicals,
                    energies: directParsingResults.energies,
                  },
                  summary: `연료 ${directParsingResults.fuels.length}개, 원료 ${directParsingResults.rawMaterials.length}개, 화학물질 ${directParsingResults.chemicals.length}개, 에너지 ${directParsingResults.energies.length}개 추출`,
                  confidence: 0.95,
                  sources: relevantDocs.map((d) => d.originalName),
                  parsingMethod: "direct",
                };
              } else {
                analysisResults[tab.id] = { status: "skipped", reason: "사용물질 데이터 없음" };
              }
              break;
            }

            case "permits": {
              const hasPermitData = directParsingResults.permitEvents.length > 0 || 
                                    directParsingResults.permitEmissionChanges.length > 0;
              if (hasPermitData) {
                analysisResults[tab.id] = {
                  status: "completed",
                  data: {
                    summary: `직접 파싱으로 허가 추진경과 데이터를 추출했습니다.`,
                    events: directParsingResults.permitEvents,
                    emissionChanges: directParsingResults.permitEmissionChanges,
                  },
                  structuredData: {
                    events: directParsingResults.permitEvents,
                    emissionChanges: directParsingResults.permitEmissionChanges,
                  },
                  summary: `추진경과 ${directParsingResults.permitEvents.length}건, 발생량 변경 ${directParsingResults.permitEmissionChanges.length}건`,
                  confidence: 0.9,
                  sources: relevantDocs.map((d) => d.originalName),
                  parsingMethod: "direct",
                };
              } else {
                analysisResults[tab.id] = { status: "skipped", reason: "허가 데이터 없음" };
              }
              break;
            }

            default:
              // BAT, 모니터링, 규제현황 등은 직접 파싱 결과가 없으면 스킵
              analysisResults[tab.id] = { status: "skipped", reason: "직접 파싱 미지원 탭" };
              break;
          }
        }

        // 프로파일에 분석 결과 반영
        await sendEvent("progress", { stage: "saving", message: "파싱 결과 저장 중...", progress: 95 });

        // 1. 실제 탭 배열 필드에 구조화된 데이터 저장
        for (const [tabId, result] of Object.entries(analysisResults)) {
          if ((result as any).status === "completed" && (result as any).structuredData) {
            const structuredData = (result as any).structuredData;
            
            switch (tabId) {
              case "emissionFacilities":
                if (Array.isArray(structuredData) && structuredData.length > 0) {
                  profile.emissionFacilities = structuredData;
                  console.log(`[Parse] 배출시설 ${structuredData.length}개 저장`);
                }
                break;
                
              case "preventionFacilities":
                if (Array.isArray(structuredData) && structuredData.length > 0) {
                  profile.preventionFacilities = structuredData;
                  console.log(`[Parse] 방지시설 ${structuredData.length}개 저장`);
                }
                break;
                
              case "stacks":
                if (structuredData && typeof structuredData === "object") {
                  profile.stacks = structuredData;
                  console.log(`[Parse] 오염물질 배출량 데이터 저장`);
                }
                break;
                
              case "processes":
                if (structuredData && typeof structuredData === "object") {
                  profile.processes = structuredData;
                  console.log(`[Parse] 공정 데이터 저장`);
                }
                break;
                
              case "substances":
                if (structuredData && typeof structuredData === "object") {
                  profile.substances = {
                    ...profile.substances,
                    rawMaterials: structuredData.rawMaterials || profile.substances?.rawMaterials || [],
                    fuels: structuredData.fuels || profile.substances?.fuels || [],
                    chemicals: structuredData.chemicals || profile.substances?.chemicals || [],
                    airPollutants: profile.substances?.airPollutants || [],
                    waterPollutants: profile.substances?.waterPollutants || [],
                    ghgEmissions: profile.substances?.ghgEmissions || [],
                  };
                  console.log(`[Parse] 물질 데이터 저장`);
                }
                break;
                
              default:
                break;
            }
          }
        }

        // 2. tabData에 메타데이터 저장
        if (!profile.tabData) {
          profile.tabData = {};
        }

        for (const [tabId, result] of Object.entries(analysisResults)) {
          if ((result as any).status === "completed") {
            profile.tabData[tabId] = {
              summary: (result as any).summary || (result as any).data?.summary || "",
              sources: (result as any).sources,
              analyzedAt: new Date().toISOString(),
              confidence: (result as any).confidence,
              items: (result as any).data?.items || [],
              tables: (result as any).data?.tables || [],
              notes: (result as any).data?.notes || "",
            };
          }
        }

        profile.lastAnalyzedAt = new Date().toISOString();
        saveProfile(profile);
        
        console.log("[Parse] 프로파일 저장 완료");
        console.log("[Parse] 저장된 탭 데이터:", Object.keys(profile.tabData || {}));
        console.log("[Parse] 분석 결과 요약:", Object.entries(analysisResults).map(([k, v]: [string, any]) => ({
          tab: k,
          status: v.status,
          hasStructuredData: !!v.structuredData,
        })));

        await sendEvent("complete", {
          success: true,
          results: analysisResults,
          analyzedTabs: Object.keys(analysisResults).filter(
            (k) => (analysisResults[k] as any).status === "completed"
          ),
        });
      } catch (error: any) {
        console.error("[Parse] 파싱 프로세스 에러:", error);
        await sendEvent("error", { error: error.message });
      } finally {
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("[Parse] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
