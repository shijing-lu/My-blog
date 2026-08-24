CREATE TABLE "fonts" (
	"id" text PRIMARY KEY NOT NULL,
	"family_name" text NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"size" integer NOT NULL DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
