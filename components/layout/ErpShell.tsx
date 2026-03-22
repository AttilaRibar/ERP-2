"use client";

import { TopNav } from "./TopNav";
import { ModuleNav } from "./ModuleNav";
import { TabBar } from "./TabBar";
import { TabContent } from "./TabContent";

interface ErpShellProps {
  userName?: string;
  userEmail?: string;
}

export function ErpShell({ userName, userEmail }: ErpShellProps) {
  return (
    <div className="flex flex-col h-screen bg-[var(--background)] overflow-hidden relative">
      <TopNav userName={userName} userEmail={userEmail} />
      <ModuleNav />
      <TabBar />

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        <TabContent />
      </div>

    </div>
  );
}
