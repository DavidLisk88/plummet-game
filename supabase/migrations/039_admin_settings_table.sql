-- ════════════════════════════════════════════════════════════════════════════
-- 039: Switch admin token storage from Vault to a private settings table.
--
-- Hosted Supabase blocks `ALTER DATABASE … SET app.*` and the Vault UI
-- has been unreliable for non-paid tiers. This stores the admin token in
-- a plain table with RLS enabled and zero policies, so only SECURITY
-- DEFINER functions can read it.
--
-- After running this migration, store the token via:
--   INSERT INTO public._admin_settings (key, value)
--   VALUES ('admin_push_token', '<64-char hex>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public._admin_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

ALTER TABLE public._admin_settings ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies → anon/authenticated cannot SELECT/INSERT/UPDATE.
-- Only SECURITY DEFINER functions (running as table owner) can read it.

REVOKE ALL ON TABLE public._admin_settings FROM PUBLIC, anon, authenticated;

-- Replace the helper to read from the settings table instead of vault.
CREATE OR REPLACE FUNCTION public._admin_token_ok(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_secret TEXT;
    v_header TEXT;
BEGIN
    v_header := COALESCE(p_token, current_setting('request.headers', true)::json->>'x-admin-token', '');
    IF v_header IS NULL OR length(v_header) < 16 THEN
        RETURN FALSE;
    END IF;

    SELECT value INTO v_secret
    FROM public._admin_settings
    WHERE key = 'admin_push_token'
    LIMIT 1;

    IF v_secret IS NULL OR length(v_secret) < 16 THEN
        RETURN FALSE;
    END IF;

    RETURN v_header = v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public._admin_token_ok(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._admin_token_ok(TEXT) TO anon, authenticated;
