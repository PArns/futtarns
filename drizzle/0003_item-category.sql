ALTER TABLE "order_items" ADD COLUMN "category" text;--> statement-breakpoint
UPDATE "order_items" SET "category" = "dishes"."category" FROM "dishes" WHERE "order_items"."dish_id" = "dishes"."id";
