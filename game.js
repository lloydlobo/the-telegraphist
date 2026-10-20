// --- CONSTANTS ---

const W = 480;
const H = 720;
const FONT = { fontFamily: "monospace", fontSize: "16px" };
const COLOR = { BG: "#0c0805", FG: "#d3b582" }
const MORSE_CODE = { E: ".", T: "-", I: "..", M: "--", A: ".-", N: "-.", S: "...", O: "---", H: "....", R: ".-.", D: "-..", L: ".-.." };
const LETTER_ORDER = "ETIMANSOHRDL";
const RAW_WORD_CORPUS = `
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
const WORDS = RAW_WORD_CORPUS.trim().split(/\r?\n/).map(word => word.trim().toUpperCase()).filter(word => word.length > 0);
const BEAT_SECONDS = 0.5;
const HIT_WINDOW_SECONDS = 0.25;
const DASH_MIN_SECONDS = 0.12;
const DOT_MAX_SECONDS = 0.25;
const DASH_FORCE_RESOLVE_SECONDS = 1.0;
const TIMING_LINE_X = 120;
const HIDE_MASTERED_LABELS = false;
const WORD_HISTORY_LIMIT = 5;
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

/**
 * @typedef {{
 *   letter: string,
 *   on: number,
 *   dash: boolean,
 *   label?: Phaser.GameObjects.Text,
 *   done?: 1 | 2
 * }} MorseSignalNote
 */

/**
 * @typedef {{
 *   attempts: number,
 *   hits: number,
 * }} LetterStat
 */

// --- VARIABLES ---

/** 
 * @type {Record<string, LetterStat>} 
 */
const letterStats = {};

// --- SFX ---

const ctxOf = (scene) => (scene.sound && scene.sound.context ? scene.sound.context : null);

function tone(scene, freq, dur, waveType, gain, slide, when) {
  const ctx = ctxOf(scene)
  if (!ctx) return;

  const t0 = ctx.currentTime + (when || 0)
  const o = ctx.createOscillator();
  const g = ctx.createGain();

  o.type = waveType || "sine";
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.linearRampToValueAtTime(Math.max(24, freq + slide), t0 + dur);

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain === null ? 0.15 : gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

function noise(scene, dur, gain, freq, q) {
  const ctx = ctxOf(scene);
  if (!ctx) return;

  const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const output = ctx.createGain();

  src.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = freq || 1200;
  filter.Q.value = q || 1;

  output.gain.setValueAtTime(gain, ctx.currentTime);
  output.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);

  src.connect(filter).connect(output).connect(ctx.destination);
  src.start();
  src.stop(ctx.currentTime + dur);
}

const SFX = {
  dit: (s) => tone(s, 720, 0.09, "sine", 0.14),
  dah: (s) => tone(s, 620, 0.22, "sine", 0.13),
  good: (s) => tone(s, 990, 0.08, "triangle", 0.09, 120),
  miss: (s) => {
    noise(s, 0.14, 0.12, 700, 0.7);
    tone(s, 150, 0.2, "sawtooth", 0.09, -60);
  },
  start: (s) => tone(s, 620, 0.1, "triangle", 0.12, 180),
  over: (s) => {
    tone(s, 320, 0.9, "sawtooth", 0.13, -260);
    tone(s, 210, 1.0, "square", 0.05, -160, 0.1);
  },
};

// --- AUDIO ---

let audio;
let master;
let audioStarted = false;

const scale = [0, 3, 5, 7, 10, 12];

function setupAudio() {
  audio = new AudioContext();

  master = audio.createDynamicsCompressor();
  master.threshold.value = -18;
  master.knee.value = 12;
  master.ratio.value = 8;
  master.attack.value = 0.003;
  master.release.value = 0.25;
  master.connect(audio.destination);
}

function playNote(note) {
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = "triangle"; // smooth; was "triangle";
  osc.frequency.value = 220 * 2 ** (note / 12);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  osc.connect(gain);
  gain.connect(master);

  osc.start(now);
  osc.stop(now + 0.35);
}

// Gain is a linear amplitude multiplier, not perceived loudness.
// Melody: 0.08 = 8% amplitude; each pad: 0.01–0.0175 = 1–1.75%.
// Multiple pads sum together, so keep each quieter to avoid clipping.
const PADS_VOLUMES = {
  triangle: [[-4, 0.008], [0, 0.012], [4, 0.007]],
  sawtooth: [[-8, 0.0125], [0, 0.0175], [7, 0.01]],
}
const PAD_VOLUMES = PADS_VOLUMES.sawtooth;

function playPad(note) {
  const now = audio.currentTime;

  for (const [detune, volume] of PAD_VOLUMES) {
    const osc = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();

    osc.type = "sawtooth"; // retro non-smoother; was triangle
    osc.frequency.value = 110 * 2 ** (note / 12);
    osc.detune.value = detune;

    filter.type = "lowpass";
    filter.frequency.value = 650; // brighter; was 350
    filter.Q.value = 1.0; // 1.0; non-gentler resonance; was 0.5;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.8);
    gain.gain.setTargetAtTime(0.001, now + 1.5, 1.2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + 7);
  }
}

function play() {
  const note = scale[Math.floor(Math.random() * scale.length)];

  playNote(note);
  playPad(note);
}

document.addEventListener("pointerdown", async () => {
  if (audioStarted) return;
  audioStarted = true;

  setupAudio();
  await audio.resume();

  play();
  setInterval(play, 600);
}, { once: true });

// --- HELPERS ---

/**
 * @param {Phaser.Scene} scene
 * @param {number} x
 * @param {number} y
 * @param {string} label
 * @param {() => void} onPress
 * @returns {Phaser.GameObjects.Container}
 */
function makeActionButton(scene, x, y, label, onPress) {
  const container = scene.add.container(x, y);
  const bg = scene.add.graphics();

  const setBg = (color) => {
    bg.clear();
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-90, -18, 180, 36, 8);
  };

  const text = scene.add.text(0, 0, label, { ...FONT, fontSize: "18px", color: COLOR.FG }).setOrigin(0.5);
  container.add([bg, text]);
  container.setSize(180, 36);
  container.setInteractive({ useHandCursor: true });

  setBg(0x1a120d);
  container.on("pointerover", () => setBg(0x2a1e15));
  container.on("pointerout", () => setBg(0x1a120d));
  container.on("pointerdown", () => {
    SFX.good(scene);
    setBg(0x382814);
    text.setY(1);
  });
  container.on("pointerup", () => {
    setBg(0x2a1e15);
    text.setY(0);
  });
  container.on("pointerup", onPress);

  return container;
}

function UNIMPLEMENTED(msg = "UNIMPLEMENTED") {
  throw new Error(msg ? `UNIMPLEMENTED: ${msg}` : msg);
}

// --- SCENE: Menu ---

class Menu extends Phaser.Scene {
  constructor() { super("Menu"); }

  create() {
    this.cameras.main.setBackgroundColor(COLOR.BG);

    // Logo
    this.add.text(W / 2, H / 8 + 44 * 0, "THE", { fontFamily: "monospace", fontSize: "28px", color: COLOR.FG, fontStyle: "bold" }).setOrigin(0.5);
    this.add.text(W / 2, H / 8 + 44 * 1, "TELEGRAPHIST", { fontFamily: "monospace", fontSize: "48px", color: COLOR.FG, fontStyle: "bold" }).setOrigin(0.5);
    this.add.text(W / 2, H / 8 + 44 * 2, "- .... .", { fontFamily: "monospace", fontSize: "12px", color: COLOR.FG, fontStyle: "bold" }).setOrigin(0.5);
    this.add.text(W / 2, H / 8 + 44 * 2.5, "- . .-.. . --. .-. .- .--. .... .. ... -", { fontFamily: "monospace", fontSize: "12px", color: COLOR.FG, fontStyle: "bold" }).setOrigin(0.5);

    this.add.text(W / 2, H / 2 - 34, "DIT  .  TAP / QUICK PRESS", {
      ...FONT, fontSize: "16px", color: COLOR.FG, fontStyle: "bold",
    }).setOrigin(0.5);
    this.add.text(W / 2, H / 2 + 4, "DAH  -  PRESS AND HOLD", {
      ...FONT, fontSize: "16px", color: COLOR.FG, fontStyle: "bold",
    }).setOrigin(0.5);
    this.add.text(W / 2, H / 2 + 54, "TIME EACH SIGNAL TO THE LINE", {
      ...FONT, fontSize: "13px", color: COLOR.FG,
    }).setOrigin(0.5);

    const go = () => { SFX.start(this); this.scene.start("Play"); };
    makeActionButton(this, W / 2, H - 132, "CLOCK IN", go);
    makeActionButton(this, W / 2, H - 76, "HOW TO PLAY", () => this.scene.start("Tutorial"));
    this.input.keyboard.once("keydown-SPACE", go);
  }
}

// --- SCENE: Tutorial ---

class Tutorial extends Phaser.Scene {
  constructor() { super("Tutorial"); }

  create() {
    this.cameras.main.setBackgroundColor(COLOR.BG);
    this.add.text(W / 2, 100, "HOW TO SEND MORSE", {
      ...FONT, fontSize: "24px", color: COLOR.FG, fontStyle: "bold",
    }).setOrigin(0.5);

    this.add.text(W / 2, 190, "WATCH THE SIGNAL MOVE TOWARD THE LINE", {
      ...FONT, fontSize: "14px", color: COLOR.FG, align: "center",
    }).setOrigin(0.5);
    this.add.text(W / 2, 250, "PRESS AS IT REACHES THE LINE", {
      ...FONT, fontSize: "14px", color: COLOR.FG, align: "center",
    }).setOrigin(0.5);

    this.add.text(W / 2, 340, "DIT   .   TAP OR PRESS BRIEFLY", {
      ...FONT, fontSize: "17px", color: COLOR.FG, fontStyle: "bold",
    }).setOrigin(0.5);
    this.add.text(W / 2, 395, "DAH   -   PRESS AND HOLD", {
      ...FONT, fontSize: "17px", color: COLOR.FG, fontStyle: "bold",
    }).setOrigin(0.5);

    this.add.text(W / 2, 475, "Example: A = .-   (DIT, then DAH)", {
      ...FONT, fontSize: "15px", color: COLOR.FG, align: "center",
    }).setOrigin(0.5);

    makeActionButton(this, W / 2, 570, "START SENDING", () => {
      SFX.start(this);
      this.scene.start("Play");
    });
    makeActionButton(this, W / 2, 626, "BACK", () => this.scene.start("Menu"));
  }
}

// --- SCENE: Play ---

class Play extends Phaser.Scene {
  constructor() {
    super("Play");
    this.unlockedLetterCount = 4;
  }

  create() {
    this.cameras.main.setBackgroundColor(COLOR.BG);

    this.graphics = this.add.graphics();
    this.statusText = this.add.text(10, 10, "", { ...FONT, color: COLOR.FG });
    this.wordHistory = [];
    this.wordHistoryText = this.add.text(W - 10, 10, "", {
      ...FONT,
      fontSize: "12px",
      color: COLOR.FG,
      align: "right",
      lineSpacing: 3,
    }).setOrigin(1, 0).setDepth(2);
    this.pauseButton = this.add.text(W - 10, 96, "[ PAUSE ]", {
      ...FONT,
      fontSize: "12px",
      color: COLOR.FG,
      backgroundColor: "#1a120d",
      padding: { x: 7, y: 5 },
    }).setOrigin(1, 0).setDepth(2);
    this.pauseButtonBounds = new Phaser.Geom.Rectangle(W - 100, 92, 90, 30);
    this.glowGraphics = this.add.graphics().setDepth(-1);
    this.backgroundShader = null;

    if (this.game.renderer.type === Phaser.WEBGL) {
      const shaderKey = "dit-dah-play-background";
      this.cache.shader.add(shaderKey, new Phaser.Display.BaseShader(shaderKey, PLAY_BACKGROUND_SHADER));
      this.backgroundShader = this.add.shader(shaderKey, W / 2, H / 2, W, H).setDepth(-2);
    }

    this.elapsedSeconds = 0;
    this.previousTimestamp = performance.now() / 1e3;

    this.noteIndex = 0;
    /** @type {MorseSignalNote[]} */
    this.notes = [];
    this.quality = 100;
    this.score = 1;
    /** @type {MorseSignalNote|null} */
    this.currentDash = null; // null; was 0
    this.currentPressTime = 0;

    this.input.keyboard.on("keydown", (event) => {
      if (event.code === "Escape" || event.code === "KeyP") {
        this.pauseGame();
        return;
      }
      if (!event.repeat) this.handlePress(this.gameTimeFromEvent(event.timeStamp));
    });
    this.input.keyboard.on("keyup", (event) => this.handleRelease(this.gameTimeFromEvent(event.timeStamp)));
    this.input.on("pointerdown", (pointer) => {
      if (this.pauseButtonBounds.contains(pointer.x, pointer.y)) {
        this.pauseGame();
        return;
      }
      this.handlePress(this.gameTimeFromEvent(pointer.event.timeStamp));
    });
    this.input.on("pointerup", (pointer) => this.handleRelease(this.gameTimeFromEvent(pointer.event.timeStamp)));

    this.scheduleWord();
  }

  update() {
    {
      const now = performance.now() / 1e3;
      const previousElapsed = this.elapsedSeconds;
      this.elapsedSeconds = Math.min(now - this.previousTimestamp, this.elapsedSeconds + 0.1);
      this.previousTimestamp = now - this.elapsedSeconds;
      const deltaSeconds = this.elapsedSeconds - previousElapsed;

      {
        while (
          this.notes[this.noteIndex] &&
          this.notes[this.noteIndex] !== this.currentDash &&
          this.elapsedSeconds > this.notes[this.noteIndex].on + HIT_WINDOW_SECONDS
        ) {
          this.resolveNote(this.notes[[this.noteIndex]], false);
        }

        if (this.currentDash && this.elapsedSeconds - this.currentPressTime > DASH_FORCE_RESOLVE_SECONDS) {
          const hit = this.currentDash.dash ? true : false;
          this.resolveNote(this.currentDash, hit);
          this.currentDash = null;
        }

        if (this.noteIndex >= this.notes.length && this.elapsedSeconds > this.notes.at(-1).on + 1) {
          if (
            this.unlockedLetterCount < 12 &&
            [...LETTER_ORDER.slice(0, this.unlockedLetterCount)].every(isMastered)
          ) {
            this.unlockedLetterCount += 4;
          }
          this.scheduleWord();
        }
      }

      this.quality = Math.min(100, this.quality + deltaSeconds * 2);
      if (this.quality <= 0) {
        SFX.over(this);
        this.scene.start("Over", { score: this.score });
        return;
      }
    }

    {
      const gateY = 210;
      const gateHeight = 90;
      this.graphics.clear().fillStyle(0xffffff).fillRect(TIMING_LINE_X, gateY, 2, gateHeight);
      const upcomingNote = this.notes[this.noteIndex];
      const proximity = upcomingNote
        ? 1 - Phaser.Math.Clamp(Math.abs(upcomingNote.on - this.elapsedSeconds) / HIT_WINDOW_SECONDS, 0, 1)
        : 0;
      this.glowGraphics.clear();
      if (upcomingNote) {
        this.glowGraphics
          .fillStyle(0xffbb44, 0.04 + proximity * 0.14)
          .fillRect(TIMING_LINE_X - 12, gateY - 6, 26, gateHeight + 12);
      }
      for (const note of this.notes) {
        const noteX = Math.round(TIMING_LINE_X + (note.on - this.elapsedSeconds) * 120);
        const isVisible = noteX > -40 && noteX < 520;
        const labelY = gateY + gateHeight / 2 + 20;
        const shouldHideMasteredLabel = HIDE_MASTERED_LABELS && isMastered(note.letter);
        if (note.label) note.label.setPosition(noteX - 10, labelY).setVisible(isVisible && !shouldHideMasteredLabel);
        if (!isVisible) continue;
        this.graphics.fillStyle(note.done === 1 ? 0x44aa44 : note.done === 2 ? 0xaa4444 : 0xffbb44);
        if (note.dash) this.graphics.fillRect(noteX - 20, gateY + 15, 40, 16);
        else this.graphics.fillCircle(noteX, gateY + 23, 8);
      }
      this.statusText.setText(`score ${this.score}    quality ${this.quality | 0}    letters ${LETTER_ORDER.slice(0, this.unlockedLetterCount)}`)
      if (this.backgroundShader) this.backgroundShader.setUniform("time", this.elapsedSeconds);
    }
  }

  scheduleWord() {
    this.notes.forEach((note) => note.label && note.label.destroy());
    const unlockedLetters = LETTER_ORDER.slice(0, this.unlockedLetterCount);
    const eligibleWords = WORDS.filter((word) => [...word].every((letter) => unlockedLetters.includes(letter)));
    let nextNoteTime = this.elapsedSeconds + 2;
    this.notes = [];
    this.noteIndex = 0;

    for (const letter of eligibleWords[Math.random() * eligibleWords.length | 0]) {
      [...MORSE_CODE[letter]].forEach((signal, signalIndex) => {
        /** @type {MorseSignalNote} */
        const note = { letter, on: nextNoteTime, dash: signal === "-" };
        if (!signalIndex) note.label = this.add.text(0, 245, letter + " " + MORSE_CODE[letter], { ...FONT, color: COLOR.FG });
        this.notes.push(note);
        nextNoteTime += BEAT_SECONDS;
      });
      nextNoteTime += BEAT_SECONDS;
    }
    const word = this.notes.map((note) => note.letter)
      .filter((letter, index, letters) => index === 0 || letter !== letters[index - 1])
      .join("");
    this.wordHistory.push(word);
    this.wordHistory = this.wordHistory.slice(-WORD_HISTORY_LIMIT);
    this.wordHistoryText.setText(this.wordHistory.join("\n"));
  }

  handlePress(eventTime) {
    if (this.currentDash) return;

    /**@type { MorseSignalNote }*/
    const note = this.notes[this.noteIndex];
    if (!note || Math.abs(eventTime - note.on) >= HIT_WINDOW_SECONDS) return;

    if (note.dash) {
      SFX.dah(this);
      this.currentDash = note;
      this.currentPressTime = eventTime;
      return;
    }

    // A dot is only valid if released quickly. If the press is held long enough
    // to behave like a dash, it should count as a miss instead of passing.
    SFX.dit(this);
    this.currentDash = note;
    this.currentPressTime = eventTime;
  }

  handleRelease(eventTime) {
    if (!this.currentDash) return;

    const holdTime = eventTime - this.currentPressTime;
    const hit = this.currentDash.dash
      ? holdTime >= DASH_MIN_SECONDS
      : holdTime <= DOT_MAX_SECONDS;

    this.resolveNote(this.currentDash, hit);
    this.currentDash = null;
    this.currentPressTime = 0;
  }

  pauseGame() {
    this.scene.launch("Pause");
    this.scene.pause();
  }

  /**
   * @param {MorseSignalNote} note 
   * @param {boolean} hit 
   */
  resolveNote(note, hit) {
    const stats = statsFor(note.letter);
    stats.attempts++;
    if (hit) {
      stats.hits++;
      this.score += 10;
      SFX.good(this);
    } else {
      this.quality -= 10;
      SFX.miss(this);
      this.cameras.main.shake(100, 0.004);
    }
    note.done = hit ? 1 : 2;
    this.noteIndex++;
  }

  // NOTE: Native timestamps avoid adding the frame delay from Phaser's input queue.
  gameTimeFromEvent(timestamp) {
    return (timestamp > 1e12 ? performance.now() : timestamp) / 1e3 - this.previousTimestamp;
  }
}

// --- SCENE: Pause ---

class Pause extends Phaser.Scene {
  constructor() { super("Pause"); }

  create() {
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.78);
    this.add.text(W / 2, 220, "LINE PAUSED", {
      ...FONT, fontSize: "28px", color: COLOR.FG, fontStyle: "bold",
    }).setOrigin(0.5);

    const resume = () => {
      const playScene = this.scene.get("Play");
      playScene.previousTimestamp = performance.now() / 1e3 - playScene.elapsedSeconds;
      this.scene.stop();
      this.scene.resume("Play");
    };
    makeActionButton(this, W / 2, 320, "RESUME", resume);
    makeActionButton(this, W / 2, 380, "MAIN MENU", () => {
      this.scene.stop("Play");
      this.scene.start("Menu");
    });

    this.input.keyboard.on("keydown", (event) => {
      if (event.code === "Escape" || event.code === "KeyP") resume();
      if (event.code === "KeyM") {
        this.scene.stop("Play");
        this.scene.start("Menu");
      }
    });
  }
}

/**
 * 
 * @param {string} letter 
 * @returns {LetterStat}
 */
const statsFor = (letter) => letterStats[letter] || (letterStats[letter] = { attempts: 0, hits: 0 });

/**
 * @param {string} letter 
 * @returns {boolean}
 */
const isMastered = (letter) => {
  /** @type {LetterStat} */
  const stats = statsFor(letter);
  return stats.attempts >= 5 && stats.hits / stats.attempts >= 0.75;
}

// --- SCENE: Over ---

class Over extends Phaser.Scene {
  constructor() { super("Over"); }

  init(data) {
    this.finalScore = data.score ?? 0;
  }

  create() {
    this.cameras.main.setBackgroundColor(COLOR.BG);

    this.add.text(W / 2, 65 + 50 * 0, "LINE DEAD", { ...FONT, fontSize: "28px", color: COLOR.FG }).setOrigin(0.5);
    this.add.text(W / 2, 65 + 50 * 1, `FINAL SCORE ${this.finalScore}`, { ...FONT, color: COLOR.FG }).setOrigin(0.5);

    makeActionButton(this, W / 2, 300, "RETRY", () => this.scene.start("Play"));
    makeActionButton(this, W / 2, 360, "MENU", () => this.scene.start("Menu"));

    this.input.keyboard.once("keydown-SPACE", () => this.scene.start("Play"));
    this.input.keyboard.once("keydown-M", () => this.scene.start("Menu"));
  }
}

// --- Entry Point Boot Game ---

new Phaser.Game(
  {
    type: Phaser.AUTO,
    width: W,
    height: H,
    backgroundColor: COLOR.BG,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [Menu, Tutorial, Play, Pause, Over],
  }
);