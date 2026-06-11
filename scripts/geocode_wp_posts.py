#!/usr/bin/env python3
"""
Add new_lat / new_lng to wp_posts CSV by geocoding address (or title + state).

Uses Mapbox Geocoding API (forward geocode: text → coordinates).
Loads MAPBOX_ACCESS_TOKEN from the environment or common project .env files.

Usage:
  python3 scripts/geocode_wp_posts.py "/Users/macuser/Downloads/wp_posts (6).csv"
  python3 scripts/geocode_wp_posts.py input.csv -o output.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import certifi
import ssl

# Optional: pip install python-dotenv (stdlib fallback below)
try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore

NULLISH = {"", "null", "none", "NULL", "None"}

ENV_SEARCH_PATHS = [
    Path(__file__).resolve().parents[1] / ".env",
    Path(__file__).resolve().parents[2] / "SpaceTime source files" / ".env",
    Path(__file__).resolve().parents[2] / "codetivelab" / "apps" / "space_time" / "spacetime" / ".env",
    Path.home() / "Documents" / "SpaceTime source files" / ".env",
    Path.home() / "Documents" / "codetivelab" / "apps" / "space_time" / "spacetime" / ".env",
]


def _clean(value: str | None) -> str:
    if value is None:
        return ""
    s = str(value).strip().strip('"')
    return "" if s in NULLISH else s


def load_mapbox_token() -> str:
    for path in ENV_SEARCH_PATHS:
        if not path.is_file():
            continue
        if load_dotenv:
            load_dotenv(path, override=False)
        else:
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                if key.strip() == "MAPBOX_ACCESS_TOKEN" and val.strip():
                    os.environ.setdefault("MAPBOX_ACCESS_TOKEN", val.strip().strip('"').strip("'"))

    token = os.environ.get("MAPBOX_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit(
            "MAPBOX_ACCESS_TOKEN not set. Export it or add it to a project .env "
            "(e.g. SpaceTime source files/.env)."
        )
    return token


def build_geocode_query(row: dict[str, str]) -> str | None:
    address = _clean(row.get("address"))
    title = _clean(row.get("post_title"))
    city = _clean(row.get("city"))
    state = _clean(row.get("state"))
    zip_code = _clean(row.get("zip_code"))

    if address:
        parts = [address]
        if state and state.lower() not in address.lower():
            parts.append(state)
        if zip_code and zip_code not in address:
            parts.append(zip_code)
        return ", ".join(parts) + ", USA"

    parts: list[str] = []
    if title:
        # Drop leading "College Name - Program" noise when no street address
        parts.append(title)
    if city:
        parts.append(city)
    if state:
        parts.append(state)
    if zip_code:
        parts.append(zip_code)
    if not parts:
        return None
    return ", ".join(parts) + ", USA"


def _http_opener() -> urllib.request.OpenerDirector:
    ctx = ssl.create_default_context(cafile=certifi.where())
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))


def forward_geocode(query: str, token: str, session: urllib.request.OpenerDirector) -> tuple[str, str] | None:
    encoded = urllib.parse.quote(query, safe="")
    url = (
        "https://api.mapbox.com/geocoding/v5/mapbox.places/"
        f"{encoded}.json?access_token={urllib.parse.quote(token)}"
        "&limit=1&country=us&types=address,poi,place"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "yhgc-geocode-wp-posts/1.0"})
    with session.open(req, timeout=30) as resp:
        data = json.load(resp)
    features = data.get("features") or []
    if not features:
        return None
    center = features[0].get("center")
    if not center or len(center) < 2:
        return None
    lng, lat = center[0], center[1]
    return (f"{lat:.7f}", f"{lng:.7f}")


def process_csv(
    input_path: Path,
    output_path: Path,
    token: str,
    delay_sec: float,
    max_rows: int | None,
) -> None:
    session = _http_opener()
    rows_out: list[dict[str, str]] = []
    fieldnames: list[str] | None = None
    geocoded = 0
    failed = 0

    with input_path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise SystemExit("CSV has no header row.")
        fieldnames = list(reader.fieldnames)
        for col in ("new_lat", "new_lng"):
            if col not in fieldnames:
                fieldnames.append(col)

        for i, row in enumerate(reader):
            if max_rows is not None and i >= max_rows:
                break
            out = {k: (row.get(k) or "") for k in reader.fieldnames}
            query = build_geocode_query(out)
            out["new_lat"] = ""
            out["new_lng"] = ""

            if query:
                try:
                    coords = forward_geocode(query, token, session)
                    if coords:
                        out["new_lat"], out["new_lng"] = coords
                        geocoded += 1
                        print(f"[{i + 1}] OK  {out.get('post_id', '?')}: {query[:70]}…" if len(query) > 70 else f"[{i + 1}] OK  {out.get('post_id', '?')}: {query}")
                    else:
                        failed += 1
                        print(f"[{i + 1}] MISS {out.get('post_id', '?')}: {query}", file=sys.stderr)
                except urllib.error.HTTPError as e:
                    failed += 1
                    body = e.read().decode("utf-8", errors="replace")[:200]
                    print(f"[{i + 1}] HTTP {e.code} {out.get('post_id', '?')}: {body}", file=sys.stderr)
                    if e.code == 429:
                        print("Rate limited — waiting 60s…", file=sys.stderr)
                        time.sleep(60)
                except Exception as e:
                    failed += 1
                    print(f"[{i + 1}] ERR {out.get('post_id', '?')}: {e}", file=sys.stderr)
            else:
                failed += 1
                print(f"[{i + 1}] SKIP {out.get('post_id', '?')}: no query", file=sys.stderr)

            rows_out.append(out)
            if delay_sec > 0:
                time.sleep(delay_sec)

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows_out)

    print(f"\nWrote {output_path} ({len(rows_out)} rows, {geocoded} geocoded, {failed} missed/skipped).")


def main() -> None:
    parser = argparse.ArgumentParser(description="Geocode wp_posts CSV → new_lat, new_lng")
    parser.add_argument("input_csv", type=Path, help="Input CSV path")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output CSV (default: input stem + _geocoded.csv)",
    )
    parser.add_argument("--delay", type=float, default=0.12, help="Seconds between API calls")
    parser.add_argument("--max-rows", type=int, default=None, help="Process only first N rows (testing)")
    parser.add_argument(
        "--spread-duplicates",
        action="store_true",
        help="After geocoding, offset duplicate new_lat/new_lng by 10 m (see offset_duplicate_geocodes.py)",
    )
    args = parser.parse_args()

    input_path = args.input_csv.expanduser().resolve()
    if not input_path.is_file():
        raise SystemExit(f"File not found: {input_path}")

    output_path = args.output
    if output_path is None:
        output_path = input_path.with_name(f"{input_path.stem}_geocoded.csv")
    else:
        output_path = output_path.expanduser().resolve()

    token = load_mapbox_token()
    process_csv(input_path, output_path, token, args.delay, args.max_rows)

    if args.spread_duplicates:
        import subprocess

        offset_script = Path(__file__).resolve().parent / "offset_duplicate_geocodes.py"
        print("\nSpreading duplicate coordinates (+10 m ring)…", file=sys.stderr)
        subprocess.run(
            [sys.executable, str(offset_script), str(output_path), "-o", str(output_path)],
            check=True,
        )


if __name__ == "__main__":
    main()
