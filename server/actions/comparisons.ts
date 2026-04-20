"use server";

import { db } from "@/lib/db";
import { savedComparisons } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

// UI state saved for simple (2-version) compare
export interface SimpleCompareState {
  swapped: boolean;
  showUnchanged: boolean;
  viewMode: "items" | "sections";
  showQtyChange: boolean;
}

// UI state saved for multi-version compare
export interface MultiCompareState {
  viewMode: "overview" | "sections" | "variance";
  skipZero: boolean;
  hiddenVersionIdxs: number[];   // array of original indices
  versionOrder: number[];        // array of original indices
  referenceVersionIdx: number | null;
}

export type CompareType = "simple" | "multi";
export type CompareState = SimpleCompareState | MultiCompareState;

export interface SavedComparison {
  id: number;
  budgetId: number;
  name: string;
  versionIds: number[];
  versionNames: string[];
  compareType: CompareType;
  state: CompareState;
  createdAt: Date | null;
}

function rowToComparison(row: typeof savedComparisons.$inferSelect): SavedComparison {
  return {
    id: row.id,
    budgetId: row.budgetId,
    name: row.name,
    versionIds: JSON.parse(row.versionIds) as number[],
    versionNames: JSON.parse(row.versionNames) as string[],
    compareType: row.compareType as CompareType,
    state: JSON.parse(row.state) as CompareState,
    createdAt: row.createdAt,
  };
}

export async function getSavedComparisons(budgetId: number): Promise<SavedComparison[]> {
  const rows = await db
    .select()
    .from(savedComparisons)
    .where(eq(savedComparisons.budgetId, budgetId))
    .orderBy(desc(savedComparisons.createdAt));

  return rows.map(rowToComparison);
}

export async function createSavedComparison(
  budgetId: number,
  name: string,
  versionIds: number[],
  versionNames: string[],
  compareType: CompareType,
  state: CompareState
): Promise<{ success: boolean; data?: SavedComparison; error?: string }> {
  if (!name.trim()) return { success: false, error: "A név megadása kötelező" };
  if (versionIds.length < 2) return { success: false, error: "Legalább 2 verzió szükséges" };

  const [row] = await db
    .insert(savedComparisons)
    .values({
      budgetId,
      name: name.trim(),
      versionIds: JSON.stringify(versionIds),
      versionNames: JSON.stringify(versionNames),
      compareType,
      state: JSON.stringify(state),
    })
    .returning();

  return { success: true, data: rowToComparison(row) };
}

export async function deleteSavedComparison(id: number): Promise<{ success: boolean }> {
  await db.delete(savedComparisons).where(eq(savedComparisons.id, id));
  return { success: true };
}

export async function renameSavedComparison(
  id: number,
  name: string
): Promise<{ success: boolean; error?: string }> {
  if (!name.trim()) return { success: false, error: "A név megadása kötelező" };
  await db
    .update(savedComparisons)
    .set({ name: name.trim(), updatedAt: new Date() })
    .where(eq(savedComparisons.id, id));
  return { success: true };
}
