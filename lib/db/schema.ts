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
  accessTokens: many(subcontractorAccessTokens),
  billings: many(subcontractorBillings),
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
// 10. SUBCONTRACTOR BILLINGS (Alvállalkozói számlák)
// ============================================================
export const subcontractorBillings = pgTable(
  "subcontractor_billings",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    partnerId: bigint("partner_id", { mode: "number" })
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    versionId: bigint("version_id", { mode: "number" })
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    billingNumber: text("billing_number").generatedAlwaysAs(
      sql`'SZLA-' || LPAD(id::TEXT, 4, '0')`
    ),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull().default("0"),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("draft"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewerNotes: text("reviewer_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_sub_billings_partner_id").on(t.partnerId),
    index("idx_sub_billings_version_id").on(t.versionId),
    index("idx_sub_billings_status").on(t.status),
    check("sub_billings_status_check", sql`${t.status} IN ('draft', 'submitted', 'approved', 'rejected')`),
  ]
);

export const subcontractorBillingsRelations = relations(subcontractorBillings, ({ one }) => ({
  partner: one(partners, {
    fields: [subcontractorBillings.partnerId],
    references: [partners.id],
  }),
  version: one(versions, {
    fields: [subcontractorBillings.versionId],
    references: [versions.id],
  }),
}));

// ============================================================
// 11. SUBCONTRACTOR ACCESS TOKENS (Alvállalkozói hozzáférési tokenek)
// ============================================================
export const subcontractorAccessTokens = pgTable(
  "subcontractor_access_tokens",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    partnerId: bigint("partner_id", { mode: "number" })
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    label: text("label").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_sub_tokens_partner_id").on(t.partnerId),
    index("idx_sub_tokens_token").on(t.token),
  ]
);

export const subcontractorAccessTokensRelations = relations(
  subcontractorAccessTokens,
  ({ one }) => ({
    partner: one(partners, {
      fields: [subcontractorAccessTokens.partnerId],
      references: [partners.id],
    }),
  })
);
