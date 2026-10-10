CREATE TABLE IF NOT EXISTS "mobile_sync_head" ("id" text PRIMARY KEY NOT NULL, "seq" integer NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mobile_sync_records" ("id" text PRIMARY KEY NOT NULL, "revision" text NOT NULL, "seq" integer NOT NULL, "payload" text);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_sync_records_seq" ON "mobile_sync_records" ("seq");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mobile_sync_receipts" ("id" text PRIMARY KEY NOT NULL, "digest" text NOT NULL, "reply" text NOT NULL);
--> statement-breakpoint
INSERT INTO "mobile_sync_head" ("id", "seq") VALUES ('quick_notes', 0) ON CONFLICT ("id") DO NOTHING;
