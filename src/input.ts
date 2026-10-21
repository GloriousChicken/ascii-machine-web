/**
 * Turning pointer and keyboard events into things the sea understands.
 *
 * The three gestures match the terminal app exactly: a soft wake when the
 * pointer moves, a pulse when it is pressed, and a plume when it is dragged.
 * The strengths and radii are the same numbers, so the sea behaves the same
 * way in both.
 */

/** How strongly a plain pointer move disturbs the sea, compared to a click. */
export const HOVER_STRENGTH = 0.22;

/** How strongly a click or a drag disturbs it. */
export const STIR_STRENGTH = 1.0;

/** The radius of a click or a drag, in cells. */
export const STIR_RADIUS = 4;

/** The radius of a hover, in cells. */
export const HOVER_RADIUS = 2.5;

/** A disturbance to apply to the sea. */
export interface Stir {
  x: number;
  y: number;
  strength: number;
  radius: number;
}

/** What the input layer reports back to the app. */
export type InputAction =
  | { kind: "stir"; stir: Stir }
  | { kind: "key"; key: string };

export interface InputHandlers {
  /** Apply a disturbance to the sea. */
  onStir(stir: Stir): void;
  /** A key was pressed. */
  onKey(key: string): void;
}

export interface InputOptions {
  /** The canvas the pointer events land on. */
  canvas: HTMLCanvasElement;
  /** The width of one cell, in pixels. */
  cellWidth: number;
  /** The height of one cell, in pixels. */
  cellHeight: number;
  /** How many rows the sea occupies; rows below this are the status line. */
  seaRows: number;
}

/**
 * The input layer.
 *
 * It listens for pointer and keyboard events and turns them into stirs and
 * key presses.
 */
export class Input {
  private canvas: HTMLCanvasElement;
  private handlers: InputHandlers;
  private options: InputOptions;
  private dragging = false;
  private disposers: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, handlers: InputHandlers) {
    this.canvas = canvas;
    this.handlers = handlers;
    this.options = { canvas, cellWidth: 1, cellHeight: 1, seaRows: 1 };
  }

  /** Update the metrics used to turn pixels into cells. */
  configure(options: InputOptions): void {
    this.options = options;
  }

  /** Start listening. */
  attach(): void {
    const canvas = this.canvas;

    const onPointerDown = (event: PointerEvent) => {
      this.dragging = true;
      // Capture the pointer so a drag continues even when the pointer
      // leaves the canvas.
      canvas.setPointerCapture(event.pointerId);
      this.stirAt(event, STIR_STRENGTH, STIR_RADIUS);
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (this.dragging) {
        this.stirAt(event, STIR_STRENGTH, STIR_RADIUS);
      } else {
        this.stirAt(event, HOVER_STRENGTH, HOVER_RADIUS);
      }
      event.preventDefault();
    };

    const onPointerUp = (event: PointerEvent) => {
      this.dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    const onPointerLeave = () => {
      this.dragging = false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      this.handlers.onKey(event.key);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("keydown", onKeyDown);

    this.disposers.push(() => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("keydown", onKeyDown);
    });
  }

  /** Stop listening. */
  detach(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }

  /**
   * Turn a pointer position into a cell and stir there.
   *
   * The pointer can be between cells, so the position is not snapped: the
   * disturbance is centred on the exact spot, which the terminal cannot do
   * because a terminal only knows which cell the pointer is in.
   */
  private stirAt(event: PointerEvent, strength: number, radius: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / this.options.cellWidth;
    const y = (event.clientY - rect.top) / this.options.cellHeight;

    // The status line is not part of the sea.
    if (y >= this.options.seaRows) return;

    this.handlers.onStir({ x, y, strength, radius });
  }
}
