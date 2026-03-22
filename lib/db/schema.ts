import {
  pgTable,
  bigint,
  text,
  timestamp,
  date,
  integer,
  numeric,
  boolean,
  uuid,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

// ============================================================
// 1. PARTNERS (Partnerek)
// ============================================================
export const partners = pgTable(
  "partners",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    taxNumber: text("tax_number"),
    partnerType: text("partner_type").notNull().default("client"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_partners_partner_type").on(t.partnerType),
    check("partners_partner_type_check", sql`${t.partnerType} IN ('client', 'subcontractor', 'supplier')`),
  ]
);

export const partnersRelations = relations(partners, ({ many }) => ({
  clientProjects: many(projects),
  offeredQuotes: many(quotes),
}));

// ============================================================
// 2. PROJECTS (Projektek)
// ============================================================
export const projects = pgTable(
  "projects",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    projectCode: text("project_code").generatedAlwaysAs(
      sql`'PRJ-' || LPAD(id::TEXT, 4, '0')`
    ),
    name: text("name").notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    clientId: bigint("client_id", { mode: "number" }).references(() => partners.id, {
      onDelete: "set null",
    }),
    warrantyMonths: integer("warranty_months").notNull().default(12),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_projects_client_id").on(t.clientId),
    index("idx_projects_status").on(t.status),
    uniqueIndex("uq_projects_code").on(t.projectCode),
    check("projects_status_check", sql`${t.status} IN ('active', 'completed', 'cancelled', 'on_hold')`),
  ]
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(partners, {
    fields: [projects.clientId],
    references: [partners.id],
  }),
  quotes: many(quotes),
  budgets: many(budgets),
}));

// ============================================================
// 3. QUOTES (Ajánlatok)
// ============================================================
export const quotes = pgTable(
  "quotes",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    quoteCode: text("quote_code").generatedAlwaysAs(
      sql`'AJN-' || LPAD(id::TEXT, 4, '0')`
    ),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    offererId: bigint("offerer_id", { mode: "number" }).references(
      () => partners.id,
      { onDelete: "set null" }
    ),
    price: numeric("price", { precision: 15, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("HUF"),
    status: text("status").notNull().default("pending"),
    validUntil: date("valid_until"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_quotes_project_id").on(t.projectId),
    index("idx_quotes_offerer_id").on(t.offererId),
    index("idx_quotes_status").on(t.status),
    uniqueIndex("uq_quotes_code").on(t.quoteCode),
    check("quotes_status_check", sql`${t.status} IN ('pending', 'accepted', 'rejected', 'expired')`),
  ]
);

export const quotesRelations = relations(quotes, ({ one }) => ({
  project: one(projects, {
    fields: [quotes.projectId],
    references: [projects.id],
  }),
  offerer: one(partners, {
    fields: [quotes.offererId],
    references: [partners.id],
  }),
}));

// ============================================================
// 4. BUDGETS (Költségvetések)
// ============================================================
export const budgets = pgTable(
  "budgets",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_budgets_project_id").on(t.projectId)]
);

export const budgetsRelations = relations(budgets, ({ one, many }) => ({
  project: one(projects, {
    fields: [budgets.projectId],
    references: [projects.id],
  }),
  versions: many(versions),
}));

// ============================================================
// 5. VERSIONS (Verziók)
// ============================================================
export const versions = pgTable(
  "versions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    budgetId: bigint("budget_id", { mode: "number" })
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    parentId: bigint("parent_id", { mode: "number" }),
    versionName: text("version_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_versions_budget_id").on(t.budgetId),
    index("idx_versions_parent_id").on(t.parentId),
  ]
);

export const versionsRelations = relations(versions, ({ one }) => ({
  budget: one(budgets, {
    fields: [versions.budgetId],
    references: [budgets.id],
  }),
}));

// ============================================================
// 6. BUDGET ITEMS (Költségvetési tételek)
// ============================================================
export const budgetItems = pgTable(
  "budget_items",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    versionId: bigint("version_id", { mode: "number" })
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    itemCode: uuid("item_code").notNull(),
    sequenceNo: integer("sequence_no").notNull().default(0),
    itemNumber: text("item_number").notNull().default(""),
    name: text("name").notNull(),
    quantity: numeric("quantity", { precision: 15, scale: 4 }).notNull().default("1"),
    unit: text("unit").notNull().default(""),
    materialUnitPrice: numeric("material_unit_price", { precision: 15, scale: 2 })
      .notNull()
      .default("0"),
    feeUnitPrice: numeric("fee_unit_price", { precision: 15, scale: 2 })
      .notNull()
      .default("0"),
    notes: text("notes").notNull().default(""),
    isDeleted: boolean("is_deleted").notNull().default(false),
  },
  (t) => [
    index("idx_budget_items_version_id").on(t.versionId),
    index("idx_budget_items_item_code").on(t.itemCode),
    index("idx_budget_items_version_item").on(t.versionId, t.itemCode),
  ]
);

export const budgetItemsRelations = relations(budgetItems, ({ one }) => ({
  version: one(versions, {
    fields: [budgetItems.versionId],
    references: [versions.id],
  }),
}));
