-- updated_at triggers. Idempotent — safe to re-run after adding a table.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'orgs','credentials','settings','icps','sequences','mailboxes','campaigns',
    'companies','prospects','emails','calls','jobs'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      t, t);
  END LOOP;
END $$;
