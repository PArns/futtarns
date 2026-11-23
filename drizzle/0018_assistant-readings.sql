CREATE TABLE "assistant_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"chat_message_id" integer,
	"message" text NOT NULL,
	"facts" text NOT NULL,
	"chat" text DEFAULT '' NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"interpretation" jsonb,
	"action" text,
	"command" text,
	"answer" text,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"rating" integer,
	"rating_note" text,
	"rated_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_readings" ADD CONSTRAINT "assistant_readings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_readings" ADD CONSTRAINT "assistant_readings_chat_message_id_chat_messages_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_readings" ADD CONSTRAINT "assistant_readings_rated_by_id_members_id_fk" FOREIGN KEY ("rated_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_readings_created_idx" ON "assistant_readings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "assistant_readings_chat_idx" ON "assistant_readings" USING btree ("chat_message_id");