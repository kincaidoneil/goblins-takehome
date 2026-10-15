ALTER TYPE "public"."model_call_status" ADD VALUE IF NOT EXISTS 'interrupted';--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN IF NOT EXISTS "model_answered" text;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN IF NOT EXISTS "status_code" integer;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN IF NOT EXISTS "provider_id" text;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN IF NOT EXISTS "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN IF NOT EXISTS "subject_id" text;