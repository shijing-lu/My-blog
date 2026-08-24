CREATE TABLE "github_users" (
	"id" text PRIMARY KEY NOT NULL,
	"github_id" integer NOT NULL,
	"login" text NOT NULL,
	"name" text NOT NULL DEFAULT '',
	"avatar_url" text NOT NULL DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_users_github_id_unique" UNIQUE("github_id")
);
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"parent_id" text,
	"content" text NOT NULL DEFAULT '',
	"author_type" text NOT NULL DEFAULT 'anonymous',
	"author_name" text NOT NULL DEFAULT '',
	"github_user_id" text,
	"like_count" integer NOT NULL DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "comments_target_idx" ON "comments" ("target_type","target_id","created_at");
CREATE INDEX "comments_parent_idx" ON "comments" ("parent_id");
