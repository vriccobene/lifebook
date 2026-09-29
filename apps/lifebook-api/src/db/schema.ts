import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/*
 * Conventions: money is stored as integer cents, rates as fractions, dates as `YYYY-MM-DD` text.
 * Parameters that change over time are stored as JSON patches with a `validFrom` (see lifebook-core).
 */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /** `admin` manages the users; nobody, admins included, sees another user's financial data. */
  role: text("role", { enum: ["admin", "user"] })
    .notNull()
    .default("user"),
  createdAt: text("created_at").notNull(),
});

/** Bearer tokens: short-lived `session` tokens from the login and long-lived `api` tokens. Stored hashed. */
export const tokens = sqliteTable(
  "tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["session", "api"] }).notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at"),
    lastUsedAt: text("last_used_at"),
  },
  (t) => [index("tokens_user_idx").on(t.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    institution: text("institution"),
    type: text("type", {
      enum: [
        "checking",
        "deposit",
        "brokerage",
        "external_investment",
        "pension_fund",
        "real_estate",
        "liability",
      ],
    }).notNull(),
    realEstateUse: text("real_estate_use", { enum: ["primary_residence", "income"] }),
    contributionsMode: text("contributions_mode", { enum: ["declared", "inferred"] }).notNull(),
    countsAsLivingCost: integer("counts_as_living_cost", { mode: "boolean" })
      .notNull()
      .default(true),
    archivedAt: text("archived_at"),
  },
  (t) => [index("accounts_owner_idx").on(t.ownerId)],
);

export const accountParams = sqliteTable(
  "account_params",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    validFrom: text("valid_from").notNull(),
    /** JSON object with any subset of the account parameters. Money fields are in cents. */
    patch: text("patch").notNull(),
  },
  (t) => [index("account_params_account_idx").on(t.accountId)],
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    balanceCents: integer("balance_cents").notNull(),
    source: text("source", { enum: ["csv", "manual", "firefly"] }).notNull(),
  },
  (t) => [uniqueIndex("snapshots_account_date_idx").on(t.accountId, t.date)],
);

export const contributions = sqliteTable(
  "contributions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** Set on imported entries (`firefly:<journal id>`), so a new import updates them instead of duplicating. */
    externalId: text("external_id"),
  },
  (t) => [
    index("contributions_account_date_idx").on(t.accountId, t.date),
    uniqueIndex("contributions_account_external_idx").on(t.accountId, t.externalId),
  ],
);

export const incomeItems = sqliteTable(
  "income_items",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    kind: text("kind", { enum: ["recurring", "one_off"] }).notNull(),
    /** one_off only */
    date: text("date"),
    /** recurring only */
    periodicity: text("periodicity", { enum: ["monthly", "quarterly", "yearly"] }),
    startDate: text("start_date"),
    endDate: text("end_date"),
  },
  (t) => [index("income_items_owner_idx").on(t.ownerId)],
);

export const essentialSpending = sqliteTable(
  "essential_spending",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    mode: text("mode", { enum: ["percent", "amount", "month_amount"] }).notNull(),
    /** Percent (0-100) for `percent`, cents for the amount modes. */
    value: real("value").notNull(),
    validFrom: text("valid_from"),
    month: text("month"),
  },
  (t) => [index("essential_spending_owner_idx").on(t.ownerId)],
);

export const settingsEntries = sqliteTable(
  "settings_entries",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    validFrom: text("valid_from").notNull(),
    /** JSON object with any subset of the settings. */
    patch: text("patch").notNull(),
  },
  (t) => [index("settings_entries_owner_idx").on(t.ownerId)],
);

/** One Firefly III connection per user. The personal access token is stored encrypted (see auth/secretBox). */
export const fireflyConnections = sqliteTable("firefly_connections", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  baseUrl: text("base_url").notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  createdAt: text("created_at").notNull(),
  lastImportAt: text("last_import_at"),
});

/** A Firefly III account linked to a Lifebook account of the same user. */
export const fireflyLinks = sqliteTable(
  "firefly_links",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fireflyAccountId: text("firefly_account_id").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("firefly_links_user_firefly_idx").on(t.userId, t.fireflyAccountId),
    uniqueIndex("firefly_links_account_idx").on(t.accountId),
  ],
);
