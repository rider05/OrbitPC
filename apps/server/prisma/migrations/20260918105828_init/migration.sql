-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "mfa_secret" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "device_label" TEXT,
    "device_meta" JSONB,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "last_seen_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "computers" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'windows',
    "agent_version" TEXT,
    "public_key" TEXT,
    "boot_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "last_seen_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "computers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "computer_credentials" (
    "id" UUID NOT NULL,
    "computer_id" UUID NOT NULL,
    "credential_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,
    "rotated_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "computer_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_sessions" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID,
    "user_code_hash" TEXT,
    "secret_hash" TEXT NOT NULL,
    "requested_computer_metadata" JSONB,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "polling_secret_hash" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pairing_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_policies" (
    "id" UUID NOT NULL,
    "computer_id" UUID NOT NULL,
    "command_name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commands" (
    "id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "computer_id" UUID NOT NULL,
    "requester_session_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "args_redacted" JSONB,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "result_redacted" JSONB,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_events" (
    "id" UUID NOT NULL,
    "command_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_redacted" JSONB,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "computer_id" UUID,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "ip_context" TEXT,
    "device_context" JSONB,
    "metadata_redacted" JSONB,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "computers_owner_user_id_revoked_at_idx" ON "computers"("owner_user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "computer_credentials_computer_id_revoked_at_idx" ON "computer_credentials"("computer_id", "revoked_at");

-- CreateIndex
CREATE INDEX "pairing_sessions_expires_at_idx" ON "pairing_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "command_policies_computer_id_command_name_key" ON "command_policies"("computer_id", "command_name");

-- CreateIndex
CREATE INDEX "commands_computer_id_created_at_idx" ON "commands"("computer_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "commands_requester_session_id_idempotency_key_key" ON "commands"("requester_session_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "command_events_command_id_sequence_key" ON "command_events"("command_id", "sequence");

-- CreateIndex
CREATE INDEX "audit_events_computer_id_occurred_at_idx" ON "audit_events"("computer_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_actor_id_occurred_at_idx" ON "audit_events"("actor_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "computers" ADD CONSTRAINT "computers_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "computer_credentials" ADD CONSTRAINT "computer_credentials_computer_id_fkey" FOREIGN KEY ("computer_id") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_policies" ADD CONSTRAINT "command_policies_computer_id_fkey" FOREIGN KEY ("computer_id") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commands" ADD CONSTRAINT "commands_computer_id_fkey" FOREIGN KEY ("computer_id") REFERENCES "computers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commands" ADD CONSTRAINT "commands_requester_session_id_fkey" FOREIGN KEY ("requester_session_id") REFERENCES "user_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_events" ADD CONSTRAINT "command_events_command_id_fkey" FOREIGN KEY ("command_id") REFERENCES "commands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_computer_id_fkey" FOREIGN KEY ("computer_id") REFERENCES "computers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
