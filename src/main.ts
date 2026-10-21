/**
 * ascii-machine, in a browser.
 *
 * A flow field carries a density of characters across the screen. The mouse
 * disturbs it: moving leaves a faint wake, clicking drops a pulse, dragging
 * ploughs a plume through the current.
 *
 * The simulation runs on a fixed canonical grid and is resampled to the
 * display, so a seed means the same sea at any window size.
 */

import "@fontsource/jetbrains-mono/400.css";
import "./style.css";
import "./hooks";

import { Input, type Stir } from "./input";
import { accentIndex, glyphIndex, paletteNames, rampNames } from "./palette";
import { Renderer } from "./renderer";
import {
  CANONICAL_HEIGHT,
  CANONICAL_WIDTH,
  percentile,
  resizeField,
  Simulation,
} from "./simulation";
import { downloadPng, HELP_ROWS, Overlay, statusText } from "./ui";

/** The simulation advances on a fixed clock, not on the frame rate. */
const STEP_SECONDS = 1 / 60;

/** Never run more than this many simulation steps for one frame. */
const MAX_STEPS_PER_FRAME = 3;

const canvas = document.getElementById("sea") as HTMLCanvasElement;
const overlayCanvas = document.getElementById("overlay") as HTMLCanvasElement;
const overlay = new Overlay(overlayCanvas);

/**
 * The seed.
 *
 * It comes from the URL when there is one, so a link reproduces an exact
 * sea. Otherwise one is made and put in the URL, so the address bar always
 * describes what is on screen.
 */
function readSeed(): number {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("seed");
  if (raw !== null && raw !== "") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed >>> 0;
  }
  const generated = Math.floor(Math.random() * 0xffffffff) >>> 0;
  const next = new URLSearchParams(window.location.search);
  next.set("seed", String(generated));
  window.history.replaceState(null, "", `?${next.toString()}`);
  return generated;
}

/**
 * A fixed number of steps to run before stopping.
 *
 * This is a test hook: it makes the grid deterministic, so it can be
 * compared between runs and between window sizes.
 */
function readStepLimit(): number | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("steps");
  if (raw === null || raw === "") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const seed = readSeed();
const stepLimit = readStepLimit();

const simulation = new Simulation(CANONICAL_HEIGHT, CANONICAL_WIDTH, seed);
const renderer = new Renderer(canvas, "classic", "ember");

let paused = false;
let showHelp = false;
let speed = 1;
let ramp = "classic";
let palette = "ember";
let accumulator = 0;
let lastTime = performance.now();
let stepsTaken = 0;

/** The grid as it is displayed, resampled from the canonical grid. */
let displayDensity: Float32Array = new Float32Array(0);
let displayEnergy: Float32Array = new Float32Array(0);
let glyphs: Uint8Array = new Uint8Array(0);
let colors: Uint8Array = new Uint8Array(0);

function resizeCanvas(): void {
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  overlay.resize(width, height, ratio);

  if (renderer.resize(canvas)) {
    // The number of cells changed, so the buffers have to grow and the
    // simulation has to be shown at the new size.
    const { columns, rows } = renderer.gridSize;
    glyphs = new Uint8Array(columns * rows);
    colors = new Uint8Array(columns * rows);
    updateDisplay();
  }
}

/** How many rows the sea occupies; the rest is the status line. */
function seaRows(): number {
  const { rows } = renderer.gridSize;
  return Math.max(1, rows - 1);
}

/**
 * Apply a disturbance to the display grid.
 *
 * The mark lands exactly under the cursor, which is what makes the
 * interaction feel direct.
 */
function stirDisplay(x: number, y: number, radius: number): void {
  const { columns } = renderer.gridSize;
  const height = seaRows();
  const x0 = Math.max(0, Math.floor(x - radius));
  const x1 = Math.min(columns, Math.floor(x + radius) + 1);
  const y0 = Math.max(0, Math.floor(y - radius));
  const y1 = Math.min(height, Math.floor(y + radius) + 1);
  if (x0 >= x1 || y0 >= y1) return;

  const radiusSquared = radius * radius;
  for (let row = y0; row < y1; row++) {
    for (let col = x0; col < x1; col++) {
      const dx = col - x;
      const dy = row - y;
      const falloff = Math.exp(-(dx * dx + dy * dy) / radiusSquared);
      const index = row * columns + col;
      if (falloff > displayEnergy[index]) displayEnergy[index] = falloff;
    }
  }
}

/**
 * Resample the canonical simulation to the display grid.
 *
 * The display energy is preserved when `keepEnergy` is set, because a
 * disturbance is stamped onto it directly.
 */
function updateDisplay(keepEnergy = false): void {
  const { columns } = renderer.gridSize;
  const height = seaRows();

  displayDensity = resizeField(
    simulation.density,
    CANONICAL_HEIGHT,
    CANONICAL_WIDTH,
    height,
    columns,
  );
  if (!keepEnergy) {
    displayEnergy = resizeField(
      simulation.energy,
      CANONICAL_HEIGHT,
      CANONICAL_WIDTH,
      height,
      columns,
    );
  }

  // Normalize so the sea always uses the full range of the ramp, whatever
  // the current density happens to be.
  const low = percentile(displayDensity, 2);
  const high = percentile(displayDensity, 98);
  const span = Math.max(high - low, 1e-6);
  const normalized = new Float32Array(displayDensity.length);
  for (let i = 0; i < displayDensity.length; i++) {
    const value = (displayDensity[i] - low) / span;
    normalized[i] = value < 0 ? 0 : value > 1 ? 1 : value;
  }

  glyphs = glyphIndex(normalized, ramp);
  colors = accentIndex(displayEnergy);
}

/** Draw everything. */
function draw(): void {
  renderer.draw(canvas, glyphs, colors);

  const { cellWidth, cellHeight } = renderer.cellMetrics;
  const { columns } = renderer.gridSize;
  overlay.draw({
    cellWidth,
    cellHeight,
    columns,
    seaRows: seaRows(),
    status: statusText({ speed, ramp, palette, paused }),
    showHelp,
    ratio: window.devicePixelRatio || 1,
  });
}

const input = new Input(canvas, {
  onStir(stir: Stir) {
    // The disturbance is applied to the display grid, not the canonical
    // one. The pointer knows where it is in display cells, and resampling
    // the canonical field would blur and shift the mark away from the
    // cursor. The canonical field still gets stirred, so the flow carries
    // the disturbance onwards, but the visible mark is exact.
    const { columns } = renderer.gridSize;
    const height = seaRows();

    stirDisplay(stir.x, stir.y, stir.radius);
    simulation.stir(
      (stir.x / columns) * CANONICAL_WIDTH,
      (stir.y / height) * CANONICAL_HEIGHT,
      stir.strength,
      stir.radius * (CANONICAL_WIDTH / columns),
    );
    // The energy has already been stamped on the display, so it is kept.
    updateDisplay(true);
  },
  onKey(key: string) {
    switch (key) {
      case " ":
        paused = !paused;
        break;
      case "r":
        simulation.reset();
        break;
      case "s":
        downloadPng(canvas, `ascii-machine-${seed}.png`);
        break;
      case "[":
        speed = Math.max(0.25, speed - 0.25);
        simulation.speed = speed;
        break;
      case "]":
        speed = Math.min(3, speed + 0.25);
        simulation.speed = speed;
        break;
      case "f": {
        const names = rampNames();
        ramp = names[(names.indexOf(ramp) + 1) % names.length];
        renderer.setRamp(ramp);
        break;
      }
      case "p": {
        const names = paletteNames();
        palette = names[(names.indexOf(palette) + 1) % names.length];
        renderer.setPalette(palette);
        break;
      }
      case "h":
        showHelp = !showHelp;
        break;
      default:
        return;
    }
    updateDisplay();
  },
});

function frame(): void {
  const now = performance.now();
  const elapsed = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;

  if (!paused) {
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= STEP_SECONDS && steps < MAX_STEPS_PER_FRAME) {
      // The step limit is exact, so a run with a limit always ends on the
      // same step, which is what makes the grid reproducible.
      if (stepLimit !== null && stepsTaken >= stepLimit) break;
      simulation.step();
      accumulator -= STEP_SECONDS;
      steps++;
      stepsTaken++;
    }
    if (steps > 0) updateDisplay();
  }

  draw();

  // With a step limit the simulation stops once it is reached, which makes
  // the grid deterministic for testing.
  if (stepLimit === null || stepsTaken < stepLimit) {
    requestAnimationFrame(frame);
  } else {
    (window as unknown as Record<string, unknown>).__stepsTaken = stepsTaken;
  }
}

function boot(): void {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  const { cellWidth, cellHeight } = renderer.cellMetrics;
  input.configure({
    canvas,
    cellWidth,
    cellHeight,
    seaRows: seaRows(),
  });
  window.addEventListener("resize", () => {
    const metrics = renderer.cellMetrics;
    input.configure({
      canvas,
      cellWidth: metrics.cellWidth,
      cellHeight: metrics.cellHeight,
      seaRows: seaRows(),
    });
  });
  input.attach();

  updateDisplay();
  draw();
  requestAnimationFrame(frame);

  // Hooks for the tests: the grid as it is displayed, and the number of
  // simulation steps taken.
  const hook = window as unknown as Record<string, unknown>;
  hook.__grid = () => ({
    glyphs: Array.from(glyphs),
    colors: Array.from(colors),
    columns: renderer.gridSize.columns,
    rows: renderer.gridSize.rows,
    seaRows: seaRows(),
  });
  // The real cell size, so the tests do not have to derive it and get it
  // slightly wrong.
  hook.__cellSize = () => renderer.cellMetrics;
  // Profiling hooks, used by the tests to find out where the time goes.
  hook.__step = () => simulation.step();
  hook.__update = () => updateDisplay();
  hook.__draw = () => draw();
  hook.__frameOnce = () => {
    simulation.step();
    updateDisplay();
    draw();
  };
  hook.__energy = () => Array.from(displayEnergy);
  hook.__density = () => Array.from(displayDensity);
  hook.__seed = seed;
  hook.__helpRows = HELP_ROWS;
  hook.__ready = true;
}

boot();
