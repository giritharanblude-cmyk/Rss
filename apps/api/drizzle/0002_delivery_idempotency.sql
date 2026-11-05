CREATE UNIQUE INDEX "deliveries_idempotency_unique"
ON "deliveries" ("recipient_id", "channel", "kind", "subject_or_ref")
WHERE "subject_or_ref" IS NOT NULL;
