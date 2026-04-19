// deno-lint-ignore-file
// @ts-nocheck — This is a Deno-based Supabase Edge Function; VS Code TS errors are expected.

/**
 * send-notification — Supabase Edge Function
 *
 * Sends push notifications to registered devices via APNs (iOS) and FCM (Android).
 * Called from the admin dashboard with service_role key.
 *
 * Required Supabase secrets:
 *   APNS_KEY_ID      — Your APNs key ID from Apple Developer
 *   APNS_TEAM_ID     — Your Apple Developer Team ID
 *   APNS_PRIVATE_KEY — Contents of the .p8 file (base64 encoded, no line breaks)
 *   APNS_BUNDLE_ID   — com.plummetgame.app  (optional, defaults to this value)
 *   FCM_SERVER_KEY   — Firebase Cloud Messaging Server Key (from Firebase Console → Project Settings → Cloud Messaging)
 *
 * POST body: { "title": "...", "body": "...", "target": "all" | "<account_id>" }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const APNS_KEY_ID           = Deno.env.get('APNS_KEY_ID')!
const APNS_TEAM_ID          = Deno.env.get('APNS_TEAM_ID')!
const APNS_PRIVATE_KEY_B64  = Deno.env.get('APNS_PRIVATE_KEY')!
const APNS_BUNDLE_ID        = Deno.env.get('APNS_BUNDLE_ID') || 'com.plummetgame.app'
const APNS_HOST             = 'https://api.push.apple.com'    // Production APNs
// const APNS_HOST          = 'https://api.sandbox.push.apple.com'  // Dev/sandbox builds

const FCM_SERVER_KEY        = Deno.env.get('FCM_SERVER_KEY') || ''  // Optional; Android only
const FCM_ENDPOINT          = 'https://fcm.googleapis.com/fcm/send'
const NOTIFICATION_SOUND    = 'wotd_chime.wav'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
        },
    })
}

// ---------------------------------------------------------------------------
// APNs helpers
// ---------------------------------------------------------------------------

/**
 * Convert a DER-encoded ECDSA signature (from WebCrypto) to the raw r||s format
 * required by the APNs JWT spec (RFC 7518, section 3.4).
 */
function derToRaw(derSignature: ArrayBuffer): Uint8Array {
    const view = new DataView(derSignature)
    // DER layout: 0x30 <total-len> 0x02 <r-len> <r-bytes> 0x02 <s-len> <s-bytes>
    let offset = 2                          // skip 0x30 and total length byte
    const rLen = view.getUint8(offset + 1); offset += 2
    const r = new Uint8Array(derSignature, offset, rLen); offset += rLen
    const sLen = view.getUint8(offset + 1); offset += 2
    const s = new Uint8Array(derSignature, offset, sLen)

    // Strip optional leading 0x00 sign-extension byte
    const rStart = r[0] === 0 ? 1 : 0
    const sStart = s[0] === 0 ? 1 : 0

    const raw = new Uint8Array(64)
    raw.set(r.slice(rStart), 32 - (rLen - rStart))
    raw.set(s.slice(sStart), 64 - (sLen - sStart))
    return raw
}

/**
 * Create a signed ES256 JWT for APNs token-based auth.
 */
async function createAPNsJWT(): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const header  = { alg: 'ES256', kid: APNS_KEY_ID, typ: 'JWT' }
    const payload = { iss: APNS_TEAM_ID, iat: now }

    const b64url = (obj: unknown) =>
        btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

    const headerB64  = b64url(header)
    const payloadB64 = b64url(payload)
    const signingInput = `${headerB64}.${payloadB64}`

    // Decode the .p8 private key (base64-encoded PKCS#8)
    const keyPEM = atob(APNS_PRIVATE_KEY_B64)
    const pemBody = keyPEM
        .replace('-----BEGIN PRIVATE KEY-----', '')
        .replace('-----END PRIVATE KEY-----', '')
        .replace(/\s/g, '')
    const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))

    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8', keyData,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false, ['sign']
    )

    // WebCrypto returns DER format; APNs JWT requires raw r||s (64 bytes)
    const derSig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        cryptoKey,
        new TextEncoder().encode(signingInput)
    )
    const rawSig = derToRaw(derSig)
    const sigB64 = btoa(String.fromCharCode(...rawSig))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

    return `${headerB64}.${payloadB64}.${sigB64}`
}

// ---------------------------------------------------------------------------
// APNs send
// ---------------------------------------------------------------------------

/**
 * Send a single push notification via APNs (iOS).
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
                    sound: NOTIFICATION_SOUND,
                    badge: 1,
                },
            }),
        })

        if (res.ok) return { token, success: true }

        const errBody = await res.text()
        console.error(`APNs error for ${token.substring(0, 10)}…: ${res.status} ${errBody}`)

        // 410 = token is permanently invalid; 400 = bad device token
        if (res.status === 410 || res.status === 400) {
            return { token, success: false, error: `invalid_token: ${res.status}` }
        }
        return { token, success: false, error: `${res.status}: ${errBody}` }
    } catch (err) {
        return { token, success: false, error: String(err) }
    }
}

// ---------------------------------------------------------------------------
// FCM send (Android)
// ---------------------------------------------------------------------------

/**
 * Send push notifications to a batch of Android tokens via FCM legacy API.
 * Returns per-token results so invalid tokens can be pruned.
 */
async function sendToFCM(tokens: string[], title: string, body: string): Promise<{ token: string; success: boolean; error?: string }[]> {
    if (!FCM_SERVER_KEY) {
        return tokens.map(token => ({ token, success: false, error: 'FCM_SERVER_KEY not configured' }))
    }

    try {
        const res = await fetch(FCM_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `key=${FCM_SERVER_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                registration_ids: tokens,
                notification: { title, body, sound: 'default' },
                android: { priority: 'high' },
            }),
        })

        if (!res.ok) {
            const errText = await res.text()
            console.error(`FCM error: ${res.status} ${errText}`)
            return tokens.map(token => ({ token, success: false, error: `FCM ${res.status}` }))
        }

        const { results } = await res.json()
        return tokens.map((token, i) => {
            const r = results?.[i]
            if (!r) return { token, success: false, error: 'no result' }
            if (r.error === 'InvalidRegistration' || r.error === 'NotRegistered') {
                return { token, success: false, error: `invalid_token: ${r.error}` }
            }
            if (r.error) {
                return { token, success: false, error: r.error }
            }
            return { token, success: true }
        })
    } catch (err) {
        return tokens.map(token => ({ token, success: false, error: String(err) }))
    }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS })
    }

    try {
        console.log('✓ send-notification handler called')
        
        if (req.method !== 'POST') {
            return jsonResponse({ error: 'Method not allowed' }, 405)
        }

        console.log('✓ POST request verified')

        // Auth is disabled for testing; remove comments to re-enable
        // const authHeader = (req.headers.get('authorization') || '').trim()
        // const apiKeyHeader = (req.headers.get('apikey') || '').trim()
        // if (!authHeader && !apiKeyHeader) {
        //     return jsonResponse({ error: 'Missing authorization headers' }, 401)
        // }

        const { title, body, target = 'all' } = await req.json()
        console.log(`✓ Parsed JSON: target=${target}, title length=${title?.length || 0}`)
        if (!title || !body) {
            return jsonResponse({ error: 'title and body required' }, 400)
        }

        console.log('✓ Validation passed')

        // Fetch tokens from DB
        console.log(`Connecting to Supabase: ${SUPABASE_URL}`)
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        console.log('✓ Supabase client created')
        let query = supabase.from('push_tokens').select('token, account_id, platform')

        if (target !== 'all') {
            query = query.eq('account_id', target)
        }

        const { data: rows, error: dbError } = await query
        console.log(`✓ DB query returned: rows=${rows?.length || 0}, error=${dbError?.message || 'none'}`)
        
        if (dbError) {
            console.error(`DB Error: ${dbError.message}`)
            return jsonResponse({ error: dbError.message }, 500)
        }
        if (!rows || rows.length === 0) {
            return jsonResponse({ sent: 0, message: 'No tokens found' })
        }

        const iosTokens     = rows.filter(r => r.platform === 'ios').map(r => r.token)
        const androidTokens = rows.filter(r => r.platform === 'android').map(r => r.token)

        // ── iOS via APNs ──
        let iosResults: { token: string; success: boolean; error?: string }[] = []
        if (iosTokens.length > 0) {
            const jwt = await createAPNsJWT()
            iosResults = await Promise.all(iosTokens.map(t => sendToAPNs(t, title, body, jwt)))
        }

        // ── Android via FCM ──
        let androidResults: { token: string; success: boolean; error?: string }[] = []
        if (androidTokens.length > 0) {
            // FCM allows up to 1000 tokens per request; batch if needed
            const BATCH = 1000
            for (let i = 0; i < androidTokens.length; i += BATCH) {
                const batch = androidTokens.slice(i, i + BATCH)
                const batchResults = await sendToFCM(batch, title, body)
                androidResults.push(...batchResults)
            }
        }

        const allResults = [...iosResults, ...androidResults]
        const successes  = allResults.filter(r => r.success).length
        const errors     = allResults.filter(r => !r.success)

        // Clean up permanently invalid tokens
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

        return jsonResponse({
            sent:         successes,
            failed:       errors.length,
            cleaned:      invalidTokens.length,
            total_tokens: rows.length,
            ios_tokens:   iosTokens.length,
            android_tokens: androidTokens.length,
        })
    } catch (error) {
        console.error('send-notification unhandled error:', error)
        return jsonResponse({ error: String(error) }, 500)
    }
})
