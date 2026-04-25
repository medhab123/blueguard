# BlueGuard

Starter project for a whale-ship collision prevention demo.

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

## What this includes

- AISStream websocket client for the LA / San Pedro channel
- Basic project structure for building risk logic and dashboard next
- Simple setup steps for Windows PowerShell

## Project structure

```text
blueguard/
  src/
    aisstream_client.py
  .env.example
  requirements.txt
  README.md
```

## Quick start

1. Create and activate a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2. Install dependencies:

```powershell
pip install -r requirements.txt
```

3. Set your API key:

```powershell
$env:AISSTREAM_API_KEY="YOUR_API_KEY_HERE"
```

4. Run the client:

```powershell
python .\src\aisstream_client.py
```


## Get whale sightings data (global)

You can download global whale occurrence data (Cetacea) from OBIS into a CSV:

```powershell
python .\src\download_whale_data.py
```

This writes:

- `data/whale_occurrences_global.csv` (default)

Useful options:

```powershell
# Download a larger file
python .\src\download_whale_data.py --max-records 20000 --page-size 2000

# Save to custom path
python .\src\download_whale_data.py --output .\data\whales_worldwide.csv

# Fresh records only (recommended for live-ish demo data)
python .\src\download_whale_data.py --start-date 2026-01-01 --max-records 5000

# Last 30 days only (post-filter)
python .\src\download_whale_data.py --max-age-days 30 --max-records 2000
```

## Environmental context (chlorophyll + SST)

For the hackathon you can still use mock values, but this project now supports free live data:

- **SST**: Open-Meteo Marine API (free, no key)
- **Chlorophyll**: NOAA CoastWatch ERDDAP VIIRS weekly global (free, no key)

Generate one zone context JSON:

```powershell
python .\src\environmental_context.py --lat 33.9 --lon -118.4
```

This writes `data/environmental_context.json` and prints a dict shaped like:

```json
{
  "mode": "live",
  "high_krill_zone": {
    "lat": 33.9,
    "lon": -118.4,
    "score": 5.54,
    "chlorophyll_mg_m3": 0.636,
    "sea_surface_temp_c": 18.0
  }
}
```

If live APIs fail, it automatically falls back to mock values (`mode: "mock_fallback"`).

## Build a risk snapshot (ships + whales + environment)

This combines all three layers into per-ship risk scores.

```powershell
# Live mode (needs AISSTREAM_API_KEY in your shell)
python .\src\build_risk_snapshot.py

# Offline demo mode (uses sample ships, still uses your whale/env data)
python .\src\build_risk_snapshot.py --offline-sample-ships
```

Output:

- `data/risk_snapshot.json`

Tuning options:

```powershell
# Use mock environmental context
python .\src\build_risk_snapshot.py --offline-sample-ships --no-live-env

# Limit whales to recent records only
python .\src\build_risk_snapshot.py --offline-sample-ships --whale-max-age-days 14
```

## Live frontend (API-first, no local CSV reads)

A new React app lives in `frontend-live/` and pulls data directly from live sources:

- OBIS (`https://api.obis.org/v3/occurrence`) for whale sightings
- Open-Meteo Marine API for SST
- NOAA CoastWatch ERDDAP for chlorophyll
- AISStream websocket for vessel positions

Run it:

```powershell
cd .\frontend-live
npm install
npm run dev
```

Open `http://localhost:5173/`.

To avoid entering the AIS key every time, create `frontend-live/.env.local`:

```powershell
cd .\frontend-live
Copy-Item .env.example .env.local
```

Then edit `.env.local` and set:

```text
VITE_AISSTREAM_API_KEY=YOUR_AISSTREAM_API_KEY_HERE
VITE_MAPBOX_ACCESS_TOKEN=YOUR_MAPBOX_PUBLIC_TOKEN_HERE
```

Restart `npm run dev`. The Ships tab will auto-load the key, and Mapbox maps will render for:

- Dashboard combined whale + vessel view
- Whales page (whale markers)
- Ships page (vessel markers)

## Verify backend live APIs and query URLs

To confirm backend API wiring and inspect the exact live query URLs:

```powershell
python .\src\verify_live_backend.py --lat 33.9 --lon -118.4 --start-date 2026-01-01
```

This prints a JSON report with:

- OBIS query URL + returned record count
- Open-Meteo query URL + SST value
- NOAA query URL + chlorophyll value
- AIS subscription preview (including whether bounding boxes are being used)

## Notes

- AISStream requires your subscription payload to be sent quickly after websocket connect.
- Keep your AIS key private; this frontend keeps it only in current browser memory.
- By default, `src/aisstream_client.py` now streams without a bounding box; set `AISSTREAM_BOUNDING_BOXES` if you want to limit message volume.

## Fetch.ai Track 1 (Agentverse + ASI:One)

This repo now includes a default ASI:One-compatible specialist agent:

- `src/blueguard_agentverse.py`

It implements the mandatory **Chat Protocol** and publishes a manifest for Agentverse discovery.

### 1) Install backend dependencies

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2) Configure environment

```powershell
Copy-Item .env.agentverse.example .env
```

Then edit `.env` and set at least:

- `BLUEGUARD_AGENT_SEED`
- `AISSTREAM_API_KEY` (optional; if missing, agent falls back to offline sample ships)

### 3) Run the Agentverse-compatible agent

```powershell
python .\src\blueguard_agentverse.py
```

### 4) Register on Agentverse

Use **Managed Agents -> External Agent** (or hosted if preferred), then ensure:

- Agent is active
- Discoverability is enabled on ASI:One
- Chat Protocol manifest is visible

### 5) Test from ASI:One

Example query:

`Is there whale activity near the Port of LA and what is BlueGuard doing about it?`

The agent returns:

- risk summary (high/medium counts)
- top-risk vessel
- action recommendation
- whale context count

### Payment Protocol

Payment Protocol is optional in this starter and can be added next for premium safety reports.

## Devpost submission checklist

- Public GitHub repo URL
- Agentverse profile URL
- ASI:One shared chat session URL
- 3-5 minute demo video
