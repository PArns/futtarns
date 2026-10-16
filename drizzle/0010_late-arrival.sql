ALTER TABLE "attendance" ADD COLUMN "late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "arrives_at" text;