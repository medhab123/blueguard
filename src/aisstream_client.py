import asyncio
import json
import os
from datetime import datetime, timezone

import websockets

WS_URL = "wss://stream.aisstream.io/v0/stream"

DEFAULT_BOUNDING_BOXES: list[list[list[float]]] | None = None


def build_subscription() -> dict:
    api_key = os.getenv("AISSTREAM_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Missing AISSTREAM_API_KEY environment variable.")

    subscription = {
        "APIKey": api_key,
        "FilterMessageTypes": ["PositionReport"],
    }
    # Optional: allow custom bounding boxes via env var with JSON shape:
    # [[[minLat, minLon], [maxLat, maxLon]], ...]
    env_boxes = os.getenv("AISSTREAM_BOUNDING_BOXES", "").strip()
    if env_boxes:
        parsed_boxes = json.loads(env_boxes)
        if not isinstance(parsed_boxes, list):
            raise ValueError("AISSTREAM_BOUNDING_BOXES must be a JSON array.")
        subscription["BoundingBoxes"] = parsed_boxes
    elif DEFAULT_BOUNDING_BOXES:
        subscription["BoundingBoxes"] = DEFAULT_BOUNDING_BOXES

    return subscription


async def stream_forever() -> None:
    subscription = build_subscription()

    while True:
        try:
            async with websockets.connect(
                WS_URL,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=5,
                max_size=10_000_000,
            ) as ws:
                # AISStream requires subscription quickly after connect.
                await ws.send(json.dumps(subscription))
                print(f"[{datetime.now(timezone.utc).isoformat()}] Subscribed to AISStream")

                async for raw_message in ws:
                    message = json.loads(raw_message)

                    if "error" in message:
                        print(f"SERVER ERROR: {message['error']}")
                        continue

                    if message.get("MessageType") != "PositionReport":
                        continue

                    metadata = message.get("MetaData", {}) or message.get("Metadata", {})
                    position = message.get("Message", {}).get("PositionReport", {})

                    print(
                        {
                            "time": datetime.now(timezone.utc).isoformat(),
                            "ship": metadata.get("ShipName"),
                            "mmsi": position.get("UserID") or metadata.get("MMSI"),
                            "lat": position.get("Latitude"),
                            "lon": position.get("Longitude"),
                            "sog": position.get("Sog"),
                            "heading": position.get("TrueHeading"),
                        }
                    )

        except Exception as exc:  # noqa: BLE001
            print(f"Connection dropped: {exc!r}. Retrying in 3 seconds...")
            await asyncio.sleep(3)


if __name__ == "__main__":
    asyncio.run(stream_forever())
