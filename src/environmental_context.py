import argparse
import csv
import io
import json
import urllib.parse
import urllib.request
from datetime import UTC, datetime

OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
NOAA_CHL_WEEKLY_DATASET = "noaacwN20VIIRSchlaWeekly"
NOAA_ERDDAP_BASE = "https://coastwatch.noaa.gov/erddap/griddap"


def fetch_sea_surface_temperature(lat: float, lon: float, timeout_s: int = 20) -> dict:
    params = urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "current": "sea_surface_temperature",
            "timezone": "UTC",
        }
    )
    url = f"{OPEN_METEO_MARINE_URL}?{params}"
    with urllib.request.urlopen(url, timeout=timeout_s) as response:
        payload = json.loads(response.read().decode("utf-8"))

    current = payload.get("current", {})
    value = current.get("sea_surface_temperature")
    if value is None:
        raise RuntimeError("Open-Meteo returned no sea_surface_temperature value.")

    return {
        "sea_surface_temp_c": float(value),
        "observed_at_utc": current.get("time"),
        "source": "Open-Meteo Marine API",
        "url": url,
    }


def fetch_chlorophyll_weekly(lat: float, lon: float, timeout_s: int = 20) -> dict:
    query = f"chlor_a[(last)][(0.0)][({lat})][({lon})]"
    url = f"{NOAA_ERDDAP_BASE}/{NOAA_CHL_WEEKLY_DATASET}.csv?{query}"

    with urllib.request.urlopen(url, timeout=timeout_s) as response:
        text = response.read().decode("utf-8")

    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise RuntimeError("NOAA ERDDAP returned no chlorophyll rows.")

    row = None
    chlorophyll_value = None
    for candidate in rows:
        raw_value = candidate.get("chlor_a")
        try:
            chlorophyll_value = float(raw_value)  # skips units row like "mg m^-3"
            row = candidate
            break
        except (TypeError, ValueError):
            continue

    if row is None or chlorophyll_value is None:
        raise RuntimeError("NOAA ERDDAP chlorophyll value missing.")

    return {
        "chlorophyll_mg_m3": chlorophyll_value,
        "observed_at_utc": row.get("time"),
        "source": "NOAA CoastWatch ERDDAP (VIIRS weekly global)",
        "url": url,
    }


def compute_krill_score(chlorophyll_mg_m3: float, sea_surface_temp_c: float) -> float:
    # Hackathon-friendly heuristic: food availability (chlorophyll) drives most of the score.
    # Temperature nudges risk because upwelling/cooler regimes are often more productive.
    chlorophyll_component = min(max(chlorophyll_mg_m3, 0.0), 2.0) / 2.0 * 8.0

    if 8.0 <= sea_surface_temp_c <= 18.0:
        temp_component = 2.0
    elif 6.0 <= sea_surface_temp_c <= 22.0:
        temp_component = 1.0
    else:
        temp_component = 0.0

    return round(min(10.0, chlorophyll_component + temp_component), 2)


def build_mock_context(lat: float, lon: float) -> dict:
    mock_chl = 0.9
    mock_sst = 15.5
    score = compute_krill_score(mock_chl, mock_sst)
    now_utc = datetime.now(UTC).isoformat()
    return {
        "mode": "mock",
        "generated_at_utc": now_utc,
        "high_krill_zone": {
            "lat": lat,
            "lon": lon,
            "score": score,
            "chlorophyll_mg_m3": mock_chl,
            "sea_surface_temp_c": mock_sst,
            "chlorophyll_source": "mock",
            "sst_source": "mock",
        },
    }


def build_live_context(lat: float, lon: float, timeout_s: int = 20) -> dict:
    sst = fetch_sea_surface_temperature(lat=lat, lon=lon, timeout_s=timeout_s)
    chl = fetch_chlorophyll_weekly(lat=lat, lon=lon, timeout_s=timeout_s)
    score = compute_krill_score(
        chlorophyll_mg_m3=chl["chlorophyll_mg_m3"],
        sea_surface_temp_c=sst["sea_surface_temp_c"],
    )

    return {
        "mode": "live",
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "high_krill_zone": {
            "lat": lat,
            "lon": lon,
            "score": score,
            "chlorophyll_mg_m3": chl["chlorophyll_mg_m3"],
            "sea_surface_temp_c": sst["sea_surface_temp_c"],
            "chlorophyll_observed_at_utc": chl["observed_at_utc"],
            "sst_observed_at_utc": sst["observed_at_utc"],
            "chlorophyll_source": chl["source"],
            "sst_source": sst["source"],
        },
        "sources": {
            "chlorophyll_url": chl["url"],
            "sst_url": sst["url"],
        },
    }


def get_environmental_context(lat: float, lon: float, prefer_live: bool, timeout_s: int) -> dict:
    if not prefer_live:
        return build_mock_context(lat=lat, lon=lon)

    try:
        return build_live_context(lat=lat, lon=lon, timeout_s=timeout_s)
    except Exception as exc:  # noqa: BLE001
        fallback = build_mock_context(lat=lat, lon=lon)
        fallback["mode"] = "mock_fallback"
        fallback["fallback_reason"] = repr(exc)
        return fallback


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build chlorophyll + SST context with live APIs and mock fallback."
    )
    parser.add_argument("--lat", type=float, default=33.9, help="Zone latitude")
    parser.add_argument("--lon", type=float, default=-118.4, help="Zone longitude")
    parser.add_argument(
        "--prefer-live",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Try live APIs first (default: true). Use --no-prefer-live to force mock.",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=20,
        help="HTTP timeout in seconds for each live API call (default: 20)",
    )
    parser.add_argument(
        "--output",
        default="data/environmental_context.json",
        help="Output JSON file path (default: data/environmental_context.json)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    context = get_environmental_context(
        lat=args.lat,
        lon=args.lon,
        prefer_live=args.prefer_live,
        timeout_s=args.timeout_seconds,
    )

    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(context, handle, indent=2)

    print(json.dumps(context, indent=2))
    print(f"\nSaved to {args.output}")


if __name__ == "__main__":
    main()
