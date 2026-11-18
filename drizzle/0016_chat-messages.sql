CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_member_idx" ON "chat_messages" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_created_idx" ON "chat_messages" USING btree ("created_at");