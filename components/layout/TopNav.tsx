"use client";

import { useState, useEffect, useRef } from "react";
import { LogOut, ChevronDown, FolderKanban, X } from "lucide-react";
import { logoutAction } from "@/server/actions/auth";
import { getProjectsForSelect } from "@/server/actions/projects";
import { useProjectStore, type ProjectOption } from "@/stores/project-store";
import { GlobalSearch } from "./GlobalSearch";

interface TopNavProps {
  userName?: string;
  userEmail?: string;
}

/** Derives initials from a Cognito username or email. */
function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.split(/[.\s_@]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** Formats a display name. If it already looks like a real name, returns as-is. */
function formatDisplayName(name: string): string {
  if (!name) return "Felhasználó";
  // If it contains a space it's already a full name (e.g. "Kiss János")
  if (name.includes(" ")) return name;
  // Otherwise it's a username — capitalize first segment
  return name
    .split(/[._@]+/)[0]
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TopNav({ userName, userEmail }: TopNavProps) {
  const displayName = userName ? userName : formatDisplayName(userEmail ?? "");
  const initials = getInitials(userName ?? userEmail ?? "");

  const { selectedProject, projects, loaded, setSelectedProject, setProjects } = useProjectStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load projects on mount
  useEffect(() => {
    if (!loaded) {
      getProjectsForSelect().then(setProjects);
    }
  }, [loaded, setProjects]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  const handleSelect = (project: ProjectOption | null) => {
    setSelectedProject(project);
    setDropdownOpen(false);
  };

  return (
    <header className="flex items-center gap-3 px-4 h-[52px] bg-[var(--slate-800)] shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 text-[15px] font-semibold text-[var(--slate-50)] tracking-tight whitespace-nowrap">
        <div className="w-[26px] h-[26px] bg-[var(--indigo-600)] rounded-[6px] flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="white">
            <path d="M2 3h5v5H2zm7 0h5v5H9zM2 10h5v5H2zm7 0h5v5H9z" />
          </svg>
        </div>
        ERP 2
      </div>

      {/* Search bar */}
      <GlobalSearch />

      {/* Right section */}
      <div className="ml-auto flex items-center gap-[10px]">
        {/* Project selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((p) => !p)}
            className="flex items-center gap-[6px] bg-[var(--indigo-900)] border border-[var(--indigo-600)] text-[var(--indigo-300)] text-xs px-[10px] py-1 rounded-[6px] whitespace-nowrap hover:bg-[var(--indigo-800)] transition-colors cursor-pointer max-w-[220px]"
          >
            <FolderKanban size={12} className="shrink-0" />
            <span className="truncate">
              {selectedProject
                ? `${selectedProject.projectCode ?? ""} ${selectedProject.name}`.trim()
                : "Nincs projekt kiválasztva"}
            </span>
            <ChevronDown size={12} className="shrink-0 ml-auto" />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-[260px] bg-[var(--slate-800)] border border-[var(--slate-600)] rounded-lg shadow-xl z-50 py-1 max-h-[320px] overflow-y-auto">
              {/* No project option */}
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className={`w-full text-left px-3 py-[7px] text-xs flex items-center gap-2 transition-colors cursor-pointer ${
                  selectedProject === null
                    ? "bg-[var(--indigo-900)] text-[var(--indigo-300)]"
                    : "text-[var(--slate-300)] hover:bg-[var(--slate-700)]"
                }`}
              >
                <X size={11} className="shrink-0 text-[var(--slate-500)]" />
                <span className="italic">Nincs projekt kiválasztva</span>
              </button>

              {projects.length > 0 && (
                <div className="border-t border-[var(--slate-700)] my-1" />
              )}

              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(p)}
                  className={`w-full text-left px-3 py-[7px] text-xs flex items-center gap-2 transition-colors cursor-pointer ${
                    selectedProject?.id === p.id
                      ? "bg-[var(--indigo-900)] text-[var(--indigo-300)]"
                      : "text-[var(--slate-300)] hover:bg-[var(--slate-700)]"
                  }`}
                >
                  <span className="text-[var(--indigo-400)] font-mono shrink-0">{p.projectCode}</span>
                  <span className="truncate">{p.name}</span>
                </button>
              ))}

              {loaded && projects.length === 0 && (
                <div className="px-3 py-2 text-xs text-[var(--slate-500)]">Nincs aktív projekt</div>
              )}
            </div>
          )}
        </div>
        <span className="text-[var(--slate-300)] text-[13px]">{displayName}</span>
        <div className="w-[30px] h-[30px] rounded-full bg-[var(--indigo-600)] flex items-center justify-center text-white text-[11px] font-semibold border-2 border-[#6366f1]">
          {initials}
        </div>

        {/* Logout */}
        <form action={logoutAction}>
          <button
            type="submit"
            title="Kijelentkezés"
            className="w-[30px] h-[30px] flex items-center justify-center rounded-lg text-[var(--slate-400)] hover:text-[var(--slate-100)] hover:bg-[var(--slate-700)] transition-colors cursor-pointer"
            aria-label="Kijelentkezés"
          >
            <LogOut size={15} />
          </button>
        </form>
      </div>
    </header>
  );
}
