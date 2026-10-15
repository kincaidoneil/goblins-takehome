CREATE TYPE "public"."chat_role" AS ENUM('teacher', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."class_session_status" AS ENUM('lobby', 'live', 'ended');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('extracting', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."grade_source" AS ENUM('model', 'teacher_accepted', 'teacher_scored', 'teacher_override');--> statement-breakpoint
CREATE TYPE "public"."grade_state" AS ENUM('submitted', 'grading', 'graded', 'needs_teacher', 'couldnt_grade');--> statement-breakpoint
CREATE TYPE "public"."model_call_status" AS ENUM('ok', 'rate_limited', 'timeout', 'provider_error', 'bad_response');--> statement-breakpoint
CREATE TABLE "assignment_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid,
	"draft_owner_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"template_id" text,
	"extraction_status" "extraction_status" DEFAULT 'extracting' NOT NULL,
	"extraction_failure_reason" text,
	"load_test_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_has_one_owner" CHECK (("assignments"."teacher_id" is null) <> ("assignments"."draft_owner_id" is null)),
	CONSTRAINT "assignments_failure_reason_iff_failed" CHECK (("assignments"."extraction_status" = 'failed') = ("assignments"."extraction_failure_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "class_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"join_code" text NOT NULL,
	"status" "class_session_status" DEFAULT 'lobby' NOT NULL,
	"time_limit_minutes" integer,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"report_share_token" text,
	"load_test_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_sessions_reportShareToken_unique" UNIQUE("report_share_token"),
	CONSTRAINT "class_sessions_join_code_format" CHECK ("class_sessions"."join_code" ~ '^[0-9]{6}$'),
	CONSTRAINT "class_sessions_time_limit_positive" CHECK ("class_sessions"."time_limit_minutes" is null or "class_sessions"."time_limit_minutes" > 0),
	CONSTRAINT "class_sessions_status_timestamps" CHECK (case "class_sessions"."status"
        when 'lobby' then "class_sessions"."started_at" is null and "class_sessions"."ended_at" is null
        when 'live' then "class_sessions"."started_at" is not null and "class_sessions"."ended_at" is null
        when 'ended' then "class_sessions"."ended_at" is not null
      end)
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"submission_id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"state" "grade_state" DEFAULT 'submitted' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"max_points" integer NOT NULL,
	"grader_read" text,
	"model_line_points" jsonb,
	"grader_reason" text,
	"flag_reason" text,
	"failure_reason" text,
	"source" "grade_source",
	"line_points" jsonb,
	"points" integer,
	"graded_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"outcome_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grades_attempt_positive" CHECK ("grades"."attempt" >= 1),
	CONSTRAINT "grades_max_points_positive" CHECK ("grades"."max_points" > 0),
	CONSTRAINT "grades_points_in_range" CHECK ("grades"."points" is null or ("grades"."points" >= 0 and "grades"."points" <= "grades"."max_points")),
	CONSTRAINT "grades_final_fields_iff_graded" CHECK (("grades"."state" = 'graded') = (
        "grades"."source" is not null and "grades"."line_points" is not null
        and "grades"."points" is not null and "grades"."graded_at" is not null
      )),
	CONSTRAINT "grades_failure_iff_couldnt_grade" CHECK (("grades"."state" = 'couldnt_grade') = ("grades"."failure_reason" is not null)),
	CONSTRAINT "grades_model_result_complete" CHECK (("grades"."grader_read" is null) = ("grades"."model_line_points" is null)
        and ("grades"."grader_read" is null) = ("grades"."grader_reason" is null)),
	CONSTRAINT "grades_needs_teacher_has_model_result" CHECK ("grades"."state" <> 'needs_teacher' or ("grades"."grader_read" is not null and "grades"."flag_reason" is not null)),
	CONSTRAINT "grades_model_source_has_model_result" CHECK ("grades"."source" is distinct from 'model' or "grades"."grader_read" is not null)
);
--> statement-breakpoint
CREATE TABLE "model_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "model_call_status" NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(12, 8),
	"submission_id" uuid,
	"attempt" integer,
	"error_message" text,
	"load_test_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "problem_dependencies" (
	"problem_id" uuid NOT NULL,
	"depends_on_problem_id" uuid NOT NULL,
	CONSTRAINT "problem_dependencies_problem_id_depends_on_problem_id_pk" PRIMARY KEY("problem_id","depends_on_problem_id"),
	CONSTRAINT "problem_dependencies_not_self" CHECK ("problem_dependencies"."problem_id" <> "problem_dependencies"."depends_on_problem_id")
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"text" text NOT NULL,
	"answer_key" text NOT NULL,
	"diagram_description" text,
	"grade_with_page_image" boolean DEFAULT false NOT NULL,
	"page_numbers" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"grading_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problems_position_nonnegative" CHECK ("problems"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rubric_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"points" integer NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rubric_lines_points_positive" CHECK ("rubric_lines"."points" > 0),
	CONSTRAINT "rubric_lines_position_nonnegative" CHECK ("rubric_lines"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"name_key" text NOT NULL,
	"avatar" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_name_key_not_empty" CHECK ("students"."name_key" <> '')
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"whiteboard_url" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_grade_link" UNIQUE("id","session_id","student_id","problem_id")
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"hide_names_and_scores" boolean DEFAULT false NOT NULL,
	"load_test_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teachers_clerkUserId_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "worksheet_pages" (
	"assignment_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"image_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worksheet_pages_assignment_id_page_number_pk" PRIMARY KEY("assignment_id","page_number"),
	CONSTRAINT "worksheet_pages_page_number_positive" CHECK ("worksheet_pages"."page_number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "assignment_chat_messages" ADD CONSTRAINT "assignment_chat_messages_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_submission_fk" FOREIGN KEY ("submission_id","session_id","student_id","problem_id") REFERENCES "public"."submissions"("id","session_id","student_id","problem_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "problem_dependencies" ADD CONSTRAINT "problem_dependencies_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_dependencies" ADD CONSTRAINT "problem_dependencies_depends_on_problem_id_problems_id_fk" FOREIGN KEY ("depends_on_problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_lines" ADD CONSTRAINT "rubric_lines_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worksheet_pages" ADD CONSTRAINT "worksheet_pages_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_chat_messages_assignment_id_created_at_index" ON "assignment_chat_messages" USING btree ("assignment_id","created_at");--> statement-breakpoint
CREATE INDEX "assignments_teacher_id_index" ON "assignments" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "assignments_draft_owner_id_index" ON "assignments" USING btree ("draft_owner_id");--> statement-breakpoint
CREATE INDEX "assignments_load_test_run_id_index" ON "assignments" USING btree ("load_test_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_sessions_open_join_code" ON "class_sessions" USING btree ("join_code") WHERE "class_sessions"."status" <> 'ended';--> statement-breakpoint
CREATE INDEX "class_sessions_teacher_id_index" ON "class_sessions" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "class_sessions_assignment_id_index" ON "class_sessions" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "class_sessions_load_test_run_id_index" ON "class_sessions" USING btree ("load_test_run_id");--> statement-breakpoint
CREATE INDEX "grades_session_id_index" ON "grades" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "grades_student_id_index" ON "grades" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "grades_problem_id_index" ON "grades" USING btree ("problem_id");--> statement-breakpoint
CREATE INDEX "model_calls_created_at_index" ON "model_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "model_calls_load_test_run_id_index" ON "model_calls" USING btree ("load_test_run_id");--> statement-breakpoint
CREATE INDEX "model_calls_submission_id_index" ON "model_calls" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "problem_dependencies_depends_on_problem_id_index" ON "problem_dependencies" USING btree ("depends_on_problem_id");--> statement-breakpoint
CREATE UNIQUE INDEX "problems_assignment_id_position_index" ON "problems" USING btree ("assignment_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_lines_problem_id_position_index" ON "rubric_lines" USING btree ("problem_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "students_session_id_name_key_index" ON "students" USING btree ("session_id","name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_student_id_problem_id_index" ON "submissions" USING btree ("student_id","problem_id");--> statement-breakpoint
CREATE INDEX "submissions_session_id_index" ON "submissions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "submissions_problem_id_index" ON "submissions" USING btree ("problem_id");--> statement-breakpoint
CREATE INDEX "teachers_load_test_run_id_index" ON "teachers" USING btree ("load_test_run_id");