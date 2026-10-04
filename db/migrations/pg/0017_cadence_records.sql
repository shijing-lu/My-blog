CREATE TABLE IF NOT EXISTS "cadence_records" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "record_id" text NOT NULL,
  "payload" text,
  "revision" text NOT NULL,
  "updated_at" text NOT NULL
);
