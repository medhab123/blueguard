import argparse
import asyncio
import csv
import json
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import websockets

from aisstream_client import WS_URL, build_subscription
from environmental_context import get_environmental_context


@dataclass
class WhaleSighting:
    species: str
    lat: float
    lon: float
    event_date: datetime


@dataclass
class ShipPosition:
    ship: str
    mmsi: str
    lat: float
    lon: float
    sog: float
    heading: float | None
    observed_at: str


def parse_event_datetime(value: str) -> datetime | None:
    raw = (value or "").strip().replace("Z", "")
    if not raw:
        return None

    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(raw.split(".")[0], fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def load_whale_sightings(path: Path, max_age_days: int) -> list[WhaleSighting]:
    sightings: list[WhaleSighting] = []
    now = datetime.now(UTC)

    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            event_dt = parse_event_datetime(row.get("eventDate", ""))
            if event_dt is None:
                continue

            age_days = (now - event_dt).days
            if age_days > max_age_days:
                continue

            try:
                lat = float(row["decimalLatitude"])
                lon = float(row["decimalLongitude"])
            except (KeyError, TypeError, ValueError):
                continue

            sightings.append(
                WhaleSighting(
                    species=(row.get("species") or row.get("scientificName") or "unknown"),
                    lat=lat,
                    lon=lon,
                    event_date=event_dt,
                )
            )

    return sightings


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return radius_km * 2 * math.asin(math.sqrt(a))


async def collect_live_ships(max_ships: int, max_seconds: int) -> list[ShipPosition]:
    subscription = build_subscription()
    unique_ships: dict[str, ShipPosition] = {}

    async with websockets.connect(
        WS_URL,
        ping_interval=20,
        ping_timeout=20,
        close_timeout=5,
        max_size=10_000_000,
    ) as ws:
        await ws.send(json.dumps(subscription))
        deadline = asyncio.get_running_loop().time() + max_seconds

        while len(unique_ships) < max_ships:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break

            raw_message = await asyncio.wait_for(ws.recv(), timeout=remaining)
            message = json.loads(raw_message)
            if message.get("MessageType") != "PositionReport":
                continue

            metadata = message.get("MetaData", {}) or message.get("Metadata", {})
            position = message.get("Message", {}).get("PositionReport", {})
            mmsi = str(position.get("UserID") or metadata.get("MMSI") or "").strip()
            if not mmsi:
                continue

            try:
                lat = float(position["Latitude"])
                lon = float(position["Longitude"])
            except (KeyError, TypeError, ValueError):
                continue

            sog_raw = position.get("Sog")
            try:
                sog = float(sog_raw) if sog_raw is not None else 0.0
            except (TypeError, ValueError):
                sog = 0.0

            heading_raw = position.get("TrueHeading")
            try:
                heading = float(heading_raw) if heading_raw is not None else None
            except (TypeError, ValueError):
                heading = None

            unique_ships[mmsi] = ShipPosition(
                ship=(metadata.get("ShipName") or "UNKNOWN").strip() or "UNKNOWN",
                mmsi=mmsi,
                lat=lat,
                lon=lon,
                sog=sog,
                heading=heading,
                observed_at=datetime.now(UTC).isoformat(),
            )

    return list(unique_ships.values())


def build_offline_sample_ships() -> list[ShipPosition]:
    now = datetime.now(UTC).isoformat()
    return [
        ShipPosition(
            ship="Cargo Alpha",
            mmsi="111000111",
            lat=33.93,
            lon=-118.46,
            sog=13.2,
            heading=155.0,
            observed_at=now,
        ),
        ShipPosition(
            ship="Tanker Bravo",
            mmsi="222000222",
            lat=33.86,
            lon=-118.35,
            sog=11.4,
            heading=170.0,
            observed_at=now,
        ),
    ]


def compute_ship_risk(ship: ShipPosition, whales: list[WhaleSighting], env_context: dict) -> dict:
    now = datetime.now(UTC)
    whale_score = 0.0
    nearby_whales = 0

    for whale in whales:
        distance = haversine_km(ship.lat, ship.lon, whale.lat, whale.lon)
        if distance > 10.0:
            continue

        age_hours = (now - whale.event_date).total_seconds() / 3600.0
        if age_hours > 48:
            continue

        recency_weight = max(0.0, 1.0 - (age_hours / 48.0))
        distance_weight = max(0.0, 1.0 - (distance / 10.0))
        whale_score += 8.0 * recency_weight * distance_weight
        nearby_whales += 1

    zone = env_context.get("high_krill_zone", {})
    zone_lat = float(zone.get("lat", ship.lat))
    zone_lon = float(zone.get("lon", ship.lon))
    zone_score = float(zone.get("score", 0.0))
    zone_distance = haversine_km(ship.lat, ship.lon, zone_lat, zone_lon)
    env_score = max(0.0, zone_score * (1.0 - min(zone_distance, 20.0) / 20.0))

    if ship.sog >= 14:
        speed_score = 1.8
    elif ship.sog >= 10:
        speed_score = 1.0
    elif ship.sog >= 6:
        speed_score = 0.4
    else:
        speed_score = 0.0

    total = min(10.0, whale_score + env_score + speed_score)
    if total >= 7.0:
        level = "HIGH"
    elif total >= 4.0:
        level = "MEDIUM"
    else:
        level = "LOW"

    return {
        "ship": ship.ship,
        "mmsi": ship.mmsi,
        "lat": ship.lat,
        "lon": ship.lon,
        "sog": ship.sog,
        "heading": ship.heading,
        "observed_at": ship.observed_at,
        "risk_level": level,
        "risk_total": round(total, 2),
        "risk_components": {
            "whale_score": round(whale_score, 2),
            "environment_score": round(env_score, 2),
            "speed_score": round(speed_score, 2),
        },
        "nearby_whale_sightings": nearby_whales,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a whale-ship collision risk snapshot from AIS + whale + environmental data."
    )
    parser.add_argument(
        "--whale-csv",
        default="data/whale_recent.csv",
        help="Path to whale sightings CSV (default: data/whale_recent.csv)",
    )
    parser.add_argument(
        "--whale-max-age-days",
        type=int,
        default=45,
        help="Keep whale sightings newer than N days (default: 45)",
    )
    parser.add_argument("--env-lat", type=float, default=33.9, help="Environmental zone latitude")
    parser.add_argument("--env-lon", type=float, default=-118.4, help="Environmental zone longitude")
    parser.add_argument(
        "--no-live-env",
        action="store_true",
        help="Use mock environmental context instead of live APIs",
    )
    parser.add_argument(
        "--ships",
        type=int,
        default=12,
        help="Collect up to N unique live ships from AIS (default: 12)",
    )
    parser.add_argument(
        "--ship-collect-seconds",
        type=int,
        default=30,
        help="Max seconds to collect live ship updates (default: 30)",
    )
    parser.add_argument(
        "--offline-sample-ships",
        action="store_true",
        help="Skip AIS and use sample ships for demo output",
    )
    parser.add_argument(
        "--output",
        default="data/risk_snapshot.json",
        help="Output JSON path (default: data/risk_snapshot.json)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    whale_path = Path(args.whale_csv)
    if not whale_path.exists():
        raise FileNotFoundError(f"Whale CSV not found: {whale_path}")
    if args.whale_max_age_days <= 0:
        raise ValueError("--whale-max-age-days must be > 0")

    whales = load_whale_sightings(path=whale_path, max_age_days=args.whale_max_age_days)
    env_context = get_environmental_context(
        lat=args.env_lat,
        lon=args.env_lon,
        prefer_live=not args.no_live_env,
        timeout_s=20,
    )

    if args.offline_sample_ships:
        ships = build_offline_sample_ships()
    else:
        ships = asyncio.run(
            collect_live_ships(max_ships=args.ships, max_seconds=args.ship_collect_seconds)
        )

    scored = [compute_ship_risk(ship=ship, whales=whales, env_context=env_context) for ship in ships]
    scored.sort(key=lambda row: row["risk_total"], reverse=True)

    output = {
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "ship_count": len(scored),
        "whale_sightings_used": len(whales),
        "environment_mode": env_context.get("mode"),
        "environment_zone": env_context.get("high_krill_zone", {}),
        "ships": scored,
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2)

    print(f"Saved risk snapshot to {output_path}")
    print(f"Ships scored: {len(scored)}")
    if scored:
        print("Top risk ship:")
        print(json.dumps(scored[0], indent=2))


if __name__ == "__main__":
    main()
