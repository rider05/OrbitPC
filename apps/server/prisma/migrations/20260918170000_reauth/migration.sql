-- Server-side recent-auth proof for destructive commands.
ALTER TABLE "user_sessions" ADD COLUMN "last_reauth_at" TIMESTAMPTZ;
