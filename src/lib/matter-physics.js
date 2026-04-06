/**
 * matter-physics.js — Matter.js physics-driven particle & debris system for PLUMMET
 *
 * Provides realistic physics simulation for:
 *   - Word clear debris (letter fragments scatter with momentum/friction)
 *   - Bomb explosion shrapnel (radial blast with angular velocity)
 *   - Bonus unlock particle implosion (attract bodies to target)
 *   - Confetti rain with air resistance & tumble rotation
 *   - Grid cascade physics (letters falling with bounce/settle)
 *   - Impact rings with physics-based expansion
 */
import Matter from 'matter-js';

const { Engine, World, Bodies, Body, Composite, Events, Runner, Vector } = Matter;

// ── Shared Physics World ──
let _engine = null;
let _world = null;
let _runner = null;
let _bodies = new Map(); // id -> { body, renderer, life, maxLife, type }
let _nextId = 0;
let _canvas = null;
let _ctx = null;
let _isRunning = false;

/**
 * Initialize the Matter.js physics world.
 * Call once during game setup. Uses a hidden canvas overlay for rendering.
 *
 * @param {HTMLCanvasElement} canvas - The canvas to render physics particles on
 */
export function initPhysicsWorld(canvas) {
    if (_engine) destroyPhysicsWorld();

    _canvas = canvas;
    _ctx = canvas.getContext('2d');

    _engine = Engine.create({
        gravity: { x: 0, y: 1.2, scale: 0.001 },
        enableSleeping: true,
    });
    _world = _engine.world;

    // Floor boundary (below visible area, just to catch stray bodies)
    const floor = Bodies.rectangle(
        canvas.width / 2, canvas.height + 50,
        canvas.width * 2, 100,
        { isStatic: true, label: 'floor' }
    );
    World.add(_world, floor);

    // Listen for sleeping bodies to auto-remove
    Events.on(_engine, 'afterUpdate', _cleanupBodies);

    _isRunning = true;
}

/**
 * Step the physics engine and render all active bodies.
 * Call from the game's main RAF loop.
 *
 * @param {number} dt - Delta time in seconds
 */
export function updatePhysics(dt) {
    if (!_engine || !_isRunning) return;

    // Matter uses ms internally
    Engine.update(_engine, dt * 1000);

    // Render all tracked bodies
    if (_ctx && _canvas) {
        // Don't clear — overlay renders on top of game canvas
        _renderBodies(dt);
    }
}

/**
 * Render physics bodies onto the canvas.
 */
function _renderBodies(dt) {
    const ctx = _ctx;

    for (const [id, entry] of _bodies) {
        entry.life -= dt;
        if (entry.life <= 0 || entry.body.isSleeping) {
            _removebody(id);
            continue;
        }

        const { body, type } = entry;
        const alpha = Math.max(0, entry.life / entry.maxLife);
        const pos = body.position;
        const angle = body.angle;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(pos.x, pos.y);
        ctx.rotate(angle);

        switch (type) {
            case 'debris':
                ctx.fillStyle = entry.color || '#e2d8a6';
                ctx.fillRect(-entry.size / 2, -entry.size / 4, entry.size, entry.size / 2);
                break;
            case 'shrapnel':
                ctx.fillStyle = entry.color || '#ff6600';
                ctx.beginPath();
                ctx.moveTo(0, -entry.size);
                ctx.lineTo(entry.size * 0.6, entry.size * 0.5);
                ctx.lineTo(-entry.size * 0.6, entry.size * 0.5);
                ctx.closePath();
                ctx.fill();
                break;
            case 'confetti':
                ctx.fillStyle = entry.color;
                ctx.fillRect(-entry.size / 2, -entry.size / 4, entry.size, entry.size / 2);
                break;
            case 'dust':
                ctx.beginPath();
                ctx.arc(0, 0, entry.size * alpha, 0, Math.PI * 2);
                ctx.fillStyle = entry.color || '#ffd700';
                ctx.fill();
                break;
            case 'letter':
                ctx.fillStyle = entry.color || '#3a3933';
                ctx.fillRect(-entry.size / 2, -entry.size / 2, entry.size, entry.size);
                ctx.fillStyle = '#fff';
                ctx.font = `bold ${Math.floor(entry.size * 0.55)}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(entry.letter || '?', 0, 0);
                break;
            default:
                ctx.fillStyle = entry.color || '#fff';
                ctx.beginPath();
                ctx.arc(0, 0, entry.size, 0, Math.PI * 2);
                ctx.fill();
        }

        ctx.restore();
    }
}

function _removebody(id) {
    const entry = _bodies.get(id);
    if (entry) {
        World.remove(_world, entry.body);
        _bodies.delete(id);
    }
}

function _cleanupBodies() {
    for (const [id, entry] of _bodies) {
        const pos = entry.body.position;
        // Remove if out of bounds
        if (_canvas && (pos.y > _canvas.height + 100 || pos.x < -200 || pos.x > _canvas.width + 200)) {
            _removebody(id);
        }
    }
}

// ── Particle Spawning Functions ──

const DEBRIS_COLORS = ['#e2d8a6', '#c4a878', '#8cb860', '#7aa68e', '#d4c890', '#b0a878', '#9a9680', '#706c58'];
const CONFETTI_COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff922b', '#be4bdb', '#20c997', '#e64980'];

/**
 * Spawn debris particles when letters are cleared from the grid.
 * Each debris piece has realistic mass, friction, and angular velocity.
 *
 * @param {number} x - Center X position
 * @param {number} y - Center Y position
 * @param {number} [count=8] - Number of debris pieces
 * @param {object} [opts] - Override options
 */
export function spawnDebris(x, y, count = 8, opts = {}) {
    if (!_world) return;

    for (let i = 0; i < count; i++) {
        const size = 3 + Math.random() * 5;
        const body = Bodies.rectangle(x, y, size, size / 2, {
            restitution: 0.4 + Math.random() * 0.3,
            friction: 0.1,
            frictionAir: 0.01 + Math.random() * 0.02,
            density: 0.001,
            label: 'debris',
        });

        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 6;
        Body.setVelocity(body, { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed - 3 });
        Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.3);

        World.add(_world, body);
        const id = _nextId++;
        _bodies.set(id, {
            body,
            type: 'debris',
            life: 1.2 + Math.random() * 0.8,
            maxLife: 2.0,
            size,
            color: opts.color || DEBRIS_COLORS[Math.floor(Math.random() * DEBRIS_COLORS.length)],
        });
    }
}

/**
 * Spawn bomb explosion shrapnel — radial blast with high velocity.
 *
 * @param {number} x - Blast center X
 * @param {number} y - Blast center Y
 * @param {number} [count=20] - Number of shrapnel pieces
 */
export function spawnExplosion(x, y, count = 20) {
    if (!_world) return;

    for (let i = 0; i < count; i++) {
        const size = 2 + Math.random() * 4;
        const body = Bodies.polygon(x, y, 3, size, {
            restitution: 0.6,
            friction: 0.05,
            frictionAir: 0.005 + Math.random() * 0.01,
            density: 0.0008,
            label: 'shrapnel',
        });

        const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
        const speed = 6 + Math.random() * 10;
        Body.setVelocity(body, { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed });
        Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.5);

        World.add(_world, body);
        const id = _nextId++;
        _bodies.set(id, {
            body,
            type: 'shrapnel',
            life: 0.8 + Math.random() * 0.6,
            maxLife: 1.4,
            size,
            color: ['#ff6600', '#ff4400', '#ffaa00', '#ff8800'][Math.floor(Math.random() * 4)],
        });
    }
}

/**
 * Physics-based confetti rain for celebrations.
 * Confetti pieces have high air friction for fluttering effect.
 *
 * @param {number} [count=40] - Number of confetti pieces
 * @param {object} [opts] - Options { width, startY }
 */
export function spawnConfettiPhysics(count = 40, opts = {}) {
    if (!_world || !_canvas) return;

    const w = opts.width || _canvas.width;
    const startY = opts.startY || -20;

    for (let i = 0; i < count; i++) {
        const x = Math.random() * w;
        const size = 4 + Math.random() * 6;
        const body = Bodies.rectangle(x, startY - Math.random() * 100, size, size / 2, {
            restitution: 0.2,
            friction: 0.3,
            frictionAir: 0.04 + Math.random() * 0.06, // High air resistance for flutter
            density: 0.0003,
            label: 'confetti',
        });

        Body.setVelocity(body, {
            x: (Math.random() - 0.5) * 3,
            y: 1 + Math.random() * 2,
        });
        Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.2);

        World.add(_world, body);
        const id = _nextId++;
        _bodies.set(id, {
            body,
            type: 'confetti',
            life: 3 + Math.random() * 2,
            maxLife: 5,
            size,
            color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        });
    }
}

/**
 * Spawn dust particles that implode toward a target point.
 * Uses Matter.js attraction via `afterUpdate` force application.
 *
 * @param {number} sx - Source X
 * @param {number} sy - Source Y
 * @param {number} tx - Target X
 * @param {number} ty - Target Y
 * @param {number} [count=12]
 */
export function spawnDustImplosion(sx, sy, tx, ty, count = 12) {
    if (!_world) return;

    const attractIds = [];
    for (let i = 0; i < count; i++) {
        const size = 2 + Math.random() * 3;
        const body = Bodies.circle(
            sx + (Math.random() - 0.5) * 40,
            sy + (Math.random() - 0.5) * 40,
            size,
            {
                restitution: 0,
                friction: 0,
                frictionAir: 0.02,
                density: 0.0005,
                label: 'dust',
            }
        );

        // Initial scatter velocity
        const angle = Math.random() * Math.PI * 2;
        Body.setVelocity(body, {
            x: Math.cos(angle) * (2 + Math.random() * 3),
            y: Math.sin(angle) * (2 + Math.random() * 3),
        });

        World.add(_world, body);
        const id = _nextId++;
        _bodies.set(id, {
            body,
            type: 'dust',
            life: 0.6 + Math.random() * 0.3,
            maxLife: 0.9,
            size,
            color: ['#ffd700', '#f59e0b', '#fb923c'][Math.floor(Math.random() * 3)],
        });
        attractIds.push(id);
    }

    // Attraction force applied each step
    const attractHandler = () => {
        for (const aid of attractIds) {
            const entry = _bodies.get(aid);
            if (!entry) continue;
            const pos = entry.body.position;
            const dx = tx - pos.x;
            const dy = ty - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const strength = 0.0003 * (1 + entry.maxLife - entry.life); // Strengthens over time
            Body.applyForce(entry.body, pos, {
                x: (dx / dist) * strength,
                y: (dy / dist) * strength,
            });
        }
        // Remove handler when all dust is gone
        if (attractIds.every(aid => !_bodies.has(aid))) {
            Events.off(_engine, 'beforeUpdate', attractHandler);
        }
    };
    Events.on(_engine, 'beforeUpdate', attractHandler);
}

/**
 * Spawn a physics-simulated falling letter block.
 * Used for cascade animations when letters settle after a word clear.
 *
 * @param {number} x - Start X
 * @param {number} y - Start Y
 * @param {number} targetY - Target landing Y
 * @param {string} letter - The letter to display
 * @param {number} cellSize - Cell size for rendering
 * @returns {number} Body ID for tracking
 */
export function spawnFallingLetter(x, y, targetY, letter, cellSize) {
    if (!_world) return -1;

    const body = Bodies.rectangle(x, y, cellSize * 0.8, cellSize * 0.8, {
        restitution: 0.15,
        friction: 0.8,
        frictionAir: 0.01,
        density: 0.003,
        label: 'letter',
    });

    Body.setVelocity(body, { x: 0, y: 2 });

    World.add(_world, body);
    const id = _nextId++;
    _bodies.set(id, {
        body,
        type: 'letter',
        life: 2.0,
        maxLife: 2.0,
        size: cellSize * 0.8,
        letter,
        color: '#3a3933',
    });
    return id;
}

/**
 * Spawn impact ring — expanding circle bodies that fade out.
 *
 * @param {number} x - Center X
 * @param {number} y - Center Y
 * @param {number} [intensity=1] - Scale multiplier
 */
export function spawnImpactRing(x, y, intensity = 1) {
    if (!_world) return;

    const ringCount = 2 + Math.floor(intensity);
    for (let i = 0; i < ringCount; i++) {
        const radius = 8 + i * 6;
        // Create small bodies arranged in a ring pattern
        const segments = 8;
        for (let s = 0; s < segments; s++) {
            const angle = (s / segments) * Math.PI * 2;
            const bx = x + Math.cos(angle) * (radius * 0.3);
            const by = y + Math.sin(angle) * (radius * 0.3);
            const body = Bodies.circle(bx, by, 1.5, {
                restitution: 0,
                friction: 0,
                frictionAir: 0.06,
                density: 0.0001,
                label: 'ring',
            });
            const speed = (2 + intensity * 2) * (1 + i * 0.3);
            Body.setVelocity(body, {
                x: Math.cos(angle) * speed,
                y: Math.sin(angle) * speed,
            });
            World.add(_world, body);
            const id = _nextId++;
            _bodies.set(id, {
                body,
                type: 'dust',
                life: 0.3 + i * 0.1,
                maxLife: 0.5 + i * 0.1,
                size: 2 + intensity,
                color: `rgba(226, 216, 166, ${0.6 - i * 0.15})`,
            });
        }
    }
}

/**
 * Get the count of active physics bodies.
 */
export function getActiveBodyCount() {
    return _bodies.size;
}

/**
 * Clear all physics bodies.
 */
export function clearAllBodies() {
    for (const [id] of _bodies) {
        _removebody(id);
    }
    _bodies.clear();
}

/**
 * Destroy the physics world entirely.
 */
export function destroyPhysicsWorld() {
    if (_runner) Runner.stop(_runner);
    if (_engine) {
        Events.off(_engine, 'afterUpdate', _cleanupBodies);
        World.clear(_world);
        Engine.clear(_engine);
    }
    _bodies.clear();
    _engine = null;
    _world = null;
    _runner = null;
    _canvas = null;
    _ctx = null;
    _isRunning = false;
}

export { Matter };
