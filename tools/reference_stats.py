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
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# The terminal app lives next door. Its simulation is pure numpy, so it can
# be imported without pulling in any terminal machinery.
TERMINAL_APP = Path("SOME_PATH")
sys.path.insert(0, str(TERMINAL_APP / "src"))

from ascii_machine import palette as pal  # noqa: E402
from ascii_machine.simulation import Simulation  # noqa: E402


def histogram(density):
    """The share of cells at each of the ten ramp levels."""
    low, high = pal.np.percentile(density, 2), pal.np.percentile(density, 98)
    span = max(float(high - low), 1e-6)
    normalized = pal.np.clip((density - low) / span, 0, 1)
    index = pal.glyph_index(normalized, "classic")
    counts = pal.np.bincount(index.ravel(), minlength=10) / index.size
    return [round(float(value), 4) for value in counts]


def aliveness(seed, steps, width, height):
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


def click_response(seed, steps, width, height):
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
    steps = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 80
    height = int(sys.argv[3]) if len(sys.argv) > 3 else 24

    histograms = []
    aliveness_early = []
    aliveness_late = []
    click_offsets = []
    click_lit = []

    for seed in range(12):
        simulation = Simulation(height, width, seed=seed)
        for _ in range(steps):
            simulation.step()
        histograms.append(histogram(simulation.density))

        alive = aliveness(seed, steps, width, height)
        aliveness_early.append(alive["early"])
        aliveness_late.append(alive["late"])

        click = click_response(seed, steps, width, height)
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
