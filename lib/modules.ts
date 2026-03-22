import {
  Users,
  FolderKanban,
  FileText,
  Calculator,
  Settings,
  Bot,
  BarChart2,
} from "lucide-react";
import type { ModuleDef } from "@/types/modules";

export const MODULE_REGISTRY: ModuleDef[] = [
  { key: "partners", label: "Partnerek", icon: Users, color: "#8b5cf6" },
  { key: "projects", label: "Projektek", icon: FolderKanban, color: "#06b6d4" },
  { key: "quotes", label: "Ajánlatok", icon: FileText, color: "#22c55e" },
  { key: "budgets", label: "Költségvetések", icon: Calculator, color: "#f59e0b" },
  { key: "reports", label: "Kimutatások", icon: BarChart2, color: "#6366f1" },
  { key: "ai-assistant", label: "AI Asszisztens", icon: Bot, color: "#10b981", group: "sep" },
  { key: "settings", label: "Beállítások", icon: Settings, color: "#94a3b8", group: "sep" },
];
