import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime

from aisstream_client import build_subscription

OBIS_URL = "https://api.obis.org/v3/occurrence"
OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
NOAA_ERDDAP_URL = (
    "https://coastwatch.noaa.gov/erddap/griddap/noaacwN20VIIRSchlaWeekly.csv"
)


def get_json(url: str, timeout_s: int) -> dict:
    with urllib.request.urlopen(url, timeout=timeout_s) as response:
        return json.loads(response.read().decode("utf-8"))


def get_text(url: str, timeout_s: int) -> str:
    with urllib.request.urlopen(url, timeout=timeout_s) as response:
        return response.read().decode("utf-8")


def check_obis(timeout_s: int, size: int, start_date: str) -> dict:
    params = urllib.parse.urlencode(
        {
            "scientificname": "Cetacea",
            "size": size,
            "startdate": start_date,
            "fields": "id,scientificName,eventDate,decimalLatitude,decimalLongitude,datasetName,individualCount",
        }
    )
    url = f"{OBIS_URL}?{params}"
    payload = get_json(url, timeout_s=timeout_s)
    rows = payload.get("results", [])
    return {
        "query_url": url,
        "ok": bool(rows),
        "records_returned": len(rows),
        "total_available": payload.get("total"),
        "sample": rows[0] if rows else None,
    }


def check_open_meteo(timeout_s: int, lat: float, lon: float) -> dict:
    params = urllib.parse.urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "current": "sea_surface_temperature",
            "timezone": "UTC",
        }
    )
    url = f"{OPEN_METEO_MARINE_URL}?{params}"
    payload = get_json(url, timeout_s=timeout_s)
    current = payload.get("current", {})
    return {
        "query_url": url,
        "ok": current.get("sea_surface_temperature") is not None,
        "sea_surface_temperature": current.get("sea_surface_temperature"),
        "observed_at_utc": current.get("time"),
    }


def check_noaa(timeout_s: int, lat: float, lon: float) -> dict:
    query = f"chlor_a[(last)][(0.0)][({lat})][({lon})]"
    url = f"{NOAA_ERDDAP_URL}?{query}"
    text = get_text(url, timeout_s=timeout_s)

    chlorophyll = None
    observed_at = None
    for line in text.splitlines()[1:]:
        cols = line.split(",")
        if len(cols) < 5:
            continue
        try:
            chlorophyll = float(cols[4])
            observed_at = cols[0].replace('"', "")
            break
        except ValueError:
            continue

    return {
        "query_url": url,
        "ok": chlorophyll is not None,
        "chlorophyll_mg_m3": chlorophyll,
        "observed_at_utc": observed_at,
    }


def check_ais_subscription() -> dict:
    key_present = bool(os.getenv("AISSTREAM_API_KEY", "").strip())
    try:
        subscription = build_subscription()
        return {
            "ok": True,
            "api_key_present": key_present,
            "subscription_preview": {
                "FilterMessageTypes": subscription.get("FilterMessageTypes"),
                "has_bounding_boxes": "BoundingBoxes" in subscription,
                "bounding_boxes_count": len(subscription.get("BoundingBoxes", [])),
            },
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "api_key_present": key_present,
            "error": repr(exc),
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify live backend APIs and print exact query URLs."
    )
    parser.add_argument("--lat", type=float, default=33.9, help="Latitude for marine checks")
    parser.add_argument("--lon", type=float, default=-118.4, help="Longitude for marine checks")
    parser.add_argument(
        "--start-date",
        default=(datetime.now(UTC).date().replace(day=1).isoformat()),
        help="OBIS start date YYYY-MM-DD",
    )
    parser.add_argument(
        "--obis-size",
        type=int,
        default=20,
        help="OBIS sample page size (default: 20)",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=20,
        help="HTTP timeout per API call (default: 20)",
    )
    return parser.parse_args()


def safe_check(label: str, fn) -> dict:
    try:
        return {"name": label, "status": "ok", "details": fn()}
    except urllib.error.HTTPError as exc:
        return {
            "name": label,
            "status": "error",
            "details": {"http_status": exc.code, "error": str(exc)},
        }
    except urllib.error.URLError as exc:
        return {"name": label, "status": "error", "details": {"error": repr(exc)}}
    except Exception as exc:  # noqa: BLE001
        return {"name": label, "status": "error", "details": {"error": repr(exc)}}


def main() -> None:
    args = parse_args()
    report = {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "checks": [
            safe_check(
                "obis_occurrence",
                lambda: check_obis(
                    timeout_s=args.timeout_seconds,
                    size=args.obis_size,
                    start_date=args.start_date,
                ),
            ),
            safe_check(
                "open_meteo_sst",
                lambda: check_open_meteo(
                    timeout_s=args.timeout_seconds,
                    lat=args.lat,
                    lon=args.lon,
                ),
            ),
            safe_check(
                "noaa_chlorophyll",
                lambda: check_noaa(
                    timeout_s=args.timeout_seconds,
                    lat=args.lat,
                    lon=args.lon,
                ),
            ),
            safe_check("ais_subscription_config", check_ais_subscription),
        ],
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
