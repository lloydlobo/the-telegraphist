// --- CONSTANTS ---

const DESIGN_HEIGHT = 720;
const MIN_STAGE_WIDTH = 480;
const MAX_STAGE_WIDTH = 1280;
const WIDE_ASPECT_THRESHOLD = 1.05;

const FONT = { fontFamily: "monospace", fontSize: "16px" };
const COLOR = {
  BG: "#0c0805",
  FG: "#d3b582",
  DIM: "#8a7550",
  GOOD: "#9fd08a",
  BAD: "#d97a63",
};

const MORSE_CODE = { E: ".", T: "-", I: "..", M: "--", A: ".-", N: "-.", S: "...", O: "---", H: "....", R: ".-.", D: "-..", L: ".-.." };
const LETTER_ORDER = "ETIMANSOHRDL";

const RAW_WORD_CORPUS = `
IT
ME
MET
TIE
EMIT
ITEM
MEET
MITE
TIME
STONE
NOTES
MOIST
MEANT
INSET
HORSE
HAND
LAND
TRAIN
NORTH
SOLDIER
THREAD
`;
const WORDS = RAW_WORD_CORPUS.trim().split(/\r?\n/).map((word) => word.trim().toUpperCase()).filter((word) => word.length > 0);

const BEAT_START_SECONDS = 0.65;
const BEAT_MIN_SECONDS = 0.5;
const BEAT_STEP_SECONDS = 0.03;
const HIT_WINDOW_SECONDS = 0.25;
const DASH_MIN_SECONDS = 0.12;
const DOT_MAX_SECONDS = 0.25;
const DASH_FORCE_RESOLVE_SECONDS = 1.0;
const QUALITY_REGEN_PER_SECOND = 5;
const QUALITY_MISS_PENALTY = 10;
const WORD_HISTORY_LIMIT = 5;
const LEAD_IN_SECONDS = 3.2;
const RUNWAY_SECONDS = 3.2;
const SEND_KEYS = new Set(["Space", "Enter", "KeyJ", "KeyF"]);
const SAVE_KEY = "telegraphist.save.v1";

const PLAY_BACKGROUND_SHADER = `
precision mediump float;
uniform vec2 resolution;
uniform float time;
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec2 pixel = gl_FragCoord.xy;
  float scan = 0.5 + 0.5 * cos(pixel.y * 0.72);
  float grain = fract(sin(dot(floor(pixel / 3.0 + time * 5.0), vec2(12.9898, 78.233))) * 43758.5453);
  float roll = 1.0 - smoothstep(0.0, 0.18, abs(uv.y - fract(time * 0.08)));
  float vignette = 1.0 - smoothstep(0.28, 0.82, length((uv - 0.5) * vec2(1.0, 0.8)));
  vec3 base = vec3(0.035, 0.032, 0.018);
  vec3 phosphor = vec3(0.15, 0.19, 0.075) * (0.25 + scan * 0.45 + roll * 0.3);
  vec3 color = (base + phosphor + grain * 0.018) * (0.45 + vignette * 0.75);
  gl_FragColor = vec4(color, 1.0);
}
`;

// --- STAGE ---

/**
 * Width follows the window aspect on desktop; portrait stays at the original
 * 480x720. Height is always the design height, so pixel sizes are stable.
 */
function computeStage() {
  const width = window.innerWidth || MIN_STAGE_WIDTH;
  const height = window.innerHeight || DESIGN_HEIGHT;
  const aspect = width / Math.max(1, height);

  if (aspect <= WIDE_ASPECT_THRESHOLD) {
    return { W: MIN_STAGE_WIDTH, H: DESIGN_HEIGHT, wide: false };
  }

  const stageWidth = Math.round(DESIGN_HEIGHT * aspect);
  return {
    W: Math.min(MAX_STAGE_WIDTH, Math.max(720, stageWidth)),
    H: DESIGN_HEIGHT,
    wide: true,
  };
}

const STAGE = computeStage();
const REDUCED_MOTION = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;

// --- SAVE DATA ---

function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const saveData = Object.assign(
  { mute: false, tick: true, best: 0, letters: {} },
  loadSave()
);

// Defend against hand-edited or half-written storage.
if (!saveData.letters || typeof saveData.letters !== "object" || Array.isArray(saveData.letters)) saveData.letters = {};
if (typeof saveData.best !== "number" || !Number.isFinite(saveData.best)) saveData.best = 0;

/** @type {Record<string, LetterStat>} */
const letterStats = saveData.letters;

let persistTimer = null;

function persistSave() {
  if (persistTimer) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
    } catch {
      /* storage disabled, play without persistence */
    }
  }, 200);
}

/**
 * @param {string} letter
 * @returns {LetterStat}
 */
const statsFor = (letter) => letterStats[letter] || (letterStats[letter] = { attempts: 0, hits: 0 });

/**
 * @param {string} letter
 * @returns {boolean}
 */
const isMastered = (letter) => {
  const stats = statsFor(letter);
  return stats.attempts >= 5 && stats.hits / stats.attempts >= 0.75;
};

// --- SFX ---

const ctxOf = (scene) => (scene && scene.sound && scene.sound.context) || null;

function tone(scene, freq, dur, waveType, gain, slide, delay) {
  if (saveData.mute) return;
  const ctx = ctxOf(scene);
  const out = ctx && scene.sound.destination;
  if (!ctx || !out) return;

  const t0 = ctx.currentTime + (delay || 0);
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();

  oscillator.type = waveType || "sine";
  oscillator.frequency.setValueAtTime(freq, t0);
  if (slide) oscillator.frequency.linearRampToValueAtTime(Math.max(24, freq + slide), t0 + dur);

  envelope.gain.setValueAtTime(0.0001, t0);
  envelope.gain.linearRampToValueAtTime(gain === null ? 0.15 : gain, t0 + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  oscillator.connect(envelope).connect(out);
  oscillator.start(t0);
  oscillator.stop(t0 + dur + 0.03);
}

function noise(scene, dur, gain, freq, q) {
  if (saveData.mute) return;
  const ctx = ctxOf(scene);
  if (!ctx) return;

  const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const output = ctx.createGain();

  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = freq || 1200;
  filter.Q.value = q || 1;

  output.gain.setValueAtTime(gain, ctx.currentTime);
  output.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);

  source.connect(filter).connect(output).connect(out);
  source.start();
  source.stop(ctx.currentTime + dur);
}

const SFX = {
  dit: (scene) => tone(scene, 720, 0.09, "sine", 0.14),
  dah: (scene) => tone(scene, 620, 0.22, "sine", 0.13),
  good: (scene) => tone(scene, 990, 0.08, "triangle", 0.09, 120),
  miss: (scene) => {
    noise(scene, 0.14, 0.12, 700, 0.7);
    tone(scene, 150, 0.2, "sawtooth", 0.09, -60);
  },
  tick: (scene) => tone(scene, 1400, 0.025, "sine", 0.03),
  start: (scene) => tone(scene, 620, 0.1, "triangle", 0.12, 180),
  unlock: (scene) => {
    tone(scene, 660, 0.12, "triangle", 0.09, 140);
    tone(scene, 880, 0.16, "triangle", 0.07, 180, 0.1);
  },
  over: (scene) => {
    tone(scene, 320, 0.9, "sawtooth", 0.13, -260);
    tone(scene, 210, 1.0, "square", 0.05, -160, 0.1);
  },
};

// --- AMBIENCE ---

/**
 * Shared compressor for the ambience bus (pad + melody only — SFX bypass it,
 * exactly as in the pre-refactor graph). Lazily attached to Phaser's sound
 * manager so mute and unlock are handled in one place.
 */
let master = null;
let masterContext = null;

function ensureMaster(scene) {
  const ctx = ctxOf(scene);
  const out = scene && scene.sound && scene.sound.destination;
  if (!ctx || !out) return null;

  if (!master || masterContext !== ctx) {
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -18;
    master.knee.value = 12;
    master.ratio.value = 8;
    master.attack.value = 0.003;
    master.release.value = 0.25;
    master.connect(out);
    masterContext = ctx;
  }

  return master;
}

const scale = [0, 3, 5, 7, 10, 12];

function applyMute() {
  if (game && game.sound) game.sound.mute = saveData.mute;
}

function toggleMute() {
  saveData.mute = !saveData.mute;
  applyMute();
  persistSave();
  return saveData.mute;
}

function playNote(scene, note) {
  if (saveData.mute) return;
  const ctx = ctxOf(scene);
  const out = ensureMaster(scene);
  if (!ctx || !out) return;
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.value = 220 * 2 ** (note / 12);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  oscillator.connect(gain);
  gain.connect(out);

  oscillator.start(now);
  oscillator.stop(now + 0.35);
}

// Gain is a linear amplitude multiplier, not perceived loudness.
// Melody: 0.08 = 8% amplitude; each pad: 1–1.75%.
const PAD_VOICES = [[-8, 0.0125], [0, 0.0175], [7, 0.01]];

function playPad(scene, note) {
  if (saveData.mute) return;
  const ctx = ctxOf(scene);
  const out = ensureMaster(scene);
  if (!ctx || !out) return;
  const now = ctx.currentTime;

  for (const [detune, volume] of PAD_VOICES) {
    const oscillator = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    oscillator.type = "sawtooth";
    oscillator.frequency.value = 110 * 2 ** (note / 12);
    oscillator.detune.value = detune;

    filter.type = "lowpass";
    filter.frequency.value = 650;
    filter.Q.value = 1.0;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.8);
    gain.gain.setTargetAtTime(0.001, now + 1.5, 1.2);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(out);

    oscillator.start(now);
    oscillator.stop(now + 7);
  }
}

function playAmbientNote(scene) {
  const note = scale[Math.floor(Math.random() * scale.length)];
  playNote(scene, note);
  playPad(scene, note);
}

// --- HELPERS ---

function font(size, bold) {
  return { fontFamily: "monospace", fontSize: `${size}px`, color: COLOR.FG, fontStyle: bold ? "bold" : "normal" };
}

function destroyLabel(note) {
  if (note.label) {
    note.label.destroy();
    note.label = null;
  }
}

/**
 * @param {Phaser.Scene} scene
 * @param {number} x
 * @param {number} y
 * @param {string} label
 * @param {() => void} onPress
 * @param {number} [width]
 * @returns {Phaser.GameObjects.Container}
 */
function makeActionButton(scene, x, y, label, onPress, width = 220) {
  const height = 44;
  const container = scene.add.container(x, y);
  const background = scene.add.graphics();

  const paint = (color) => {
    background.clear();
    background.fillStyle(color, 1);
    background.fillRoundedRect(-width / 2, -height / 2, width, height, 8);
  };

  const text = scene.add.text(0, 0, label, font(18, true)).setOrigin(0.5);
  container.add([background, text]);
  container.labelText = text;
  container.setSize(width, height);
  container.setInteractive({ useHandCursor: true });

  paint(0x1a120d);
  container.on("pointerover", () => paint(0x2a1e15));
  container.on("pointerout", () => paint(0x1a120d));
  container.on("pointerdown", () => {
    SFX.good(scene);
    paint(0x382814);
    text.setY(1);
  });
  container.on("pointerup", () => {
    paint(0x2a1e15);
    text.setY(0);
    onPress();
  });

  return container;
}

// --- TRACK SCENE ---

class TrackScene extends Phaser.Scene {
  createTrack() {
    this.graphics = this.add.graphics();
    this.glowGraphics = this.add.graphics().setDepth(-1);
    this.feedbackText = this.add
      .text(0, 0, "", font(18, true))
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(5);

    this.elapsedSeconds = 0;
    this.previousTimestamp = performance.now() / 1e3;

    /** @type {MorseSignalNote[]} */
    this.notes = [];
    this.noteIndex = 0;
    /** @type {MorseSignalNote|null} */
    this.currentDash = null;
    this.currentPressTime = 0;

    this.beatSeconds = BEAT_START_SECONDS;
    this.gridOrigin = 0;
    this.lastBeatIndex = -1;
    this.sequenceDone = false;

    this.bindTrackInput();
    this.events.once("shutdown", () => this.destroyTrack());
  }

  destroyTrack() {
    this.destroyLabels();
  }

  destroyLabels() {
    for (const note of this.notes) destroyLabel(note);
  }

  metrics() {
    const wide = STAGE.W > 600;
    const lineX = Math.round(STAGE.W * (wide ? 0.3 : 0.25));
    const gateH = wide ? 190 : 150;

    return {
      wide,
      lineX,
      speed: (STAGE.W - lineX) / RUNWAY_SECONDS,
      gateY: Math.round(STAGE.H * 0.38),
      gateH,
      midY: Math.round(STAGE.H * 0.38) + Math.round(gateH / 2),
      noteR: wide ? 13 : 10,
      dashW: wide ? 68 : 52,
      dashH: wide ? 24 : 18,
      labelSize: wide ? 20 : 15,
      labelY: Math.round(STAGE.H * 0.38) + gateH + 26,
    };
  }

  bindTrackInput() {
    // Captures are global (and are not removed on plugin shutdown by design);
    // preventDefault is handled by the keyboard manager, not per event.
    this.input.keyboard.addCapture("SPACE,ENTER,J,F");
    this.input.keyboard.on("keydown", this.onKeyDown, this);
    this.input.keyboard.on("keyup", this.onKeyUp, this);
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("pointerupoutside", this.onPointerUp, this);
  }

  onKeyDown(event) {
    if (event.code === "KeyM" && !event.repeat) {
      const muted = toggleMute();
      this.showFeedback(muted ? "MUTED" : "SOUND ON", COLOR.DIM);
      return;
    }
    if (this.handleSpecialKey(event)) return;
    if (event.repeat || !SEND_KEYS.has(event.code)) return;
    this.handlePress(this.gameTimeFromEvent(event.timeStamp));
  }

  onKeyUp(event) {
    if (!SEND_KEYS.has(event.code)) return;
    this.handleRelease(this.gameTimeFromEvent(event.timeStamp));
  }

  handleSpecialKey() {
    return false;
  }

  onPointerDown(pointer, over) {
    if (this.handlePointerDown(pointer, over)) return;
    // Native pointer timestamps avoid the frame delay from Phaser's input queue.
    this.handlePress(this.gameTimeFromEvent(pointer.downTime || performance.now()));
  }

  handlePointerDown() {
    return false;
  }

  onPointerUp(pointer) {
    // See the note above; upTime can be 0 for a pointer that was never down.
    this.handleRelease(this.gameTimeFromEvent(pointer.upTime || performance.now()));
  }

  // NOTE: Native timestamps avoid adding the frame delay from Phaser's input queue.
  gameTimeFromEvent(timestamp) {
    const seconds =
      timestamp && timestamp > 1e12 ? performance.now() / 1e3 : timestamp ? timestamp / 1e3 : performance.now() / 1e3;
    return seconds - this.previousTimestamp;
  }

  handlePress(eventTime) {
    if (this.currentDash) return;

    const note = this.notes[this.noteIndex];
    if (!note) return;

    const offset = eventTime - note.on;
    if (Math.abs(offset) >= HIT_WINDOW_SECONDS) {
      if (offset < -HIT_WINDOW_SECONDS && offset > -0.7) this.showFeedback("TOO EARLY", COLOR.DIM);
      else if (offset > HIT_WINDOW_SECONDS) this.showFeedback("TOO LATE", COLOR.BAD);
      return;
    }

    this.currentDash = note;
    this.currentPressTime = eventTime;
    note.dash ? SFX.dah(this) : SFX.dit(this);
  }

  handleRelease(eventTime) {
    if (!this.currentDash) return;

    const note = this.currentDash;
    const holdTime = eventTime - this.currentPressTime;
    const offset = this.currentPressTime - note.on;

    let hit;
    let reason = null;
    if (note.dash) {
      hit = holdTime >= DASH_MIN_SECONDS;
      if (!hit) reason = "TOO SHORT";
    } else {
      hit = holdTime <= DOT_MAX_SECONDS;
      if (!hit) reason = "TOO LONG";
    }

    this.resolveNote(note, hit, reason, offset);
    this.currentDash = null;
    this.currentPressTime = 0;
  }

  /**
   * @param {MorseSignalNote} note
   * @param {boolean} hit
   * @param {string|null} [reason]
   * @param {number|null} [offset]
   */
  resolveNote(note, hit, reason = null, offset = null) {
    const stats = statsFor(note.letter);
    stats.attempts++;
    if (hit) stats.hits++;

    this.recordResult(note, hit);

    note.done = hit ? 1 : 2;
    this.noteIndex++;

    if (hit) {
      const grade = offset === null ? "SENT" : gradeOffset(offset);
      this.showFeedback(grade, grade === "PERFECT" ? COLOR.GOOD : COLOR.FG);
    } else {
      this.showFeedback(reason || "MISSED", COLOR.BAD);
    }

    persistSave();
  }

  recordResult() {}

  tickTrack() {
    const now = performance.now() / 1e3;
    const previousElapsed = this.elapsedSeconds;
    this.elapsedSeconds = Math.min(now - this.previousTimestamp, this.elapsedSeconds + 0.1);
    this.previousTimestamp = now - this.elapsedSeconds;
    const deltaSeconds = this.elapsedSeconds - previousElapsed;

    while (
      this.notes[this.noteIndex] &&
      this.notes[this.noteIndex] !== this.currentDash &&
      this.elapsedSeconds > this.notes[this.noteIndex].on + HIT_WINDOW_SECONDS
    ) {
      this.resolveNote(this.notes[this.noteIndex], false, "MISSED");
    }

    if (this.currentDash && this.elapsedSeconds - this.currentPressTime > DASH_FORCE_RESOLVE_SECONDS) {
      const note = this.currentDash;
      this.resolveNote(note, note.dash, note.dash ? null : "TOO LONG", this.currentPressTime - note.on);
      this.currentDash = null;
      this.currentPressTime = 0;
    }

    this.tickMetronome();

    const last = this.notes[this.notes.length - 1];
    if (
      !this.sequenceDone &&
      last &&
      this.noteIndex >= this.notes.length &&
      this.elapsedSeconds > last.on + HIT_WINDOW_SECONDS + 0.5
    ) {
      this.sequenceDone = true;
      this.onSequenceComplete();
    }

    this.drawTrack(this.metrics());
    return deltaSeconds;
  }

  tickMetronome() {
    if (!saveData.tick || !this.gridOrigin) return;
    const index = Math.floor((this.elapsedSeconds - this.gridOrigin) / this.beatSeconds);
    if (index !== this.lastBeatIndex) {
      this.lastBeatIndex = index;
      if (index >= 0) SFX.tick(this);
    }
  }

  onSequenceComplete() {}

  drawTrack(metrics) {
    const { lineX, speed, gateY, gateH, midY } = metrics;

    this.graphics.clear();
    this.glowGraphics.clear();

    // Beat grid: makes the rhythm visible instead of something you have to feel out.
    if (this.gridOrigin) {
      const firstBeat = Math.floor((this.elapsedSeconds - this.gridOrigin) / this.beatSeconds);
      for (let index = firstBeat; index < firstBeat + 12; index++) {
        const beatTime = this.gridOrigin + index * this.beatSeconds;
        const x = Math.round(lineX + (beatTime - this.elapsedSeconds) * speed);
        if (x < lineX || x > STAGE.W) continue;
        this.graphics.fillStyle(0xffffff, index % 4 === 0 ? 0.1 : 0.045).fillRect(x, gateY + 10, 1, gateH - 20);
      }
    }

    // Runway rail.
    this.graphics.fillStyle(0xffffff, 0.07).fillRect(lineX, midY, Math.max(0, STAGE.W - lineX), 1);

    // Strike line.
    this.graphics.fillStyle(0xffffff, 1).fillRect(lineX - 2, gateY, 4, gateH);

    const upcoming = this.notes[this.noteIndex];
    const proximity = upcoming
      ? 1 - Phaser.Math.Clamp(Math.abs(upcoming.on - this.elapsedSeconds) / HIT_WINDOW_SECONDS, 0, 1)
      : 0;
    if (upcoming) {
      this.glowGraphics
        .fillStyle(0xffbb44, 0.05 + proximity * 0.16)
        .fillRect(lineX - 16, gateY - 8, 34, gateH + 16);
    }

    for (const note of this.notes) {
      const x = Math.round(lineX + (note.on - this.elapsedSeconds) * speed);
      const visible = x > -80 && x < STAGE.W + 80;

      if (note.label) {
        note.label.setPosition(x, metrics.labelY).setVisible(visible);
      }
      if (!visible) continue;

      this.graphics.fillStyle(note.done === 1 ? 0x44aa44 : note.done === 2 ? 0xaa4444 : 0xffbb44);
      if (note.dash) {
        this.graphics.fillRect(x - metrics.dashW / 2, midY - metrics.dashH / 2, metrics.dashW, metrics.dashH);
      } else {
        this.graphics.fillCircle(x, midY, metrics.noteR);
      }
    }
  }

  /**
   * @param {MorseSignalNote} note
   * @param {string} text
   */
  addNoteLabel(note, text) {
    const metrics = this.metrics();
    note.label = this.add
      .text(0, metrics.labelY, text, font(metrics.labelSize))
      .setOrigin(0.5, 0);
  }

  showFeedback(text, color) {
    const metrics = this.metrics();
    this.tweens.killTweensOf(this.feedbackText);
    this.feedbackText
      .setText(text)
      .setColor(color)
      .setPosition(metrics.lineX, metrics.gateY - 34)
      .setAlpha(1)
      .setY(metrics.gateY - 34);

    this.tweens.add({
      targets: this.feedbackText,
      alpha: 0,
      y: metrics.gateY - 56,
      duration: 700,
      ease: "Quad.easeOut",
    });
  }
}

/**
 * @param {number} offset
 * @returns {"PERFECT"|"GOOD"|"OK"}
 */
function gradeOffset(offset) {
  const absolute = Math.abs(offset);
  if (absolute <= 0.09) return "PERFECT";
  if (absolute <= 0.17) return "GOOD";
  return "OK";
}

// --- SCENE: Menu ---

class Menu extends Phaser.Scene {
  constructor() {
    super("Menu");
  }

  create() {
    this.cameras.main.setBackgroundColor(COLOR.BG);

    // Sync the persisted mute preference into Phaser's sound manager.
    applyMute();

    const centerX = STAGE.W / 2;
    const scale = STAGE.W > 600 ? 1.15 : 1;

    this.add.text(centerX, STAGE.H * 0.11, "THE", font(28 * scale, true)).setOrigin(0.5);
    this.add.text(centerX, STAGE.H * 0.11 + 44 * scale, "TELEGRAPHIST", font(48 * scale, true)).setOrigin(0.5);
    this.add.text(centerX, STAGE.H * 0.11 + 88 * scale, "- .... .", font(12 * scale, true)).setOrigin(0.5);
    this.add.text(centerX, STAGE.H * 0.11 + 110 * scale, "- . .-.. . --. .-. .- .--. .... .. ... -", font(12 * scale, true)).setOrigin(0.5);

    this.add.text(centerX, STAGE.H * 0.44, "DIT  .  TAP / QUICK PRESS", font(16 * scale, true)).setOrigin(0.5);
    this.add.text(centerX, STAGE.H * 0.49, "DAH  -  PRESS AND HOLD", font(16 * scale, true)).setOrigin(0.5);
    this.add.text(centerX, STAGE.H * 0.55, "TIME EACH SIGNAL TO THE LINE", font(13 * scale)).setOrigin(0.5);

    if (saveData.best > 0) {
      this.add.text(centerX, STAGE.H * 0.62, `BEST ${saveData.best}`, font(13 * scale)).setOrigin(0.5).setColor(COLOR.DIM);
    }

    const go = () => {
      SFX.start(this);
      this.scene.start("Play");
    };
    makeActionButton(this, centerX, STAGE.H * 0.8, "CLOCK IN", go);
    makeActionButton(this, centerX, STAGE.H * 0.89, "HOW TO PLAY", () => this.scene.start("Tutorial"));

    this.add.text(centerX, STAGE.H - 22, "SPACE OR TAP TO CLOCK IN", font(12)).setOrigin(0.5).setColor(COLOR.DIM);
    this.input.keyboard.on("keydown-SPACE", go);
    this.input.keyboard.on("keydown-ENTER", go);
  }
}

// --- SCENE: Tutorial ---

class Tutorial extends Phaser.Scene {
  constructor() {
    super("Tutorial");
  }

  create() {
    this.cameras.main.setBackgroundColor(COLOR.BG);

    const centerX = STAGE.W / 2;
    const scale = STAGE.W > 600 ? 1.1 : 1;

    this.add.text(centerX, STAGE.H * 0.13, "HOW TO SEND MORSE", font(24 * scale, true)).setOrigin(0.5);

    this.add.text(centerX, STAGE.H * 0.26, "WATCH THE SIGNAL MOVE TOWARD THE LINE", font(14 * scale)).setOrigin(0.5);
    this.add.text(centerX, STAGE.H * 0.33, "PRESS AS IT REACHES THE LINE", font(14 * scale)).setOrigin(0.5);

    this.add.text(centerX, STAGE.H * 0.45, "DIT   .   TAP OR PRESS BRIEFLY", font(17 * scale, true)).setOrigin(0.5);
    this.add.text(centerX, STAGE.H * 0.52, "DAH   -   PRESS AND HOLD", font(17 * scale, true)).setOrigin(0.5);

    this.add.text(centerX, STAGE.H * 0.62, "Example: A = .-   (DIT, then DAH)", font(15 * scale)).setOrigin(0.5);
    this.add.text(centerX, STAGE.H * 0.68, "Every clean word unlocks more letters.", font(13 * scale)).setOrigin(0.5).setColor(COLOR.DIM);

    makeActionButton(this, centerX, STAGE.H * 0.78, "PRACTICE FIRST", () => {
      SFX.start(this);
      this.scene.start("Practice");
    });
    makeActionButton(this, centerX, STAGE.H * 0.86, "START SENDING", () => {
      SFX.start(this);
      this.scene.start("Play");
    });
    makeActionButton(this, centerX, STAGE.H * 0.94, "BACK", () => this.scene.start("Menu"), 160);

    this.input.keyboard.on("keydown-ESC", () => this.scene.start("Menu"));
  }
}

// --- SCENE: Practice ---

class Practice extends TrackScene {
  constructor() {
    super("Practice");
  }

  create() {
    this.cameras.main.setBackgroundColor(COLOR.BG);

    this.stepIndex = 0;
    this.steps = ["E", "T", "A"];
    this.stepFailed = false;

    this.headerText = this.add.text(STAGE.W / 2, STAGE.H * 0.09, "", font(22, true)).setOrigin(0.5);
    this.hintText = this.add.text(STAGE.W / 2, STAGE.H * 0.17, "", font(16)).setOrigin(0.5).setColor(COLOR.DIM);
    this.actionText = this.add.text(STAGE.W / 2, STAGE.H * 0.25, "", font(26, true)).setOrigin(0.5);

    this.createTrack();

    makeActionButton(this, STAGE.W / 2, STAGE.H * 0.82, "START SENDING", () => {
      SFX.start(this);
      this.scene.start("Play");
    });
    makeActionButton(this, STAGE.W / 2, STAGE.H * 0.9, "BACK", () => this.scene.start("Tutorial"), 160);

    this.scheduleStep();
  }

  scheduleStep() {
    this.destroyLabels();
    this.notes = [];
    this.noteIndex = 0;
    this.currentDash = null;
    this.stepFailed = false;
    this.sequenceDone = false;

    if (this.stepIndex >= this.steps.length) {
      this.headerText.setText("NICE SENDING");
      this.hintText.setText("YOU KNOW THE THREE BASIC SIGNALS");
      this.actionText.setText("CLOCK IN WHEN READY");
      this.gridOrigin = 0;
      SFX.unlock(this);
      return;
    }

    const letter = this.steps[this.stepIndex];
    const code = MORSE_CODE[letter];
    const start = this.elapsedSeconds + 1.9;

    this.gridOrigin = start;
    this.lastBeatIndex = -1;
    this.beatSeconds = 0.8;

    this.headerText.setText(`PRACTICE ${this.stepIndex + 1} / ${this.steps.length}    ${letter}  ${code}`);
    this.hintText.setText("TAP AS IT REACHES THE LINE");
    this.actionText.setText(code.split("").map((signal) => (signal === "." ? "TAP" : "HOLD")).join("   "));

    [...code].forEach((signal, index) => {
      /** @type {MorseSignalNote} */
      const note = { letter, on: start + index * this.beatSeconds, dash: signal === "-" };
      if (index === 0) this.addNoteLabel(note, `${letter}  ${code}`);
      this.notes.push(note);
    });
  }

  recordResult(note, hit) {
    if (hit) {
      SFX.good(this);
      return;
    }

    SFX.miss(this);
    this.stepFailed = true;
    this.destroyLabels();
    this.notes = [];
    this.noteIndex = 0;
    this.currentDash = null;
    this.hintText.setText("TRY THAT ONE AGAIN");
    this.actionText.setText("LISTEN FOR THE BEAT");

    this.time.delayedCall(1200, () => {
      if (this.scene.isActive()) this.scheduleStep();
    });
  }

  onSequenceComplete() {
    this.stepIndex++;
    this.time.delayedCall(700, () => {
      if (this.scene.isActive()) this.scheduleStep();
    });
  }

  handleSpecialKey(event) {
    if (event.code === "Escape") {
      this.scene.start("Tutorial");
      return true;
    }
    return false;
  }

  update() {
    this.tickTrack();
  }
}

// --- SCENE: Play ---

class Play extends TrackScene {
  constructor() {
    super("Play");
  }

  create() {
    this.cameras.main.setBackgroundColor(COLOR.BG);

    this.unlockedLetterCount = 4;
    this.quality = 100;
    this.score = 0;
    this.telegramCount = 0;
    this.beatSeconds = BEAT_START_SECONDS;
    this.wordHistory = [];

    this.backgroundShader = null;
    if (this.game.renderer.type === Phaser.WEBGL) {
      const shaderKey = "dit-dah-play-background";
      if (!this.cache.shader.exists(shaderKey)) {
        this.cache.shader.add(shaderKey, new Phaser.Display.BaseShader(shaderKey, PLAY_BACKGROUND_SHADER));
      }
      this.backgroundShader = this.add
        .shader(shaderKey, STAGE.W / 2, STAGE.H / 2, STAGE.W, STAGE.H)
        .setDepth(-2);
    }

    this.createTrack();

    this.statusText = this.add.text(16, 14, "", font(16)).setDepth(2);
    this.wordHistoryText = this.add
      .text(STAGE.W - 16, 14, "", { ...font(13), align: "right", lineSpacing: 4 })
      .setOrigin(1, 0)
      .setDepth(2);

    this.pauseButton = this.add
      .text(STAGE.W - 16, 112, "[ PAUSE ]", { ...font(13), backgroundColor: "#1a120d", padding: { x: 7, y: 5 } })
      .setOrigin(1, 0)
      .setDepth(2)
      .setInteractive({ useHandCursor: true });

    this.telegramText = this.add
      .text(STAGE.W / 2, STAGE.H * 0.78, "", font(16, true))
      .setOrigin(0.5)
      .setColor(COLOR.DIM)
      .setDepth(2);

    this.scheduleWord();

    // Ambience rides the Scene Clock: it freezes while the scene is paused and
    // dies with the scene, so no start/stop plumbing is needed. It no-ops
    // while muted.
    playAmbientNote(this);
    this.time.addEvent({ delay: 600, loop: true, callback: () => playAmbientNote(this) });

    // Rebase the send-timing reference when the scene resumes (from the Pause
    // menu or a Return to play after tab hide). Phaser does not clear custom
    // scene-event listeners on shutdown, so remove it explicitly.
    const onResume = () => {
      this.previousTimestamp = performance.now() / 1e3 - this.elapsedSeconds;
      playAmbientNote(this);
    };
    this.events.on(Phaser.Scenes.Events.RESUME, onResume);
    this.events.once("shutdown", () => this.events.off(Phaser.Scenes.Events.RESUME, onResume));
  }

  update() {
    const deltaSeconds = this.tickTrack();

    this.quality = Math.min(100, this.quality + deltaSeconds * QUALITY_REGEN_PER_SECOND);
    this.statusText.setText(
      `SCORE ${this.score}    QUALITY ${Math.max(0, this.quality | 0)}    LETTERS ${LETTER_ORDER.slice(0, this.unlockedLetterCount)}`
    );

    if (this.quality <= 0) {
      SFX.over(this);
      this.scene.start("Over", { score: this.score });
    }

    if (this.backgroundShader) this.backgroundShader.setUniform("time", this.elapsedSeconds);
  }

  relayout() {
    this.statusText.setPosition(16, 14);
    this.wordHistoryText.setPosition(STAGE.W - 16, 14);
    this.pauseButton.setPosition(STAGE.W - 16, 112);
    this.telegramText.setPosition(STAGE.W / 2, STAGE.H * 0.78);
    if (this.backgroundShader) {
      this.backgroundShader.setPosition(STAGE.W / 2, STAGE.H / 2).setDisplaySize(STAGE.W, STAGE.H);
    }
  }

  scheduleWord() {
    this.destroyLabels();
    const unlockedLetters = LETTER_ORDER.slice(0, this.unlockedLetterCount);
    const eligibleWords = WORDS.filter((word) => [...word].every((letter) => unlockedLetters.includes(letter)));
    if (!eligibleWords.length) return;

    // Open with two short telegrams so the first minute is not a wall of notes.
    let pool = eligibleWords;
    if (this.telegramCount < 2) {
      const drills = eligibleWords.filter((word) => word.length <= 3);
      if (drills.length) pool = drills;
    }

    const word = pool[Math.floor(Math.random() * pool.length)];
    const start = this.elapsedSeconds + LEAD_IN_SECONDS;

    this.notes = [];
    this.noteIndex = 0;
    this.currentDash = null;
    this.sequenceDone = false;
    this.gridOrigin = start;
    this.lastBeatIndex = -1;

    let nextNoteTime = start;
    for (const letter of word) {
      [...MORSE_CODE[letter]].forEach((signal, signalIndex) => {
        /** @type {MorseSignalNote} */
        const note = { letter, on: nextNoteTime, dash: signal === "-" };
        if (!signalIndex) this.addNoteLabel(note, `${letter}  ${MORSE_CODE[letter]}`);
        this.notes.push(note);
        nextNoteTime += this.beatSeconds;
      });
      nextNoteTime += this.beatSeconds;
    }

    this.wordHistory.push(word);
    this.wordHistory = this.wordHistory.slice(-WORD_HISTORY_LIMIT);
    this.wordHistoryText.setText(this.wordHistory.join("\n"));
    this.telegramText.setText(`SENDING  ${word}`);

    this.telegramCount++;
    this.beatSeconds = Math.max(BEAT_MIN_SECONDS, this.beatSeconds - BEAT_STEP_SECONDS);
  }

  onSequenceComplete() {
    if (this.unlockedLetterCount < LETTER_ORDER.length) {
      const current = LETTER_ORDER.slice(0, this.unlockedLetterCount).split("");
      if (current.every(isMastered)) {
        this.unlockedLetterCount = Math.min(LETTER_ORDER.length, this.unlockedLetterCount + 4);
        const unlocked = LETTER_ORDER.slice(0, this.unlockedLetterCount).split("").join(" ");
        this.showBanner(`NEW LETTERS  ${unlocked}`);
        SFX.unlock(this);
      }
    }

    this.time.delayedCall(600, () => {
      if (this.scene.isActive()) this.scheduleWord();
    });
  }

  recordResult(note, hit) {
    if (hit) {
      this.score += 10;
      SFX.good(this);
      return;
    }

    this.quality -= QUALITY_MISS_PENALTY;
    SFX.miss(this);
    if (!REDUCED_MOTION) this.cameras.main.shake(100, 0.004);
  }

  showBanner(text) {
    const banner = this.add
      .text(STAGE.W / 2, STAGE.H * 0.24, text, font(20, true))
      .setOrigin(0.5)
      .setColor(COLOR.GOOD)
      .setDepth(4);

    this.tweens.add({
      targets: banner,
      alpha: 0,
      y: STAGE.H * 0.24 - 24,
      duration: 1600,
      ease: "Quad.easeOut",
      onComplete: () => banner.destroy(),
    });
  }

  handleSpecialKey(event) {
    if (event.code === "Escape" || event.code === "KeyP") {
      this.pauseGame();
      return true;
    }
    return false;
  }

  handlePointerDown(pointer, over) {
    // `over` is the reusable hit-test list; only inspect it synchronously.
    if (over && over.includes(this.pauseButton)) {
      this.pauseGame();
      return true;
    }
    return false;
  }

  pauseGame() {
    if (!this.scene.isActive() || this.scene.isPaused()) return;
    this.scene.launch("Pause");
    this.scene.pause();
  }
}

// --- SCENE: Pause ---

class Pause extends Phaser.Scene {
  constructor() {
    super("Pause");
  }

  create() {
    this.add.rectangle(STAGE.W / 2, STAGE.H / 2, STAGE.W, STAGE.H, 0x000000, 0.78);
    this.add.text(STAGE.W / 2, STAGE.H * 0.26, "LINE PAUSED", font(28, true)).setOrigin(0.5);

    const resume = () => {
      this.scene.stop();
      this.scene.resume("Play");
    };

    const soundButton = makeActionButton(this, STAGE.W / 2, STAGE.H * 0.5, this.soundLabel(), () => {
      toggleMute();
      soundButton.labelText.setText(this.soundLabel());
    });

    const tickButton = makeActionButton(this, STAGE.W / 2, STAGE.H * 0.58, this.tickLabel(), () => {
      saveData.tick = !saveData.tick;
      persistSave();
      tickButton.labelText.setText(this.tickLabel());
    });

    makeActionButton(this, STAGE.W / 2, STAGE.H * 0.42, "RESUME", resume);
    makeActionButton(this, STAGE.W / 2, STAGE.H * 0.66, "MAIN MENU", () => {
      this.scene.stop("Play");
      this.scene.start("Menu");
    });

    this.add.text(STAGE.W / 2, STAGE.H * 0.85, "ESC / P  RESUME     M  MUTE", font(12)).setOrigin(0.5).setColor(COLOR.DIM);

    this.input.keyboard.on("keydown", (event) => {
      if (event.code === "Escape" || event.code === "KeyP") resume();
      if (event.code === "KeyM" && !event.repeat) {
        toggleMute();
        soundButton.labelText.setText(this.soundLabel());
      }
    });
  }

  soundLabel() {
    return saveData.mute ? "SOUND: OFF" : "SOUND: ON";
  }

  tickLabel() {
    return saveData.tick ? "BEAT TICK: ON" : "BEAT TICK: OFF";
  }
}

// --- SCENE: Over ---

class Over extends Phaser.Scene {
  constructor() {
    super("Over");
  }

  init(data) {
    this.finalScore = data.score ?? 0;
  }

  create() {
    this.cameras.main.setBackgroundColor(COLOR.BG);

    if (this.finalScore > saveData.best) {
      saveData.best = this.finalScore;
      persistSave();
    }

    const centerX = STAGE.W / 2;
    this.add.text(centerX, STAGE.H * 0.13, "LINE DEAD", font(28, true)).setOrigin(0.5);
    this.add.text(centerX, STAGE.H * 0.21, `FINAL SCORE ${this.finalScore}`, font(18)).setOrigin(0.5);
    this.add.text(centerX, STAGE.H * 0.26, `BEST ${saveData.best}`, font(14)).setOrigin(0.5).setColor(COLOR.DIM);

    const weak = Object.entries(letterStats)
      .filter(([, stats]) => stats.attempts >= 3)
      .map(([letter, stats]) => [letter, stats.hits / stats.attempts])
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
      .map(([letter, ratio]) => `${letter} ${Math.round(ratio * 100)}%`)
      .join("   ");

    if (weak) {
      this.add.text(centerX, STAGE.H * 0.33, `WEAKEST: ${weak}`, font(14)).setOrigin(0.5).setColor(COLOR.DIM);
    }

    makeActionButton(this, centerX, STAGE.H * 0.52, "RETRY", () => this.scene.start("Play"));
    makeActionButton(this, centerX, STAGE.H * 0.61, "MENU", () => this.scene.start("Menu"), 160);

    this.add.text(centerX, STAGE.H * 0.72, "SPACE  RETRY     ESC  MENU", font(12)).setOrigin(0.5).setColor(COLOR.DIM);

    this.input.keyboard.once("keydown-SPACE", () => this.scene.start("Play"));
    this.input.keyboard.once("keydown-ESC", () => this.scene.start("Menu"));
  }
}

// --- RESIZE ---

function applyStage(next) {
  if (next.W === STAGE.W) return false;
  STAGE.W = next.W;
  STAGE.wide = next.wide;
  game.scale.resize(STAGE.W, STAGE.H);
  // FIT caches both the aspect ratio and the parent bounds from boot, so re-apply them.
  game.scale.displaySize.setAspectRatio(STAGE.W / STAGE.H);
  game.scale.getParentBounds();
  game.scale.refresh();
  return true;
}

let resizeTimer = null;

window.addEventListener("resize", () => {
  if (resizeTimer) window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = null;
    if (!applyStage(computeStage())) return;

    for (const scene of game.scene.getScenes(true)) {
      if (scene.relayout) scene.relayout();
      else scene.scene.restart();
    }

    const playScene = game.scene.getScene("Play");
    if (playScene && playScene.scene.isPaused() && playScene.relayout) playScene.relayout();
  }, 180);
});

// --- ENTRY POINT ---

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: STAGE.W,
  height: STAGE.H,
  backgroundColor: COLOR.BG,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [Menu, Tutorial, Practice, Play, Pause, Over],
});

// Pause when the tab loses focus so a run cannot die in the background.
// Phaser translates visibilitychange (and pagehide) into this event.
game.events.on(Phaser.Core.Events.HIDDEN, () => {
  const playScene = game.scene.getScene("Play");
  if (playScene && playScene.scene.isActive()) playScene.pauseGame();
});
