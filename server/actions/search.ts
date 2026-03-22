"use server";

import { db } from "@/lib/db";
import { projects, partners, quotes, budgets } from "@/lib/db/schema";
import { ilike, or } from "drizzle-orm";
import { eq } from "drizzle-orm";

export interface SearchResult {
  id: number;
  moduleKey: string;
  label: string;
  subtitle?: string;
  code?: string;
}

/**
 * Global search across projects, partners, quotes and budgets.
 * Returns max 5 results per category, 20 total.
 */
export async function globalSearch(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const pattern = `%${q}%`;

  const [projectRows, partnerRows, quoteRows, budgetRows] = await Promise.all([
    // Projects
    db
      .select({
        id: projects.id,
        name: projects.name,
        projectCode: projects.projectCode,
        status: projects.status,
      })
      .from(projects)
      .where(
        or(
          ilike(projects.name, pattern),
          ilike(projects.projectCode, pattern),
        )
      )
      .limit(5),

    // Partners
    db
      .select({
        id: partners.id,
        name: partners.name,
        email: partners.email,
        partnerType: partners.partnerType,
      })
      .from(partners)
      .where(
        or(
          ilike(partners.name, pattern),
          ilike(partners.email, pattern),
          ilike(partners.taxNumber, pattern),
        )
      )
      .limit(5),

    // Quotes
    db
      .select({
        id: quotes.id,
        subject: quotes.subject,
        quoteCode: quotes.quoteCode,
        status: quotes.status,
        projectName: projects.name,
      })
      .from(quotes)
      .leftJoin(projects, eq(quotes.projectId, projects.id))
      .where(
        or(
          ilike(quotes.subject, pattern),
          ilike(quotes.quoteCode, pattern),
        )
      )
      .limit(5),

    // Budgets
    db
      .select({
        id: budgets.id,
        name: budgets.name,
        projectName: projects.name,
      })
      .from(budgets)
      .leftJoin(projects, eq(budgets.projectId, projects.id))
      .where(
        or(
          ilike(budgets.name, pattern),
          ilike(projects.name, pattern),
        )
      )
      .limit(5),
  ]);

  const results: SearchResult[] = [];

  for (const r of projectRows) {
    results.push({
      id: r.id,
      moduleKey: "projects",
      label: r.name,
      code: r.projectCode ?? undefined,
      subtitle: r.status === "active" ? "Aktív" : r.status === "completed" ? "Befejezett" : r.status === "on_hold" ? "Szünetel" : "Törölve",
    });
  }

  for (const r of partnerRows) {
    const typeLabel = r.partnerType === "client" ? "Ügyfél" : r.partnerType === "subcontractor" ? "Alvállalkozó" : "Beszállító";
    results.push({
      id: r.id,
      moduleKey: "partners",
      label: r.name,
      subtitle: typeLabel + (r.email ? ` · ${r.email}` : ""),
    });
  }

  for (const r of quoteRows) {
    results.push({
      id: r.id,
      moduleKey: "quotes",
      label: r.subject,
      code: r.quoteCode ?? undefined,
      subtitle: r.projectName ?? undefined,
    });
  }

  for (const r of budgetRows) {
    results.push({
      id: r.id,
      moduleKey: "budgets",
      label: r.name,
      subtitle: r.projectName ?? undefined,
    });
  }

  return results;
}
