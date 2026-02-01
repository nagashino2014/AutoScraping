/**
 * 스케줄 목록 조회 API
 * GET /api/scraper/status/schedules
 */

import { NextResponse } from "next/server";
import { readScraperSchedules } from "@/lib/scraper/schedule-store";
import { readScraperTargets } from "@/lib/scraper/targets-store";

// Cron 표현식을 한글 설명으로 변환
function describeCron(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  const dayNames: Record<string, string> = {
    "0": "일", "1": "월", "2": "화", "3": "수", "4": "목", "5": "금", "6": "토",
    "SUN": "일", "MON": "월", "TUE": "화", "WED": "수", "THU": "목", "FRI": "금", "SAT": "토",
  };
  
  let description = "";
  
  // 매월 특정 일
  if (dayOfMonth !== "*" && dayOfWeek === "*") {
    description = `매월 ${dayOfMonth}일`;
  }
  // 매주 특정 요일
  else if (dayOfMonth === "*" && dayOfWeek !== "*") {
    const day = dayNames[dayOfWeek.toUpperCase()] || dayOfWeek;
    description = `매주 ${day}요일`;
  }
  // 매일
  else if (dayOfMonth === "*" && dayOfWeek === "*") {
    description = "매일";
  }
  else {
    description = cron;
  }
  
  // 시간 추가
  if (hour !== "*" && minute !== "*") {
    description += ` ${hour}:${minute.padStart(2, "0")}`;
  }
  
  return description;
}

// Cron에서 다음 실행 시간들 계산 (간단한 버전)
function getNextRuns(cron: string, count: number = 7): Date[] {
  const parts = cron.split(" ");
  if (parts.length !== 5) return [];
  
  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;
  const runs: Date[] = [];
  const now = new Date();
  
  for (let i = 0; i < 30 && runs.length < count; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    date.setHours(parseInt(hour) || 0);
    date.setMinutes(parseInt(minute) || 0);
    date.setSeconds(0);
    date.setMilliseconds(0);
    
    let matches = false;
    
    // 매일
    if (dayOfMonth === "*" && dayOfWeek === "*") {
      matches = true;
    }
    // 특정 요일
    else if (dayOfMonth === "*" && dayOfWeek !== "*") {
      matches = date.getDay() === parseInt(dayOfWeek);
    }
    // 특정 일
    else if (dayOfMonth !== "*") {
      matches = date.getDate() === parseInt(dayOfMonth);
    }
    
    if (matches && date > now) {
      runs.push(date);
    }
  }
  
  return runs;
}

export async function GET() {
  try {
    const schedulesData = readScraperSchedules();
    const { orgs, boards } = readScraperTargets();
    
    const orgMap = new Map(orgs.map((o) => [o.org_id, o]));
    const boardMap = new Map(boards.map((b) => [b.board_id, b]));
    
    const schedules = schedulesData.schedules.map((sched) => {
      const targetBoards = sched.targets.map((boardId) => {
        const board = boardMap.get(boardId);
        const org = board ? orgMap.get(board.org_id) : null;
        return {
          board_id: boardId,
          board_name: board?.board_name || boardId,
          org_id: board?.org_id || "",
          org_name: org?.org_name || "",
          org_logo: org?.logo_path || null,
        };
      });
      
      const nextRuns = getNextRuns(sched.cron, 7);
      
      return {
        schedule_id: sched.schedule_id,
        name: sched.name,
        cron: sched.cron,
        cron_description: describeCron(sched.cron),
        enabled: sched.enabled,
        targets: targetBoards,
        next_runs: nextRuns.map((d) => d.toISOString()),
      };
    });
    
    return NextResponse.json({
      success: true,
      schedules,
    });
  } catch (error) {
    console.error("[status/schedules] Error:", error);
    return NextResponse.json(
      { success: false, error: "스케줄 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
