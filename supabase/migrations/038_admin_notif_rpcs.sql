-- ════════════════════════════════════════════════════════════════════════════
-- 038: Admin RPCs for the notification dashboard
--
-- The dashboard previously used the SERVICE ROLE key in the browser to
-- read push_tokens / notification_log / profiles. That key is now never
-- shipped to the client. Instead, the dashboard sends an X-Admin-Token
-- header + uses these SECURITY DEFINER RPCs which validate the token
-- server-side via vault-stored secret comparison.
--
-- Setup:
--   -- 1. In the Supabase Dashboard → Database → Vault, store the secret:
--   --    name:  admin_push_token
--   --    value: <same long random string set as ADMIN_PUSH_TOKEN edge secret>
--   --
--   -- (If not using Vault, you can store it in a private settings table —
--   --  but Vault is the supported path. The function below reads it via
--   --  vault.decrypted_secrets.)
-- ════════════════════════════════════════════════════════════════════════════

-- Helper: validates that the X-Admin-Token request header matches the
-- vault-stored secret. Returns true/false. Reads header via
-- current_setting('request.headers') exposed by PostgREST.
CREATE OR REPLACE FUNCTION public._admin_token_ok(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
    v_secret TEXT;
    v_header TEXT;
BEGIN
    -- Prefer explicit param if passed (lets the edge function reuse this).
    v_header := COALESCE(p_token, current_setting('request.headers', true)::json->>'x-admin-token', '');
    IF v_header IS NULL OR length(v_header) < 16 THEN
        RETURN FALSE;
    END IF;

    BEGIN
        SELECT decrypted_secret INTO v_secret
        FROM vault.decrypted_secrets
        WHERE name = 'admin_push_token'
        LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
        v_secret := NULL;
    END;

    IF v_secret IS NULL OR length(v_secret) < 16 THEN
        RETURN FALSE;
    END IF;

    -- Constant-length comparison (length already confirmed non-null above).
    RETURN v_header = v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public._admin_token_ok(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._admin_token_ok(TEXT) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- admin_notif_stats — aggregate counts only (no row data leaks)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_notif_stats()
RETURNS TABLE (token_count BIGINT, notif_count BIGINT, user_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
    IF NOT public._admin_token_ok(NULL) THEN
        RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
        SELECT
            (SELECT COUNT(*) FROM public.push_tokens),
            (SELECT COUNT(*) FROM public.notification_log),
            (SELECT COUNT(*) FROM public.profiles);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_notif_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_notif_stats() TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- admin_notif_users — usernames + account_ids for the target dropdown
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_notif_users()
RETURNS TABLE (account_id UUID, username TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
    IF NOT public._admin_token_ok(NULL) THEN
        RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
        SELECT p.account_id, p.username
        FROM public.profiles p
        WHERE p.username IS NOT NULL
        ORDER BY p.username ASC
        LIMIT 1000;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_notif_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_notif_users() TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- admin_notif_history — recent sent log
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_notif_history(p_limit INT DEFAULT 20)
RETURNS TABLE (
    id UUID, title TEXT, body TEXT, sent_at TIMESTAMPTZ,
    target TEXT, tokens_sent INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
    IF NOT public._admin_token_ok(NULL) THEN
        RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
        SELECT n.id, n.title, n.body, n.sent_at, n.target, n.tokens_sent
        FROM public.notification_log n
        ORDER BY n.sent_at DESC
        LIMIT GREATEST(1, LEAST(p_limit, 100));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_notif_history(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_notif_history(INT) TO anon, authenticated;
