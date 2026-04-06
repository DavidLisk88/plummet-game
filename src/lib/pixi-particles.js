/**
 * pixi-particles.js — PixiJS WebGL-accelerated particle rendering for PLUMMET
 *
 * Provides high-performance particle effects using PixiJS:
 *   - Confetti celebration overlay (game over, challenge win, level up)
 *   - Dust cloud bursts for word clears
 *   - Floating background letter particles
 *   - Sparkle/shimmer effects for bonus tiles
 *   - Star field effects for streak rewards
 *
 * Uses a transparent PixiJS canvas overlaid on the game canvas.
 */
import { Application, Container, Graphics, Text, TextStyle, Ticker } from 'pixi.js';

// ── State ──
let _app = null;
let _particleContainer = null;
let _particles = [];
let _overlayCanvas = null;
let _isReady = false;

const CONFETTI_COLORS = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xff922b, 0xbe4bdb, 0x20c997, 0xe64980];
const DUST_COLORS = [0xe2d8a6, 0xc4a878, 0x8cb860, 0x7aa68e, 0xd4c890];
const SPARKLE_COLORS = [0xffd700, 0xffffff, 0xf59e0b, 0xfbbf24];

/**
 * Initialize the PixiJS application with a transparent overlay canvas.
 *
 * @param {HTMLElement} container - DOM element to append the PixiJS canvas into
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {Promise<void>}
 */
export async function initPixiOverlay(container, width, height) {
    if (_app) destroyPixiOverlay();

    try {
        _app = new Application();
        await _app.init({
            width,
            height,
            backgroundAlpha: 0,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
        });

        _overlayCanvas = _app.canvas;
        _overlayCanvas.style.position = 'absolute';
        _overlayCanvas.style.top = '0';
        _overlayCanvas.style.left = '0';
        _overlayCanvas.style.pointerEvents = 'none';
        _overlayCanvas.style.zIndex = '5';

        container.style.position = 'relative';
        container.appendChild(_overlayCanvas);

        _particleContainer = new Container();
        _app.stage.addChild(_particleContainer);

        // Update loop
        _app.ticker.add(_updateParticles);

        _isReady = true;
    } catch (e) {
        console.warn('[pixi-particles] WebGL not available, falling back gracefully:', e.message);
        _isReady = false;
    }
}

/**
 * Check if PixiJS overlay is ready.
 */
export function isPixiReady() {
    return _isReady;
}

/**
 * Resize the PixiJS overlay.
 */
export function resizePixiOverlay(width, height) {
    if (!_app) return;
    _app.renderer.resize(width, height);
}

// ── Update Loop ──

function _updateParticles(ticker) {
    const dt = ticker.deltaTime / 60; // Normalize to seconds

    for (let i = _particles.length - 1; i >= 0; i--) {
        const p = _particles[i];
        p.life -= dt;

        if (p.life <= 0) {
            _particleContainer.removeChild(p.gfx);
            try { p.gfx.destroy(); } catch (_) { /* PixiJS 8 TexturePool bug */ }
            _particles.splice(i, 1);
            continue;
        }

        // Physics
        p.vx += (p.ax || 0) * dt;
        p.vy += (p.ay || 0) * dt;
        p.vx *= (1 - (p.drag || 0));
        p.vy *= (1 - (p.drag || 0));
        p.x += p.vx * dt * 60;
        p.y += p.vy * dt * 60;
        p.rotation += (p.rotSpeed || 0) * dt * 60;

        // Apply to graphics
        p.gfx.x = p.x;
        p.gfx.y = p.y;
        p.gfx.rotation = p.rotation;
        p.gfx.alpha = Math.max(0, p.life / p.maxLife);

        // Scale effects
        if (p.scaleDecay) {
            const scale = p.life / p.maxLife;
            p.gfx.scale.set(scale * p.baseScale);
        }
    }
}

// ── Particle Factory ──

function _createRectParticle(x, y, w, h, color) {
    const gfx = new Graphics();
    gfx.rect(-w / 2, -h / 2, w, h);
    gfx.fill(color);
    gfx.x = x;
    gfx.y = y;
    return gfx;
}

function _createCircleParticle(x, y, radius, color) {
    const gfx = new Graphics();
    gfx.circle(0, 0, radius);
    gfx.fill(color);
    gfx.x = x;
    gfx.y = y;
    return gfx;
}

function _createStarParticle(x, y, size, color) {
    const gfx = new Graphics();
    const points = [];
    for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? size : size * 0.4;
        const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
        points.push(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    gfx.poly(points);
    gfx.fill(color);
    gfx.x = x;
    gfx.y = y;
    return gfx;
}

function _createLetterParticle(x, y, letter, size, color) {
    const style = new TextStyle({
        fontFamily: 'sans-serif',
        fontSize: size,
        fontWeight: 'bold',
        fill: color,
    });
    const text = new Text({ text: letter, style });
    text.anchor.set(0.5);
    text.x = x;
    text.y = y;
    return text;
}

// ── Public Effects ──

/**
 * Spawn a confetti celebration burst.
 *
 * @param {number} [count=50] - Number of confetti pieces
 * @param {object} [opts] - Options { x, y, spread, gravity }
 */
export function pixiConfettiBurst(count = 50, opts = {}) {
    if (!_isReady) return;

    const cx = opts.x ?? (_app.screen.width / 2);
    const cy = opts.y ?? (_app.screen.height * 0.3);
    const spread = opts.spread ?? 300;

    for (let i = 0; i < count; i++) {
        const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        const w = 4 + Math.random() * 8;
        const h = 2 + Math.random() * 4;
        const gfx = _createRectParticle(cx, cy, w, h, color);
        _particleContainer.addChild(gfx);

        _particles.push({
            gfx,
            x: cx, y: cy,
            vx: (Math.random() - 0.5) * spread * 0.05,
            vy: -2 - Math.random() * 6,
            ax: 0, ay: 0.15, // gravity
            drag: 0.01,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.15,
            life: 2 + Math.random() * 2,
            maxLife: 4,
            baseScale: 1,
            scaleDecay: false,
        });
    }
}

/**
 * Spawn dust cloud burst at a position (for word clears).
 *
 * @param {number} x - Center X
 * @param {number} y - Center Y
 * @param {number} [count=15]
 * @param {object} [opts]
 */
export function pixiDustBurst(x, y, count = 15, opts = {}) {
    if (!_isReady) return;

    for (let i = 0; i < count; i++) {
        const color = DUST_COLORS[Math.floor(Math.random() * DUST_COLORS.length)];
        const radius = 2 + Math.random() * 4;
        const gfx = _createCircleParticle(x, y, radius, color);
        _particleContainer.addChild(gfx);

        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;

        _particles.push({
            gfx,
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1,
            ax: 0, ay: 0.05,
            drag: 0.02,
            rotation: 0,
            rotSpeed: 0,
            life: 0.5 + Math.random() * 0.5,
            maxLife: 1.0,
            baseScale: 1 + Math.random() * 0.5,
            scaleDecay: true,
        });
    }
}

/**
 * Spawn sparkle/shimmer effects for bonus tiles, power-ups.
 *
 * @param {number} x - Center X
 * @param {number} y - Center Y
 * @param {number} [count=8]
 */
export function pixiSparkleBurst(x, y, count = 8) {
    if (!_isReady) return;

    for (let i = 0; i < count; i++) {
        const color = SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)];
        const size = 3 + Math.random() * 5;
        const gfx = _createStarParticle(x, y, size, color);
        _particleContainer.addChild(gfx);

        const angle = (i / count) * Math.PI * 2;
        const speed = 1 + Math.random() * 2;

        _particles.push({
            gfx,
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 0.5,
            ax: 0, ay: 0.03,
            drag: 0.015,
            rotation: Math.random() * Math.PI,
            rotSpeed: (Math.random() - 0.5) * 0.1,
            life: 0.6 + Math.random() * 0.6,
            maxLife: 1.2,
            baseScale: 1,
            scaleDecay: true,
        });
    }
}

/**
 * Spawn floating letter particles for background ambiance.
 *
 * @param {number} [count=20]
 * @param {object} [opts] - Options { width, height }
 */
export function pixiFloatingLetters(count = 20, opts = {}) {
    if (!_isReady) return;

    const w = opts.width ?? _app.screen.width;
    const h = opts.height ?? _app.screen.height;
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    for (let i = 0; i < count; i++) {
        const letter = letters[Math.floor(Math.random() * 26)];
        const x = Math.random() * w;
        const y = h + 10 + Math.random() * 50;
        const size = 10 + Math.random() * 16;
        const gfx = _createLetterParticle(x, y, letter, size, 0x706c58);
        gfx.alpha = 0.15 + Math.random() * 0.15;
        _particleContainer.addChild(gfx);

        _particles.push({
            gfx,
            x, y,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -0.3 - Math.random() * 0.5,
            ax: 0, ay: 0,
            drag: 0,
            rotation: (Math.random() - 0.5) * 0.3,
            rotSpeed: (Math.random() - 0.5) * 0.005,
            life: 8 + Math.random() * 6,
            maxLife: 14,
            baseScale: 1,
            scaleDecay: false,
        });
    }
}

/**
 * Spawn star burst for streak rewards.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} [count=12]
 */
export function pixiStarBurst(x, y, count = 12) {
    if (!_isReady) return;

    for (let i = 0; i < count; i++) {
        const color = SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)];
        const size = 4 + Math.random() * 6;
        const gfx = _createStarParticle(x, y, size, color);
        _particleContainer.addChild(gfx);

        const angle = (i / count) * Math.PI * 2;
        const speed = 2 + Math.random() * 4;

        _particles.push({
            gfx,
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            ax: 0, ay: 0.08,
            drag: 0.01,
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.2,
            life: 1.0 + Math.random() * 0.8,
            maxLife: 1.8,
            baseScale: 1.2,
            scaleDecay: true,
        });
    }
}

/**
 * Clear all active particles.
 */
export function clearPixiParticles() {
    for (const p of _particles) {
        _particleContainer.removeChild(p.gfx);
        try { p.gfx.destroy(); } catch (_) { /* PixiJS 8 TexturePool bug */ }
    }
    _particles = [];
}

/**
 * Get active particle count.
 */
export function getPixiParticleCount() {
    return _particles.length;
}

/**
 * Destroy the PixiJS overlay entirely.
 */
export function destroyPixiOverlay() {
    if (_app) {
        _app.ticker.remove(_updateParticles);
        clearPixiParticles();
        if (_overlayCanvas && _overlayCanvas.parentNode) {
            _overlayCanvas.parentNode.removeChild(_overlayCanvas);
        }
        try { _app.ticker.stop(); } catch (_) {}
        try { _app.destroy(true); } catch (_) {}
        _app = null;
        _particleContainer = null;
        _overlayCanvas = null;
        _isReady = false;
    }
}
