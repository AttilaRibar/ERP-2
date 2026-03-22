import type { LucideIcon } from "lucide-react";

export interface ModuleDef {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
  group?: string;
}
