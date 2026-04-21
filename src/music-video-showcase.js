import Chance from "chance";
import { WordRunnerGame } from "./word-runner-game.js";

const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;

const TAKES = [
    {
        id: "aurora-drift",
        label: "Take 1",
        title: "Aurora Drift",
        subtitle: "Slow neon glide with long camera breathing room",
        seed: "aurora-drift-2026",
        initialSpeed: 188,
        maxSpeed: 330,
        speedRamp: 0.08,
        wordBoost: 9,
    },
    {
        id: "copper-rush",
        label: "Take 2",
        title: "Copper Rush",
        subtitle: "Warmer pacing with a little more forward push",
        seed: "copper-rush-2026",
        initialSpeed: 202,
        maxSpeed: 352,
        speedRamp: 0.09,
        wordBoost: 10,
    },
    {
        id: "skyline-bounce",
        label: "Take 3",
        title: "Skyline Bounce",
        subtitle: "Higher platform rhythm and more vertical motion",
        seed: "skyline-bounce-2026",
        initialSpeed: 194,
        maxSpeed: 340,
        speedRamp: 0.085,
        wordBoost: 11,
    },
    {
        id: "ember-lattice",
        label: "Take 4",
        title: "Ember Lattice",
        subtitle: "Dense letter flow for more word hits on screen",
        seed: "ember-lattice-2026",
        initialSpeed: 198,
        maxSpeed: 346,
        speedRamp: 0.088,
        wordBoost: 12,
    },
    {
        id: "tidal-finale",
        label: "Take 5",
        title: "Tidal Finale",
        subtitle: "Clean heroic closer for the end of a music video",
        seed: "tidal-finale-2026",
        initialSpeed: 206,
        maxSpeed: 360,
        speedRamp: 0.095,
        wordBoost: 12,
    },
];

const els = {
    stage: document.getElementById("video-stage"),
    takeList: document.getElementById("take-list"),
    takeDuration: document.getElementById("take-duration"),
    recordFps: document.getElementById("record-fps"),
    score: document.getElementById("metric-score"),
    distance: document.getElementById("metric-distance"),
    stageTitle: document.getElementById("stage-title"),
    stageSubtitle: document.getElementById("stage-subtitle"),
    statusPill: document.getElementById("status-pill"),
    recordingChip: document.getElementById("recording-chip"),
    playCurrent: document.getElementById("play-current"),
    playReel: document.getElementById("play-reel"),
    recordCurrent: document.getElementById("record-current"),
    recordReel: document.getElementById("record-reel"),
    stopRecording: document.getElementById("stop-recording"),
    restartTake: document.getElementById("restart-take"),
};

let dictionary = new Set();
let prefixes = new Set();
let dictionaryWords = [];
let game = null;
let currentTakeIndex = 0;
let reelTimer = null;
let restartTimer = null;
let reelActive = false;
let currentRecorder = null;
let currentChunks = [];
let recordStopTimer = null;

function setStatus(text) {
    els.statusPill.textContent = text;
}

function setRecordingStatus(text) {
    els.recordingChip.textContent = text;
}

function getTakeDurationMs() {
    const seconds = Number(els.takeDuration.value);
    return Math.max(10, Number.isFinite(seconds) ? seconds : 45) * 1000;
}

function getCaptureFps() {
    const fps = Number(els.recordFps.value);
    return Math.max(24, Math.min(60, Number.isFinite(fps) ? fps : 60));
}

function buildPrefixSet(words) {
    const set = new Set();
    for (const word of words) {
        for (let len = 2; len < word.length; len++) {
            set.add(word.slice(0, len));
        }
    }
    return set;
}

/**
 * Builds a flat letter sequence from a target word queue.
 * Between words we insert 2 neutral filler letters so the runner has room
 * to finish collecting the current word before the next word starts.
 */
function buildLetterSequence(targetWords) {
    const rng = new Chance("filler-seq");
    const FILLERS = "AEIOUTNSR"; // common, safe, easy to ignore
    const seq = [];
    for (const word of targetWords) {
        for (const ch of word) seq.push(ch);
        // 2 filler letters between words as breathing room
        for (let i = 0; i < 2; i++) {
            seq.push(FILLERS[rng.integer({ min: 0, max: FILLERS.length - 1 })]);
        }
    }
    return seq;
}

function createLetterPicker(targetWords) {
    const seq = buildLetterSequence(targetWords);
    let cursor = 0;

    return () => {
        if (seq.length === 0) return "A";
        const letter = seq[cursor % seq.length];
        cursor++;
        return letter;
    };
}

function isFriendlyTargetWord(word) {
    if (word.length < 4 || word.length > 7) return false;
    if (!/^[A-Z]+$/.test(word)) return false;
    const hard = (word.match(/[QXZJV]/g) || []).length;
    return hard <= 1;
}

function buildTargetWordQueue(seed, count = 200) {
    const rng = new Chance(`${seed}-targets`);
    const pool = dictionaryWords.filter(isFriendlyTargetWord);
    if (pool.length === 0) return [];

    const picked = [];
    const used = new Set();
    const maxTries = Math.max(count * 50, 1000);

    for (let tries = 0; picked.length < count && tries < maxTries; tries++) {
        const idx = rng.integer({ min: 0, max: pool.length - 1 });
        const w = pool[idx];
        if (used.has(w)) continue;
        used.add(w);
        picked.push(w);
    }

    return picked;
}

function formatDistance(distance) {
    return `${Math.floor(distance / 10)}m`;
}

function updateMetrics(state) {
    els.score.textContent = String(Math.floor(state.score || 0)).padStart(5, "0");
    els.distance.textContent = formatDistance(state.distance || 0);
}

function updateTakeButtons() {
    const buttons = els.takeList.querySelectorAll("button");
    for (const button of buttons) {
        button.classList.toggle("active", Number(button.dataset.takeIndex) === currentTakeIndex);
    }
}

function findBestWord(letters) {
    for (let len = letters.length; len >= 3; len--) {
        for (let start = 0; start <= letters.length - len; start++) {
            const candidate = letters.slice(start, start + len).join("");
            if (dictionary.has(candidate)) return candidate;
        }
    }
    return null;
}

function hasLiveFuture(letters) {
    for (let start = 0; start < letters.length; start++) {
        const suffix = letters.slice(start).join("");
        if (suffix.length >= 2 && prefixes.has(suffix)) return true;
    }
    return false;
}

function maybeValidateWord() {
    if (!game) return;
    const letters = game.getCollectedLetters();
    if (letters.length < 3) return;

    const bestWord = findBestWord(letters);
    if (bestWord) {
        game.validateWord();
        return;
    }

    if (letters.length >= 8 || !hasLiveFuture(letters)) {
        game.validateWord();
    }
}

function clearReelTimer() {
    if (reelTimer) {
        window.clearTimeout(reelTimer);
        reelTimer = null;
    }
}

function clearRestartTimer() {
    if (restartTimer) {
        window.clearTimeout(restartTimer);
        restartTimer = null;
    }
}

function stopRecordingTimers() {
    if (recordStopTimer) {
        window.clearTimeout(recordStopTimer);
        recordStopTimer = null;
    }
}

function getMimeType() {
    const candidates = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
    ];
    return candidates.find((value) => MediaRecorder.isTypeSupported(value)) || "";
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildGameOptions(take) {
    const targetWords = buildTargetWordQueue(take.seed, 200);
    const pickLetter = createLetterPicker(targetWords);
    return {
        width: VIDEO_WIDTH,
        height: VIDEO_HEIGHT,
        resolution: 1,
        seed: take.seed,
        autoPilot: true,
        autoCollectWords: true,
        cinematicMode: true,
        countdownSeconds: 0,
        initialSpeed: take.initialSpeed,
        maxSpeed: take.maxSpeed,
        speedRamp: take.speedRamp,
        wordBoost: take.wordBoost,
        overlayTitle: `${take.label}  ${take.title}`,
        overlaySubtitle: take.subtitle,
        overlayDuration: 6,
        dictionaryRef: dictionary,
        targetWords,
        targetWordStallSeconds: 2.6,
        randomLetterFn: () => pickLetter(),
        callbacks: {
            onLetterCollected: () => maybeValidateWord(),
            onStateUpdate: (state) => updateMetrics(state),
            onGameOver: () => handleGameOver(),
        },
    };
}

async function startTake(index, { preserveReel = false } = {}) {
    const take = TAKES[index];
    currentTakeIndex = index;
    updateTakeButtons();
    clearRestartTimer();
    if (!preserveReel) {
        reelActive = false;
        clearReelTimer();
    }

    els.stageTitle.textContent = `${take.label} · ${take.title}`;
    els.stageSubtitle.textContent = take.subtitle;
    setStatus(reelActive ? "Running Reel" : "Playing Take");

    const options = buildGameOptions(take);
    if (!game) {
        game = new WordRunnerGame(els.stage, options);
        await game.start();
    } else {
        await game.restart(null, options);
    }
}

function scheduleReelStep(index, takeDurationMs) {
    clearReelTimer();
    if (index >= TAKES.length) {
        reelActive = false;
        setStatus(currentRecorder ? "Recording Reel" : "Reel Finished");
        return;
    }

    startTake(index, { preserveReel: true }).catch((error) => {
        console.error("Failed to start take:", error);
        setStatus("Take Error");
    });

    reelTimer = window.setTimeout(() => {
        scheduleReelStep(index + 1, takeDurationMs);
    }, takeDurationMs);
}

async function playFullReel() {
    reelActive = true;
    setStatus(currentRecorder ? "Recording Reel" : "Running Reel");
    scheduleReelStep(0, getTakeDurationMs());
}

function handleGameOver() {
    clearRestartTimer();
    restartTimer = window.setTimeout(() => {
        startTake(currentTakeIndex, { preserveReel: reelActive }).catch((error) => {
            console.error("Failed to restart take:", error);
            setStatus("Restart Error");
        });
    }, 800);
}

async function ensureRecorderReady(mode) {
    if (mode === "reel") {
        await playFullReel();
    } else {
        await startTake(currentTakeIndex);
    }
    await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
}

async function startRecording(mode) {
    if (currentRecorder) return;

    await ensureRecorderReady(mode);
    const canvas = game?.getCanvas();
    if (!canvas) {
        setStatus("Canvas Missing");
        return;
    }

    const mimeType = getMimeType();
    const stream = canvas.captureStream(getCaptureFps());
    currentChunks = [];

    currentRecorder = new MediaRecorder(
        stream,
        mimeType
            ? { mimeType, videoBitsPerSecond: 16_000_000 }
            : { videoBitsPerSecond: 16_000_000 }
    );

    currentRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) currentChunks.push(event.data);
    };

    currentRecorder.onstop = () => {
        const blob = new Blob(currentChunks, { type: currentRecorder?.mimeType || "video/webm" });
        const takeSlug = TAKES[currentTakeIndex].id;
        const fileName = mode === "reel"
            ? `plummet-word-runner-reel-${Date.now()}.webm`
            : `plummet-word-runner-${takeSlug}-${Date.now()}.webm`;
        triggerDownload(blob, fileName);
        currentRecorder = null;
        currentChunks = [];
        stopRecordingTimers();
        setRecordingStatus("Recorder Idle");
        setStatus(reelActive ? "Running Reel" : "Playback Ready");
    };

    currentRecorder.start();
    setRecordingStatus(mode === "reel" ? "Recording Reel" : "Recording Take");
    setStatus(mode === "reel" ? "Recording Reel" : "Recording Take");

    const totalMs = mode === "reel" ? getTakeDurationMs() * TAKES.length : getTakeDurationMs();
    recordStopTimer = window.setTimeout(() => {
        if (currentRecorder && currentRecorder.state !== "inactive") currentRecorder.stop();
    }, totalMs);
}

function stopRecording() {
    if (!currentRecorder || currentRecorder.state === "inactive") return;
    currentRecorder.stop();
}

async function loadDictionary() {
    const response = await fetch("./words.json");
    if (!response.ok) throw new Error(`words.json fetch failed: ${response.status}`);
    const payload = await response.json();
    const words = Array.isArray(payload) ? payload : payload.words;
    dictionaryWords = words
        .filter((word) => typeof word === "string")
        .map((word) => word.toUpperCase());
    dictionary = new Set(dictionaryWords.filter((word) => word.length >= 3 && word.length <= 8));
    prefixes = buildPrefixSet(dictionary);
}

function renderTakeButtons() {
    els.takeList.innerHTML = "";
    TAKES.forEach((take, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "take-btn";
        button.dataset.takeIndex = String(index);
        button.innerHTML = `<strong>${take.label} · ${take.title}</strong><span>${take.subtitle}</span>`;
        button.addEventListener("click", () => {
            startTake(index).catch((error) => {
                console.error("Failed to switch take:", error);
                setStatus("Take Error");
            });
        });
        els.takeList.appendChild(button);
    });
    updateTakeButtons();
}

function bindEvents() {
    els.playCurrent.addEventListener("click", () => {
        startTake(currentTakeIndex).catch((error) => {
            console.error("Failed to play take:", error);
            setStatus("Take Error");
        });
    });
    els.playReel.addEventListener("click", () => {
        playFullReel().catch((error) => {
            console.error("Failed to play reel:", error);
            setStatus("Reel Error");
        });
    });
    els.recordCurrent.addEventListener("click", () => {
        startRecording("take").catch((error) => {
            console.error("Failed to record take:", error);
            setStatus("Record Error");
        });
    });
    els.recordReel.addEventListener("click", () => {
        startRecording("reel").catch((error) => {
            console.error("Failed to record reel:", error);
            setStatus("Record Error");
        });
    });
    els.stopRecording.addEventListener("click", () => stopRecording());
    els.restartTake.addEventListener("click", () => {
        startTake(currentTakeIndex, { preserveReel: reelActive }).catch((error) => {
            console.error("Failed to restart take:", error);
            setStatus("Restart Error");
        });
    });
}

async function boot() {
    renderTakeButtons();
    bindEvents();
    setStatus("Loading Dictionary");
    setRecordingStatus("Recorder Idle");
    await loadDictionary();
    setStatus("Playback Ready");
    await startTake(0);
}

boot().catch((error) => {
    console.error(error);
    setStatus("Boot Failed");
    els.stageSubtitle.textContent = error.message;
});