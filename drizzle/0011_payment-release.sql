ALTER TABLE "fridays" ADD COLUMN "payment_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fridays" ADD COLUMN "payment_notify" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Fridays closed before this change paid from the deadline on and sent their links then.
UPDATE "fridays" SET "payment_released_at" = "locked_at", "payment_notify" = true WHERE "locked_at" IS NOT NULL;
