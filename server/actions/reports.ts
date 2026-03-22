"use server";

import { db } from "@/lib/db";
import { projects, partners, quotes, budgets, budgetItems, versions } from "@/lib/db/schema";
import { eq, count, sum, sql, desc } from "drizzle-orm";

// ─── Project status distribution ───────────────────────────────────────────
export async function getProjectStatusStats() {
  const rows = await db
    .select({
      status: projects.status,
      count: count(projects.id),
    })
    .from(projects)
    .groupBy(projects.status);

  const labelMap: Record<string, string> = {
    active: "Aktív",
    completed: "Befejezett",
    cancelled: "Törölve",
    on_hold: "Felfüggesztve",
  };
  const colorMap: Record<string, string> = {
    active: "#22c55e",
    completed: "#6366f1",
    cancelled: "#ef4444",
    on_hold: "#f59e0b",
  };

  return rows.map((r) => ({
    name: labelMap[r.status] ?? r.status,
    value: Number(r.count),
    color: colorMap[r.status] ?? "#94a3b8",
  }));
}

// ─── Quote status distribution ─────────────────────────────────────────────
export async function getQuoteStatusStats() {
  const rows = await db
    .select({
      status: quotes.status,
      count: count(quotes.id),
      totalValue: sum(quotes.price),
    })
    .from(quotes)
    .groupBy(quotes.status);

  const labelMap: Record<string, string> = {
    pending: "Folyamatban",
    accepted: "Elfogadva",
    rejected: "Elutasítva",
    expired: "Lejárt",
  };
  const colorMap: Record<string, string> = {
    pending: "#f59e0b",
    accepted: "#22c55e",
    rejected: "#ef4444",
    expired: "#94a3b8",
  };

  return rows.map((r) => ({
    name: labelMap[r.status] ?? r.status,
    value: Number(r.count),
    totalValue: Number(r.totalValue ?? 0),
    color: colorMap[r.status] ?? "#94a3b8",
  }));
}

// ─── Partner type distribution ─────────────────────────────────────────────
export async function getPartnerTypeStats() {
  const rows = await db
    .select({
      partnerType: partners.partnerType,
      count: count(partners.id),
    })
    .from(partners)
    .groupBy(partners.partnerType);

  const labelMap: Record<string, string> = {
    client: "Ügyfél",
    subcontractor: "Alvállalkozó",
    supplier: "Szállító",
  };
  const colorMap: Record<string, string> = {
    client: "#6366f1",
    subcontractor: "#06b6d4",
    supplier: "#f59e0b",
  };

  return rows.map((r) => ({
    name: labelMap[r.partnerType] ?? r.partnerType,
    value: Number(r.count),
    color: colorMap[r.partnerType] ?? "#94a3b8",
  }));
}

// ─── Monthly quote volumes (last 12 months) ────────────────────────────────
export async function getMonthlyQuoteVolume() {
  const rows = await db.execute<{ month: string; count: string; total: string }>(
    sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COUNT(*)::text                                       AS count,
        COALESCE(SUM(price), 0)::text                       AS total
      FROM quotes
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `
  );

  return rows.map((r) => ({
    month: r.month,
    count: Number(r.count),
    total: Number(r.total),
  }));
}

// ─── Top 10 partners by number of projects ─────────────────────────────────
export async function getTopPartnersByProjects() {
  const rows = await db
    .select({
      partnerName: partners.name,
      projectCount: count(projects.id),
    })
    .from(partners)
    .leftJoin(projects, eq(partners.id, projects.clientId))
    .groupBy(partners.id, partners.name)
    .orderBy(desc(count(projects.id)))
    .limit(10);

  return rows.map((r) => ({
    name: r.partnerName,
    value: Number(r.projectCount),
  }));
}

// ─── Top 10 partners by accepted quote value ────────────────────────────────
export async function getTopPartnersByQuoteValue() {
  const rows = await db
    .select({
      partnerName: partners.name,
      totalValue: sum(quotes.price),
    })
    .from(partners)
    .leftJoin(projects, eq(partners.id, projects.clientId))
    .leftJoin(quotes, eq(projects.id, quotes.projectId))
    .where(eq(quotes.status, "accepted"))
    .groupBy(partners.id, partners.name)
    .orderBy(desc(sum(quotes.price)))
    .limit(10);

  return rows
    .filter((r) => Number(r.totalValue ?? 0) > 0)
    .map((r) => ({
      name: r.partnerName,
      value: Number(r.totalValue ?? 0),
    }));
}

// ─── Budget material vs fee cost breakdown ────────────────────────────────
export async function getBudgetCostBreakdown() {
  const rows = await db.execute<{
    project_name: string;
    material_cost: string;
    fee_cost: string;
  }>(sql`
    SELECT
      p.name AS project_name,
      COALESCE(SUM(bi.material_unit_price * bi.quantity), 0)::text AS material_cost,
      COALESCE(SUM(bi.fee_unit_price * bi.quantity), 0)::text       AS fee_cost
    FROM projects p
    JOIN budgets b ON b.project_id = p.id
    JOIN versions v ON v.budget_id = b.id
    JOIN budget_items bi ON bi.version_id = v.id
    WHERE bi.is_deleted = false
    GROUP BY p.id, p.name
    ORDER BY (SUM(bi.material_unit_price * bi.quantity) + SUM(bi.fee_unit_price * bi.quantity)) DESC
    LIMIT 8
  `);

  return rows.map((r) => ({
    name: r.project_name,
    material: Number(r.material_cost),
    fee: Number(r.fee_cost),
  }));
}

// ─── Summary KPI cards ─────────────────────────────────────────────────────
export async function getSummaryKpis() {
  const [
    [{ totalPartners }],
    [{ totalProjects }],
    [{ totalQuotes }],
    [{ totalBudgets }],
    [{ acceptedQuoteValue }],
    [{ activeProjects }],
  ] = await Promise.all([
    db.select({ totalPartners: count(partners.id) }).from(partners),
    db.select({ totalProjects: count(projects.id) }).from(projects),
    db.select({ totalQuotes: count(quotes.id) }).from(quotes),
    db.select({ totalBudgets: count(budgets.id) }).from(budgets),
    db
      .select({ acceptedQuoteValue: sum(quotes.price) })
      .from(quotes)
      .where(eq(quotes.status, "accepted")),
    db
      .select({ activeProjects: count(projects.id) })
      .from(projects)
      .where(eq(projects.status, "active")),
  ]);

  return {
    totalPartners: Number(totalPartners),
    totalProjects: Number(totalProjects),
    totalQuotes: Number(totalQuotes),
    totalBudgets: Number(totalBudgets),
    acceptedQuoteValue: Number(acceptedQuoteValue ?? 0),
    activeProjects: Number(activeProjects),
  };
}
