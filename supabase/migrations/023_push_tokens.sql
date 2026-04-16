-- ════════════════════════════════════════════════════════════════
-- 023: Push notification token storage
-- ════════════════════════════════════════════════════════════════

CREATE TABLE public.push_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, token)
);

-- Index for sending to all tokens for an account
CREATE INDEX idx_push_tokens_account ON public.push_tokens(account_id);

-- RLS: users can manage their own tokens
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own tokens"
    ON public.push_tokens FOR INSERT
    WITH CHECK (account_id = auth.uid());

CREATE POLICY "Users can read own tokens"
    ON public.push_tokens FOR SELECT
    USING (account_id = auth.uid());

CREATE POLICY "Users can delete own tokens"
    ON public.push_tokens FOR DELETE
    USING (account_id = auth.uid());

CREATE POLICY "Users can update own tokens"
    ON public.push_tokens FOR UPDATE
    USING (account_id = auth.uid());

-- ════════════════════════════════════════════════════════════════
-- Notification log (track what was sent)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE public.notification_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_by     UUID REFERENCES public.accounts(id),
    target      TEXT NOT NULL DEFAULT 'all', -- 'all', or a specific account_id
    tokens_sent INTEGER NOT NULL DEFAULT 0,
    errors      JSONB DEFAULT '[]'
);

-- Only service role can write to notification_log (via Edge Function)
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- RPC to register/upsert a push token (callable from client)
CREATE OR REPLACE FUNCTION public.register_push_token(p_token TEXT, p_platform TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.push_tokens (account_id, token, platform)
    VALUES (auth.uid(), p_token, p_platform)
    ON CONFLICT (account_id, token) DO UPDATE SET
        platform = p_platform,
        updated_at = NOW();
END;
$$;

-- RPC to remove a push token (on logout)
CREATE OR REPLACE FUNCTION public.unregister_push_token(p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.push_tokens
    WHERE account_id = auth.uid() AND token = p_token;
END;
$$;
