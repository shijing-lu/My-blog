CREATE TABLE IF NOT EXISTS "mobile_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "device_id" text NOT NULL,
  "device_name" text NOT NULL,
  "credential_version" text NOT NULL,
  "access_hash" text NOT NULL,
  "refresh_hash" text NOT NULL,
  "previous_refresh_hash" text,
  "refresh_request_id" text,
  "access_expires_at" text NOT NULL,
  "refresh_expires_at" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "revoked_at" text
);
