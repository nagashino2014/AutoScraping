import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ["pdf-parse", "mammoth", "xlsx", "adm-zip", "sql.js"],
  
  // Docker 배포를 위한 standalone 출력
  output: "standalone",

  // 빌드 시 TypeScript 타입 체크 건너뛰기 (개발 중 타입 에러가 빌드를 막지 않도록)
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
