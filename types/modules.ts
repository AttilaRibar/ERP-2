import type { LucideIcon } from "lucide-react";

export interface DropdownItem {
  key: string;
  label: string;
  moduleKey: string;
  params?: Record<string, unknown>;
}

export interface ModuleDef {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
  group?: string;
  dropdownItems?: DropdownItem[];
}
