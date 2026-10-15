ALTER TYPE "public"."model_call_status" ADD VALUE 'interrupted';--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "model_answered" text;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "status_code" integer;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "provider_id" text;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "model_calls" ADD COLUMN "subject_id" text;