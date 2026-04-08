import type { ReactNode } from "react";

export default function SettleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-bold">E</span>
          </div>
          <span className="text-sm font-semibold text-gray-700">
            Alvállalkozói Elszámolás
          </span>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
