/**
 * The WebGL renderer.
 *
 * The sea is a grid of characters, and drawing it with Canvas 2D would mean
 * one text-shaping operation per cell every frame, which is thousands of
 * them. Instead the characters are rasterized once into a glyph atlas, and
 * each frame is a single instanced draw call: one quad per cell, sampling
 * the atlas.
 *
 * Each instance carries only where its cell is, which character to draw and
 * which colour to draw it in. Everything else is derived in the shader, so
 * the per-frame work is uploading a few hundred bytes of instance data and
 * one draw call.
 */

import {
  ACCENT_PALETTES,
  GLYPH_RAMPS,
  SEA_COLOR,
  type Rgb,
} from "./palette";

/** The font used for the sea, and its size in pixels. */
export const FONT_FAMILY =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
export const FONT_SIZE = 14;

/**
 * The vertical scale of the grid cells.
 *
 * Terminal cells are about twice as tall as they are wide, and a character
 * cell should look like one. The line height is set explicitly so the grid
 * is predictable rather than dependent on the font's default.
 */
export const LINE_HEIGHT = 1.85;

/** The background, matching the terminal app's default background. */
export const BACKGROUND: Rgb = { r: 24, g: 24, b: 24 };

const VERTEX_SHADER = `#version 300 es
precision highp float;

// The corner of the unit quad, shared by every cell.
layout(location = 0) in vec2 a_corner;
// The cell's position in grid units.
layout(location = 1) in vec2 a_cell;
// The glyph index and the colour index.
layout(location = 2) in vec2 a_glyph;

uniform vec2 u_gridSize;   // cells across, cells down
uniform vec2 u_cellSize;   // pixels per cell
uniform vec2 u_atlasCells; // glyphs per atlas row

out vec2 v_uv;
flat out int v_color;

void main() {
  vec2 pixel = (a_cell + a_corner) * u_cellSize;
  vec2 normalized = pixel / (u_gridSize * u_cellSize);
  gl_Position = vec4(normalized.x * 2.0 - 1.0, 1.0 - normalized.y * 2.0, 0.0, 1.0);

  // The atlas is a grid of glyph cells. The glyph index gives the cell, and
  // the corner gives the position within it.
  float column = mod(a_glyph.x, u_atlasCells.x);
  float row = floor(a_glyph.x / u_atlasCells.x);
  v_uv = (vec2(column, row) + a_corner) / u_atlasCells;

  v_color = int(a_glyph.y);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
flat in int v_color;

uniform sampler2D u_atlas;
uniform vec3 u_colors[4]; // 0 sea, 1 to 3 accent levels

out vec4 outColor;

void main() {
  // The atlas is drawn with the canvas's own y axis, so it is flipped.
  float alpha = texture(u_atlas, vec2(v_uv.x, 1.0 - v_uv.y)).a;
  if (alpha < 0.01) discard;
  outColor = vec4(u_colors[v_color], alpha);
}`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader failed to compile: ${log}`);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("could not create a program");
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    throw new Error(`program failed to link: ${log}`);
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  return program;
}

/** A glyph atlas: every character of every ramp, rasterized once. */
interface Atlas {
  texture: WebGLTexture;
  columns: number;
  rows: number;
  /** The glyph index of the first character of each ramp. */
  rampStarts: Record<string, number>;
}

export interface GridMetrics {
  /** The width of one character cell, in pixels. */
  cellWidth: number;
  /** The height of one character cell, in pixels. */
  cellHeight: number;
  /** How many whole cells fit across the canvas. */
  columns: number;
  /** How many whole cells fit down the canvas. */
  rows: number;
}

/**
 * Measure the character cell from a real font.
 *
 * The width comes from the font's own advance for one character, and the
 * height from an explicit line height, so the grid is the same on every
 * machine.
 */
export function measureGrid(canvas: HTMLCanvasElement): GridMetrics {
  // The measurement happens on a separate canvas: once WebGL has claimed
  // one, it will not give back a 2d context.
  const scratch = document.createElement("canvas");
  const context = scratch.getContext("2d");
  if (!context) {
    throw new Error("could not get a 2d context to measure the font");
  }

  context.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  const metrics = context.measureText("M");
  const cellWidth = Math.max(1, Math.ceil(metrics.width));
  const cellHeight = Math.max(1, Math.round(FONT_SIZE * LINE_HEIGHT));

  return {
    cellWidth,
    cellHeight,
    columns: Math.max(1, Math.floor(canvas.width / cellWidth)),
    rows: Math.max(1, Math.floor(canvas.height / cellHeight)),
  };
}

/**
 * Rasterize every character of every ramp into a texture.
 *
 * The atlas is one row per ramp, so a ramp's characters are contiguous and
 * a grid cell only needs to know its ramp's starting index.
 */
function buildAtlas(
  gl: WebGL2RenderingContext,
  cellWidth: number,
  cellHeight: number,
): Atlas {
  const ramps = Object.keys(GLYPH_RAMPS);
  const rampStarts: Record<string, number> = {};
  let total = 0;
  for (const name of ramps) {
    rampStarts[name] = total;
    total += GLYPH_RAMPS[name].length;
  }

  const columns = Math.max(...ramps.map((name) => GLYPH_RAMPS[name].length));
  const rows = ramps.length;

  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = columns * cellWidth;
  atlasCanvas.height = rows * cellHeight;
  const context = atlasCanvas.getContext("2d");
  if (!context) {
    throw new Error("could not get a 2d context to build the atlas");
  }

  context.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  context.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  context.textBaseline = "alphabetic";
  context.fillStyle = "#ffffff";

  for (let row = 0; row < ramps.length; row++) {
    const name = ramps[row];
    const glyphs = GLYPH_RAMPS[name];
    for (let column = 0; column < glyphs.length; column++) {
      // The baseline is set so the glyph sits in the middle of its cell, the
      // way a terminal centres it.
      const x = column * cellWidth;
      const y = row * cellHeight + cellHeight / 2 + FONT_SIZE * 0.36;
      context.fillText(glyphs[column], x, y);
    }
  }

  const texture = gl.createTexture();
  if (!texture) throw new Error("could not create the atlas texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    atlasCanvas,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return { texture, columns, rows, rampStarts };
}

/** The renderer owns the GL context, the atlas and the instance buffers. */
export class Renderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private atlas: Atlas;
  private vao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;

  private columns: number;
  private rows: number;
  private cellWidth: number;
  private cellHeight: number;
  private ramp: string;
  private palette: string;

  /** The colour of every level: 0 is the sea, 1 to 3 are accent levels. */
  private colors = new Float32Array(4 * 3);

  constructor(canvas: HTMLCanvasElement, ramp: string, palette: string) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL 2 is not available");
    this.gl = gl;
    this.ramp = ramp;
    this.palette = palette;

    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);

    const metrics = measureGrid(canvas);
    this.columns = metrics.columns;
    this.rows = metrics.rows;
    this.cellWidth = metrics.cellWidth;
    this.cellHeight = metrics.cellHeight;

    this.atlas = buildAtlas(gl, this.cellWidth, this.cellHeight);

    this.vao = this.createVertexArray();
    this.instanceBuffer = this.createInstanceBuffer();
    this.updateColors();
  }

  private createVertexArray(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("could not create a vertex array");
    gl.bindVertexArray(vao);

    // The unit quad, shared by every cell.
    const quadBuffer = gl.createBuffer();
    if (!quadBuffer) throw new Error("could not create the quad buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
    return vao;
  }

  private createInstanceBuffer(): WebGLBuffer {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("could not create the instance buffer");

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    // Each instance carries its cell position, its glyph index and its
    // colour index.
    const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 2 * 4);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
    return buffer;
  }

  /** Change the glyph ramp, rebuilding the atlas. */
  setRamp(ramp: string): void {
    if (ramp === this.ramp) return;
    this.ramp = ramp;
    this.gl.deleteTexture(this.atlas.texture);
    this.atlas = buildAtlas(
      this.gl,
      this.cellWidth,
      this.cellHeight,
    );
  }

  /** Change the accent palette. */
  setPalette(palette: string): void {
    if (palette === this.palette) return;
    this.palette = palette;
    this.updateColors();
  }

  private updateColors(): void {
    const accent = ACCENT_PALETTES[this.palette].colors;
    this.colors.set([SEA_COLOR.r, SEA_COLOR.g, SEA_COLOR.b], 0);
    this.colors.set([accent[0].r, accent[0].g, accent[0].b], 3);
    this.colors.set([accent[1].r, accent[1].g, accent[1].b], 6);
    this.colors.set([accent[2].r, accent[2].g, accent[2].b], 9);
  }

  /** The size of the grid, in cells. */
  get gridSize(): { columns: number; rows: number } {
    return { columns: this.columns, rows: this.rows };
  }

  /** The size of a cell, in pixels. */
  get cellMetrics(): { cellWidth: number; cellHeight: number } {
    return { cellWidth: this.cellWidth, cellHeight: this.cellHeight };
  }

  /**
   * Re-measure the grid after a resize.
   *
   * Returns true if the number of cells changed, in which case the caller
   * has to rebuild its instance data.
   */
  resize(canvas: HTMLCanvasElement): boolean {
    const metrics = measureGrid(canvas);
    const changed =
      metrics.columns !== this.columns || metrics.rows !== this.rows;
    this.columns = metrics.columns;
    this.rows = metrics.rows;
    this.cellWidth = metrics.cellWidth;
    this.cellHeight = metrics.cellHeight;
    return changed;
  }

  /**
   * Draw the grid.
   *
   * `glyphs` and `colors` are one entry per cell, row-major.
   */
  draw(
    canvas: HTMLCanvasElement,
    glyphs: Uint8Array,
    colors: Uint8Array,
  ): void {
    const gl = this.gl;
    const count = this.columns * this.rows;
    const rampStart = this.atlas.rampStarts[this.ramp];

    // Build the instance data: a quad per cell.
    const instances = new Float32Array(count * 4);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.columns; x++) {
        const index = y * this.columns + x;
        const base = index * 4;
        instances[base] = x;
        instances[base + 1] = y;
        instances[base + 2] = rampStart + glyphs[index];
        instances[base + 3] = colors[index];
      }
    }

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(
      BACKGROUND.r / 255,
      BACKGROUND.g / 255,
      BACKGROUND.b / 255,
      1,
    );
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.program);

    gl.uniform2f(this.uniform("u_gridSize"), this.columns, this.rows);
    gl.uniform2f(this.uniform("u_cellSize"), this.cellWidth, this.cellHeight);
    gl.uniform2f(
      this.uniform("u_atlasCells"),
      this.atlas.columns,
      this.atlas.rows,
    );
    gl.uniform3fv(this.uniform("u_colors"), this.colors);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    gl.uniform1i(this.uniform("u_atlas"), 0);

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    gl.bindVertexArray(null);
  }

  private uniformCache = new Map<string, WebGLUniformLocation | null>();

  private uniform(name: string): WebGLUniformLocation | null {
    if (!this.uniformCache.has(name)) {
      this.uniformCache.set(
        name,
        this.gl.getUniformLocation(this.program, name),
      );
    }
    return this.uniformCache.get(name) ?? null;
  }
}
