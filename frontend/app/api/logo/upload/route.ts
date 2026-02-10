import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

// 로고 저장 디렉토리
const LOGO_DIR = path.join(process.cwd(), "public", "logos", "CI");

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const profileId = formData.get("profileId") as string | null;

    if (!file) {
      return NextResponse.json({ success: false, error: "파일이 없습니다." }, { status: 400 });
    }

    if (!profileId) {
      return NextResponse.json({ success: false, error: "프로파일 ID가 없습니다." }, { status: 400 });
    }

    // 파일 크기 체크 (2MB)
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: "파일 크기는 2MB 이하여야 합니다." }, { status: 400 });
    }

    // 파일 타입 체크
    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ success: false, error: "png, jpg, webp 형식만 지원합니다." }, { status: 400 });
    }

    // 디렉토리가 없으면 생성
    if (!fs.existsSync(LOGO_DIR)) {
      fs.mkdirSync(LOGO_DIR, { recursive: true });
    }

    // 파일 확장자 추출
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const fileName = `${profileId}.${ext}`;
    const filePath = path.join(LOGO_DIR, fileName);

    // 기존 로고 파일 삭제 (다른 확장자일 수 있음)
    const existingFiles = fs.readdirSync(LOGO_DIR).filter(f => f.startsWith(`${profileId}.`));
    for (const existingFile of existingFiles) {
      fs.unlinkSync(path.join(LOGO_DIR, existingFile));
    }

    // 파일 저장
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    // 웹에서 접근 가능한 경로 반환
    const logoUrl = `/logos/CI/${fileName}`;

    return NextResponse.json({ 
      success: true, 
      logoUrl,
      message: "로고가 성공적으로 업로드되었습니다." 
    });

  } catch (error) {
    console.error("Logo upload error:", error);
    return NextResponse.json({ 
      success: false, 
      error: "로고 업로드 중 오류가 발생했습니다." 
    }, { status: 500 });
  }
}

// 로고 삭제 API
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get("profileId");

    if (!profileId) {
      return NextResponse.json({ success: false, error: "프로파일 ID가 없습니다." }, { status: 400 });
    }

    // 기존 로고 파일 삭제
    if (fs.existsSync(LOGO_DIR)) {
      const existingFiles = fs.readdirSync(LOGO_DIR).filter(f => f.startsWith(`${profileId}.`));
      for (const existingFile of existingFiles) {
        fs.unlinkSync(path.join(LOGO_DIR, existingFile));
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: "로고가 삭제되었습니다." 
    });

  } catch (error) {
    console.error("Logo delete error:", error);
    return NextResponse.json({ 
      success: false, 
      error: "로고 삭제 중 오류가 발생했습니다." 
    }, { status: 500 });
  }
}
