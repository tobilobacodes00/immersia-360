-- ACC-3: an organization always keeps at least one owner. The server checks this before it acts (apps/web/src/lib/team-rules.ts),
-- but two owners demoting each other at the same moment would both pass that check; this trigger makes the rule hold for every
-- path into the table, under concurrency.
CREATE FUNCTION "is_owner_role"(roles text) RETURNS boolean AS $$
  SELECT 'owner' = ANY (string_to_array(replace(roles, ' ', ''), ','))
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint
CREATE FUNCTION "org_keeps_owner"() RETURNS trigger AS $$
DECLARE
  giving_up_ownership boolean;
BEGIN
  -- (NEW does not exist in a DELETE trigger, so it is only read on the UPDATE branch.)
  IF TG_OP = 'DELETE' THEN
    giving_up_ownership := "is_owner_role"(OLD."role");
  ELSE
    giving_up_ownership := "is_owner_role"(OLD."role") AND NOT "is_owner_role"(NEW."role");
  END IF;
  IF giving_up_ownership THEN
    -- One owner change per organization at a time: the check below must see the other transaction's result.
    PERFORM pg_advisory_xact_lock(hashtextextended('org_keeps_owner:' || OLD."organization_id", 0));
    -- When the organization itself is being deleted, its members go with it.
    IF EXISTS (SELECT 1 FROM "organization" WHERE "id" = OLD."organization_id")
       AND NOT EXISTS (
         SELECT 1 FROM "member" m
         WHERE m."organization_id" = OLD."organization_id" AND m."id" <> OLD."id" AND "is_owner_role"(m."role")
       ) THEN
      RAISE EXCEPTION 'organization_needs_owner' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "member_keeps_owner" BEFORE DELETE OR UPDATE OF "role" ON "member" FOR EACH ROW EXECUTE FUNCTION "org_keeps_owner"();
