-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Migration 035 — delete_own_account RPC                              ║
-- ║                                                                      ║
-- ║  Allows a user to fully delete their own account, including the      ║
-- ║  auth.users row (which frees the email for re-registration).         ║
-- ║  Runs as SECURITY DEFINER so it has permission to delete from        ║
-- ║  auth.users. Only deletes the calling user's own row.                ║
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 1. Delete from accounts (cascades to profiles, scores, inventory, etc.)
    DELETE FROM accounts WHERE id = v_user_id;

    -- 2. Delete the auth.users row (frees email for re-registration)
    DELETE FROM auth.users WHERE id = v_user_id;
END;
$$;
