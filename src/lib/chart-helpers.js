/**
 * chart-helpers.js — Chart.js integration for leaderboard analytics
 *
 * Provides reusable chart factories for skill radar, score bars, etc.
 * Uses Chart.js with tree-shaking for minimal bundle impact.
 */

import {
    Chart,
    RadarController,
    RadialLinearScale,
    PointElement,
    LineElement,
    Filler,
    Tooltip,
    BarController,
    CategoryScale,
    LinearScale,
    BarElement,
    LineController,
} from 'chart.js';

// Register only what we need
Chart.register(
    RadarController,
    RadialLinearScale,
    PointElement,
    LineElement,
    Filler,
    Tooltip,
    BarController,
    CategoryScale,
    LinearScale,
    BarElement,
    LineController,
);

// Track active charts so we can destroy before re-creating
const _activeCharts = new Map();

function _destroyChart(key) {
    const existing = _activeCharts.get(key);
    if (existing) {
        existing.destroy();
        _activeCharts.delete(key);
    }
}

/**
 * Component labels for radar charts (matches the 8 skill components).
 */
const COMPONENT_LABELS = [
    'Score', 'Grids', 'Difficulty', 'Speed',
    'Challenge', 'Consistency', 'Versatility', 'Growth',
];

const COMPONENT_KEYS = [
    'raw_score_component', 'grid_mastery_component', 'difficulty_component', 'time_pressure_component',
    'challenge_component', 'consistency_component', 'versatility_component', 'progression_component',
];

/**
 * Extract component values from a rank/analysis data object.
 */
function _extractComponents(data) {
    return COMPONENT_KEYS.map(k => Math.round(data[k] || 0));
}

/**
 * Class-based accent colors.
 */
function _getClassColor(skillClass) {
    switch (skillClass) {
        case 'expert': return { bg: 'rgba(245, 158, 11, 0.08)', border: '#fbbf24', point: '#fde68a' };
        case 'master': return { bg: 'rgba(94, 234, 212, 0.08)', border: '#5eead4', point: '#99f6e4' };
        case 'high': return { bg: 'rgba(251, 191, 36, 0.08)', border: '#fbbf24', point: '#fde68a' };
        case 'medium': return { bg: 'rgba(148, 163, 184, 0.08)', border: '#94a3b8', point: '#cbd5e1' };
        default: return { bg: 'rgba(251, 146, 60, 0.08)', border: '#fb923c', point: '#fdba74' };
    }
}

/**
 * Create a skill radar chart on a given canvas element.
 *
 * @param {HTMLCanvasElement} canvas - Target canvas
 * @param {Object} data - Rank data object with component keys
 * @param {Object} [opts] - Extra options
 * @param {string} [opts.chartKey] - Key for chart lifecycle (destroy/recreate)
 * @param {string} [opts.skillClass] - 'high', 'medium', 'low', 'master'
 * @param {Object} [opts.comparison] - Optional second dataset (e.g., class averages)
 * @param {number} [opts.size] - Canvas CSS size in px (default: 200)
 * @returns {Chart} The Chart instance
 */
export function createSkillRadar(canvas, data, opts = {}) {
    const key = opts.chartKey || canvas.id || `radar_${Date.now()}`;
    _destroyChart(key);

    const values = _extractComponents(data);
    const colors = _getClassColor(opts.skillClass || data.skill_class || 'low');
    const size = opts.size || 200;

    canvas.width = size * 2;
    canvas.height = size * 2;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';

    const datasets = [{
        label: 'Profile',
        data: values,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        borderWidth: 1.25,
        pointBackgroundColor: colors.point,
        pointBorderColor: '#111318',
        pointBorderWidth: 1,
        pointRadius: 2,
        pointHoverRadius: 4,
        pointHoverBorderWidth: 1,
    }];

    // Optional comparison dataset (class averages)
    if (opts.comparison) {
        const compValues = COMPONENT_KEYS.map(k => Math.round(opts.comparison[k] || 0));
        datasets.push({
            label: 'Class Avg',
            data: compValues,
            backgroundColor: 'rgba(148,163,184,0.03)',
            borderColor: 'rgba(148,163,184,0.32)',
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
        });
    }

    const chart = new Chart(canvas, {
        type: 'radar',
        data: {
            labels: COMPONENT_LABELS,
            datasets,
        },
        options: {
            responsive: false,
            animation: { duration: 450, easing: 'easeOutQuart' },
            plugins: {
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(14, 18, 24, 0.94)',
                    titleFont: { size: 10, weight: '600' },
                    bodyFont: { size: 10 },
                    padding: 7,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${ctx.raw}`,
                    },
                },
                legend: { display: false },
            },
            scales: {
                r: {
                    min: 0,
                    max: 100,
                    ticks: {
                        stepSize: 25,
                        display: false,
                        backdropColor: 'transparent',
                    },
                    grid: {
                        color: 'rgba(148,163,184,0.14)',
                    },
                    angleLines: {
                        color: 'rgba(148,163,184,0.14)',
                    },
                    pointLabels: {
                        color: '#8f98a8',
                        font: { size: 9, weight: 500 },
                    },
                },
            },
        },
    });

    _activeCharts.set(key, chart);
    return chart;
}

/**
 * Create a horizontal bar chart for challenge performance stats.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} opts
 * @param {string[]} opts.labels
 * @param {number[]} opts.values
 * @param {string} [opts.chartKey]
 * @param {string} [opts.color] - Bar color
 * @returns {Chart}
 */
export function createStatsBar(canvas, opts = {}) {
    const key = opts.chartKey || canvas.id || `bar_${Date.now()}`;
    _destroyChart(key);

    const color = opts.color || '#8b9bdc';

    canvas.width = 300 * 2;
    canvas.height = Math.max(100, opts.labels.length * 28) * 2;
    canvas.style.width = '100%';
    canvas.style.height = Math.max(100, opts.labels.length * 28) + 'px';

    const chart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: opts.labels,
            datasets: [{
                data: opts.values,
                backgroundColor: color + '22',
                borderColor: color,
                borderWidth: 1,
                borderRadius: 6,
                barPercentage: 0.62,
                categoryPercentage: 0.72,
            }],
        },
        options: {
            responsive: false,
            indexAxis: 'y',
            animation: { duration: 420 },
            plugins: {
                tooltip: {
                    backgroundColor: 'rgba(14,18,24,0.94)',
                    titleFont: { size: 10, weight: '600' },
                    bodyFont: { size: 10 },
                    padding: 7,
                    cornerRadius: 8,
                    displayColors: false,
                },
                legend: { display: false },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(148,163,184,0.12)', drawBorder: false },
                    border: { display: false },
                    ticks: { color: '#7e8797', font: { size: 9 }, maxTicksLimit: 4 },
                },
                y: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { color: '#a0a7b4', font: { size: 9, weight: 500 } },
                },
            },
        },
    });

    _activeCharts.set(key, chart);
    return chart;
}

/**
 * Destroy a chart by key (for cleanup on section collapse).
 */
export function destroyChart(key) {
    _destroyChart(key);
}

/**
 * Destroy all tracked charts.
 */
export function destroyAllCharts() {
    for (const [key] of _activeCharts) {
        _destroyChart(key);
    }
}

/**
 * Render a radar chart into a container element (creates canvas automatically).
 * Returns the chart key for later destruction.
 *
 * @param {HTMLElement} container - Parent element
 * @param {Object} data - Rank data with component scores
 * @param {Object} [opts]
 * @returns {string} chartKey
 */
export function renderRadarInto(container, data, opts = {}) {
    const key = opts.chartKey || `radar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'chart-radar-wrap';

    const canvas = document.createElement('canvas');
    canvas.id = key;
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    createSkillRadar(canvas, data, { ...opts, chartKey: key });
    return key;
}

/**
 * Render a horizontal bar chart into a container (creates canvas automatically).
 * Ideal for challenge-specific performance stats.
 *
 * @param {HTMLElement} container
 * @param {Object} opts - { labels, values, color, chartKey }
 * @returns {string} chartKey
 */
export function renderBarInto(container, opts = {}) {
    const key = opts.chartKey || `bar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-wrap';

    const canvas = document.createElement('canvas');
    canvas.id = key;
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    createStatsBar(canvas, { ...opts, chartKey: key });
    return key;
}

/**
 * Create a mini line chart (sparkline) for recent score trends.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} opts
 * @param {number[]} opts.scores - Score values (oldest → newest)
 * @param {string} [opts.color]
 * @param {string} [opts.chartKey]
 * @returns {Chart}
 */
export function createScoreTrend(canvas, opts = {}) {
    const key = opts.chartKey || canvas.id || `trend_${Date.now()}`;
    _destroyChart(key);

    const scores = opts.scores || [];
    const color = opts.color || '#8b9bdc';

    canvas.width = 280 * 2;
    canvas.height = 72 * 2;
    canvas.style.width = '100%';
    canvas.style.height = '72px';

    const chart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: scores.map((_, i) => `${i + 1}`),
            datasets: [{
                data: scores,
                borderColor: color,
                backgroundColor: color + '10',
                borderWidth: 1.4,
                pointRadius: scores.length > 8 ? 0 : 1.8,
                pointHoverRadius: 3,
                pointBackgroundColor: color,
                fill: false,
                tension: 0.28,
            }],
        },
        options: {
            responsive: false,
            animation: { duration: 420 },
            plugins: {
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(14,18,24,0.94)',
                    titleFont: { size: 10, weight: '600' },
                    bodyFont: { size: 10 },
                    padding: 6,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        title: (items) => `Game ${items[0].label}`,
                        label: (ctx) => `Score: ${ctx.raw.toLocaleString()}`,
                    },
                },
                legend: { display: false },
            },
            scales: {
                x: {
                    display: false,
                },
                y: {
                    grid: { color: 'rgba(148,163,184,0.12)', drawBorder: false },
                    border: { display: false },
                    ticks: { color: '#7e8797', font: { size: 9 }, maxTicksLimit: 3 },
                },
            },
        },
    });

    _activeCharts.set(key, chart);
    return chart;
}

/**
 * Render a score trend line chart into a container.
 *
 * @param {HTMLElement} container
 * @param {Object} opts - { scores, color, chartKey }
 * @returns {string} chartKey
 */
export function renderTrendInto(container, opts = {}) {
    const key = opts.chartKey || `trend_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'chart-trend-wrap';

    const label = document.createElement('div');
    label.className = 'chart-trend-label';
    label.textContent = 'Recent Scores';
    wrap.appendChild(label);

    const canvas = document.createElement('canvas');
    canvas.id = key;
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    createScoreTrend(canvas, { ...opts, chartKey: key });
    return key;
}

export { COMPONENT_KEYS, COMPONENT_LABELS };
