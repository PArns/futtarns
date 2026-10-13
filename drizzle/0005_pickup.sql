ALTER TABLE "fridays" ADD COLUMN "pickup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fridays" ADD COLUMN "picker_id" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payee_id" integer;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "pickup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fridays" ADD CONSTRAINT "fridays_picker_id_members_id_fk" FOREIGN KEY ("picker_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payee_id_members_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;