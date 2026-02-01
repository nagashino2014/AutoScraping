import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EcoMonitor AI",
  description: "환경정책·법령 모니터링 및 보고서 자동화 플랫폼",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
