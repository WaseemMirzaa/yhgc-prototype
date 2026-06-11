#!/usr/bin/env python3
"""
Find duplicate new_lat/new_lng values and spread duplicates 10 m apart (circle around first point).

Usage:
  python3 scripts/offset_duplicate_geocodes.py input_geocoded.csv
  python3 scripts/offset_duplicate_geocodes.py input.csv -o output.csv --report-only
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
from collections import defaultdict
from pathlib import Path

LAT_COL = "new_lat"
LNG_COL = "new_lng"
COORD_PRECISION = 6  # ~0.11 m — treat as same pin
OFFSET_METERS = 10.0


def parse_coord(value: str) -> float | None:
    v = (value or "").strip().strip('"')
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def coord_key(lat: float, lng: float) -> tuple[float, float]:
    return (round(lat, COORD_PRECISION), round(lng, COORD_PRECISION))


def offset_meters(lat: float, lng: float, bearing_deg: float, distance_m: float) -> tuple[float, float]:
    """Move point by distance_m along bearing_deg (0 = north, 90 = east). WGS84 sphere."""
    r = 6_378_137.0
    brng = math.radians(bearing_deg)
    lat1 = math.radians(lat)
    lng1 = math.radians(lng)
    lat2 = math.asin(
        math.sin(lat1) * math.cos(distance_m / r)
        + math.cos(lat1) * math.sin(distance_m / r) * math.cos(brng)
    )
    lng2 = lng1 + math.atan2(
        math.sin(brng) * math.sin(distance_m / r) * math.cos(lat1),
        math.cos(distance_m / r) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), math.degrees(lng2)


def find_duplicate_groups(rows: list[dict[str, str]]) -> dict[tuple[float, float], list[int]]:
    groups: dict[tuple[float, float], list[int]] = defaultdict(list)
    for i, row in enumerate(rows):
        lat = parse_coord(row.get(LAT_COL, ""))
        lng = parse_coord(row.get(LNG_COL, ""))
        if lat is None or lng is None:
            continue
        groups[coord_key(lat, lng)].append(i)
    return {k: idxs for k, idxs in groups.items() if len(idxs) > 1}


def apply_offsets(rows: list[dict[str, str]], groups: dict[tuple[float, float], list[int]], verbose: bool) -> int:
    changed = 0
    for (base_lat, base_lng), indices in sorted(groups.items(), key=lambda x: -len(x[1])):
        n = len(indices)
        if verbose:
            print(f"\nDuplicate group ({base_lat}, {base_lng}) — {n} rows", file=sys.stderr)
        for rank, row_idx in enumerate(indices):
            row = rows[row_idx]
            pid = row.get("post_id", "?")
            title = (row.get("post_title") or "")[:60]
            if rank == 0:
                if verbose:
                    print(f"  [{rank + 1}/{n}] post_id={pid} KEEP  {base_lat:.7f}, {base_lng:.7f}  {title}", file=sys.stderr)
                continue
            bearing = (rank - 1) * (360.0 / (n - 1)) if n > 2 else 0.0
            new_lat, new_lng = offset_meters(base_lat, base_lng, bearing, OFFSET_METERS)
            row[LAT_COL] = f"{new_lat:.7f}"
            row[LNG_COL] = f"{new_lng:.7f}"
            changed += 1
            if verbose:
                print(
                    f"  [{rank + 1}/{n}] post_id={pid} +{OFFSET_METERS:.0f}m @{bearing:.1f}°  "
                    f"{new_lat:.7f}, {new_lng:.7f}  {title}",
                    file=sys.stderr,
                )
    return changed


def verify_unique(rows: list[dict[str, str]]) -> int:
    seen: dict[tuple[float, float], str] = {}
    collisions = 0
    for row in rows:
        lat = parse_coord(row.get(LAT_COL, ""))
        lng = parse_coord(row.get(LNG_COL, ""))
        if lat is None or lng is None:
            continue
        key = coord_key(lat, lng)
        pid = row.get("post_id", "?")
        if key in seen:
            collisions += 1
            print(f"STILL DUPLICATE: {key} post_ids {seen[key]} & {pid}", file=sys.stderr)
        else:
            seen[key] = pid
    return collisions


def main() -> None:
    parser = argparse.ArgumentParser(description="Spread duplicate new_lat/new_lng by 10 m")
    parser.add_argument("input_csv", type=Path)
    parser.add_argument("-o", "--output", type=Path, default=None)
    parser.add_argument("--report-only", action="store_true", help="List duplicate groups only")
    parser.add_argument("-q", "--quiet", action="store_true", help="No per-row log")
    args = parser.parse_args()

    input_path = args.input_csv.expanduser().resolve()
    if not input_path.is_file():
        raise SystemExit(f"Not found: {input_path}")

    output_path = args.output or input_path
    if args.output is None and not args.report_only:
        output_path = input_path.with_name(f"{input_path.stem}_deduped.csv")

    with input_path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    if LAT_COL not in fieldnames or LNG_COL not in fieldnames:
        raise SystemExit(f"CSV must include {LAT_COL} and {LNG_COL}")

    groups = find_duplicate_groups(rows)
    dup_rows = sum(len(v) for v in groups.values())
    print(
        f"Rows: {len(rows)} | Duplicate coordinate groups: {len(groups)} | "
        f"Rows in those groups: {dup_rows} | Will offset: {dup_rows - len(groups)}",
        file=sys.stderr,
    )

    if args.report_only:
        for key, idxs in sorted(groups.items(), key=lambda x: -len(x[1])):
            ids = [rows[i].get("post_id", "?") for i in idxs]
            print(f"{len(idxs)}x {key} -> {ids}")
        return

    if not groups:
        print("No duplicates — nothing to change.", file=sys.stderr)
        if output_path != input_path:
            with output_path.open("w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
                w.writeheader()
                w.writerows(rows)
        return

    changed = apply_offsets(rows, groups, verbose=not args.quiet)
    remaining = verify_unique(rows)

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)

    print(
        f"\nWrote {output_path} | Offset {changed} rows | "
        f"Remaining duplicate keys: {remaining}",
        file=sys.stderr,
    )
    if remaining:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
