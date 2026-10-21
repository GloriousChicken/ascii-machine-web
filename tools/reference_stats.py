#!/usr/bin/env python3
"""Measure the invariants of the terminal app, for the web version to match.

The web version and the terminal app deliberately use different random
generators, so they do not produce the same sea from the same seed. Parity is
therefore established through seed independent invariants: properties that
hold whatever the seed is.

This script measures those invariants against the terminal app, and prints
them as JSON. The Playwright tests then check the web version against the
same numbers.

Usage:
    python3 tools/reference_stats.py [steps] [width] [height]

The terminal app is not part of this repository, so its location has to be
given. It is taken from the --terminal argument, or from the
ASCII_MACHINE_TERMINAL environment variable, or from a sibling checkout of
the terminal app named ascii-machine.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# The terminal app lives somewhere else: its simulation is pure numpy, so it
# can be imported without pulling in any terminal machinery.
TERMINAL_ENV = "ASCII_MACHINE_TERMINAL"


def terminal_app_path(explicit: str | None) -> Path:
    """Where the terminal app's source lives."""
    if explicit:
        return Path(explicit).expanduser()

    from_env = os.environ.get(TERMINAL_ENV)
    if from_env:
        return Path(from_env).expanduser()

    # A checkout of the terminal app next to this one.
    sibling = Path(__file__).resolve().parent.parent.parent / "ascii-machine"
    if sibling.is_dir():
        return sibling

    raise SystemExit(
        f"could not find the terminal app. Set {TERMINAL_ENV} to its path, "
        f"or pass --terminal PATH."
    )


def import_terminal_app(explicit: str | None):
    """Import the terminal app's palette and simulation."""
    sys.path.insert(0, str(terminal_app_path(explicit) / "src"))

    from ascii_machine import palette as pal
    from ascii_machine.simulation import Simulation

    return pal, Simulation


def histogram(pal, density):
    """The share of cells at each of the ten ramp levels."""
    low, high = pal.np.percentile(density, 2), pal.np.percentile(density, 98)
    span = max(float(high - low), 1e-6)
    normalized = pal.np.clip((density - low) / span, 0, 1)
    index = pal.glyph_index(normalized, "classic")
    counts = pal.np.bincount(index.ravel(), minlength=10) / index.size
    return [round(float(value), 4) for value in counts]


def aliveness(pal, Simulation, seed, steps, width, height):
    """How much the sea changes from one frame to the next."""
    simulation = Simulation(height, width, seed=seed)
    for _ in range(steps):
        simulation.step()

    differences = []
    for _ in range(30):
        before = simulation.density.copy()
        simulation.step()
        differences.append(float(pal.np.abs(simulation.density - before).mean()))

    early = sum(differences[:10]) / 10
    late = sum(differences[-10:]) / 10
    return {"early": round(early, 6), "late": round(late, 6)}


def click_response(pal, Simulation, seed, steps, width, height):
    """Where the energy lands when a cell is clicked."""
    simulation = Simulation(height, width, seed=seed)
    for _ in range(steps):
        simulation.step()

    target_x, target_y = width // 2, height // 2
    simulation.stir(target_x, target_y, strength=1.0, radius=4.0)

    peak = pal.np.unravel_index(pal.np.argmax(simulation.energy), simulation.energy.shape)
    lit = int((simulation.energy > pal.ACCENT_THRESHOLD).sum())
    return {
        "peakOffset": [int(peak[1] - target_x), int(peak[0] - target_y)],
        "litCells": lit,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Measure the terminal app's invariants, for the web version to match."
    )
    parser.add_argument("steps", nargs="?", type=int, default=200)
    parser.add_argument("width", nargs="?", type=int, default=80)
    parser.add_argument("height", nargs="?", type=int, default=24)
    parser.add_argument(
        "--terminal",
        default=None,
        help="path to the terminal app's checkout",
    )
    args = parser.parse_args()

    steps, width, height = args.steps, args.width, args.height
    pal, Simulation = import_terminal_app(args.terminal)

    histograms = []
    aliveness_early = []
    aliveness_late = []
    click_offsets = []
    click_lit = []

    for seed in range(12):
        simulation = Simulation(height, width, seed=seed)
        for _ in range(steps):
            simulation.step()
        histograms.append(histogram(pal, simulation.density))

        alive = aliveness(pal, Simulation, seed, steps, width, height)
        aliveness_early.append(alive["early"])
        aliveness_late.append(alive["late"])

        click = click_response(pal, Simulation, seed, steps, width, height)
        click_offsets.append(click["peakOffset"])
        click_lit.append(click["litCells"])

    import numpy as np

    stacked = np.array(histograms)
    all_offsets = np.array(click_offsets)

    result = {
        "steps": steps,
        "width": width,
        "height": height,
        "histogram": {
            "mean": [round(float(v), 4) for v in stacked.mean(axis=0)],
            "std": [round(float(v), 4) for v in stacked.std(axis=0)],
        },
        "aliveness": {
            "earlyMean": round(float(np.mean(aliveness_early)), 6),
            "lateMean": round(float(np.mean(aliveness_late)), 6),
            "lateFloor": 0.002,
        },
        "click": {
            "maxOffset": [int(np.abs(all_offsets[:, 0]).max()), int(np.abs(all_offsets[:, 1]).max())],
            "litCellsMean": round(float(np.mean(click_lit)), 1),
        },
    }

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
