#!/usr/bin/env python3
"""Sweep trace parameters and score each combination.

Two independent scores are reported, because they pull in opposite directions:

  * ``soft``  = mean |vector render - antialiased source alpha|.  This is the
    honest fidelity measure: it rewards landing on the true sub-pixel edge.
  * ``hard``  = IoU of the render against the thresholded mask.  IoU is biased
    towards reproducing the pixel staircase, so it is only a sanity check.

A slightly larger Douglas-Peucker tolerance lowers ``hard`` while barely moving
``soft``: that is the smoothing we want, since it removes jaggies that IoU
counts as "correct".
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from trace_icons import load_alpha, trace_alpha
from verify_render import parse_path, rasterise

HERE = Path(__file__).resolve().parent
PNG = HERE / "png"

SIGMAS = [0.0, 0.6]
TOLERANCES = [0.3, 0.45, 0.6, 0.8, 1.0]
CORNERS = [28.0, 34.0, 45.0]


def evaluate(alpha: np.ndarray, mask: np.ndarray, sigma: float,
             tolerance: float, corner: float):
    a = load_alpha  # noqa: F841  (kept for symmetry with callers)
    field = alpha
    d, loops = trace_alpha(field, tolerance, corner)
    r = rasterise(parse_path(d), mask.shape[1], mask.shape[0])
    hard = (np.logical_and(r >= 0.5, mask).sum()
            / max(1, np.logical_or(r >= 0.5, mask).sum()))
    soft = float(np.abs(r - alpha).mean())
    return float(hard), soft, loops


def main() -> None:
    names = sorted(p.name.replace(".mask.npy", "") for p in PNG.glob("*.mask.npy"))
    masks = {n: np.load(PNG / f"{n}.mask.npy").astype(bool) for n in names}
    print(f"{len(names)} glyphs\n")
    print(f"{'sigma':>6} {'tol':>6} {'corner':>7} {'soft':>9} {'hard IoU':>9} {'bytes':>9}")
    best = (None, 9e9)                      # (params, soft error)
    rows = []
    for sigma in SIGMAS:
        alphas = {n: load_alpha(n, sigma) for n in names}
        for tol in TOLERANCES:
            for corner in CORNERS:
                softs, hards, sizes = [], [], 0
                for n in names:
                    hard, soft, _ = evaluate(alphas[n], masks[n], sigma, tol, corner)
                    softs.append(soft); hards.append(hard)
                    sizes += (HERE / "svg" / f"{n}.svg").stat().st_size if False else 0
                soft = float(np.mean(softs)); hard = float(np.mean(hards))
                rows.append((sigma, tol, corner, soft, hard))
                print(f"{sigma:>6.2f} {tol:>6.2f} {corner:>7.0f} "
                      f"{soft:>9.5f} {hard:>9.4f}")
                if soft < best[1]:
                    best = ((sigma, tol, corner), soft)
    params, soft_err = best
    print(f"\nlowest mean soft error {soft_err:.5f} at sigma={params[0]} "
          f"tol={params[1]} corner={params[2]:.0f}")


if __name__ == "__main__":
    main()
