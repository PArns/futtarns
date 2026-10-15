ALTER TABLE "order_items" ADD COLUMN "restaurant_id" integer;--> statement-breakpoint
-- Every order so far was for its Friday's restaurant, which the first order pins.
UPDATE "order_items" SET "restaurant_id" = "fridays"."restaurant_id" FROM "fridays" WHERE "fridays"."date" = "order_items"."friday_date";--> statement-breakpoint
-- A Friday without a restaurant has no orders: switching away or to a flat price deletes them.
DELETE FROM "order_items" WHERE "restaurant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "restaurant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;
