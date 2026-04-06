/**
 * gsap-engine.js — GSAP-powered animation system for PLUMMET
 *
 * Replaces CSS transitions, Web Animations API calls, and setTimeout-based
 * animations with timeline-orchestrated GSAP sequences for:
 *   - Screen transitions with directional slide/parallax
 *   - Score popup particle fountains
 *   - Chain / combo banner entrances with elastic bounce
 *   - Word popup letter assembly with staggered reveals
 *   - Bonus unlock dust implosion with physics paths
 *   - Level-up overlay celebration sequence
 *   - Button micro-interaction press/hover feedback
 *   - Challenge card staggered grid entrance
 *   - Phaser-compatible DOM overlay animations
 */
import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';

gsap.registerPlugin(MotionPathPlugin);

// ── Timeline Registry ──
// Track active timelines for proper cleanup/kill on screen change
const _activeTimelines = new Map();

function _register(key, tl) {
    if (_activeTimelines.has(key)) _activeTimelines.get(key).kill();
    _activeTimelines.set(key, tl);
    tl.eventCallback('onComplete', () => _activeTimelines.delete(key));
    return tl;
}

/** Kill all running GSAP animations in a given category (or all). */
export function killAnimations(category) {
    if (category) {
        const tl = _activeTimelines.get(category);
        if (tl) { tl.kill(); _activeTimelines.delete(category); }
    } else {
        for (const tl of _activeTimelines.values()) tl.kill();
        _activeTimelines.clear();
    }
}

// ── Screen Transitions ──

/**
 * Transition between two screens with a directional slide + fade.
 * Much richer than the CSS `screenFadeIn 0.3s ease-out` default.
 *
 * @param {HTMLElement} outScreen - Screen being hidden
 * @param {HTMLElement} inScreen  - Screen being shown
 * @param {object} [opts]
 * @param {'left'|'right'|'up'|'down'|'fade'} [opts.direction='fade']
 * @param {number} [opts.duration=0.4]
 * @param {Function} [opts.onComplete]
 * @returns {gsap.core.Timeline}
 */
export function screenTransition(outScreen, inScreen, opts = {}) {
    const { direction = 'fade', duration = 0.4, onComplete } = opts;

    const tl = gsap.timeline({
        onComplete: () => {
            if (outScreen) outScreen.classList.remove('active');
            if (onComplete) onComplete();
        },
    });

    const offsets = {
        left:  { x: '-100%', y: 0 },
        right: { x: '100%',  y: 0 },
        up:    { x: 0, y: '-100%' },
        down:  { x: 0, y: '100%' },
        fade:  { x: 0, y: 0 },
    };
    const off = offsets[direction] || offsets.fade;

    // Out screen slides away + fades
    if (outScreen) {
        tl.to(outScreen, {
            x: direction === 'fade' ? 0 : off.x === 0 ? 0 : (parseFloat(off.x) > 0 ? '-30%' : '30%'),
            y: direction === 'fade' ? 0 : off.y === 0 ? 0 : (parseFloat(off.y) > 0 ? '-30%' : '30%'),
            opacity: 0,
            duration: duration * 0.6,
            ease: 'power2.in',
        }, 0);
    }

    // In screen slides in from offset
    if (inScreen) {
        inScreen.classList.add('active');
        gsap.set(inScreen, {
            x: off.x,
            y: off.y,
            opacity: direction === 'fade' ? 0 : 0.7,
        });

        tl.to(inScreen, {
            x: 0,
            y: 0,
            opacity: 1,
            duration,
            ease: 'power2.out',
        }, direction === 'fade' ? 0 : duration * 0.3);
    }

    return _register('screenTransition', tl);
}

// ── Score Popup Fountain ──

/**
 * Animated score popup with GSAP physics-based arc and scale.
 * Replaces the CSS transition version in juice-effects for DOM contexts.
 *
 * @param {HTMLElement} container
 * @param {number|string} text - Score or text to display
 * @param {number} x
 * @param {number} y
 * @param {object} [opts]
 * @returns {gsap.core.Timeline}
 */
export function scorePopup(container, text, x, y, opts = {}) {
    const {
        color = '#ffd700',
        fontSize = 22,
        duration = 1.0,
        prefix = '+',
        scale = 1.3,
    } = opts;

    const el = document.createElement('div');
    el.textContent = `${prefix}${text}`;
    el.style.cssText = `
        position: absolute; left: ${x}px; top: ${y}px;
        color: ${color}; font-size: ${fontSize}px; font-weight: bold;
        font-family: 'Inter', sans-serif; pointer-events: none;
        z-index: 1000; text-shadow: 0 2px 6px rgba(0,0,0,0.6);
        will-change: transform, opacity;
    `;
    container.appendChild(el);

    const tl = gsap.timeline({
        onComplete: () => el.remove(),
    });

    tl.fromTo(el, {
        y: 0, scale: 0.5, opacity: 0,
    }, {
        y: -20, scale, opacity: 1,
        duration: duration * 0.25,
        ease: 'back.out(2)',
    })
    .to(el, {
        y: -70,
        opacity: 0,
        scale: scale * 0.8,
        duration: duration * 0.75,
        ease: 'power2.in',
    });

    return tl;
}

// ── Chain Banner Animation ──

/**
 * Animate the chain banner with elastic entrance, pulse, and scale.
 *
 * @param {HTMLElement} el - The chain banner element
 * @param {number} chainCount
 * @returns {gsap.core.Timeline}
 */
export function chainBannerEntrance(el, chainCount) {
    if (!el) return null;

    const tl = gsap.timeline();

    // Intensity scales with chain count
    const intensity = Math.min(1 + (chainCount - 2) * 0.15, 2.0);

    tl.fromTo(el, {
        scale: 0.3,
        opacity: 0,
        y: 20,
        rotationX: -30,
    }, {
        scale: intensity,
        opacity: 1,
        y: 0,
        rotationX: 0,
        duration: 0.35,
        ease: 'elastic.out(1.2, 0.5)',
    })
    .to(el, {
        scale: 1,
        duration: 0.3,
        ease: 'power2.out',
    });

    // Pulsing glow for high chains
    if (chainCount >= 4) {
        tl.to(el, {
            textShadow: '0 0 20px rgba(255,165,0,0.8), 0 0 40px rgba(255,69,0,0.5)',
            repeat: 2,
            yoyo: true,
            duration: 0.2,
            ease: 'power1.inOut',
        });
    }

    return _register('chainBanner', tl);
}

/**
 * Dismiss the chain banner.
 */
export function chainBannerExit(el) {
    if (!el) return null;
    return gsap.to(el, {
        scale: 0.5,
        opacity: 0,
        y: -15,
        duration: 0.25,
        ease: 'power2.in',
        onComplete: () => {
            el.classList.remove('visible', 'pop');
            el.classList.add('hidden');
            gsap.set(el, { clearProps: 'all' });
        },
    });
}

// ── Word Popup Letter Assembly ──

/**
 * Staggered letter-by-letter reveal for word popups.
 * Replaces the CSS @keyframes letterAssemble animation.
 *
 * @param {HTMLElement} row - The word popup row element
 * @param {NodeList|HTMLElement[]} letterSpans - Individual letter elements
 * @param {object} [opts]
 * @returns {gsap.core.Timeline}
 */
export function letterAssemble(row, letterSpans, opts = {}) {
    const { duration = 0.5, stagger = 0.04, ease = 'back.out(1.7)' } = opts;

    if (!row || !letterSpans || !letterSpans.length) return null;

    const tl = gsap.timeline();

    // Row slides in
    tl.fromTo(row, {
        x: -20,
        opacity: 0,
    }, {
        x: 0,
        opacity: 1,
        duration: 0.2,
        ease: 'power2.out',
    });

    // Letters assemble with stagger
    tl.fromTo(letterSpans, {
        scale: 0,
        opacity: 0,
        y: 15,
        rotation: () => gsap.utils.random(-20, 20),
    }, {
        scale: 1,
        opacity: 1,
        y: 0,
        rotation: 0,
        duration,
        stagger,
        ease,
    }, '<0.1');

    return tl;
}

/**
 * Word popup exit animation.
 */
export function wordPopupExit(row) {
    if (!row) return null;
    return gsap.to(row, {
        x: 30,
        opacity: 0,
        scale: 0.9,
        duration: 0.3,
        ease: 'power2.in',
        onComplete: () => row.remove(),
    });
}

// ── Bonus Unlock Celebration ──

/**
 * Full bonus unlock sequence: card burst, dust implosion, button pulse.
 * Replaces the Web Animations API + setTimeout chain in _checkBonusUnlock.
 *
 * @param {HTMLElement} card   - The bonus card element
 * @param {HTMLElement} btn    - The bonus button (dust target)
 * @param {HTMLElement} overlay - The overlay container
 * @param {number} holdMs     - How long to show the card before dust animation
 * @returns {gsap.core.Timeline}
 */
export function bonusUnlockSequence(card, btn, overlay, holdMs = 1200) {
    if (!card || !btn) return null;

    const tl = gsap.timeline();

    // Card entrance: scale + rotate
    tl.fromTo(card, {
        scale: 0,
        rotation: -10,
        opacity: 0,
    }, {
        scale: 1,
        rotation: 0,
        opacity: 1,
        duration: 0.5,
        ease: 'back.out(1.7)',
    });

    // Hold phase
    tl.to({}, { duration: holdMs / 1000 });

    // Dust implosion — spawn 18 particles
    tl.call(() => {
        _spawnDustImplosion(card, btn);
    });

    // Card dissolves
    tl.to(card, {
        scale: 0.3,
        opacity: 0,
        filter: 'blur(8px)',
        duration: 0.4,
        ease: 'power2.in',
    }, '-=0.1');

    // Button pulse to receive particles
    tl.fromTo(btn, {
        scale: 1,
    }, {
        scale: 1.3,
        duration: 0.15,
        ease: 'power2.out',
        yoyo: true,
        repeat: 1,
    }, '+=0.3');

    // Cleanup
    tl.call(() => {
        if (overlay) overlay.classList.add('hidden');
        gsap.set(card, { clearProps: 'all' });
    });

    return _register('bonusUnlock', tl);
}

function _spawnDustImplosion(source, target) {
    const srcRect = source.getBoundingClientRect();
    const tgtRect = target.getBoundingClientRect();
    const cx = srcRect.left + srcRect.width / 2;
    const cy = srcRect.top + srcRect.height / 2;
    const tx = tgtRect.left + tgtRect.width / 2;
    const ty = tgtRect.top + tgtRect.height / 2;

    const count = 18;
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count;
        const spread = 30 + Math.random() * 30;
        const sx = cx + Math.cos(angle) * spread;
        const sy = cy + Math.sin(angle) * spread;

        const p = document.createElement('div');
        p.style.cssText = `
            position: fixed; width: 6px; height: 6px; border-radius: 50%;
            background: ${['#ffd700', '#f59e0b', '#fb923c', '#ef4444'][i % 4]};
            pointer-events: none; z-index: 2000;
            left: ${sx}px; top: ${sy}px;
            will-change: transform, opacity;
        `;
        document.body.appendChild(p);

        // Each particle follows a bezier-like arc to the target
        const midX = (sx + tx) / 2 + (Math.random() - 0.5) * 80;
        const midY = (sy + ty) / 2 - 40 - Math.random() * 60;

        gsap.to(p, {
            motionPath: {
                path: [
                    { x: 0, y: 0 },
                    { x: midX - sx, y: midY - sy },
                    { x: tx - sx, y: ty - sy },
                ],
                curviness: 1.5,
            },
            scale: 0.3,
            opacity: 0.3,
            duration: 0.5 + Math.random() * 0.2,
            delay: i * 0.02,
            ease: 'power2.in',
            onComplete: () => p.remove(),
        });
    }
}

// ── Particle Burst ──

/**
 * GSAP-powered particle burst effect.
 * Replaces the CSS transition particle system in juice-effects.
 *
 * @param {HTMLElement} container
 * @param {number} x
 * @param {number} y
 * @param {object} [opts]
 * @returns {gsap.core.Timeline}
 */
export function particleBurst(container, x, y, opts = {}) {
    const {
        count = 10,
        colors = ['#ffd700', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6'],
        spread = 80,
        duration = 0.6,
        size = 6,
        gravity = 40,
    } = opts;

    const tl = gsap.timeline();
    const particles = [];

    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.4;
        const dist = spread * (0.6 + Math.random() * 0.4);
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;

        p.style.cssText = `
            position: absolute; left: ${x}px; top: ${y}px;
            width: ${size}px; height: ${size}px; border-radius: 50%;
            background: ${colors[i % colors.length]};
            pointer-events: none; z-index: 1001;
            will-change: transform, opacity;
        `;
        container.appendChild(p);
        particles.push(p);

        tl.to(p, {
            x: dx,
            y: dy + gravity,
            opacity: 0,
            scale: 0.3,
            duration,
            ease: 'power2.out',
            onComplete: () => p.remove(),
        }, 0);
    }

    return tl;
}

// ── Word Celebration ──

/**
 * GSAP-powered word celebration combining score popup + particle burst + flash.
 */
export function wordCelebrationGSAP(container, word, score, x, y) {
    const tl = gsap.timeline();

    // Flash overlay
    const flash = document.createElement('div');
    flash.style.cssText = `
        position: absolute; inset: 0; background: #22c55e;
        pointer-events: none; z-index: 999;
        will-change: opacity;
    `;
    container.appendChild(flash);
    tl.fromTo(flash, { opacity: word.length >= 5 ? 0.2 : 0.1 }, {
        opacity: 0,
        duration: 0.4,
        ease: 'power2.out',
        onComplete: () => flash.remove(),
    }, 0);

    // Score popup
    tl.add(scorePopup(container, score, x, y - 30, {
        color: '#22c55e',
        fontSize: word.length >= 6 ? 28 : 22,
    }), 0);

    // Particle burst
    tl.add(particleBurst(container, x, y, {
        count: word.length >= 5 ? 14 : 8,
        colors: ['#22c55e', '#10b981', '#fbbf24', '#f59e0b'],
    }), 0.05);

    return tl;
}

/**
 * GSAP failure flash.
 */
export function failureFlash(container) {
    const flash = document.createElement('div');
    flash.style.cssText = `
        position: absolute; inset: 0; background: #ef4444;
        pointer-events: none; z-index: 999;
    `;
    container.appendChild(flash);
    return gsap.fromTo(flash, { opacity: 0.25 }, {
        opacity: 0,
        duration: 0.3,
        ease: 'power2.out',
        onComplete: () => flash.remove(),
    });
}

// ── Level Up Celebration ──

/**
 * Orchestrated level-up overlay animation.
 *
 * @param {HTMLElement} overlay - #level-up-overlay
 * @param {HTMLElement} progressBar - Progress fill element
 * @param {number} progressPct - 0-100 progress value
 * @returns {gsap.core.Timeline}
 */
export function levelUpCelebration(overlay, progressBar, progressPct) {
    if (!overlay) return null;

    const tl = gsap.timeline();

    overlay.classList.remove('hidden');

    // Overlay fade in
    tl.fromTo(overlay, {
        opacity: 0,
        scale: 0.9,
    }, {
        opacity: 1,
        scale: 1,
        duration: 0.3,
        ease: 'power2.out',
    });

    // Progress bar fill
    if (progressBar) {
        tl.fromTo(progressBar, {
            width: '0%',
        }, {
            width: `${progressPct}%`,
            duration: 0.8,
            ease: 'power2.out',
        }, '+=0.2');
    }

    // Auto-close
    tl.to(overlay, {
        opacity: 0,
        scale: 0.95,
        duration: 0.3,
        ease: 'power2.in',
        onComplete: () => overlay.classList.add('hidden'),
    }, '+=1.5');

    return _register('levelUp', tl);
}

// ── Button Micro-interactions ──

/**
 * Add GSAP-powered press/hover micro-interactions to a button.
 * More fluid than CSS :active transform transitions.
 */
export function addButtonJuice(btn) {
    if (!btn || btn._gsapJuiced) return;
    btn._gsapJuiced = true;

    btn.addEventListener('pointerdown', () => {
        gsap.to(btn, {
            scale: 0.92,
            duration: 0.1,
            ease: 'power2.out',
        });
    });

    btn.addEventListener('pointerup', () => {
        gsap.to(btn, {
            scale: 1,
            duration: 0.25,
            ease: 'elastic.out(1, 0.4)',
        });
    });

    btn.addEventListener('pointerleave', () => {
        gsap.to(btn, {
            scale: 1,
            duration: 0.2,
            ease: 'power2.out',
        });
    });
}

/**
 * Batch-apply button juice to multiple elements.
 */
export function juiceAllButtons(selector = '.game-btn, .nav-btn, .control-btn') {
    const btns = document.querySelectorAll(selector);
    btns.forEach(addButtonJuice);
}

// ── Challenge Card Grid Entrance ──

/**
 * Staggered entrance for challenge cards in the grid.
 *
 * @param {HTMLElement[]|NodeList} cards
 * @returns {gsap.core.Timeline}
 */
export function challengeGridEntrance(cards) {
    if (!cards || !cards.length) return null;

    const tl = gsap.timeline();
    tl.fromTo(cards, {
        y: 30,
        opacity: 0,
        scale: 0.9,
    }, {
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 0.4,
        stagger: 0.06,
        ease: 'back.out(1.4)',
    });

    return _register('challengeGrid', tl);
}

// ── Shake Effect (GSAP implementation) ──

/**
 * GSAP screen shake — richer than ScreenShake class for DOM elements.
 * Applies random offsets with exponential decay.
 *
 * @param {HTMLElement} element
 * @param {number} intensity - Pixel magnitude (2-15)
 * @param {number} duration - Seconds
 * @returns {gsap.core.Tween}
 */
export function gsapShake(element, intensity = 5, duration = 0.4) {
    if (!element) return null;

    const tl = gsap.timeline();
    const steps = Math.ceil(duration / 0.03);

    for (let i = 0; i < steps; i++) {
        const decay = Math.pow(0.85, i);
        const x = (Math.random() - 0.5) * intensity * 2 * decay;
        const y = (Math.random() - 0.5) * intensity * 2 * decay;
        const rot = (Math.random() - 0.5) * intensity * 0.3 * decay;

        tl.to(element, {
            x, y,
            rotation: rot,
            duration: 0.03,
            ease: 'none',
        });
    }

    tl.to(element, { x: 0, y: 0, rotation: 0, duration: 0.05, ease: 'power1.out' });

    return tl;
}

// ── Confetti Rain ──

/**
 * Full-screen confetti celebration.
 *
 * @param {HTMLElement} container
 * @param {number} count - Number of confetti pieces (40-120)
 * @param {number} duration - Seconds for full rain
 */
export function confettiRain(container, count = 60, duration = 2.5) {
    const colors = ['#ffd700', '#22c55e', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899'];
    const w = container.offsetWidth || window.innerWidth;

    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        const size = 4 + Math.random() * 6;
        const isRect = Math.random() > 0.5;

        p.style.cssText = `
            position: absolute;
            left: ${Math.random() * w}px;
            top: -10px;
            width: ${isRect ? size * 2 : size}px;
            height: ${size}px;
            background: ${colors[i % colors.length]};
            border-radius: ${isRect ? '1px' : '50%'};
            pointer-events: none;
            z-index: 1500;
            will-change: transform, opacity;
        `;
        container.appendChild(p);

        gsap.to(p, {
            y: container.offsetHeight + 20,
            x: `+=${(Math.random() - 0.5) * 150}`,
            rotation: gsap.utils.random(-360, 360),
            opacity: 0,
            duration: duration * (0.6 + Math.random() * 0.4),
            delay: Math.random() * duration * 0.4,
            ease: 'power1.in',
            onComplete: () => p.remove(),
        });
    }
}

// ── Number Counter / Score Bump ──

/**
 * Animate a number rolling up (or down) in an element.
 * Perfect for score displays and stat counters.
 *
 * @param {HTMLElement} el
 * @param {number} from
 * @param {number} to
 * @param {object} [opts]
 * @returns {gsap.core.Tween}
 */
export function numberRoll(el, from, to, opts = {}) {
    const { duration = 0.6, ease = 'power2.out', prefix = '', suffix = '', formatter } = opts;

    const obj = { val: from };
    return gsap.to(obj, {
        val: to,
        duration,
        ease,
        onUpdate: () => {
            const v = Math.round(obj.val);
            el.textContent = formatter ? formatter(v) : `${prefix}${v.toLocaleString()}${suffix}`;
        },
    });
}

// ── Gameover Stats Reveal ──

/**
 * Staggered reveal of gameover stat rows.
 *
 * @param {HTMLElement[]|NodeList} rows
 */
export function gameoverStatsReveal(rows) {
    if (!rows || !rows.length) return null;

    return gsap.fromTo(rows, {
        x: -30, opacity: 0,
    }, {
        x: 0, opacity: 1,
        duration: 0.4,
        stagger: 0.08,
        ease: 'power2.out',
    });
}

// ── Freeze Indicator Pulse ──

/**
 * Pulsing animation for the freeze timer indicator.
 */
export function freezeIndicatorPulse(el) {
    if (!el) return null;
    return gsap.fromTo(el, {
        scale: 1,
        boxShadow: '0 0 10px rgba(59, 130, 246, 0.5)',
    }, {
        scale: 1.05,
        boxShadow: '0 0 20px rgba(59, 130, 246, 0.8)',
        duration: 0.5,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
    });
}

// ── Challenge Preview Animations ──

/**
 * GSAP-powered challenge preview canvas overlay animations.
 * These render on top of the canvas preview with DOM elements for richer effects.
 *
 * @param {HTMLElement} cardEl - Challenge card container
 * @param {string} type - Challenge type ('TARGET_WORD'|'SPEED_ROUND'|'WORD_CATEGORY'|'WORD_SEARCH'|'WORD_RUNNER')
 * @returns {{ tl: gsap.core.Timeline, destroy: Function }}
 */
export function challengePreviewOverlay(cardEl, type) {
    if (!cardEl) return null;

    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.5 });
    const wrapper = document.createElement('div');
    wrapper.className = 'gsap-preview-overlay';
    wrapper.style.cssText = 'position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 2;';
    cardEl.style.position = 'relative';
    cardEl.appendChild(wrapper);

    switch (type) {
        case 'TARGET_WORD':
            _previewTargetWord(wrapper, tl);
            break;
        case 'SPEED_ROUND':
            _previewSpeedRound(wrapper, tl);
            break;
        case 'WORD_SEARCH':
            _previewWordSearch(wrapper, tl);
            break;
        case 'WORD_RUNNER':
            _previewWordRunner(wrapper, tl);
            break;
        default:
            _previewGeneric(wrapper, tl);
    }

    return {
        tl,
        destroy: () => {
            tl.kill();
            wrapper.remove();
        },
    };
}

function _previewTargetWord(wrapper, tl) {
    const highlight = document.createElement('div');
    highlight.style.cssText = `
        position: absolute; width: 60%; height: 18%;
        left: 20%; top: 40%;
        border: 2px solid rgba(255, 215, 0, 0.8);
        border-radius: 6px;
        background: rgba(255, 215, 0, 0.1);
    `;
    wrapper.appendChild(highlight);

    tl.fromTo(highlight, {
        opacity: 0, scale: 0.8,
    }, {
        opacity: 1, scale: 1,
        duration: 0.4, ease: 'power2.out',
    })
    .to(highlight, {
        boxShadow: '0 0 12px rgba(255, 215, 0, 0.6)',
        duration: 0.5, yoyo: true, repeat: 1, ease: 'sine.inOut',
    })
    .to(highlight, { opacity: 0, duration: 0.3, ease: 'power2.in' });
}

function _previewSpeedRound(wrapper, tl) {
    for (let i = 0; i < 3; i++) {
        const block = document.createElement('div');
        block.style.cssText = `
            position: absolute;
            width: 20%; height: 12%;
            left: ${20 + i * 25}%;
            top: -15%;
            background: rgba(96, 165, 250, 0.6);
            border-radius: 4px;
        `;
        wrapper.appendChild(block);

        tl.to(block, {
            top: '85%',
            duration: 0.8,
            delay: i * 0.2,
            ease: 'power2.in',
        }, 0)
        .to(block, {
            opacity: 0, scale: 1.3,
            duration: 0.2,
        });
    }
}

function _previewWordSearch(wrapper, tl) {
    const line = document.createElement('div');
    line.style.cssText = `
        position: absolute; height: 3px; width: 0;
        left: 15%; top: 50%;
        background: linear-gradient(90deg, rgba(34,197,94,0.8), rgba(34,197,94,0.2));
        border-radius: 2px;
    `;
    wrapper.appendChild(line);

    tl.to(line, { width: '70%', duration: 0.6, ease: 'power2.out' })
      .to(line, { opacity: 0, duration: 0.3 })
      .set(line, { width: 0, opacity: 1, top: '35%' })
      .to(line, { width: '50%', duration: 0.5, ease: 'power2.out' })
      .to(line, { opacity: 0, duration: 0.3 });
}

function _previewWordRunner(wrapper, tl) {
    const dot = document.createElement('div');
    dot.style.cssText = `
        position: absolute; width: 10px; height: 10px; border-radius: 50%;
        background: #60a5fa; left: 10%; bottom: 20%;
    `;
    const letter = document.createElement('div');
    letter.textContent = '★';
    letter.style.cssText = `
        position: absolute; font-size: 12px; color: #ffd700;
        right: 25%; top: 35%; opacity: 0;
    `;
    wrapper.appendChild(dot);
    wrapper.appendChild(letter);

    tl.to(dot, { left: '80%', duration: 1.5, ease: 'none' }, 0)
      .to(dot, { bottom: '50%', duration: 0.3, ease: 'power2.out', yoyo: true, repeat: 1 }, 0.3)
      .fromTo(letter, { opacity: 0, scale: 1.5 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'power2.out' }, 0.6)
      .to(letter, { opacity: 0, scale: 0.5, duration: 0.2 }, 1.0)
      .set(dot, { left: '10%', bottom: '20%' });
}

function _previewGeneric(wrapper, tl) {
    const glow = document.createElement('div');
    glow.style.cssText = `
        position: absolute; inset: 10%;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px;
    `;
    wrapper.appendChild(glow);

    tl.fromTo(glow, { opacity: 0 }, {
        opacity: 0.6, duration: 0.5, yoyo: true, repeat: 1, ease: 'sine.inOut',
    });
}

// ── Utility: Ease presets ──

export const EasePresets = {
    bouncy: 'elastic.out(1, 0.3)',
    snappy: 'back.out(1.7)',
    smooth: 'power2.inOut',
    crisp: 'power3.out',
    gentle: 'sine.inOut',
};

/** Re-export gsap for direct use when needed */
export { gsap };
