/**
 * The status line, the help overlay, and saving a frame.
 *
 * The status line sits in the last row of the grid, the way the terminal
 * app's footer does, so the two look the same.
 */

import { FONT_FAMILY, FONT_SIZE } from "./renderer";

/** The text of the status line. */
export function statusText(options: {
  speed: number;
  ramp: string;
  palette: string;
  paused: boolean;
}): string {
  const state = options.paused ? "PAUSED" : "running";
  return ` speed ${options.speed.toFixed(2)}x | ramp ${options.ramp} | palette ${options.palette} | ${state} `;
}

/** The help text, listing the keys. */
export const HELP_TEXT = [
  "space  pause / resume",
  "r      reset the sea",
  "s      save the frame as a png",
  "[ ]    flow speed down / up",
  "f      cycle the glyph ramp",
  "p      cycle the accent palette",
  "h      toggle this help",
];

/** How many rows the help overlay takes when it is shown. */
export const HELP_ROWS = HELP_TEXT.length + 1;

/**
 * Draw the status line and the help overlay onto a 2d context.
 *
 * This is a separate canvas layered over the sea, so the sea itself stays
 * entirely in WebGL.
 */
export class Overlay {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("could not get a 2d context for the overlay");
    this.context = context;
  }

  /** Match the overlay canvas to the sea canvas. */
  resize(width: number, height: number, ratio: number): void {
    this.canvas.width = Math.floor(width * ratio);
    this.canvas.height = Math.floor(height * ratio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /**
   * Draw the overlay.
   *
   * The status line goes in the last row of the sea, and the help overlay
   * sits over the rows above it.
   */
  draw(options: {
    cellWidth: number;
    cellHeight: number;
    columns: number;
    seaRows: number;
    status: string;
    showHelp: boolean;
    ratio: number;
  }): void {
    const context = this.context;
    const { cellWidth, cellHeight, columns, seaRows, ratio } = options;

    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
    context.textBaseline = "middle";

    if (options.showHelp) {
      const height = HELP_TEXT.length * cellHeight * ratio;
      const width = columns * cellWidth * ratio;
      const top = (seaRows - HELP_TEXT.length) * cellHeight * ratio;

      context.fillStyle = "rgba(16, 16, 16, 0.92)";
      context.fillRect(0, top, width, height);

      context.fillStyle = "#e8e8e8";
      HELP_TEXT.forEach((line, index) => {
        context.fillText(
          line,
          6 * ratio,
          top + (index + 0.5) * cellHeight * ratio,
        );
      });
    }

    // The status line, in the last row of the sea.
    const statusTop = seaRows * cellHeight * ratio;
    context.fillStyle = "rgba(16, 16, 16, 0.92)";
    context.fillRect(
      0,
      statusTop,
      this.canvas.width,
      cellHeight * ratio,
    );

    context.fillStyle = "#b8b8b8";
    context.fillText(
      options.status,
      4 * ratio,
      statusTop + (cellHeight * ratio) / 2,
    );
  }
}

/**
 * Offer the current frame as a PNG download.
 *
 * This is the browser's equivalent of the terminal app's `s` key, which
 * writes a text and an ANSI file.
 */
export function downloadPng(canvas: HTMLCanvasElement, name: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
