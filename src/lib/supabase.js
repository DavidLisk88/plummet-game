/**
 * supabase.js — Supabase client for PLUMMET
 * 
 * Handles auth, profile CRUD, game score recording, and leaderboard queries.
 * Falls back to localStorage when Supabase credentials are not configured.
 */
import { createClient } from '@supabase/supabase-js';

// ── Environment config ──
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isLocalMode = !SUPABASE_URL || !SUPABASE_ANON_KEY;

export let supabase = null;

if (!isLocalMode) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
        },
    });
}

// ════════════════════════════════════════
// AUTH
// ════════════════════════════════════════

export async function signUp(email, password) {
    if (isLocalMode) throw new Error('Supabase not configured');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    // Create the accounts row client-side (no trigger on auth.users)
    const user = data.session?.user || data.user;
    if (user) {
        await ensureAccountRow(user.id, user.email);
    }
    return data;
}

export async function ensureAccountRow(userId, email) {
    if (isLocalMode || !userId) return;
    const { error } = await supabase
        .from('accounts')
        .upsert({ id: userId, email }, { onConflict: 'id' });
    if (error) console.warn('ensureAccountRow:', error.message);
}

export async function signIn(email, password) {
    if (isLocalMode) throw new Error('Supabase not configured');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // Ensure accounts row exists (backfill for users created before client-side creation)
    const user = data.session?.user || data.user;
    if (user) {
        await ensureAccountRow(user.id, user.email);
    }
    return data;
}

export async function signOut() {
    if (isLocalMode) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

export async function getSession() {
    if (isLocalMode) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session || null;
}

export async function getUser() {
    if (isLocalMode) return null;
    const { data } = await supabase.auth.getUser();
    return data?.user || null;
}

export function onAuthStateChange(callback) {
    if (isLocalMode) return { data: { subscription: { unsubscribe: () => {} } } };
    return supabase.auth.onAuthStateChange(callback);
}

export async function resetPassword(email) {
    if (isLocalMode) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
}

// ════════════════════════════════════════
// PROFILES
// ════════════════════════════════════════

export async function getProfiles(accountId) {
    if (isLocalMode) return [];
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

export async function createProfile(accountId, username) {
    if (isLocalMode) return null;
    // Check if profile with same name already exists (prevent duplicates)
    const { data: existing } = await supabase
        .from('profiles')
        .select('*')
        .eq('account_id', accountId)
        .eq('username', username)
        .maybeSingle();
    if (existing) return existing;

    const { data, error } = await supabase
        .from('profiles')
        .insert({ account_id: accountId, username })
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function updateProfile(profileId, updates) {
    if (isLocalMode) return null;
    const { data, error } = await supabase
        .from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', profileId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deleteProfile(profileId) {
    if (isLocalMode) return;
    const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', profileId);
    if (error) throw error;
}

// ════════════════════════════════════════
// GAME SCORES
// ════════════════════════════════════════

export async function recordGameScore(scoreData) {
    if (isLocalMode) return null;
    console.log('[supabase] recordGameScore payload:', JSON.stringify(scoreData, null, 2));
    const { data, error } = await supabase
        .from('game_scores')
        .insert(scoreData)
        .select()
        .single();
    if (error) {
        console.error('[supabase] recordGameScore INSERT error:', error.message, error.code, error.details, error.hint);
        throw error;
    }
    console.log('[supabase] recordGameScore SUCCESS:', data?.id);
    return data;
}

// ════════════════════════════════════════
// INVENTORY
// ════════════════════════════════════════

export async function addInventoryItem(profileId, itemId) {
    if (isLocalMode) return null;
    const { data, error } = await supabase
        .from('profile_inventory')
        .upsert({ profile_id: profileId, item_id: itemId })
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ════════════════════════════════════════
// LEADERBOARD
// ════════════════════════════════════════

export async function getLeaderboard(limit = 50, offset = 0, classFilter = null) {
    if (isLocalMode) return [];
    const { data, error } = await supabase.rpc('get_leaderboard', {
        p_limit: limit,
        p_offset: offset,
        p_class_filter: classFilter,
    });
    if (error) throw error;
    return data || [];
}

export async function getChallengeLeaderboard(challengeType, limit = 50, offset = 0, classFilter = null) {
    if (isLocalMode) return [];
    const { data, error } = await supabase.rpc('get_challenge_leaderboard', {
        p_challenge_type: challengeType,
        p_limit: limit,
        p_offset: offset,
        p_class_filter: classFilter,
    });
    if (error) throw error;
    return data || [];
}

export async function getMyRank() {
    if (isLocalMode) return null;
    const { data, error } = await supabase.rpc('get_my_rank');
    if (error) throw error;
    return data?.[0] || null;
}

export async function getMyChallengeRank(challengeType) {
    if (isLocalMode) return null;
    const { data, error } = await supabase.rpc('get_my_challenge_rank', {
        p_challenge_type: challengeType,
    });
    if (error) throw error;
    return data?.[0] || null;
}

export async function getChallengeAnalysisData(profileId, challengeType) {
    if (isLocalMode) return null;
    const { data, error } = await supabase.rpc('get_challenge_analysis_data', {
        p_profile_id: profileId,
        p_challenge_type: challengeType,
    });
    if (error) throw error;
    return data;
}

export async function updateMyRanking() {
    if (isLocalMode) return;
    const { error } = await supabase.rpc('update_my_ranking');
    if (error) throw error;
}

// Note: refreshLeaderboard and refreshChallengeLeaderboards are restricted to service_role.
// Use updateMyRanking() for per-user updates after games.
export async function refreshLeaderboard() {
    if (isLocalMode) return;
    const { error } = await supabase.rpc('refresh_leaderboard');
    if (error) throw error;
}

export async function refreshChallengeLeaderboards() {
    if (isLocalMode) return;
    const { error } = await supabase.rpc('refresh_challenge_leaderboards');
    if (error) throw error;
}

// ════════════════════════════════════════
// PLAYER ANALYSIS (for AI-generated text)
// ════════════════════════════════════════

export async function getPlayerAnalysisData(profileId) {
    if (isLocalMode) return null;
    const { data, error } = await supabase.rpc('get_player_analysis_data', {
        p_profile_id: profileId,
    });
    if (error) throw error;
    return data;
}

// ════════════════════════════════════════
// DELETE ACCOUNT
// ════════════════════════════════════════

export async function deleteAccount() {
    if (isLocalMode) return;
    // Deleting the account row cascades to all data
    const user = await getUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await supabase.from('accounts').delete().eq('id', user.id);
    if (error) throw error;
    await signOut();
}
