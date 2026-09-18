-- Agent pickup payload (full args for execution). Mobile reads use args_redacted only.
ALTER TABLE "commands" ADD COLUMN "args" JSONB;
