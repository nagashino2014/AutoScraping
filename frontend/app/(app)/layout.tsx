import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-[#F2F4F7] p-4 gap-4">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <TopBar />
        <main className="flex-1 mt-4 min-h-0 relative rounded-3xl">
          {children}
        </main>
      </div>
    </div>
  );
}
