CREATE TABLE "quick_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  "content" text DEFAULT '' NOT NULL,
  "tags" text DEFAULT '[]' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
