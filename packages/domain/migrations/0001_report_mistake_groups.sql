CREATE TABLE "report_mistake_groups" (
	"session_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"skill" text NOT NULL,
	"groups" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_mistake_groups_session_id_problem_id_input_hash_pk" PRIMARY KEY("session_id","problem_id","input_hash")
);
--> statement-breakpoint
ALTER TABLE "report_mistake_groups" ADD CONSTRAINT "report_mistake_groups_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_mistake_groups" ADD CONSTRAINT "report_mistake_groups_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;