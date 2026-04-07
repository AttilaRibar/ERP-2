import { create } from "zustand";

export type TabType = "list" | "create" | "edit" | "view";

export interface ErpTab {
  id: string;
  moduleKey: string;
  title: string;
  color: string;
  tabType: TabType;
  params?: Record<string, unknown>;
  isDirty?: boolean;
  isLoading?: boolean;
}

export interface TabStore {
  tabs: ErpTab[];
  activeTabId: string | null;
  openTab: (tab: Omit<ErpTab, "id" | "tabType"> & { tabType?: TabType }) => string;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<ErpTab>) => void;
  moveTab: (fromIndex: number, toIndex: number) => void;
}

function inferTabType(moduleKey: string, params?: Record<string, unknown>): TabType {
  if (!moduleKey.endsWith("-form")) return "list";
  const hasEntity = params && Object.values(params).some((v) => v != null);
  return hasEntity ? "view" : "create";
}

function dedupKey(moduleKey: string, params?: Record<string, unknown>): string {
  const sorted = params
    ? Object.keys(params)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => { acc[k] = params[k]; return acc; }, {})
    : {};
  return `${moduleKey}::${JSON.stringify(sorted)}`;
}

let counter = 0;
function newId() {
  counter++;
  return `tab-${counter}`;
}

const DEFAULT_TABS: ErpTab[] = [];

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: DEFAULT_TABS,
  activeTabId: null,

  openTab: (tab) => {
    const tabType = tab.tabType ?? inferTabType(tab.moduleKey, tab.params);
    const key = dedupKey(tab.moduleKey, tab.params);
    const existing = get().tabs.find(
      (t) => dedupKey(t.moduleKey, t.params) === key
    );
    if (existing) {
      const patch: Partial<ErpTab> = {};
      if (tab.tabType && tab.tabType !== existing.tabType) patch.tabType = tab.tabType;
      if (tab.title && tab.title !== existing.title) patch.title = tab.title;
      if (Object.keys(patch).length > 0) {
        set((s) => ({
          tabs: s.tabs.map((t) => t.id === existing.id ? { ...t, ...patch } : t),
          activeTabId: existing.id,
        }));
      } else {
        set({ activeTabId: existing.id });
      }
      return existing.id;
    }
    const id = newId();
    set((s) => ({
      tabs: [...s.tabs, { ...tab, tabType, id }],
      activeTabId: id,
    }));
    return id;
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const next = tabs.filter((t) => t.id !== id);
    let nextActive = activeTabId;
    if (activeTabId === id) {
      nextActive = next[Math.max(0, idx - 1)]?.id ?? null;
    }
    set({ tabs: next, activeTabId: nextActive });
  },

  activateTab: (id) => set({ activeTabId: id }),

  updateTab: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  moveTab: (from, to) =>
    set((s) => {
      const tabs = [...s.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { tabs };
    }),
}));
