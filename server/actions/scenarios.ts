"use server";

import { db } from "@/lib/db";
import {
  costScenarios,
  costScenarioLayers,
  projects,
  versions,
  budgets,
  partners,
} from "@/lib/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { z } from "zod";
import {
  getVersionItems,
  getVersionSections,
  type ReconstructedItem,
  type ReconstructedSection,
} from "./versions";

// ---- Types ----

export interface ScenarioInfo {
  id: number;
  projectId: number;
  projectName: string | null;
  projectCode: string | null;
  name: string;
  description: string;
  layerCount: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export type PriceComponent = "both" | "material" | "fee";

export interface ScenarioLayerInfo {
  id: number;
  scenarioId: number;
  versionId: number;
  layerOrder: number;
  label: string;
  versionName: string;
  versionType: string;
  budgetId: number;
  budgetName: string;
  partnerName: string | null;
  /** Which price component (material/fee/both) this layer contributes */
  priceComponent: PriceComponent;
  /** Whether to substitute the cheapest alternative for each item */
  useCheapestAlternative: boolean;
}

export interface ScenarioDetail {
  id: number;
  projectId: number;
  projectName: string | null;
  projectCode: string | null;
  name: string;
  description: string;
  layers: ScenarioLayerInfo[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ResolvedScenarioItem {
  itemCode: string;
  sequenceNo: number;
  itemNumber: string;
  name: string;
  quantity: number;
  unit: string;
  materialUnitPrice: number;
  feeUnitPrice: number;
  notes: string;
  sectionCode: string | null;
  /** Which layer provided the material price */
  materialSourceLayerOrder: number;
  materialSourceLayerLabel: string;
  /** Which layer provided the fee price */
  feeSourceLayerOrder: number;
  feeSourceLayerLabel: string;
  /** True when material and fee come from the same layer */
  hasSingleSource: boolean;
  /** True if no layer had a non-zero price for this item */
  isUnpriced: boolean;
  /** Name of the alternative item used for material price (null if base item) */
  materialAlternativeName: string | null;
  /** Name of the alternative item used for fee price (null if base item) */
  feeAlternativeName: string | null;
}

export type OptimizationStrategy = "none" | "component" | "item" | "category";

export interface OptimizationOptions {
  strategy: OptimizationStrategy;
  skipZeroItems: boolean;
}

export interface ResolvedScenarioResult {
  items: ResolvedScenarioItem[];
  sections: ReconstructedSection[];
  layers: ScenarioLayerInfo[];
  totalMaterial: number;
  totalFee: number;
  unpricedCount: number;
  optimization: OptimizationOptions;
}

export interface AvailableVersion {
  id: number;
  versionName: string;
  versionType: string;
  budgetId: number;
  budgetName: string;
  projectId: number;
  partnerName: string | null;
}

// ---- Validation ----

const ScenarioSchema = z.object({
  name: z.string().min(1, "A szcenárió neve kötelező").max(200),
  description: z.string().max(1000).default(""),
  projectId: z.number().int().positive("Projekt kiválasztása kötelező"),
});

const LayerSchema = z.object({
  versionId: z.number().int().positive(),
  layerOrder: z.number().int().min(0),
  label: z.string().max(200).default(""),
  priceComponent: z.enum(["both", "material", "fee"]).default("both"),
  useCheapestAlternative: z.boolean().default(false),
});

// ---- Queries ----

export async function getScenarios(
  search?: string,
  projectFilter?: number
): Promise<ScenarioInfo[]> {
  const result = await db.execute(sql`
    SELECT
      cs.id,
      cs.project_id,
      p.name AS project_name,
      p.project_code,
      cs.name,
      cs.description,
      cs.created_at,
      cs.updated_at,
      COUNT(csl.id)::int AS layer_count
    FROM cost_scenarios cs
    JOIN projects p ON p.id = cs.project_id
    LEFT JOIN cost_scenario_layers csl ON csl.scenario_id = cs.id
    WHERE 1=1
      ${search ? sql`AND (cs.name ILIKE ${"%" + search + "%"} OR cs.description ILIKE ${"%" + search + "%"})` : sql``}
      ${projectFilter ? sql`AND cs.project_id = ${projectFilter}` : sql``}
    GROUP BY cs.id, cs.project_id, p.name, p.project_code, cs.name, cs.description, cs.created_at, cs.updated_at
    ORDER BY cs.updated_at DESC
  `);

  const rows = result as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    projectId: Number(r.project_id),
    projectName: r.project_name ? String(r.project_name) : null,
    projectCode: r.project_code ? String(r.project_code) : null,
    name: String(r.name),
    description: String(r.description),
    layerCount: Number(r.layer_count),
    createdAt: r.created_at ? new Date(String(r.created_at)) : null,
    updatedAt: r.updated_at ? new Date(String(r.updated_at)) : null,
  }));
}

export async function getScenarioById(id: number): Promise<ScenarioDetail | null> {
  const [scenario] = await db
    .select({
      id: costScenarios.id,
      projectId: costScenarios.projectId,
      projectName: projects.name,
      projectCode: projects.projectCode,
      name: costScenarios.name,
      description: costScenarios.description,
      createdAt: costScenarios.createdAt,
      updatedAt: costScenarios.updatedAt,
    })
    .from(costScenarios)
    .leftJoin(projects, eq(costScenarios.projectId, projects.id))
    .where(eq(costScenarios.id, id));

  if (!scenario) return null;

  const layerRows = await db
    .select({
      id: costScenarioLayers.id,
      scenarioId: costScenarioLayers.scenarioId,
      versionId: costScenarioLayers.versionId,
      layerOrder: costScenarioLayers.layerOrder,
      label: costScenarioLayers.label,
      priceComponent: costScenarioLayers.priceComponent,
      useCheapestAlternative: costScenarioLayers.useCheapestAlternative,
      versionName: versions.versionName,
      versionType: versions.versionType,
      budgetId: versions.budgetId,
      budgetName: budgets.name,
      partnerName: partners.name,
    })
    .from(costScenarioLayers)
    .innerJoin(versions, eq(costScenarioLayers.versionId, versions.id))
    .innerJoin(budgets, eq(versions.budgetId, budgets.id))
    .leftJoin(partners, eq(versions.partnerId, partners.id))
    .where(eq(costScenarioLayers.scenarioId, id))
    .orderBy(costScenarioLayers.layerOrder);

  return {
    ...scenario,
    layers: layerRows.map((l) => ({
      ...l,
      versionType: l.versionType ?? "offer",
      budgetName: l.budgetName ?? "",
      partnerName: l.partnerName,
      priceComponent: (l.priceComponent ?? "both") as PriceComponent,
      useCheapestAlternative: l.useCheapestAlternative ?? false,
    })),
  };
}

export async function getAvailableVersionsForProject(
  projectId: number
): Promise<AvailableVersion[]> {
  const result = await db
    .select({
      id: versions.id,
      versionName: versions.versionName,
      versionType: versions.versionType,
      budgetId: versions.budgetId,
      budgetName: budgets.name,
      projectId: budgets.projectId,
      partnerName: partners.name,
    })
    .from(versions)
    .innerJoin(budgets, eq(versions.budgetId, budgets.id))
    .leftJoin(partners, eq(versions.partnerId, partners.id))
    .where(eq(budgets.projectId, projectId))
    .orderBy(budgets.name, versions.createdAt);

  return result.map((r) => ({
    ...r,
    versionType: r.versionType ?? "offer",
    budgetName: r.budgetName ?? "",
    partnerName: r.partnerName,
  }));
}

export async function getProjectsList(): Promise<
  { id: number; name: string; projectCode: string | null }[]
> {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      projectCode: projects.projectCode,
    })
    .from(projects)
    .orderBy(projects.name);
}

// ---- Mutations ----

export async function createScenario(
  data: { name: string; description?: string; projectId: number },
  layers: { versionId: number; layerOrder: number; label: string; priceComponent?: PriceComponent; useCheapestAlternative?: boolean }[]
): Promise<{ success: boolean; data?: ScenarioDetail; error?: string }> {
  const parsed = ScenarioSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  for (const layer of layers) {
    const lParsed = LayerSchema.safeParse(layer);
    if (!lParsed.success) return { success: false, error: lParsed.error.issues[0].message };
  }

  if (layers.length === 0) {
    return { success: false, error: "Legalább egy réteg szükséges" };
  }

  const [created] = await db
    .insert(costScenarios)
    .values({
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      description: parsed.data.description ?? "",
    })
    .returning();

  if (layers.length > 0) {
    await db.insert(costScenarioLayers).values(
      layers.map((l) => ({
        scenarioId: created.id,
        versionId: l.versionId,
        layerOrder: l.layerOrder,
        label: l.label,
        priceComponent: l.priceComponent ?? "both",
        useCheapestAlternative: l.useCheapestAlternative ?? false,
      }))
    );
  }

  const detail = await getScenarioById(created.id);
  return { success: true, data: detail! };
}

export async function updateScenario(
  id: number,
  data: { name: string; description?: string; projectId: number },
  layers: { versionId: number; layerOrder: number; label: string; priceComponent?: PriceComponent; useCheapestAlternative?: boolean }[]
): Promise<{ success: boolean; data?: ScenarioDetail; error?: string }> {
  const parsed = ScenarioSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  for (const layer of layers) {
    const lParsed = LayerSchema.safeParse(layer);
    if (!lParsed.success) return { success: false, error: lParsed.error.issues[0].message };
  }

  if (layers.length === 0) {
    return { success: false, error: "Legalább egy réteg szükséges" };
  }

  await db
    .update(costScenarios)
    .set({
      name: parsed.data.name,
      description: parsed.data.description ?? "",
      projectId: parsed.data.projectId,
      updatedAt: new Date(),
    })
    .where(eq(costScenarios.id, id));

  // Replace all layers
  await db.delete(costScenarioLayers).where(eq(costScenarioLayers.scenarioId, id));

  if (layers.length > 0) {
    await db.insert(costScenarioLayers).values(
      layers.map((l) => ({
        scenarioId: id,
        versionId: l.versionId,
        layerOrder: l.layerOrder,
        label: l.label,
        priceComponent: l.priceComponent ?? "both",
        useCheapestAlternative: l.useCheapestAlternative ?? false,
      }))
    );
  }

  const detail = await getScenarioById(id);
  return { success: true, data: detail! };
}

export async function deleteScenario(
  id: number
): Promise<{ success: boolean; error?: string }> {
  await db.delete(costScenarioLayers).where(eq(costScenarioLayers.scenarioId, id));
  await db.delete(costScenarios).where(eq(costScenarios.id, id));
  return { success: true };
}

// ---- Resolve (Flatten) ----

export async function resolveScenario(
  scenarioId: number,
  optimization?: OptimizationOptions
): Promise<ResolvedScenarioResult | null> {
  const detail = await getScenarioById(scenarioId);
  if (!detail || detail.layers.length === 0) return null;

  const opt: OptimizationOptions = optimization ?? { strategy: "none", skipZeroItems: false };

  // Sort layers by layerOrder ascending (lowest = bottom/base, highest = top priority)
  const sortedLayers = [...detail.layers].sort((a, b) => a.layerOrder - b.layerOrder);

  // Fetch all layers' items and sections in parallel
  const [layerItemSets, layerSectionSets] = await Promise.all([
    Promise.all(sortedLayers.map((l) => getVersionItems(l.versionId))),
    Promise.all(sortedLayers.map((l) => getVersionSections(l.versionId))),
  ]);

  // ---- Helper: compute effective prices for a single layer ----
  type LayerPrice = {
    materialUnitPrice: number;
    feeUnitPrice: number;
    baseItem: ReconstructedItem;
    materialAltName: string | null;
    feeAltName: string | null;
  };

  function getEffectivePrices(
    items: ReconstructedItem[],
    useCheapestAlternative: boolean,
    priceComponent: PriceComponent
  ): Map<string, LayerPrice> {
    const result = new Map<string, LayerPrice>();

    const altsByBaseCode = new Map<string, ReconstructedItem[]>();
    for (const item of items) {
      if (item.alternativeOfItemCode) {
        const list = altsByBaseCode.get(item.alternativeOfItemCode) ?? [];
        list.push(item);
        altsByBaseCode.set(item.alternativeOfItemCode, list);
      }
    }

    for (const baseItem of items) {
      if (baseItem.alternativeOfItemCode !== null) continue;

      const matchKey = baseItem.itemNumber?.trim() || baseItem.itemCode;
      let bestMaterial = baseItem.materialUnitPrice;
      let bestFee = baseItem.feeUnitPrice;
      let materialAltName: string | null = null;
      let feeAltName: string | null = null;

      if (useCheapestAlternative) {
        const candidates = [baseItem, ...(altsByBaseCode.get(baseItem.itemCode) ?? [])];
        if (priceComponent === "material") {
          const priced = candidates.filter((c) => c.materialUnitPrice > 0);
          if (priced.length > 0) {
            const winner = priced.reduce((best, c) =>
              c.materialUnitPrice < best.materialUnitPrice ? c : best
            );
            bestMaterial = winner.materialUnitPrice;
            if (winner.itemCode !== baseItem.itemCode) materialAltName = winner.name;
          } else {
            bestMaterial = 0;
          }
        } else if (priceComponent === "fee") {
          const priced = candidates.filter((c) => c.feeUnitPrice > 0);
          if (priced.length > 0) {
            const winner = priced.reduce((best, c) =>
              c.feeUnitPrice < best.feeUnitPrice ? c : best
            );
            bestFee = winner.feeUnitPrice;
            if (winner.itemCode !== baseItem.itemCode) feeAltName = winner.name;
          } else {
            bestFee = 0;
          }
        } else {
          const priced = candidates.filter(
            (c) => c.materialUnitPrice > 0 || c.feeUnitPrice > 0
          );
          if (priced.length > 0) {
            const cheapest = priced.reduce((best, c) =>
              c.materialUnitPrice + c.feeUnitPrice < best.materialUnitPrice + best.feeUnitPrice
                ? c
                : best
            );
            bestMaterial = cheapest.materialUnitPrice;
            bestFee = cheapest.feeUnitPrice;
            if (cheapest.itemCode !== baseItem.itemCode) {
              materialAltName = cheapest.name;
              feeAltName = cheapest.name;
            }
          }
        }
      }

      result.set(matchKey, {
        materialUnitPrice: bestMaterial,
        feeUnitPrice: bestFee,
        baseItem,
        materialAltName,
        feeAltName,
      });
    }

    return result;
  }

  // ---- Precompute effective prices per layer ----
  const effectivePricesPerLayer = sortedLayers.map((layer, i) =>
    getEffectivePrices(
      layerItemSets[i],
      layer.useCheapestAlternative ?? false,
      (layer.priceComponent ?? "both") as PriceComponent
    )
  );

  // ---- Build three separate maps ----
  type ItemBase = { item: ReconstructedItem; sourceLayer: ScenarioLayerInfo };
  type PriceEntry = { price: number; sourceLayer: ScenarioLayerInfo; altName: string | null };

  const itemBaseMap = new Map<string, ItemBase>();
  const materialMap = new Map<string, PriceEntry>();
  const feeMap = new Map<string, PriceEntry>();

  if (opt.strategy === "none") {
    // ---- CASCADE: existing layer-priority logic (bottom → top) ----
    for (let i = 0; i < sortedLayers.length; i++) {
      const layer = sortedLayers[i];
      const priceComponent = layer.priceComponent ?? "both";

      for (const [matchKey, layerPrice] of effectivePricesPerLayer[i]) {
        itemBaseMap.set(matchKey, { item: layerPrice.baseItem, sourceLayer: layer });

        if (priceComponent === "both" || priceComponent === "material") {
          const existing = materialMap.get(matchKey);
          if (!existing || layerPrice.materialUnitPrice > 0) {
            materialMap.set(matchKey, {
              price: layerPrice.materialUnitPrice,
              sourceLayer: layer,
              altName: layerPrice.materialAltName,
            });
          }
        }

        if (priceComponent === "both" || priceComponent === "fee") {
          const existing = feeMap.get(matchKey);
          if (!existing || layerPrice.feeUnitPrice > 0) {
            feeMap.set(matchKey, {
              price: layerPrice.feeUnitPrice,
              sourceLayer: layer,
              altName: layerPrice.feeAltName,
            });
          }
        }
      }
    }
  } else {
    // ---- OPTIMIZATION: cross-layer cheapest selection ----
    type ItemLayerEntry = {
      layerIndex: number;
      layer: ScenarioLayerInfo;
      priceComponent: PriceComponent;
      materialUnitPrice: number;
      feeUnitPrice: number;
      baseItem: ReconstructedItem;
      materialAltName: string | null;
      feeAltName: string | null;
    };

    // Build per-item availability across all layers
    const itemLayerMap = new Map<string, ItemLayerEntry[]>();
    for (let i = 0; i < sortedLayers.length; i++) {
      const layer = sortedLayers[i];
      const pc = (layer.priceComponent ?? "both") as PriceComponent;
      for (const [matchKey, lp] of effectivePricesPerLayer[i]) {
        const entries = itemLayerMap.get(matchKey) ?? [];
        entries.push({
          layerIndex: i,
          layer,
          priceComponent: pc,
          materialUnitPrice: lp.materialUnitPrice,
          feeUnitPrice: lp.feeUnitPrice,
          baseItem: lp.baseItem,
          materialAltName: lp.materialAltName,
          feeAltName: lp.feeAltName,
        });
        itemLayerMap.set(matchKey, entries);
      }
    }

    if (opt.strategy === "component") {
      // ---- COMPONENT: cheapest material + cheapest fee independently per item ----
      for (const [matchKey, entries] of itemLayerMap) {
        const topEntry = entries[entries.length - 1];
        itemBaseMap.set(matchKey, { item: topEntry.baseItem, sourceLayer: topEntry.layer });

        // Material: only from layers that contribute material
        const matEntries = entries.filter(
          (e) => e.priceComponent === "both" || e.priceComponent === "material"
        );
        const matCandidates = opt.skipZeroItems
          ? matEntries.filter((e) => e.materialUnitPrice > 0)
          : matEntries;
        if (matCandidates.length > 0) {
          const best = matCandidates.reduce((a, b) =>
            a.materialUnitPrice <= b.materialUnitPrice ? a : b
          );
          materialMap.set(matchKey, {
            price: best.materialUnitPrice,
            sourceLayer: best.layer,
            altName: best.materialAltName,
          });
        } else if (matEntries.length > 0) {
          const first = matEntries[0];
          materialMap.set(matchKey, {
            price: first.materialUnitPrice,
            sourceLayer: first.layer,
            altName: first.materialAltName,
          });
        }

        // Fee: only from layers that contribute fee
        const feeEntries = entries.filter(
          (e) => e.priceComponent === "both" || e.priceComponent === "fee"
        );
        const feeCandidates = opt.skipZeroItems
          ? feeEntries.filter((e) => e.feeUnitPrice > 0)
          : feeEntries;
        if (feeCandidates.length > 0) {
          const best = feeCandidates.reduce((a, b) =>
            a.feeUnitPrice <= b.feeUnitPrice ? a : b
          );
          feeMap.set(matchKey, {
            price: best.feeUnitPrice,
            sourceLayer: best.layer,
            altName: best.feeAltName,
          });
        } else if (feeEntries.length > 0) {
          const first = feeEntries[0];
          feeMap.set(matchKey, {
            price: first.feeUnitPrice,
            sourceLayer: first.layer,
            altName: first.feeAltName,
          });
        }
      }
    } else if (opt.strategy === "item") {
      // ---- ITEM: cheapest (material + fee) total per item from single layer ----
      for (const [matchKey, entries] of itemLayerMap) {
        const topEntry = entries[entries.length - 1];
        itemBaseMap.set(matchKey, { item: topEntry.baseItem, sourceLayer: topEntry.layer });

        const rated = entries.map((e) => ({
          ...e,
          effectiveTotal: e.materialUnitPrice + e.feeUnitPrice,
        }));
        const candidates = opt.skipZeroItems
          ? rated.filter((e) => e.effectiveTotal > 0)
          : rated;

        if (candidates.length > 0) {
          const best = candidates.reduce((a, b) =>
            a.effectiveTotal <= b.effectiveTotal ? a : b
          );
          materialMap.set(matchKey, {
            price: best.materialUnitPrice,
            sourceLayer: best.layer,
            altName: best.materialAltName,
          });
          feeMap.set(matchKey, {
            price: best.feeUnitPrice,
            sourceLayer: best.layer,
            altName: best.feeAltName,
          });
        } else if (entries.length > 0) {
          const first = entries[0];
          materialMap.set(matchKey, {
            price: first.materialUnitPrice,
            sourceLayer: first.layer,
            altName: first.materialAltName,
          });
          feeMap.set(matchKey, {
            price: first.feeUnitPrice,
            sourceLayer: first.layer,
            altName: first.feeAltName,
          });
        }
      }
    } else if (opt.strategy === "category") {
      // ---- CATEGORY: cheapest layer per root section ----

      // Build section parent lookup from all layers
      const sectionParents = new Map<string, string | null>();
      for (const sectionSet of layerSectionSets) {
        for (const sec of sectionSet) {
          sectionParents.set(sec.sectionCode, sec.parentSectionCode);
        }
      }

      // Find root section for a given sectionCode
      const rootCache = new Map<string, string>();
      function findRootSection(code: string): string {
        if (rootCache.has(code)) return rootCache.get(code)!;
        const parent = sectionParents.get(code);
        if (!parent) {
          rootCache.set(code, code);
          return code;
        }
        const root = findRootSection(parent);
        rootCache.set(code, root);
        return root;
      }

      // Group item matchKeys by root section
      const rootSectionItems = new Map<string, Set<string>>();
      for (const [matchKey, entries] of itemLayerMap) {
        const sectionCode = entries[0].baseItem.sectionCode;
        const rootCode = sectionCode ? findRootSection(sectionCode) : "__unsectioned__";
        const set = rootSectionItems.get(rootCode) ?? new Set();
        set.add(matchKey);
        rootSectionItems.set(rootCode, set);
      }

      // For each root section, find the cheapest layer
      for (const [, matchKeys] of rootSectionItems) {
        // Compute total per layer for all items in this section
        const layerTotals: {
          layerIndex: number;
          layer: ScenarioLayerInfo;
          total: number;
          itemCount: number;
        }[] = [];

        for (let i = 0; i < sortedLayers.length; i++) {
          let total = 0;
          let itemCount = 0;
          for (const mk of matchKeys) {
            const entries = itemLayerMap.get(mk);
            const entry = entries?.find((e) => e.layerIndex === i);
            if (entry) {
              total +=
                entry.baseItem.quantity *
                (entry.materialUnitPrice + entry.feeUnitPrice);
              itemCount++;
            }
          }
          if (itemCount > 0) {
            layerTotals.push({
              layerIndex: i,
              layer: sortedLayers[i],
              total,
              itemCount,
            });
          }
        }

        // Pick cheapest
        const candidates = opt.skipZeroItems
          ? layerTotals.filter((lt) => lt.total > 0)
          : layerTotals;

        const winnerLayerIndex =
          candidates.length > 0
            ? candidates.reduce((a, b) => (a.total <= b.total ? a : b)).layerIndex
            : layerTotals.length > 0
              ? layerTotals[0].layerIndex
              : 0;

        // Apply winner layer to all items in this section; fallback if item not in winner
        for (const mk of matchKeys) {
          const entries = itemLayerMap.get(mk)!;
          const winnerEntry = entries.find((e) => e.layerIndex === winnerLayerIndex);
          const bestEntry = winnerEntry ?? entries[entries.length - 1];

          itemBaseMap.set(mk, {
            item: bestEntry.baseItem,
            sourceLayer: bestEntry.layer,
          });
          materialMap.set(mk, {
            price: bestEntry.materialUnitPrice,
            sourceLayer: bestEntry.layer,
            altName: bestEntry.materialAltName,
          });
          feeMap.set(mk, {
            price: bestEntry.feeUnitPrice,
            sourceLayer: bestEntry.layer,
            altName: bestEntry.feeAltName,
          });
        }
      }
    }
  }

  // ---- Merge sections (highest layer wins per sectionCode) ----
  const sectionMap = new Map<string, ReconstructedSection>();
  for (let i = 0; i < sortedLayers.length; i++) {
    for (const sec of layerSectionSets[i]) {
      sectionMap.set(sec.sectionCode, sec);
    }
  }
  const mergedSections = Array.from(sectionMap.values()).sort(
    (a, b) => a.sequenceNo - b.sequenceNo || a.id - b.id
  );

  // ---- Build resolved items list ----
  const resolvedItems: ResolvedScenarioItem[] = Array.from(itemBaseMap.entries())
    .sort(([, a], [, b]) => {
      const seqDiff = a.item.sequenceNo - b.item.sequenceNo;
      return seqDiff !== 0 ? seqDiff : a.item.id - b.item.id;
    })
    .map(([matchKey, base]) => {
      const matEntry = materialMap.get(matchKey);
      const feeEntry = feeMap.get(matchKey);

      const materialUnitPrice = matEntry?.price ?? 0;
      const feeUnitPrice = feeEntry?.price ?? 0;

      const fallbackLayerOrder = base.sourceLayer.layerOrder;
      const fallbackLayerLabel = base.sourceLayer.label || base.sourceLayer.versionName;

      const materialSourceLayerOrder = matEntry?.sourceLayer.layerOrder ?? fallbackLayerOrder;
      const materialSourceLayerLabel =
        matEntry
          ? matEntry.sourceLayer.label || matEntry.sourceLayer.versionName
          : fallbackLayerLabel;
      const feeSourceLayerOrder = feeEntry?.sourceLayer.layerOrder ?? fallbackLayerOrder;
      const feeSourceLayerLabel =
        feeEntry
          ? feeEntry.sourceLayer.label || feeEntry.sourceLayer.versionName
          : fallbackLayerLabel;

      return {
        itemCode: base.item.itemCode,
        sequenceNo: base.item.sequenceNo,
        itemNumber: base.item.itemNumber,
        name: base.item.name,
        quantity: base.item.quantity,
        unit: base.item.unit,
        materialUnitPrice,
        feeUnitPrice,
        notes: base.item.notes,
        sectionCode: base.item.sectionCode,
        materialSourceLayerOrder,
        materialSourceLayerLabel,
        feeSourceLayerOrder,
        feeSourceLayerLabel,
        hasSingleSource: materialSourceLayerOrder === feeSourceLayerOrder,
        isUnpriced: materialUnitPrice === 0 && feeUnitPrice === 0,
        materialAlternativeName: matEntry?.altName ?? null,
        feeAlternativeName: feeEntry?.altName ?? null,
      };
    });

  const totalMaterial = resolvedItems.reduce(
    (s, i) => s + i.quantity * i.materialUnitPrice,
    0
  );
  const totalFee = resolvedItems.reduce((s, i) => s + i.quantity * i.feeUnitPrice, 0);
  const unpricedCount = resolvedItems.filter((i) => i.isUnpriced).length;

  return {
    items: resolvedItems,
    sections: mergedSections,
    layers: detail.layers,
    totalMaterial,
    totalFee,
    unpricedCount,
    optimization: opt,
  };
}
