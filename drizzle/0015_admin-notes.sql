CREATE TABLE "admin_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"note" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_notes_created_idx" ON "admin_notes" USING btree ("created_at");