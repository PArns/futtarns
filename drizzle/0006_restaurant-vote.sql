CREATE TABLE "restaurant_hosts" (
	"restaurant_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	CONSTRAINT "restaurant_hosts_restaurant_id_member_id_pk" PRIMARY KEY("restaurant_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "restaurant_votes" (
	"friday_date" date NOT NULL,
	"member_id" integer NOT NULL,
	"restaurant_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_votes_friday_date_member_id_pk" PRIMARY KEY("friday_date","member_id")
);
--> statement-breakpoint
ALTER TABLE "fridays" ADD COLUMN "restaurant_chosen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fridays" ADD COLUMN "vote_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fridays" ADD COLUMN "vote_dropped_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_hosts" ADD CONSTRAINT "restaurant_hosts_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_hosts" ADD CONSTRAINT "restaurant_hosts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_votes" ADD CONSTRAINT "restaurant_votes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_votes" ADD CONSTRAINT "restaurant_votes_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;