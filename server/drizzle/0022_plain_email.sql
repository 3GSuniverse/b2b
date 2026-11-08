-- The old "Plain letter" design was full of [BRACKETS] to replace. Unwritten copies of it become the new
-- blank plain email, which people type straight into. Anything already written is left alone.
UPDATE "templates" SET "html" = $h$<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:24px 16px;font:15px/1.6 Arial,Helvetica,sans-serif;color:#1a1a1a;background:#ffffff;">
<div data-drona-letter="1" style="max-width:560px;"><p style="margin:0 0 14px;">Hi {first_name|there},</p><p style="margin:0 0 14px;"><br></p><p style="margin:0 0 14px;">Warm regards,<br>{company_name}</p></div>
</body></html>$h$, "updated_at" = now()
WHERE "html" LIKE '%[WRITE AS YOU WOULD TO ONE CUSTOMER%';
--> statement-breakpoint
UPDATE "campaigns" SET "html" = $h$<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:24px 16px;font:15px/1.6 Arial,Helvetica,sans-serif;color:#1a1a1a;background:#ffffff;">
<div data-drona-letter="1" style="max-width:560px;"><p style="margin:0 0 14px;">Hi {first_name|there},</p><p style="margin:0 0 14px;"><br></p><p style="margin:0 0 14px;">Warm regards,<br>{company_name}</p></div>
</body></html>$h$, "updated_at" = now()
WHERE "status" IN ('DRAFT', 'SCHEDULED') AND "html" LIKE '%[WRITE AS YOU WOULD TO ONE CUSTOMER%';
