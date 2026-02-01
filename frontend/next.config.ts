import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ["pdf-parse", "mammoth", "xlsx", "adm-zip", "sql.js"],
};

export default nextConfig;
