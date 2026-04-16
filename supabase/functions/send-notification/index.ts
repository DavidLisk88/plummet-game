// deno-lint-ignore-file
// @ts-nocheck — This is a Deno-based Supabase Edge Function; VS Code TS errors are expected.

/**
 * send-notification — Supabase Edge Function
 * 
 * Sends push notifications to all registered devices via APNs (iOS).
 * Called from the admin dashboard with service_role key.
 * 
 * Required Supabase secrets:
 *   APNS_KEY_ID      — Your APNs key ID from Apple Developer
 *   APNS_TEAM_ID     — Your Apple Developer Team ID
 *   APNS_PRIVATE_KEY — Contents of the .p8 file (base64 encoded)
 *   APNS_BUNDLE_ID   — com.plummetgame.app
 * 
 * POST body: { "title": "...", "body": "...", "target": "all" | "<account_id>" }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID')!
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID')!
const APNS_PRIVATE_KEY_B64 = Deno.env.get('APNS_PRIVATE_KEY')!
const APNS_BUNDLE_ID = Deno.env.get('APNS_BUNDLE_ID') || 'com.plummetgame.app'
const APNS_HOST = 'https://api.push.apple.com' // Production
// const APNS_HOST = 'https://api.sandbox.push.apple.com' // Sandbox (dev builds)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/**
 * Create a JWT for APNs token-based auth
 */
async function createAPNsJWT(): Promise<string> {
    const header = { alg: 'ES256', kid: APNS_KEY_ID, typ: 'JWT' }
    const now = Math.floor(Date.now() / 1000)
    const payload = { iss: APNS_TEAM_ID, iat: now }

    const enc = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
    const headerB64 = enc(header)
    const payloadB64 = enc(payload)
    const signingInput = `${headerB64}.${payloadB64}`

    // Decode the .p8 private key
    const keyPEM = atob(APNS_PRIVATE_KEY_B64)
    const pemContents = keyPEM
        .replace('-----BEGIN PRIVATE KEY-----', '')
        .replace('-----END PRIVATE KEY-----', '')
        .replace(/\s/g, '')
    const keyData = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))

    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        keyData,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    )

    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        cryptoKey,
        new TextEncoder().encode(signingInput)
    )

    // Convert DER signature to raw r||s format expected by JWT
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

    return `${headerB64}.${payloadB64}.${sigB64}`
}

/**
 * Send a single push notification via APNs
 */
async function sendToAPNs(token: string, title: string, body: string, jwt: string): Promise<{ token: string; success: boolean; error?: string }> {
    try {
        const res = await fetch(`${APNS_HOST}/3/device/${token}`, {
            method: 'POST',
            headers: {
                'authorization': `bearer ${jwt}`,
                'apns-topic': APNS_BUNDLE_ID,
                'apns-push-type': 'alert',
                'apns-priority': '10',
                'apns-expiration': '0',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                aps: {
                    alert: { title, body },
                    sound: 'default',
                    badge: 1,
                }
            }),
        })

        if (res.ok) {
            return { token, success: true }
        }

        const errBody = await res.text()
        console.error(`APNs error for token ${token.substring(0, 10)}...: ${res.status} ${errBody}`)

        // If the token is invalid, we should clean it up
        if (res.status === 410 || res.status === 400) {
            return { token, success: false, error: `invalid_token: ${res.status}` }
        }

        return { token, success: false, error: `${res.status}: ${errBody}` }
    } catch (err) {
        return { token, success: false, error: String(err) }
    }
}

Deno.serve(async (req) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST',
                'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
            },
        })
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
    }

    // Verify service_role auth (only admin can send)
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    if (token !== SUPABASE_SERVICE_ROLE_KEY) {
        return new Response(JSON.stringify({ error: 'Unauthorized — service_role key required' }), { status: 401 })
    }

    const { title, body, target = 'all' } = await req.json()
    if (!title || !body) {
        return new Response(JSON.stringify({ error: 'title and body required' }), { status: 400 })
    }

    // Get tokens from DB
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    let query = supabase.from('push_tokens').select('token, account_id').eq('platform', 'ios')

    if (target !== 'all') {
        query = query.eq('account_id', target)
    }

    const { data: tokens, error: dbError } = await query
    if (dbError) {
        return new Response(JSON.stringify({ error: dbError.message }), { status: 500 })
    }

    if (!tokens || tokens.length === 0) {
        return new Response(JSON.stringify({ sent: 0, message: 'No tokens found' }), {
            headers: { 'Content-Type': 'application/json' },
        })
    }

    // Create APNs JWT (reuse for all sends)
    const jwt = await createAPNsJWT()

    // Send to all tokens
    const results = await Promise.allSettled(
        tokens.map(t => sendToAPNs(t.token, title, body, jwt))
    )

    const successes = results.filter(r => r.status === 'fulfilled' && (r as PromiseFulfilledResult<any>).value.success).length
    const errors = results
        .filter(r => r.status === 'fulfilled' && !(r as PromiseFulfilledResult<any>).value.success)
        .map(r => (r as PromiseFulfilledResult<any>).value)

    // Clean up invalid tokens
    const invalidTokens = errors
        .filter(e => e.error?.startsWith('invalid_token'))
        .map(e => e.token)

    if (invalidTokens.length > 0) {
        await supabase.from('push_tokens').delete().in('token', invalidTokens)
        console.log(`Cleaned up ${invalidTokens.length} invalid tokens`)
    }

    // Log the notification
    await supabase.from('notification_log').insert({
        title,
        body,
        target,
        tokens_sent: successes,
        errors: errors.length > 0 ? errors : [],
    })

    return new Response(JSON.stringify({
        sent: successes,
        failed: errors.length,
        cleaned: invalidTokens.length,
        total_tokens: tokens.length,
    }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
})
