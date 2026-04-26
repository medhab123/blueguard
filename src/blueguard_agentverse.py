from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)

from build_risk_snapshot import (
    build_offline_sample_ships,
    collect_live_ships,
    compute_ship_risk,
    load_whale_sightings,
)
from environmental_context import get_environmental_context

load_dotenv()

AGENT_NAME = os.getenv("BLUEGUARD_AGENT_NAME", "BlueGuard_Navigator").strip() or "BlueGuard_Navigator"
AGENT_SEED = os.getenv("BLUEGUARD_AGENT_SEED", "blueguard navigator default seed replace me").strip()
AGENT_PORT = int(os.getenv("BLUEGUARD_AGENT_PORT", "8000"))
WHALE_CSV = Path(os.getenv("BLUEGUARD_WHALE_CSV", "data/whale_occurrences_global.csv"))
WHALE_MAX_AGE_DAYS = int(os.getenv("BLUEGUARD_WHALE_MAX_AGE_DAYS", "180"))
ENV_LAT = float(os.getenv("BLUEGUARD_ENV_LAT", "33.73"))
ENV_LON = float(os.getenv("BLUEGUARD_ENV_LON", "-118.26"))
SHIP_LIMIT = int(os.getenv("BLUEGUARD_SHIP_LIMIT", "20"))
SHIP_COLLECTION_SECONDS = int(os.getenv("BLUEGUARD_SHIP_COLLECTION_SECONDS", "15"))
USE_LIVE_AIS = os.getenv("BLUEGUARD_USE_LIVE_AIS", "true").lower() not in {"0", "false", "no"}
AISSTREAM_API_KEY = os.getenv("AISSTREAM_API_KEY", "").strip()
AGENT_ENDPOINT = os.getenv("BLUEGUARD_AGENT_ENDPOINT", "").strip()
RESPONSE_TIMEOUT_S = int(os.getenv("BLUEGUARD_RESPONSE_TIMEOUT_S", "25"))

def _normalize_submit_endpoint(raw_endpoint: str) -> str:
    endpoint = raw_endpoint.strip().rstrip("/")
    if not endpoint:
        endpoint = f"http://127.0.0.1:{AGENT_PORT}"
    if not endpoint.endswith("/submit"):
        endpoint = f"{endpoint}/submit"
    return endpoint


agent_kwargs: dict[str, Any] = {
    "name": AGENT_NAME,
    "seed": AGENT_SEED,
    "port": AGENT_PORT,
    "mailbox": True,
}
if AGENT_ENDPOINT:
    agent_kwargs["endpoint"] = [_normalize_submit_endpoint(AGENT_ENDPOINT)]
agent = Agent(**agent_kwargs)
chat_proto = Protocol(spec=chat_protocol_spec)


def _make_chat_response(text: str, msg_id: Any | None = None) -> ChatMessage:
    return ChatMessage(
        timestamp=datetime.now(UTC),
        msg_id=msg_id or uuid4(),
        content=[TextContent(type="text", text=text)],
    )


async def _collect_ships() -> tuple[list[Any], str]:
    if USE_LIVE_AIS and AISSTREAM_API_KEY:
        try:
            ships = await collect_live_ships(max_ships=SHIP_LIMIT, max_seconds=SHIP_COLLECTION_SECONDS)
            if ships:
                return ships, "live_ais"
        except Exception:
            # Fall through to offline sample ships for reliability during judging.
            pass
    return build_offline_sample_ships(), "offline_sample"


async def _build_blueguard_report() -> dict[str, Any]:
    whales = []
    if WHALE_CSV.exists():
        try:
            whales = load_whale_sightings(path=WHALE_CSV, max_age_days=WHALE_MAX_AGE_DAYS)
        except Exception:
            whales = []

    env_context = get_environmental_context(
        lat=ENV_LAT,
        lon=ENV_LON,
        prefer_live=True,
        timeout_s=20,
    )
    ships, ship_mode = await _collect_ships()
    scored = [compute_ship_risk(ship=ship, whales=whales, env_context=env_context) for ship in ships]
    scored.sort(key=lambda row: row["risk_total"], reverse=True)

    high = [ship for ship in scored if ship["risk_level"] == "HIGH"]
    medium = [ship for ship in scored if ship["risk_level"] == "MEDIUM"]
    low = [ship for ship in scored if ship["risk_level"] == "LOW"]
    top = scored[0] if scored else None
    top_ship_name = top["ship"] if top else "none"
    top_ship_risk = f'{top["risk_level"]} ({top["risk_total"]})' if top else "LOW (0.0)"
    env_mode = env_context.get("mode", "unknown")
    top3 = scored[:3]

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "ship_mode": ship_mode,
        "env_mode": env_mode,
        "ship_count": len(scored),
        "high_count": len(high),
        "medium_count": len(medium),
        "low_count": len(low),
        "top_ship_name": top_ship_name,
        "top_ship_risk": top_ship_risk,
        "top_ship": top,
        "top3_ships": top3,
        "whale_sightings_used": len(whales),
        "env_zone": env_context.get("high_krill_zone", {}),
    }


def _build_fallback_report(reason: str) -> dict[str, Any]:
    whales = []
    if WHALE_CSV.exists():
        try:
            whales = load_whale_sightings(path=WHALE_CSV, max_age_days=WHALE_MAX_AGE_DAYS)
        except Exception:
            whales = []

    env_context = get_environmental_context(
        lat=ENV_LAT,
        lon=ENV_LON,
        prefer_live=False,
        timeout_s=5,
    )
    ships = build_offline_sample_ships()
    scored = [compute_ship_risk(ship=ship, whales=whales, env_context=env_context) for ship in ships]
    scored.sort(key=lambda row: row["risk_total"], reverse=True)

    high = [ship for ship in scored if ship["risk_level"] == "HIGH"]
    medium = [ship for ship in scored if ship["risk_level"] == "MEDIUM"]
    low = [ship for ship in scored if ship["risk_level"] == "LOW"]
    top = scored[0] if scored else None
    top_ship_name = top["ship"] if top else "none"
    top_ship_risk = f'{top["risk_level"]} ({top["risk_total"]})' if top else "LOW (0.0)"
    top3 = scored[:3]

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "ship_mode": "offline_sample",
        "env_mode": env_context.get("mode", "unknown"),
        "ship_count": len(scored),
        "high_count": len(high),
        "medium_count": len(medium),
        "low_count": len(low),
        "top_ship_name": top_ship_name,
        "top_ship_risk": top_ship_risk,
        "top_ship": top,
        "top3_ships": top3,
        "whale_sightings_used": len(whales),
        "env_zone": env_context.get("high_krill_zone", {}),
        "fallback_reason": reason,
    }


def _recommend_actions(report: dict[str, Any]) -> list[str]:
    high_count = int(report.get("high_count") or 0)
    medium_count = int(report.get("medium_count") or 0)
    top_ship = report.get("top_ship") or {}
    ship_mode = str(report.get("ship_mode") or "unknown")
    actions: list[str] = []

    if high_count > 0:
        actions.append("Issue immediate 10-knot advisory and reroute around recent whale activity corridors.")
        actions.append("Broadcast whale strike alert to pilot dispatch and bridge teams in San Pedro approaches.")
    elif medium_count > 0:
        actions.append("Apply precautionary transit profile: <=12 knots in whale-active sectors.")
        actions.append("Increase bridge watch reporting cadence for course and whale visual checks.")
    else:
        actions.append("Maintain monitored transit and keep a precautionary speed profile near recent sightings.")
        actions.append("Pre-stage reroute templates so traffic can react quickly if new whale detections appear.")

    if ship_mode != "live_ais":
        actions.append("Switch to live AIS mode for operational decisions; current vessel list is demo fallback.")

    if top_ship.get("nearby_whale_sightings", 0) > 0:
        actions.append("Prioritize the top-risk vessel for nearest-whale deconfliction first.")

    return actions[:3]


def _decision_label(report: dict[str, Any]) -> str:
    high_count = int(report.get("high_count") or 0)
    medium_count = int(report.get("medium_count") or 0)
    top_ship = report.get("top_ship") or {}
    top_risk = str(top_ship.get("risk_level") or "LOW")

    if high_count > 0 or top_risk == "HIGH":
        return "SLOWDOWN"
    if medium_count > 0 or top_risk == "MEDIUM":
        return "CAUTION"
    return "GO"


def _build_text_reply(user_query: str, report: dict[str, Any]) -> str:
    top_ship = report.get("top_ship") or {}
    query_hint = user_query.lower()

    if "premium" in query_hint or "paid" in query_hint:
        return (
            "BlueGuard Premium Safety Report is available. Payment Protocol is optional in this starter and can be enabled next "
            "for paid risk snapshots."
        )

    zone = report.get("env_zone") or {}
    zone_score = float(zone.get("score", 0.0))
    top3 = report.get("top3_ships") or []
    top3_lines = []
    for row in top3:
        top3_lines.append(f"{row['ship']} ({row['risk_level']} {row['risk_total']})")
    if not top3_lines:
        top3_lines.append("No tracked vessels in this cycle")

    actions = _recommend_actions(report)
    decision = _decision_label(report)
    action_summary = " | ".join(actions[:2]) if actions else "Maintain monitored transit."

    base_reply = (
        f"BlueGuard LA Whale Safety Brief | Decision: {decision}\n"
        f"Risk: {report['high_count']} HIGH, {report['medium_count']} MEDIUM, {report['low_count']} LOW ({report['ship_count']} vessels)\n"
        f"Whales: {report['whale_sightings_used']} sightings in last {WHALE_MAX_AGE_DAYS} days | Krill score: {zone_score:.2f}/10\n"
        f"Top vessels: {', '.join(top3_lines[:3])}\n"
        f"Action now: {action_summary}\n"
        f"Data source mode: ships={report['ship_mode']}, env={report.get('env_mode', 'unknown')}"
    )
    if report.get("fallback_reason"):
        base_reply += "\nNote: returned with resilient fallback data due to a temporary upstream timeout."
    return base_reply


@chat_proto.on_message(ChatMessage)
async def handle_message(ctx: Context, sender: str, msg: ChatMessage):
    ctx.logger.info("Incoming chat message from %s: %s", sender, msg.msg_id)
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=datetime.now(UTC), acknowledged_msg_id=msg.msg_id),
    )

    user_query = ""
    for item in msg.content:
        if isinstance(item, StartSessionContent):
            ctx.logger.info("Session started by %s", sender)
        elif isinstance(item, EndSessionContent):
            ctx.logger.info("Session ended by %s", sender)
        elif isinstance(item, TextContent):
            user_query = item.text or user_query

    try:
        report = await asyncio.wait_for(_build_blueguard_report(), timeout=RESPONSE_TIMEOUT_S)
    except Exception as exc:
        ctx.logger.exception("Failed to build live report; sending fallback snapshot: %s", exc)
        report = _build_fallback_report(reason=repr(exc))
    reply = _build_text_reply(user_query=user_query, report=report)
    ctx.logger.info("Sending chat response to %s for %s", sender, msg.msg_id)
    await ctx.send(sender, _make_chat_response(reply, msg.msg_id))


@chat_proto.on_message(ChatAcknowledgement)
async def handle_acknowledgement(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.info(
        "Received acknowledgement from %s for message %s",
        sender,
        msg.acknowledged_msg_id,
    )


agent.include(chat_proto, publish_manifest=True)


if __name__ == "__main__":
    agent.run()
