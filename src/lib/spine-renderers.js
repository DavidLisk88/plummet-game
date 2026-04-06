/**
 * spine-renderers.js — Spine Canvas, WebGL, and Phaser renderer integration
 *
 * Provides official Spine renderers for different contexts:
 *   - spine-canvas: 2D canvas rendering for menus, tutorials, previews
 *   - spine-webgl: High-performance WebGL skeleton rendering
 *   - spine-phaser: Phaser.js plugin integration for Word Runner
 *
 * All renderers share skeleton data from spine-engine.js.
 */

// Lazy-loaded renderer modules
let _spineCanvas = null;
let _spineWebgl = null;
let _spinePhaser = null;

/**
 * Load the spine-canvas module.
 * @returns {Promise<object|null>}
 */
export async function loadSpineCanvas() {
    if (_spineCanvas) return _spineCanvas;
    try {
        _spineCanvas = await import('@esotericsoftware/spine-canvas');
        console.log('[spine-renderers] spine-canvas loaded');
        return _spineCanvas;
    } catch (e) {
        console.warn('[spine-renderers] Failed to load spine-canvas:', e.message);
        return null;
    }
}

/**
 * Load the spine-webgl module.
 * @returns {Promise<object|null>}
 */
export async function loadSpineWebgl() {
    if (_spineWebgl) return _spineWebgl;
    try {
        _spineWebgl = await import('@esotericsoftware/spine-webgl');
        console.log('[spine-renderers] spine-webgl loaded');
        return _spineWebgl;
    } catch (e) {
        console.warn('[spine-renderers] Failed to load spine-webgl:', e.message);
        return null;
    }
}

/**
 * Load the spine-phaser module.
 * @returns {Promise<object|null>}
 */
export async function loadSpinePhaser() {
    if (_spinePhaser) return _spinePhaser;
    try {
        _spinePhaser = await import('@esotericsoftware/spine-phaser');
        console.log('[spine-renderers] spine-phaser loaded');
        return _spinePhaser;
    } catch (e) {
        console.warn('[spine-renderers] Failed to load spine-phaser:', e.message);
        return null;
    }
}

// ── Canvas 2D Renderer ──

/**
 * Create a Spine Canvas 2D skeleton renderer.
 * Uses the official spine-canvas SkeletonRenderer for proper bone/attachment rendering.
 *
 * @param {HTMLCanvasElement} canvas - Target canvas element
 * @param {object} skeleton - Spine skeleton instance (from spine-engine.js)
 * @param {object} animState - Spine AnimationState (from spine-engine.js)
 * @returns {{ render: Function, resize: Function, destroy: Function }}
 */
export function createCanvasRenderer(canvas, skeleton, animState) {
    const ctx = canvas.getContext('2d');
    let renderer = null;
    let destroyed = false;

    // Try to use official spine-canvas renderer
    loadSpineCanvas().then(mod => {
        if (mod && !destroyed) {
            try {
                renderer = new mod.SkeletonRenderer(ctx);
                renderer.debugRendering = false;
                renderer.triangleRendering = false;
            } catch (e) {
                console.warn('[spine-renderers] Canvas renderer init failed:', e.message);
            }
        }
    });

    return {
        /**
         * Render a single frame.
         * @param {number} dt - Delta time in seconds
         */
        render(dt) {
            if (destroyed) return;

            try {
                // Update animation
                animState.update(dt);
                animState.apply(skeleton);
                skeleton.updateWorldTransform();

                // Render
                ctx.save();
                if (renderer) {
                    renderer.draw(skeleton);
                } else {
                    // Fallback: draw bones directly
                    _drawBonesManually(ctx, skeleton);
                }
                ctx.restore();
            } catch (e) {
                // Silently skip frame on error
            }
        },

        resize(w, h) {
            canvas.width = w;
            canvas.height = h;
        },

        destroy() {
            destroyed = true;
            renderer = null;
        },
    };
}

// ── WebGL Renderer ──

/**
 * Create a Spine WebGL renderer for high-performance rendering.
 *
 * @param {HTMLCanvasElement} canvas - Target WebGL canvas
 * @param {object} skeleton - Spine skeleton instance
 * @param {object} animState - AnimationState
 * @returns {{ render: Function, resize: Function, destroy: Function } | null}
 */
export function createWebGLRenderer(canvas, skeleton, animState) {
    let gl = null;
    let shader = null;
    let batcher = null;
    let skeletonRenderer = null;
    let shapes = null;
    let destroyed = false;

    // Async init
    const initPromise = loadSpineWebgl().then(mod => {
        if (!mod || destroyed) return false;

        try {
            gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (!gl) return false;

            const mvp = new mod.webgl.Matrix4();
            mvp.ortho2d(0, 0, canvas.width, canvas.height);

            shader = mod.webgl.Shader.newTwoColoredTextured(gl);
            batcher = new mod.webgl.PolygonBatcher(gl);
            skeletonRenderer = new mod.webgl.SkeletonRenderer(gl);
            shapes = new mod.webgl.ShapeRenderer(gl);

            return true;
        } catch (e) {
            console.warn('[spine-renderers] WebGL init failed:', e.message);
            return false;
        }
    });

    return {
        async render(dt) {
            if (destroyed || !gl) return;
            await initPromise;

            if (!skeletonRenderer) return;

            try {
                animState.update(dt);
                animState.apply(skeleton);
                skeleton.updateWorldTransform();

                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);

                shader.bind();
                batcher.begin(shader);
                skeletonRenderer.draw(batcher, skeleton);
                batcher.end();
                shader.unbind();
            } catch (e) {
                // Silently skip frame
            }
        },

        resize(w, h) {
            canvas.width = w;
            canvas.height = h;
            if (gl) gl.viewport(0, 0, w, h);
        },

        destroy() {
            destroyed = true;
            if (batcher) try { batcher.dispose(); } catch (e) { /* */ }
            if (shader) try { shader.dispose(); } catch (e) { /* */ }
            if (shapes) try { shapes.dispose(); } catch (e) { /* */ }
            gl = null;
            skeletonRenderer = null;
        },
    };
}

// ── Phaser Plugin Configuration ──

/**
 * Get the Spine-Phaser plugin configuration for Phaser game config.
 * Returns config object to merge into Phaser.Game config.
 *
 * @returns {Promise<object|null>}
 */
export async function getSpinePhaserPlugin() {
    const mod = await loadSpinePhaser();
    if (!mod || !mod.SpinePlugin) return null;

    return {
        scene: [
            {
                key: 'SpinePlugin',
                plugin: mod.SpinePlugin,
                mapping: 'spine',
            },
        ],
    };
}

/**
 * Load a Spine skeleton into a Phaser scene (if SpinePlugin is available).
 *
 * @param {Phaser.Scene} scene - The Phaser scene with spine plugin
 * @param {string} key - Asset key
 * @param {object} skeletonData - Spine skeleton data
 * @param {number} x - Position X
 * @param {number} y - Position Y
 * @returns {object|null} Spine game object or null
 */
export function addSpineToScene(scene, key, skeletonData, x, y) {
    if (!scene.spine) {
        console.warn('[spine-renderers] SpinePlugin not available in scene');
        return null;
    }

    try {
        const spineObj = scene.spine.add.spineFromData(x, y, key, skeletonData);
        return spineObj;
    } catch (e) {
        console.warn('[spine-renderers] Failed to add Spine to scene:', e.message);
        return null;
    }
}

// ── Auto-detect best renderer ──

/**
 * Auto-detect and create the best available renderer.
 * Tries WebGL first, falls back to canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} skeleton
 * @param {object} animState
 * @returns {Promise<{ render: Function, resize: Function, destroy: Function }>}
 */
export async function createBestRenderer(canvas, skeleton, animState) {
    // Try WebGL first
    const webglRenderer = createWebGLRenderer(canvas, skeleton, animState);
    if (webglRenderer) {
        const hasWebGL = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (hasWebGL) return webglRenderer;
        webglRenderer.destroy();
    }

    // Fall back to canvas
    return createCanvasRenderer(canvas, skeleton, animState);
}

// ── Manual bone drawing fallback ──

function _drawBonesManually(ctx, skeleton) {
    const bones = skeleton.bones;
    ctx.strokeStyle = '#f5f0e8';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    for (let i = 1; i < bones.length; i++) {
        const bone = bones[i];
        const parent = bone.parent;
        if (!parent) continue;

        ctx.beginPath();
        ctx.moveTo(parent.worldX, -parent.worldY);
        ctx.lineTo(bone.worldX, -bone.worldY);
        ctx.stroke();
    }

    // Draw joints
    ctx.fillStyle = '#ffd700';
    for (const bone of bones) {
        ctx.beginPath();
        ctx.arc(bone.worldX, -bone.worldY, 2, 0, Math.PI * 2);
        ctx.fill();
    }
}
