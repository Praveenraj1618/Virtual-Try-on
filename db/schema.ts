import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";
export const looks = sqliteTable(
  "looks",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    measurements: text("measurements").notNull(),
    design: text("design").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_looks_owner_created").on(t.ownerId, t.createdAt)],
);
export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_assets_owner").on(t.ownerId)],
);
