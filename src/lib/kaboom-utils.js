/**
 * kaboom-utils.js — Kaboom.js utility extraction for PLUMMET
 *
 * Extracts useful utility functions from Kaboom.js for use in the game:
 *   - Easing functions (beyond what GSAP provides)
 *   - Timer/scheduler utilities (wait, loop, cancel)
 *   - Screen shake algorithms
 *   - Collision geometry helpers (rect overlap, circle-rect, ray casting)
 *   - Math utilities (lerp, map, wave, rand)
 *   - Color utilities
 *   - Event system (on/off/trigger)
 */
import kaboom from 'kaboom';

// Initialize a headless kaboom context for utility access
let _k = null;
let _kCanvas = null;

function _ensureKaboom() {
    if (_k) return _k;
    try {
        // Create an offscreen kaboom context — we only use its math/utility functions
        _kCanvas = document.createElement('canvas');
        _kCanvas.width = 1;
        _kCanvas.height = 1;
        _kCanvas.style.display = 'none';
        document.body.appendChild(_kCanvas);

        _k = kaboom({
            canvas: _kCanvas,
            width: 1,
            height: 1,
            background: [0, 0, 0],
            global: false, // Don't pollute global namespace
            debug: false,
        });
        return _k;
    } catch (e) {
        console.warn('[kaboom-utils] Failed to init kaboom context:', e.message);
        return null;
    }
}

// ── Easing Functions ──

/**
 * Kaboom-style easing functions.
 * These complement GSAP's easing with game-specific curves.
 */
export const KaboomEase = {
    /** Smooth ease in-out (sine) */
    smooth: t => t * t * (3 - 2 * t),

    /** Elastic ease out — bouncy overshoot */
    elastic: t => {
        if (t === 0 || t === 1) return t;
        return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
    },

    /** Bounce ease out */
    bounce: t => {
        const n1 = 7.5625;
        const d1 = 2.75;
        if (t < 1 / d1) return n1 * t * t;
        if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
        if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
        return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },

    /** Back ease — overshoots then returns */
    back: t => {
        const s = 1.70158;
        return t * t * ((s + 1) * t - s);
    },

    /** Expo ease out — fast start, slow end */
    expo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),

    /** Squish — compress and bounce */
    squish: t => {
        const s = Math.sin(t * Math.PI);
        return s * s;
    },
};

// ── Timer / Scheduler ──

const _timers = new Map();
let _timerNextId = 0;

/**
 * Schedule a callback after a delay.
 * Returns a cancel handle.
 *
 * @param {number} seconds - Delay in seconds
 * @param {Function} callback
 * @returns {number} Timer ID (pass to cancelTimer)
 */
export function scheduleTimer(seconds, callback) {
    const id = _timerNextId++;
    const handle = setTimeout(() => {
        _timers.delete(id);
        callback();
    }, seconds * 1000);
    _timers.set(id, handle);
    return id;
}

/**
 * Schedule a repeating callback.
 *
 * @param {number} intervalSeconds
 * @param {Function} callback
 * @returns {number} Timer ID
 */
export function scheduleLoop(intervalSeconds, callback) {
    const id = _timerNextId++;
    const handle = setInterval(callback, intervalSeconds * 1000);
    _timers.set(id, handle);
    return id;
}

/**
 * Cancel a scheduled timer or loop.
 *
 * @param {number} id - Timer ID
 */
export function cancelTimer(id) {
    const handle = _timers.get(id);
    if (handle != null) {
        clearTimeout(handle);
        clearInterval(handle);
        _timers.delete(id);
    }
}

/**
 * Cancel all scheduled timers.
 */
export function cancelAllTimers() {
    for (const [id, handle] of _timers) {
        clearTimeout(handle);
        clearInterval(handle);
    }
    _timers.clear();
}

// ── Screen Shake ──

/**
 * Calculate screen shake offset for a given frame.
 * Uses kaboom-style damped noise shake.
 *
 * @param {number} intensity - Shake strength in pixels
 * @param {number} t - Normalized time (0=start, 1=end)
 * @param {number} [frequency=12] - Oscillation frequency
 * @returns {{ x: number, y: number }}
 */
export function screenShakeOffset(intensity, t, frequency = 12) {
    if (t >= 1 || intensity <= 0) return { x: 0, y: 0 };

    // Decay envelope
    const envelope = intensity * (1 - t) * (1 - t);

    // Perlin-like noise using sin combinations (kaboom approach)
    const x = envelope * Math.sin(t * frequency * Math.PI * 2 + 0.3) *
              Math.cos(t * frequency * 1.3 * Math.PI + 1.2);
    const y = envelope * Math.sin(t * frequency * 1.7 * Math.PI * 2 + 2.1) *
              Math.cos(t * frequency * 0.9 * Math.PI + 0.7);

    return { x, y };
}

// ── Collision Geometry ──

/**
 * Check if two rectangles overlap.
 *
 * @param {{ x: number, y: number, w: number, h: number }} a
 * @param {{ x: number, y: number, w: number, h: number }} b
 * @returns {boolean}
 */
export function rectOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Check if a circle overlaps a rectangle.
 *
 * @param {{ x: number, y: number, r: number }} circle
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @returns {boolean}
 */
export function circleRectOverlap(circle, rect) {
    const closestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h));
    const dx = circle.x - closestX;
    const dy = circle.y - closestY;
    return (dx * dx + dy * dy) <= (circle.r * circle.r);
}

/**
 * Simple 2D ray cast against a rectangle.
 *
 * @param {{ x: number, y: number }} origin
 * @param {{ x: number, y: number }} direction - Normalized direction vector
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @param {number} maxDist
 * @returns {{ hit: boolean, dist: number, point: { x: number, y: number } }}
 */
export function rayCastRect(origin, direction, rect, maxDist = 1000) {
    const invDx = direction.x !== 0 ? 1 / direction.x : Infinity;
    const invDy = direction.y !== 0 ? 1 / direction.y : Infinity;

    const t1 = (rect.x - origin.x) * invDx;
    const t2 = (rect.x + rect.w - origin.x) * invDx;
    const t3 = (rect.y - origin.y) * invDy;
    const t4 = (rect.y + rect.h - origin.y) * invDy;

    const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
    const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));

    if (tmax < 0 || tmin > tmax || tmin > maxDist) {
        return { hit: false, dist: Infinity, point: null };
    }

    const dist = tmin >= 0 ? tmin : tmax;
    return {
        hit: true,
        dist,
        point: {
            x: origin.x + direction.x * dist,
            y: origin.y + direction.y * dist,
        },
    };
}

// ── Math Utilities ──

/**
 * Linear interpolation.
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Map a value from one range to another.
 */
export function mapRange(v, inMin, inMax, outMin, outMax) {
    return outMin + (v - inMin) / (inMax - inMin) * (outMax - outMin);
}

/**
 * Wave function — oscillates between lo and hi at given frequency.
 *
 * @param {number} lo - Minimum value
 * @param {number} hi - Maximum value
 * @param {number} t - Time value
 * @param {number} [freq=1] - Frequency
 * @returns {number}
 */
export function wave(lo, hi, t, freq = 1) {
    return lo + (Math.sin(t * freq * Math.PI * 2) * 0.5 + 0.5) * (hi - lo);
}

/**
 * Random float in range [min, max).
 */
export function rand(min = 0, max = 1) {
    return min + Math.random() * (max - min);
}

/**
 * Random integer in range [min, max].
 */
export function randi(min, max) {
    return Math.floor(rand(min, max + 1));
}

/**
 * Random 2D direction vector (unit length).
 */
export function randDir() {
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle), y: Math.sin(angle) };
}

/**
 * Clamp value between min and max.
 */
export function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/**
 * Get distance between two points.
 */
export function dist(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

// ── Color Utilities ──

/**
 * Interpolate between two hex colors.
 *
 * @param {string} colorA - Hex color (#rrggbb)
 * @param {string} colorB - Hex color
 * @param {number} t - Interpolation factor (0-1)
 * @returns {string} Hex color
 */
export function lerpColor(colorA, colorB, t) {
    const parse = c => {
        const hex = c.replace('#', '');
        return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
        ];
    };

    const [r1, g1, b1] = parse(colorA);
    const [r2, g2, b2] = parse(colorB);
    const r = Math.round(lerp(r1, r2, t));
    const g = Math.round(lerp(g1, g2, t));
    const b = Math.round(lerp(b1, b2, t));

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Generate a random color with optional hue range.
 *
 * @param {number} [saturation=0.7] - 0-1
 * @param {number} [lightness=0.5] - 0-1
 * @returns {string} HSL color string
 */
export function randomColor(saturation = 0.7, lightness = 0.5) {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h}, ${Math.round(saturation * 100)}%, ${Math.round(lightness * 100)}%)`;
}

// ── Event Bus ──

const _listeners = new Map();

/**
 * Register an event listener.
 *
 * @param {string} event - Event name
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
export function on(event, callback) {
    if (!_listeners.has(event)) _listeners.set(event, new Set());
    _listeners.get(event).add(callback);
    return () => off(event, callback);
}

/**
 * Remove an event listener.
 */
export function off(event, callback) {
    const set = _listeners.get(event);
    if (set) set.delete(callback);
}

/**
 * Emit an event to all listeners.
 *
 * @param {string} event
 * @param {...any} args
 */
export function emit(event, ...args) {
    const set = _listeners.get(event);
    if (set) {
        for (const cb of set) {
            try { cb(...args); } catch (e) { console.error(`[kaboom-utils] Event "${event}" handler error:`, e); }
        }
    }
}

/**
 * Clean up the kaboom utilities.
 */
export function destroyKaboomUtils() {
    cancelAllTimers();
    _listeners.clear();
    if (_k) {
        try { _k.quit(); } catch (e) { /* ignore */ }
        _k = null;
    }
    if (_kCanvas && _kCanvas.parentNode) {
        _kCanvas.parentNode.removeChild(_kCanvas);
        _kCanvas = null;
    }
}
