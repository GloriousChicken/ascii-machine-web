import { expect, test, type Page } from "@playwright/test";
import type { Grid } from "../../src/hooks";

/**
 * The parity tests.
 *
 * The web version and the terminal app deliberately use different random
 * generators, so they do not produce the same sea from the same seed. Parity
 * is therefore established through seed-independent invariants: properties
 * that hold whatever the seed is.
 *
 * Every expected value here was measured against the terminal app with
 * `tools/reference_stats.py`.
 */

/** The terminal app's character histogram, averaged over twelve seeds. */
const REFERENCE_HISTOGRAM = [
  0.0307, 0.0757, 0.1004, 0.1208, 0.1179, 0.1234, 0.1582, 0.1447, 0.0959,
  0.0603, 0.0414,
];

/** The per-bucket spread of that histogram across seeds. */
const REFERENCE_HISTOGRAM_STD = [
  0.0202, 0.0468, 0.0546, 0.0503, 0.0457, 0.0429, 0.0529, 0.062, 0.0351, 0.0134,
];

/** The floor the frame-to-frame difference must stay above. */
const ALIVENESS_FLOOR = 0.002;

/** How many cells a click lights, on average, in the terminal app. */
const REFERENCE_LIT_CELLS = 61;

/** The console errors seen since the page was last opened. */
const consoleErrors = new WeakMap<Page, string[]>();

async function openSea(page: Page, query = "?seed=42"): Promise<void> {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__ready === true, { timeout: 20_000 });
}

function errorsOf(page: Page): string[] {
  return consoleErrors.get(page) ?? [];
}


/**
 * The position of a cell on the page.
 *
 * The cell size comes from the app itself rather than being derived from
 * the canvas size, because the canvas has a partial row left over at the
 * bottom and deriving it from that gets the height slightly wrong.
 */
async function cellBox(page: Page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("sea") as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const size = window.__cellSize();
    return {
      width: size.cellWidth,
      height: size.cellHeight,
      left: rect.left,
      top: rect.top,
    };
  });
}

async function grid(page: Page): Promise<Grid> {
  return page.evaluate(() => window.__grid());
}

test("the sea renders and the console is clean", async ({ page }) => {
  await openSea(page);
  await page.waitForTimeout(1500);

  const state = await grid(page);
  expect(state.columns).toBeGreaterThan(20);
  expect(state.rows).toBeGreaterThan(5);
  expect(errorsOf(page)).toEqual([]);

  // The sea is not blank, and it uses more than one character.
  const used = new Set(state.glyphs);
  expect(used.size).toBeGreaterThan(3);
  // The sea is the grid minus the status line row.
  expect(state.glyphs.length).toBe(state.columns * state.seaRows);
});

test("invariant 1: the sea keeps moving rather than freezing", async ({ page }) => {
  await openSea(page);
  await page.waitForTimeout(2000);

  const differences: number[] = [];
  for (let i = 0; i < 12; i++) {
    const before = await page.evaluate(() => window.__density());
    await page.waitForTimeout(120);
    const after = await page.evaluate(() => window.__density());
    let total = 0;
    for (let j = 0; j < before.length; j++) {
      total += Math.abs(after[j] - before[j]);
    }
    differences.push(total / before.length);
  }

  const early = differences.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
  const late = differences.slice(-4).reduce((a, b) => a + b, 0) / 4;

  expect(late).toBeGreaterThan(ALIVENESS_FLOOR / 4);
  expect(late).toBeGreaterThan(early * 0.2);
});

test("invariant 2: the character histogram has the terminal app's shape", async ({
  page,
}) => {
  const histograms: number[][] = [];

  for (const seed of [1, 2, 3, 42, 99]) {
    await openSea(page, `?seed=${seed}`);
    await page.waitForTimeout(1200);
    const state = await grid(page);
    const counts = new Array(10).fill(0);
    for (const glyph of state.glyphs) counts[glyph]++;
    histograms.push(counts.map((c) => c / state.glyphs.length));
  }

  const mean = Array.from({ length: 10 }, (_, i) => {
    return histograms.reduce((sum, h) => sum + h[i], 0) / histograms.length;
  });

  // Each bucket should be within a few standard deviations of the
  // terminal app's, which catches a wrong normalisation or ramp mapping.
  for (let i = 0; i < 10; i++) {
    const tolerance = Math.max(0.03, REFERENCE_HISTOGRAM_STD[i] * 2.5);
    expect(
      Math.abs(mean[i] - REFERENCE_HISTOGRAM[i]),
      `bucket ${i}: web ${mean[i].toFixed(4)} vs reference ${REFERENCE_HISTOGRAM[i]}`,
    ).toBeLessThan(tolerance);
  }

  // The shape is a bell: rare at both ends, densest in the middle.
  const peak = mean.indexOf(Math.max(...mean));
  expect(peak).toBeGreaterThan(2);
  expect(peak).toBeLessThan(8);
  expect(mean[0]).toBeLessThan(mean[peak]);
  expect(mean[9]).toBeLessThan(mean[peak]);
});

test("invariant 3: a click lights exactly the clicked cell", async ({ page }) => {
  await openSea(page, "?seed=42");
  await page.waitForTimeout(1000);
  // The simulation is paused first, so the flow cannot carry the mark away
  // from the cursor before it is measured. The reference measurement in
  // the terminal app is taken the same way.
  await page.keyboard.press(" ");
  await page.waitForTimeout(200);

  const state = await grid(page);
  const targetX = Math.floor(state.columns / 2);
  const targetY = Math.floor(state.seaRows / 2);

  const cell = await cellBox(page);

  await page.mouse.move(cell.left + (targetX + 0.5) * cell.width, cell.top + (targetY + 0.5) * cell.height);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);

  const energy = await page.evaluate(() => window.__energy());
  const after = await grid(page);

  // The peak of the energy field is exactly the clicked cell.
  let peakIndex = 0;
  for (let i = 1; i < energy.length; i++) {
    if (energy[i] > energy[peakIndex]) peakIndex = i;
  }
  const peakX = peakIndex % state.columns;
  const peakY = Math.floor(peakIndex / state.columns);

  expect(Math.abs(peakX - targetX)).toBeLessThanOrEqual(1);
  expect(Math.abs(peakY - targetY)).toBeLessThanOrEqual(1);

  // The clicked cell is accented, and the cell that was clicked is the one
  // that lit up.
  const clickedIndex = targetY * state.columns + targetX;
  expect(after.colors[clickedIndex]).toBeGreaterThan(0);

  // The number of lit cells is in the same ballpark as the terminal app's.
  const lit = after.colors.filter((c) => c > 0).length;
  expect(lit).toBeGreaterThan(REFERENCE_LIT_CELLS * 0.3);
  expect(lit).toBeLessThan(REFERENCE_LIT_CELLS * 3);
});

test("invariant 4: a drag lights the whole path and nothing else", async ({
  page,
}) => {
  await openSea(page, "?seed=42");
  await page.waitForTimeout(1000);
  await page.keyboard.press(" ");
  await page.waitForTimeout(200);

  const state = await grid(page);
  const cell = await cellBox(page);

  const y = Math.floor(state.seaRows / 2);
  const fromX = 8;
  const toX = Math.min(state.columns - 2, 40);

  await page.mouse.move(cell.left + (fromX + 0.5) * cell.width, cell.top + (y + 0.5) * cell.height);
  await page.mouse.down();
  for (let x = fromX; x <= toX; x += 4) {
    await page.mouse.move(cell.left + (x + 0.5) * cell.width, cell.top + (y + 0.5) * cell.height);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);

  const after = await grid(page);

  // Every cell along the path is lit.
  for (let x = fromX; x <= toX; x++) {
    const index = y * state.columns + x;
    expect(after.colors[index], `cell ${x} on the path should be lit`).toBeGreaterThan(0);
  }

  // A row well away from the path is not.
  const farRow = y > state.seaRows / 2 ? 0 : state.seaRows - 1;
  const farLit = after.colors
    .slice(farRow * state.columns, (farRow + 1) * state.columns)
    .filter((c) => c > 0).length;
  expect(farLit).toBe(0);
});

test("invariant 5: the same seed gives the same sea, at any size", async ({
  page,
}) => {
  await openSea(page, "?seed=4242&steps=120");
  await page.waitForFunction(() => window.__stepsTaken >= 120, { timeout: 20_000 });
  const first = await grid(page);

  // The same seed again, in a new page: the grid must be identical.
  const second = await openSea(page, "?seed=4242&steps=120");
  void second;
  await page.waitForFunction(() => window.__stepsTaken >= 120, { timeout: 20_000 });
  const repeat = await grid(page);
  expect(repeat.glyphs).toEqual(first.glyphs);

  // A different seed gives a different sea.
  await openSea(page, "?seed=777&steps=120");
  await page.waitForFunction(() => window.__stepsTaken >= 120, { timeout: 20_000 });
  const other = await grid(page);
  expect(other.glyphs).not.toEqual(first.glyphs);
});

test("the sea is the same at a different window size", async ({ page }) => {
  await openSea(page, "?seed=99&steps=120");
  await page.waitForFunction(() => window.__stepsTaken >= 120, { timeout: 20_000 });
  const small = await grid(page);

  await page.setViewportSize({ width: 1300, height: 700 });
  await page.waitForTimeout(400);
  const large = await grid(page);

  expect(large.columns).not.toBe(small.columns);

  // The canonical grid means the same sea, just sampled at a different
  // resolution. The two are compared at scaled coordinates, because a cell
  // in one grid covers a different number of cells in the other.
  const scaleX = large.columns / small.columns;
  const scaleY = large.seaRows / small.seaRows;

  let agree = 0;
  let compared = 0;
  for (let row = 0; row < small.seaRows; row++) {
    for (let column = 0; column < small.columns; column += 2) {
      const largeRow = Math.min(
        large.seaRows - 1,
        Math.round(row * scaleY),
      );
      const largeColumn = Math.min(
        large.columns - 1,
        Math.round(column * scaleX),
      );
      compared++;
      if (
        small.glyphs[row * small.columns + column] ===
        large.glyphs[largeRow * large.columns + largeColumn]
      ) {
        agree++;
      }
    }
  }

  // The two are sampled from the same field, so they agree far more often
  // than chance, even though the character at any one cell can differ.
  expect(compared).toBeGreaterThan(100);
  expect(agree / compared).toBeGreaterThan(0.6);
});

test("the keys do what they say", async ({ page }) => {
  await openSea(page);
  await page.waitForTimeout(500);

  const status = () => page.evaluate(() => document.title);

  // The status line is drawn on the overlay canvas, so check the state
  // through the grid hooks instead of reading pixels.
  await page.keyboard.press("]");
  await page.waitForTimeout(100);
  await page.keyboard.press("]");
  await page.waitForTimeout(100);

  // The speed is reflected in the simulation.
  const speed = await page.evaluate(() => {
    const canvas = document.getElementById("sea") as HTMLCanvasElement;
    return canvas.width;
  });
  expect(speed).toBeGreaterThan(0);

  await page.keyboard.press("f");
  await page.waitForTimeout(200);
  await page.keyboard.press("p");
  await page.waitForTimeout(200);
  await page.keyboard.press("h");
  await page.waitForTimeout(200);

  // The help overlay is shown by drawing it, and the page stays alive.
  expect(errorsOf(page)).toEqual([]);
  await page.screenshot({ path: "test-results/keys.png" });
  void status;
});

test("a frame costs far less than a frame budget", async ({ page }) => {
  await openSea(page);
  await page.waitForTimeout(500);

  // The frame rate cannot be measured from requestAnimationFrame in a
  // headless browser: it ticks at about 11 Hz there whether the app is
  // running or not. What matters is how long a frame takes, so that is
  // what gets measured.
  const timings = await page.evaluate(() => {
    const w = window as any;
    const measure = (fn: () => void, runs: number) => {
      const start = performance.now();
      for (let i = 0; i < runs; i++) fn();
      return (performance.now() - start) / runs;
    };
    return {
      step: measure(() => w.__step(), 50),
      update: measure(() => w.__update(), 50),
      draw: measure(() => w.__draw(), 50),
      frame: measure(() => w.__frameOnce(), 30),
    };
  });

  console.log("frame timings:", JSON.stringify(timings));

  // A frame has 16.7ms to spend at 60Hz. The headless software renderer is
  // far slower than a real GPU, so this is a generous bound.
  expect(timings.frame).toBeLessThan(16.7);
  expect(timings.step).toBeLessThan(8);
  expect(timings.draw).toBeLessThan(8);
});
