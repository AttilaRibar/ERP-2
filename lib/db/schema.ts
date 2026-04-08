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
  settlementContracts: many(settlementContracts),
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
    versionType: text("version_type").notNull().default("offer"),
    partnerId: bigint("partner_id", { mode: "number" }).references(() => partners.id, {
      onDelete: "set null",
    }),
    originalFileName: text("original_file_name"),
    originalFilePath: text("original_file_path"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_versions_budget_id").on(t.budgetId),
    index("idx_versions_parent_id").on(t.parentId),
    index("idx_versions_version_type").on(t.versionType),
    index("idx_versions_partner_id").on(t.partnerId),
    check("versions_version_type_check", sql`${t.versionType} IN ('offer', 'contracted', 'unpriced')`),
  ]
);

export const versionsRelations = relations(versions, ({ one }) => ({
  budget: one(budgets, {
    fields: [versions.budgetId],
    references: [budgets.id],
  }),
  partner: one(partners, {
    fields: [versions.partnerId],
    references: [partners.id],
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
    sectionCode: uuid("section_code"),
    alternativeOfItemCode: uuid("alternative_of_item_code"),
    isDeleted: boolean("is_deleted").notNull().default(false),
  },
  (t) => [
    index("idx_budget_items_version_id").on(t.versionId),
    index("idx_budget_items_item_code").on(t.itemCode),
    index("idx_budget_items_version_item").on(t.versionId, t.itemCode),
    index("idx_budget_items_section_code").on(t.sectionCode),
    index("idx_budget_items_alt_of").on(t.alternativeOfItemCode),
  ]
);

export const budgetItemsRelations = relations(budgetItems, ({ one }) => ({
  version: one(versions, {
    fields: [budgetItems.versionId],
    references: [versions.id],
  }),
}));

// ============================================================
// 7. BUDGET SECTIONS (Fejezetek)
// ============================================================
export const budgetSections = pgTable(
  "budget_sections",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    versionId: bigint("version_id", { mode: "number" })
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    sectionCode: uuid("section_code").notNull(),
    parentSectionCode: uuid("parent_section_code"),
    name: text("name").notNull(),
    sequenceNo: integer("sequence_no").notNull().default(0),
    isDeleted: boolean("is_deleted").notNull().default(false),
  },
  (t) => [
    index("idx_budget_sections_version_id").on(t.versionId),
    index("idx_budget_sections_section_code").on(t.sectionCode),
  ]
);

export const budgetSectionsRelations = relations(budgetSections, ({ one }) => ({
  version: one(versions, {
    fields: [budgetSections.versionId],
    references: [versions.id],
  }),
}));

// ============================================================
// 8. COST SCENARIOS (Költség-szcenáriók)
// ============================================================
export const costScenarios = pgTable(
  "cost_scenarios",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_cost_scenarios_project_id").on(t.projectId)]
);

export const costScenariosRelations = relations(costScenarios, ({ one, many }) => ({
  project: one(projects, {
    fields: [costScenarios.projectId],
    references: [projects.id],
  }),
  layers: many(costScenarioLayers),
}));

// ============================================================
// 9. COST SCENARIO LAYERS (Szcenárió-rétegek)
// ============================================================
export const costScenarioLayers = pgTable(
  "cost_scenario_layers",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    scenarioId: bigint("scenario_id", { mode: "number" })
      .notNull()
      .references(() => costScenarios.id, { onDelete: "cascade" }),
    versionId: bigint("version_id", { mode: "number" })
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    layerOrder: integer("layer_order").notNull().default(0),
    label: text("label").notNull().default(""),
    /** Which price component this layer contributes: 'both' | 'material' | 'fee' */
    priceComponent: text("price_component").notNull().default("both"),
    /** Use the cheapest alternative for each item in this layer */
    useCheapestAlternative: boolean("use_cheapest_alternative").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_cost_scenario_layers_scenario_id").on(t.scenarioId),
    index("idx_cost_scenario_layers_version_id").on(t.versionId),
    uniqueIndex("uq_cost_scenario_layers_order").on(t.scenarioId, t.layerOrder),
  ]
);

export const costScenarioLayersRelations = relations(costScenarioLayers, ({ one }) => ({
  scenario: one(costScenarios, {
    fields: [costScenarioLayers.scenarioId],
    references: [costScenarios.id],
  }),
  version: one(versions, {
    fields: [costScenarioLayers.versionId],
    references: [versions.id],
  }),
}));

// ============================================================
// 10. SETTLEMENT CONTRACTS (Elszámolási szerződések)
// ============================================================
export const settlementContracts = pgTable(
  "settlement_contracts",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    budgetId: bigint("budget_id", { mode: "number" })
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    versionId: bigint("version_id", { mode: "number" })
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    partnerId: bigint("partner_id", { mode: "number" })
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    accessToken: text("access_token").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    totalNetAmount: numeric("total_net_amount", { precision: 15, scale: 2 }).notNull().default("0"),
    label: text("label").notNull().default(""),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_settlement_contracts_budget").on(t.budgetId),
    index("idx_settlement_contracts_version").on(t.versionId),
    index("idx_settlement_contracts_partner").on(t.partnerId),
    index("idx_settlement_contracts_status").on(t.status),
    check("settlement_contracts_status_check", sql`${t.status} IN ('active', 'completed', 'cancelled')`),
  ]
);

export const settlementContractsRelations = relations(settlementContracts, ({ one, many }) => ({
  budget: one(budgets, {
    fields: [settlementContracts.budgetId],
    references: [budgets.id],
  }),
  version: one(versions, {
    fields: [settlementContracts.versionId],
    references: [versions.id],
  }),
  partner: one(partners, {
    fields: [settlementContracts.partnerId],
    references: [partners.id],
  }),
  invoices: many(settlementInvoices),
}));

// ============================================================
// 11. SETTLEMENT INVOICES (Részszámlák)
// ============================================================
export const settlementInvoices = pgTable(
  "settlement_invoices",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    contractId: bigint("contract_id", { mode: "number" })
      .notNull()
      .references(() => settlementContracts.id, { onDelete: "cascade" }),
    invoiceNumber: integer("invoice_number").notNull(),
    label: text("label").notNull().default(""),
    maxAmount: numeric("max_amount", { precision: 15, scale: 2 }).notNull().default("0"),
    status: text("status").notNull().default("locked"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedNote: text("submitted_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    reviewNote: text("review_note"),
    claimedMaterialTotal: numeric("claimed_material_total", { precision: 15, scale: 2 }).notNull().default("0"),
    claimedFeeTotal: numeric("claimed_fee_total", { precision: 15, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_settlement_invoices_contract").on(t.contractId),
    index("idx_settlement_invoices_status").on(t.status),
    uniqueIndex("uq_settlement_invoices_number").on(t.contractId, t.invoiceNumber),
    check("settlement_invoices_status_check", sql`${t.status} IN ('locked', 'open', 'submitted', 'approved', 'rejected')`),
  ]
);

export const settlementInvoicesRelations = relations(settlementInvoices, ({ one, many }) => ({
  contract: one(settlementContracts, {
    fields: [settlementInvoices.contractId],
    references: [settlementContracts.id],
  }),
  items: many(settlementItems),
}));

// ============================================================
// 12. SETTLEMENT ITEMS (Tételes elszámolás)
// ============================================================
export const settlementItems = pgTable(
  "settlement_items",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    invoiceId: bigint("invoice_id", { mode: "number" })
      .notNull()
      .references(() => settlementInvoices.id, { onDelete: "cascade" }),
    itemCode: uuid("item_code").notNull(),
    claimedMaterialAmount: numeric("claimed_material_amount", { precision: 15, scale: 2 }).notNull().default("0"),
    claimedFeeAmount: numeric("claimed_fee_amount", { precision: 15, scale: 2 }).notNull().default("0"),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_settlement_items_invoice").on(t.invoiceId),
    index("idx_settlement_items_item_code").on(t.itemCode),
    uniqueIndex("uq_settlement_items_invoice_item").on(t.invoiceId, t.itemCode),
  ]
);

export const settlementItemsRelations = relations(settlementItems, ({ one }) => ({
  invoice: one(settlementInvoices, {
    fields: [settlementItems.invoiceId],
    references: [settlementInvoices.id],
  }),
}));
