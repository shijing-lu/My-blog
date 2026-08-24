CREATE TABLE "likes" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"user_type" text DEFAULT 'anonymous' NOT NULL,
	"user_ident" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "likes_target_user_unique" UNIQUE("target_type","target_id","user_type","user_ident")
);
