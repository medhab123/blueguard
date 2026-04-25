import argparse
import csv
from datetime import UTC, date, datetime
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

OBIS_OCCURRENCE_URL = "https://api.obis.org/v3/occurrence"

# Keep a compact schema that is enough for mapping, risk scoring, and filtering.
CSV_FIELDS = [
    "id",
    "occurrenceID",
    "scientificName",
    "species",
    "vernacularName",
    "eventDate",
    "decimalLatitude",
    "decimalLongitude",
    "datasetName",
    "basisOfRecord",
    "individualCount",
    "coordinateUncertaintyInMeters",
    "depth",
    "sst",
]


def fetch_page(
    after_id: str | None,
    page_size: int,
    timeout_s: int,
    start_date: str | None,
    end_date: str | None,
) -> dict:
    params = {
        "scientificname": "Cetacea",
        "size": page_size,
        "fields": ",".join(CSV_FIELDS),
    }
    if after_id:
        params["after"] = after_id
    if start_date:
        params["startdate"] = start_date
    if end_date:
        params["enddate"] = end_date

    query = urllib.parse.urlencode(params)
    url = f"{OBIS_OCCURRENCE_URL}?{query}"
    with urllib.request.urlopen(url, timeout=timeout_s) as response:
        return json.loads(response.read().decode("utf-8"))


def write_rows(output_path: Path, rows: list[dict], include_header: bool) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mode = "w" if include_header else "a"
    with output_path.open(mode, newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=CSV_FIELDS)
        if include_header:
            writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field) for field in CSV_FIELDS})


def parse_event_date(value: str | None) -> date | None:
    if not value:
        return None

    raw = value.strip().replace("Z", "")
    if not raw:
        return None

    # Most OBIS records are ISO timestamps; a few records use date-only or US format.
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(raw.split(".")[0], fmt).date()
        except ValueError:
            continue
    return None


def download_occurrences(
    output_path: Path,
    max_records: int,
    page_size: int,
    sleep_s: float,
    timeout_s: int,
    start_date: str | None,
    end_date: str | None,
    max_age_days: int | None,
) -> int:
    total_written = 0
    total_seen = 0
    after_id = None
    first_page = True
    today = datetime.now(UTC).date()

    while total_written < max_records:
        data = fetch_page(
            after_id=after_id,
            page_size=page_size,
            timeout_s=timeout_s,
            start_date=start_date,
            end_date=end_date,
        )
        results = data.get("results", [])
        if not results:
            break

        total_seen += len(results)
        remaining = max_records - total_written
        chunk = []
        for row in results:
            if max_age_days is not None:
                event_day = parse_event_date(row.get("eventDate"))
                if event_day is None:
                    continue
                if (today - event_day).days > max_age_days:
                    continue
            chunk.append(row)
            if len(chunk) >= remaining:
                break

        if not chunk:
            after_id = results[-1].get("id")
            if len(results) < page_size or not after_id:
                break
            if sleep_s > 0:
                time.sleep(sleep_s)
            continue

        write_rows(output_path, chunk, include_header=first_page)
        first_page = False

        total_written += len(chunk)
        after_id = results[-1].get("id")

        print(f"Scanned {total_seen} records, wrote {total_written} whale records...")

        if len(results) < page_size or not after_id:
            break

        if sleep_s > 0:
            time.sleep(sleep_s)

    return total_written


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download global whale (Cetacea) sightings from OBIS to CSV."
    )
    parser.add_argument(
        "--output",
        default="data/whale_occurrences_global.csv",
        help="Output CSV path (default: data/whale_occurrences_global.csv)",
    )
    parser.add_argument(
        "--max-records",
        type=int,
        default=5000,
        help="Maximum number of records to download (default: 5000)",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=1000,
        help="Records per API call (default: 1000, max 10000)",
    )
    parser.add_argument(
        "--sleep-seconds",
        type=float,
        default=0.25,
        help="Pause between API calls to be polite (default: 0.25)",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=30,
        help="HTTP timeout in seconds per request (default: 30)",
    )
    parser.add_argument(
        "--start-date",
        default=None,
        help="Only fetch records on/after YYYY-MM-DD (OBIS API filter)",
    )
    parser.add_argument(
        "--end-date",
        default=None,
        help="Only fetch records on/before YYYY-MM-DD (OBIS API filter)",
    )
    parser.add_argument(
        "--max-age-days",
        type=int,
        default=None,
        help="Keep only records newer than N days from today (local post-filter)",
    )
    return parser.parse_args()


def validate_iso_date(label: str, value: str | None) -> None:
    if value is None:
        return
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label} must be YYYY-MM-DD") from exc


def main() -> None:
    args = parse_args()

    if args.max_records <= 0:
        raise ValueError("--max-records must be > 0")
    if not 1 <= args.page_size <= 10000:
        raise ValueError("--page-size must be between 1 and 10000")
    if args.timeout_seconds <= 0:
        raise ValueError("--timeout-seconds must be > 0")
    if args.max_age_days is not None and args.max_age_days <= 0:
        raise ValueError("--max-age-days must be > 0")
    validate_iso_date("--start-date", args.start_date)
    validate_iso_date("--end-date", args.end_date)

    output_path = Path(args.output)
    written = download_occurrences(
        output_path=output_path,
        max_records=args.max_records,
        page_size=args.page_size,
        sleep_s=args.sleep_seconds,
        timeout_s=args.timeout_seconds,
        start_date=args.start_date,
        end_date=args.end_date,
        max_age_days=args.max_age_days,
    )

    print(f"Done. Saved {written} records to {output_path}")


if __name__ == "__main__":
    main()
