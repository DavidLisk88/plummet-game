/**
 * juice-effects.js — Screen shake, animation juice, and visual effects
 * 
 * Provides game-feel enhancements for all game modes:
 *   - Screen shake with decay
 *   - Score pop animations
 *   - Flash effects
 *   - Particle burst helpers
 *   - Jump squash & stretch
 *   - Landing impact
 *   - Word completion celebration
 */

// ── Screen Shake Engine ──

/**
 * Screen shake manager for DOM-based games (main game, word search).
 * Applies CSS transform to the target element.
 */
export class ScreenShake {
    constructor(element) {
        this.element = element;
        this.intensity = 0;
        this.duration = 0;
        this.decay = 0.9;
        this._rafId = null;
        this._originalTransform = '';
    }

    /**
     * Trigger a screen shake.
     * @param {number} intensity - Shake magnitude in pixels (2-15)
     * @param {number} duration - Duration in ms
     * @param {number} [decay=0.92] - Per-frame decay factor (0-1)
     */
    shake(intensity, duration, decay = 0.92) {
        this.intensity = Math.max(this.intensity, intensity);
        this.duration = Math.max(this.duration, duration);
        this.decay = decay;
        if (!this._rafId) this._animate();
    }

    _animate() {
        if (this.intensity < 0.5 || this.duration <= 0) {
            this._reset();
            return;
        }

        const x = (Math.random() - 0.5) * this.intensity * 2;
        const y = (Math.random() - 0.5) * this.intensity * 2;
        const rot = (Math.random() - 0.5) * this.intensity * 0.3;

        this.element.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
        this.intensity *= this.decay;
        this.duration -= 16;

        this._rafId = requestAnimationFrame(() => this._animate());
    }

    _reset() {
        this.element.style.transform = this._originalTransform;
        this.intensity = 0;
        this.duration = 0;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    destroy() {
        this._reset();
    }
}

// ── Score Pop Animation ──

/**
 * Show a floating score popup that rises and fades.
 * @param {HTMLElement} container - Container element
 * @param {number} score - Score to display
 * @param {number} x - X position (px)
 * @param {number} y - Y position (px)
 * @param {object} [opts]
 * @param {string} [opts.color='#ffd700'] - Text color
 * @param {string} [opts.prefix='+'] - Text before score
 * @param {number} [opts.duration=1000] - Animation duration ms
 * @param {number} [opts.fontSize=22] - Font size px
 */
export function scorePop(container, score, x, y, opts = {}) {
    const {
        color = '#ffd700',
        prefix = '+',
        duration = 1000,
        fontSize = 22,
    } = opts;

    const el = document.createElement('div');
    el.textContent = `${prefix}${score}`;
    el.style.cssText = `
        position: absolute;
        left: ${x}px;
        top: ${y}px;
        color: ${color};
        font-size: ${fontSize}px;
        font-weight: bold;
        font-family: 'Inter', sans-serif;
        pointer-events: none;
        z-index: 1000;
        text-shadow: 0 2px 4px rgba(0,0,0,0.5);
        transition: all ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
        opacity: 1;
    `;
    container.appendChild(el);

    // Force reflow before animation
    el.offsetHeight;

    el.style.transform = `translateY(-60px) scale(1.3)`;
    el.style.opacity = '0';

    setTimeout(() => el.remove(), duration);
}

// ── Flash Effect ──

/**
 * Flash the screen with a color overlay.
 * @param {HTMLElement} container - Container element
 * @param {string} color - CSS color
 * @param {number} [duration=300] - Flash duration ms
 * @param {number} [maxOpacity=0.3] - Peak opacity
 */
export function flashEffect(container, color, duration = 300, maxOpacity = 0.3) {
    const el = document.createElement('div');
    el.style.cssText = `
        position: absolute;
        inset: 0;
        background: ${color};
        opacity: ${maxOpacity};
        pointer-events: none;
        z-index: 999;
        transition: opacity ${duration}ms ease-out;
    `;
    container.appendChild(el);

    requestAnimationFrame(() => {
        el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), duration);
}

// ── Word Celebration ──

/**
 * Trigger a celebration effect for a valid word found.
 * @param {HTMLElement} container
 * @param {string} word
 * @param {number} score
 * @param {number} x
 * @param {number} y
 */
export function wordCelebration(container, word, score, x, y) {
    // Score popup
    scorePop(container, score, x, y - 30, {
        color: '#22c55e',
        fontSize: word.length >= 6 ? 28 : 22,
        duration: 1200,
    });

    // Word flash
    flashEffect(container, '#22c55e', 400, word.length >= 5 ? 0.2 : 0.1);

    // Particle burst (CSS-based)
    _particleBurst(container, x, y, word.length >= 5 ? 12 : 6);
}

/**
 * Trigger a failure effect.
 */
export function failureEffect(container) {
    flashEffect(container, '#ef4444', 300, 0.2);
}

// ── CSS Particle Burst ──

function _particleBurst(container, x, y, count = 8) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
        const speed = 40 + Math.random() * 60;
        const dx = Math.cos(angle) * speed;
        const dy = Math.sin(angle) * speed;

        const p = document.createElement('div');
        p.style.cssText = `
            position: absolute;
            left: ${x}px;
            top: ${y}px;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: ${['#ffd700', '#22c55e', '#f59e0b', '#ef4444'][i % 4]};
            pointer-events: none;
            z-index: 1001;
            transition: all 600ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
            opacity: 1;
        `;
        container.appendChild(p);

        requestAnimationFrame(() => {
            p.style.transform = `translate(${dx}px, ${dy}px)`;
            p.style.opacity = '0';
        });

        setTimeout(() => p.remove(), 600);
    }
}

// ── Jump Squash & Stretch (for Phaser word-runner) ──

/**
 * Apply squash & stretch to a Phaser game object.
 * @param {Phaser.Scene} scene - The Phaser scene
 * @param {Phaser.GameObjects.Graphics} target - The target object
 * @param {string} type - 'jump' | 'land' | 'collect'
 */
export function applyJuice(scene, target, type) {
    if (!scene || !scene.tweens) return;
    // Guard: tweens on null targets crash Phaser
    const canTween = target != null;

    switch (type) {
        case 'jump':
            if (!canTween) break;
            scene.tweens.add({
                targets: target,
                scaleX: 0.8,
                scaleY: 1.2,
                duration: 100,
                yoyo: true,
                ease: 'Quad.easeOut',
            });
            break;

        case 'land':
            if (!canTween) break;
            scene.tweens.add({
                targets: target,
                scaleX: 1.3,
                scaleY: 0.7,
                duration: 80,
                yoyo: true,
                ease: 'Quad.easeOut',
            });
            break;

        case 'collect':
            if (!canTween) break;
            scene.tweens.add({
                targets: target,
                scaleX: 1.5,
                scaleY: 1.5,
                alpha: 0,
                duration: 200,
                ease: 'Quad.easeOut',
            });
            break;

        case 'hit':
            // Camera shake for Phaser scene
            if (scene.cameras && scene.cameras.main) {
                scene.cameras.main.shake(300, 0.01);
            }
            break;

        case 'word-valid':
            // Celebratory camera effect
            if (scene.cameras && scene.cameras.main) {
                scene.cameras.main.flash(200, 34, 197, 94, false, null, null, 0.15);
                scene.cameras.main.shake(150, 0.005);
            }
            break;

        case 'word-invalid':
            if (scene.cameras && scene.cameras.main) {
                scene.cameras.main.flash(150, 239, 68, 68, false, null, null, 0.2);
                scene.cameras.main.shake(100, 0.008);
            }
            break;
    }
}

// ── Time-based easing functions ──

export const Ease = {
    linear: t => t,
    quadIn: t => t * t,
    quadOut: t => t * (2 - t),
    quadInOut: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    cubicIn: t => t * t * t,
    cubicOut: t => (--t) * t * t + 1,
    elasticOut: t => {
        const p = 0.3;
        return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
    },
    bounceOut: t => {
        if (t < 1 / 2.75) return 7.5625 * t * t;
        if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
        if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
        return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    },
};
