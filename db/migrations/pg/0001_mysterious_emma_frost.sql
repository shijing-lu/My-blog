CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"thumb_url" text,
	"title" text DEFAULT '' NOT NULL,
	"width" integer,
	"height" integer,
	"taken_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
