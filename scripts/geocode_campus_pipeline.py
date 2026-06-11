#!/usr/bin/env python3
"""
Full campus geocoding pipeline (from scratch).

Query priority (Mapbox forward geocode):
  1. Full address + state + ZIP
  2. Institution name + full address + state + ZIP
  3. Institution name + state + ZIP
  4. Institution name + state

Then: spread duplicate coordinates by 10 m, generate SQL parts (≤100 lines each).

Usage:
  python3 scripts/geocode_campus_pipeline.py \\
    --input "/Users/macuser/Downloads/wp_posts (6).csv" \\
    --output "/Users/macuser/Downloads/wp_posts_campus_geocoded.csv"
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import certifi
import ssl

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore

NULLISH = {"", "null", "none", "NULL", "None"}

# Full state name → USPS abbreviation (avoids "Washington" → Washington DC)
US_STATE_ABBR: dict[str, str] = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
    "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH",
    "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN",
    "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}

# west, south, east, north (Mapbox bbox)
STATE_BBOX: dict[str, tuple[float, float, float, float]] = {
    "AL": (-88.47, 30.22, -84.89, 35.01), "AK": (-179.15, 51.21, -129.99, 71.35),
    "AZ": (-114.82, 31.33, -109.05, 37.00), "AR": (-94.62, 33.00, -89.64, 36.50),
    "CA": (-124.41, 32.53, -114.13, 42.01), "CO": (-109.06, 36.99, -102.04, 41.00),
    "CT": (-73.73, 40.98, -71.79, 42.05), "DE": (-75.79, 38.45, -75.05, 39.84),
    "FL": (-87.63, 24.52, -80.03, 31.00), "GA": (-85.61, 30.36, -80.84, 35.00),
    "HI": (-160.25, 18.91, -154.81, 22.24), "ID": (-117.24, 41.99, -111.04, 49.00),
    "IL": (-91.51, 36.97, -87.02, 42.51), "IN": (-88.10, 37.77, -84.78, 41.76),
    "IA": (-96.64, 40.38, -90.14, 43.50), "KS": (-102.05, 36.99, -94.59, 40.00),
    "KY": (-89.57, 36.50, -81.96, 39.15), "LA": (-94.04, 28.93, -88.82, 33.02),
    "ME": (-71.08, 43.06, -66.95, 47.46), "MD": (-79.49, 37.91, -75.05, 39.72),
    "MA": (-73.51, 41.24, -69.93, 42.89), "MI": (-90.42, 41.70, -82.41, 48.31),
    "MN": (-97.24, 43.50, -89.49, 49.38), "MS": (-91.66, 30.17, -88.10, 35.00),
    "MO": (-95.77, 35.99, -89.10, 40.61), "MT": (-116.05, 44.36, -104.04, 49.00),
    "NE": (-104.05, 40.00, -95.31, 43.00), "NV": (-120.01, 35.00, -114.04, 42.00),
    "NH": (-72.56, 42.70, -70.70, 45.31), "NJ": (-75.56, 38.93, -73.89, 41.36),
    "NM": (-109.05, 31.33, -103.00, 37.00), "NY": (-79.76, 40.50, -71.86, 45.02),
    "NC": (-84.32, 33.84, -75.46, 36.59), "ND": (-104.05, 45.94, -96.55, 49.00),
    "OH": (-84.82, 38.40, -80.52, 42.33), "OK": (-103.00, 33.62, -94.43, 37.00),
    "OR": (-124.57, 41.99, -116.46, 46.29), "PA": (-80.52, 39.72, -74.69, 42.27),
    "RI": (-71.86, 41.15, -71.12, 42.02), "SC": (-83.35, 32.03, -78.54, 35.22),
    "SD": (-104.06, 42.48, -96.44, 45.94), "TN": (-90.31, 34.98, -81.65, 36.68),
    "TX": (-106.65, 25.84, -93.51, 36.50), "UT": (-114.05, 37.00, -109.04, 42.00),
    "VT": (-73.44, 42.73, -71.46, 45.02), "VA": (-83.68, 36.54, -75.24, 39.47),
    "WA": (-124.85, 45.54, -116.92, 49.00), "WV": (-82.64, 37.20, -77.72, 40.64),
    "WI": (-92.89, 42.49, -86.25, 47.08), "WY": (-111.06, 40.99, -104.05, 45.00),
}

ENV_SEARCH_PATHS = [
    Path(__file__).resolve().parents[1] / ".env",
    Path(__file__).resolve().parents[2] / "SpaceTime source files" / ".env",
    Path.home() / "Documents" / "SpaceTime source files" / ".env",
    Path.home() / "Documents" / "codetivelab" / "apps" / "space_time" / "spacetime" / ".env",
]
OFFSET_METERS = 10.0
COORD_PRECISION = 6
SQL_MAX_LINES = 100
SQL_PARTS_DIR = Path(__file__).resolve().parent / "wp_lat_lng_update_parts"


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
        raise SystemExit("MAPBOX_ACCESS_TOKEN not set (env or SpaceTime .env).")
    return token


def institution_name(post_title: str) -> str:
    title = _clean(post_title)
    if " - " in title:
        return title.split(" - ", 1)[0].strip()
    return title


def state_abbr(state: str) -> str:
    s = _clean(state)
    if not s:
        return ""
    if len(s) == 2 and s.isalpha():
        return s.upper()
    return US_STATE_ABBR.get(s.lower(), s)


# Known main campuses when only institution + state is available
INSTITUTION_CITY: dict[str, tuple[str, str]] = {
    "washington state university": ("Pullman", "WA"),
    "lower columbia college": ("Longview", "WA"),
    "florida atlantic university": ("Boca Raton", "FL"),
    "florida international university": ("Miami", "FL"),
    "university of central florida": ("Orlando", "FL"),
    "texas a&m university-san antonio": ("San Antonio", "TX"),
    "texas a&m university central texas": ("Killeen", "TX"),
    "university of florida": ("Gainesville", "FL"),
    "santa monica college": ("Santa Monica", "CA"),
    "san diego state university": ("San Diego", "CA"),
    "rutgers university": ("New Brunswick", "NJ"),
}

def institution_city_override(inst: str) -> tuple[str, str] | None:
    low = inst.lower()
    for name, (city, st) in INSTITUTION_CITY.items():
        if name in low:
            return city, st
    return None


def city_hint(inst: str, st: str) -> str:
    """Guess city from institution name when street address is missing."""
    ov = institution_city_override(inst)
    if ov:
        return ov[0]
    low = inst.lower()
    hints: list[tuple[str, str, str]] = [
        ("miami dade", "FL", "Miami"),
        ("miami", "FL", "Miami"),
        ("san diego", "CA", "San Diego"),
        ("los angeles", "CA", "Los Angeles"),
        ("san francisco", "CA", "San Francisco"),
        ("san jose", "CA", "San Jose"),
        ("santa monica", "CA", "Santa Monica"),
        ("santa ana", "CA", "Santa Ana"),
        ("houston", "TX", "Houston"),
        ("austin", "TX", "Austin"),
        ("dallas", "TX", "Dallas"),
        ("pullman", "WA", "Pullman"),
        ("seattle", "WA", "Seattle"),
        ("tacoma", "WA", "Tacoma"),
        ("longview", "WA", "Longview"),
        ("new brunswick", "NJ", "New Brunswick"),
        ("rutgers", "NJ", "New Brunswick"),
    ]
    for needle, state, city in hints:
        if needle in low and (not st or st == state):
            return city
    return ""


def build_geocode_attempts(row: dict[str, str]) -> list[tuple[str, str, str | None]]:
    """Return ordered (query, method, state_abbr_for_bbox) attempts."""
    addr = _clean(row.get("address"))
    inst = institution_name(row.get("post_title", ""))
    st = state_abbr(row.get("state", ""))
    zip_code = _clean(row.get("zip_code"))
    city = _clean(row.get("city"))
    attempts: list[tuple[str, str, str | None]] = []

    def with_us(parts: list[str]) -> str:
        return ", ".join(p for p in parts if p) + ", USA"

    if addr:
        parts = [addr]
        if city and city.lower() not in addr.lower():
            parts.append(city)
        if st and st.lower() not in addr.lower():
            parts.append(st)
        if zip_code and zip_code not in addr:
            parts.append(zip_code)
        attempts.append((with_us(parts), "address+state+zip", st or None))

    if inst and addr:
        parts = [inst, addr]
        if st:
            parts.append(st)
        if zip_code:
            parts.append(zip_code)
        attempts.append((with_us(parts), "institution+address+state+zip", st or None))

    if inst and st:
        parts = [inst]
        ov = institution_city_override(inst)
        if ov:
            hint, st = ov[0], ov[1]
        else:
            hint = city or city_hint(inst, st)
        if hint:
            parts.append(hint)
        parts.append(st)
        if zip_code:
            parts.append(zip_code)
        attempts.append((with_us(parts), "institution+state+zip", st))

    seen: set[str] = set()
    out: list[tuple[str, str, str | None]] = []
    for q, m, b in attempts:
        if q not in seen:
            seen.add(q)
            out.append((q, m, b))
    return out


def point_in_bbox(lat: float, lng: float, bbox: tuple[float, float, float, float]) -> bool:
    west, south, east, north = bbox
    return south <= lat <= north and west <= lng <= east


def _http_opener() -> urllib.request.OpenerDirector:
    ctx = ssl.create_default_context(cafile=certifi.where())
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))


def forward_geocode(
    query: str,
    token: str,
    session: urllib.request.OpenerDirector,
    *,
    types: str,
    bbox: tuple[float, float, float, float] | None = None,
) -> tuple[float, float, str] | None:
    encoded = urllib.parse.quote(query, safe="")
    bbox_param = ""
    if bbox:
        west, south, east, north = bbox
        bbox_param = f"&bbox={west},{south},{east},{north}"
    url = (
        "https://api.mapbox.com/geocoding/v5/mapbox.places/"
        f"{encoded}.json?access_token={urllib.parse.quote(token)}"
        f"&limit=1&country=us&types={urllib.parse.quote(types)}{bbox_param}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "yhgc-campus-pipeline/2.0"})
    with session.open(req, timeout=30) as resp:
        data = json.load(resp)
    features = data.get("features") or []
    if not features:
        return None
    f0 = features[0]
    center = f0.get("center")
    if not center or len(center) < 2:
        return None
    lng, lat = float(center[0]), float(center[1])
    place_name = str(f0.get("place_name") or "")
    return lat, lng, place_name


def geocode_row(
    row: dict[str, str],
    token: str,
    session: urllib.request.OpenerDirector,
) -> tuple[str, str, str, str]:
    """Returns new_lat, new_lng, geocode_query, geocode_method."""
    attempts = build_geocode_attempts(row)
    if not attempts:
        return "", "", "", "no_query"

    for query, method, st in attempts:
        types = "address,poi" if method.startswith("address") or "address" in method else "poi,place,address"
        bbox = STATE_BBOX.get(st) if st else None
        for attempt in range(3):
            try:
                hit = forward_geocode(query, token, session, types=types, bbox=bbox)
                if hit:
                    lat, lng, _ = hit
                    if bbox and not point_in_bbox(lat, lng, bbox):
                        continue
                    return f"{lat:.7f}", f"{lng:.7f}", query, method
                break
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < 2:
                    time.sleep(30)
                    continue
                break
            except Exception:
                break
        time.sleep(0.05)
    return "", "", attempts[0][0], "failed"


def offset_meters(lat: float, lng: float, bearing_deg: float, distance_m: float) -> tuple[float, float]:
    r = 6_378_137.0
    brng = math.radians(bearing_deg)
    lat1, lng1 = math.radians(lat), math.radians(lng)
    lat2 = math.asin(
        math.sin(lat1) * math.cos(distance_m / r)
        + math.cos(lat1) * math.sin(distance_m / r) * math.cos(brng)
    )
    lng2 = lng1 + math.atan2(
        math.sin(brng) * math.sin(distance_m / r) * math.cos(lat1),
        math.cos(distance_m / r) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), math.degrees(lng2)


def spread_duplicate_coords(rows: list[dict[str, str]]) -> int:
    groups: dict[tuple[float, float], list[int]] = defaultdict(list)
    for i, row in enumerate(rows):
        lat = row.get("new_lat", "").strip()
        lng = row.get("new_lng", "").strip()
        if not lat or not lng:
            continue
        key = (round(float(lat), COORD_PRECISION), round(float(lng), COORD_PRECISION))
        groups[key].append(i)

    changed = 0
    for (base_lat, base_lng), indices in groups.items():
        if len(indices) < 2:
            continue
        n = len(indices)
        for rank, idx in enumerate(indices):
            if rank == 0:
                continue
            bearing = (rank - 1) * (360.0 / (n - 1)) if n > 2 else 0.0
            new_lat, new_lng = offset_meters(base_lat, base_lng, bearing, OFFSET_METERS)
            rows[idx]["new_lat"] = f"{new_lat:.7f}"
            rows[idx]["new_lng"] = f"{new_lng:.7f}"
            rows[idx]["coord_offset"] = f"10m@{bearing:.0f}deg"
            changed += 1
    return changed


def esc_sql(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "''")


def union_lines(subset: list[tuple[int, str, str]]) -> list[str]:
    lines = []
    for i, (pid, lat, lng) in enumerate(subset):
        prefix = "SELECT" if i == 0 else "UNION ALL SELECT"
        lines.append(f"  {prefix} {pid} AS post_id, '{esc_sql(lat)}' AS new_lat, '{esc_sql(lng)}' AS new_lng")
    return lines


def write_part(path: Path, lines: list[str]) -> None:
    if len(lines) > SQL_MAX_LINES:
        raise ValueError(f"{path.name}: {len(lines)} lines > {SQL_MAX_LINES}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def generate_sql_parts(rows: list[dict[str, str]], out_dir: Path) -> None:
    import shutil

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    data = []
    for r in rows:
        pid = _clean(r.get("post_id"))
        lat = _clean(r.get("new_lat"))
        lng = _clean(r.get("new_lng"))
        if pid and lat and lng:
            data.append((int(pid), lat, lng))
    data.sort(key=lambda x: x[0])

    write_part(
        out_dir / "00_README.sql",
        [
            "-- Campus _lat/_lng full regen — run files in numeric order (max 100 lines each).",
            f"-- Campuses with coords: {len(data)} | Table prefix: wp_",
            "-- 01_backup → 02_preview_* → 03_start_transaction → 04_update_lat_* → 05_update_lng_* → 99_commit",
        ],
    )
    write_part(
        out_dir / "01_backup.sql",
        [
            "SELECT pm.post_id, pm.meta_key, pm.meta_value",
            "FROM wp_postmeta pm",
            "INNER JOIN wp_posts p ON p.ID = pm.post_id",
            "WHERE p.post_type = 'campus' AND p.post_status = 'publish'",
            "  AND pm.meta_key IN ('_lat', '_lng')",
            "ORDER BY pm.post_id, pm.meta_key;",
        ],
    )

    preview_h = [
        "SELECT p.ID AS post_id, p.post_title,",
        "  MAX(CASE WHEN pm.meta_key = '_lat' THEN pm.meta_value END) AS current_lat,",
        "  MAX(CASE WHEN pm.meta_key = '_lng' THEN pm.meta_value END) AS current_lng,",
        "  src.new_lat, src.new_lng",
        "FROM wp_posts p",
        "LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key IN ('_lat','_lng')",
        "INNER JOIN (",
    ]
    preview_f = [
        ") src ON p.ID = src.post_id",
        "WHERE p.post_type = 'campus' AND p.post_status = 'publish'",
        "GROUP BY p.ID, p.post_title, src.new_lat, src.new_lng ORDER BY p.ID;",
    ]
    cap = SQL_MAX_LINES - len(preview_h) - len(preview_f) - 2
    i, pn = 0, 1
    while i < len(data):
        chunk = data[i : i + cap]
        write_part(out_dir / f"02_preview_{pn:02d}.sql", [f"-- PREVIEW {pn}"] + preview_h + union_lines(chunk) + preview_f)
        i += len(chunk)
        pn += 1

    write_part(out_dir / "03_start_transaction.sql", ["START TRANSACTION;"])

    def write_updates(prefix: str, meta_key: str, col: str) -> None:
        header = ["UPDATE wp_postmeta pm", "INNER JOIN ("]
        footer = [
            ") src ON pm.post_id = src.post_id",
            f"SET pm.meta_value = src.{col}",
            f"WHERE pm.meta_key = '{meta_key}';",
        ]
        cap_u = SQL_MAX_LINES - len(header) - len(footer) - 2
        i, n = 0, 1
        while i < len(data):
            chunk = data[i : i + cap_u]
            write_part(out_dir / f"{prefix}_{n:02d}.sql", [f"-- UPDATE {meta_key} part {n}"] + header + union_lines(chunk) + footer)
            i += len(chunk)
            n += 1

    write_updates("04_update_lat", "_lat", "new_lat")
    write_updates("05_update_lng", "_lng", "new_lng")

    write_part(
        out_dir / "99_commit_and_verify.sql",
        [
            "COMMIT;",
            "",
            "SELECT p.ID AS post_id, p.post_title,",
            "  MAX(CASE WHEN pm.meta_key = '_lat' THEN pm.meta_value END) AS latitude,",
            "  MAX(CASE WHEN pm.meta_key = '_lng' THEN pm.meta_value END) AS longitude",
            "FROM wp_posts p",
            "LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id",
            "WHERE p.post_type = 'campus' AND p.post_status = 'publish'",
            "  AND pm.meta_key IN ('_lat','_lng')",
            "GROUP BY p.ID, p.post_title ORDER BY p.ID;",
        ],
    )


def run_pipeline(input_path: Path, output_path: Path, sql_dir: Path, delay: float, max_rows: int | None) -> None:
    token = load_mapbox_token()
    session = _http_opener()

    with input_path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        in_rows = list(reader)

    if max_rows is not None:
        in_rows = in_rows[:max_rows]

    extra = ["new_lat", "new_lng", "geocode_query", "geocode_method", "coord_offset"]
    out_fields = fieldnames + [c for c in extra if c not in fieldnames]

    out_rows: list[dict[str, str]] = []
    ok = fail = 0
    for i, row in enumerate(in_rows):
        pid = _clean(row.get("post_id"))
        lat, lng, query, method = geocode_row(row, token, session)
        out = dict(row)
        out["new_lat"] = lat
        out["new_lng"] = lng
        out["geocode_query"] = query
        out["geocode_method"] = method
        out["coord_offset"] = ""
        out_rows.append(out)
        if lat and lng:
            ok += 1
            print(f"[{i+1}/{len(in_rows)}] OK {pid} ({method})")
        else:
            fail += 1
            print(f"[{i+1}/{len(in_rows)}] FAIL {pid} ({method})", file=sys.stderr)
        if delay > 0:
            time.sleep(delay)

    spread = spread_duplicate_coords(out_rows)
    print(f"\nGeocoded: {ok} ok, {fail} failed | Spread {spread} duplicate offsets")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=out_fields, quoting=csv.QUOTE_ALL, extrasaction="ignore")
        w.writeheader()
        w.writerows(out_rows)
    print(f"Wrote {output_path}")

    generate_sql_parts(out_rows, sql_dir)
    print(f"SQL parts → {sql_dir}")


def main() -> None:
    p = argparse.ArgumentParser(description="Full campus geocode pipeline + SQL parts")
    p.add_argument("--input", type=Path, default=Path("/Users/macuser/Downloads/wp_posts (6).csv"))
    p.add_argument("--output", type=Path, default=Path("/Users/macuser/Downloads/wp_posts_campus_geocoded.csv"))
    p.add_argument("--sql-dir", type=Path, default=SQL_PARTS_DIR)
    p.add_argument("--delay", type=float, default=0.12)
    p.add_argument("--max-rows", type=int, default=None)
    args = p.parse_args()
    run_pipeline(args.input.resolve(), args.output.resolve(), args.sql_dir.resolve(), args.delay, args.max_rows)


if __name__ == "__main__":
    main()
