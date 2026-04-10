import {
  Users,
  FolderKanban,
  FileText,
  Calculator,
  Settings,
  Bot,
  BarChart2,
  Layers,
  ClipboardList,
  TextSearch,
} from "lucide-react";
import type { ModuleDef } from "@/types/modules";

export const MODULE_REGISTRY: ModuleDef[] = [
  { key: "partners", label: "Partnerek", icon: Users, color: "#8b5cf6" },
  { key: "projects", label: "Projektek", icon: FolderKanban, color: "#06b6d4" },
  { key: "quotes", label: "Ajánlatok", icon: FileText, color: "#22c55e" },
  { key: "budgets", label: "Költségvetések", icon: Calculator, color: "#f59e0b" },
  { key: "scenarios", label: "Szcenáriók", icon: Layers, color: "#ec4899" },
  { key: "settlements", label: "Alvállalkozói elszámolás", icon: ClipboardList, color: "#0ea5e9" },
  { key: "items", label: "Tételek", icon: TextSearch, color: "#8b5cf6" },
  { key: "reports", label: "Kimutatások", icon: BarChart2, color: "#6366f1", dropdownItems: [
    { key: "reports-general", label: "Általános kimutatás", moduleKey: "reports" },
    { key: "reports-finance", label: "Pénzügyi kimutatás", moduleKey: "reports", params: { report: "finance" } },
    { key: "reports-projects", label: "Projekt összesítő", moduleKey: "reports", params: { report: "projects" } },
    { key: "reports-partners", label: "Partner statisztika", moduleKey: "reports", params: { report: "partners" } },
  ]},
  { key: "ai-assistant", label: "AI Asszisztens", icon: Bot, color: "#10b981", group: "sep" },
  { key: "settings", label: "Beállítások", icon: Settings, color: "#94a3b8", group: "sep" },
];
