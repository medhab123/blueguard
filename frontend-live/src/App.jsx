import { useEffect, useMemo, useRef, useState } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"

const WS_PROTOCOL = window.location.protocol === "https:" ? "wss" : "ws"
const AIS_WS_PROXY_URL = `${WS_PROTOCOL}://${window.location.host}/ws/ais`
const AIS_WS_DIRECT_URL = "wss://stream.aisstream.io/v0/stream"
const OBIS_API_URL = "/api/obis"
const GBIF_API_URL = "/api/gbif"
const INAT_API_URL = "/api/inat"
const OPEN_METEO_URL = "/api/openmeteo"
const NOAA_URL = "/api/noaa"
const DEFAULT_CENTER = { lat: 33.9, lon: -118.4 }
const LA_CENTER = { lat: 33.73, lon: -118.26 }
const LA_BOUNDS = {
  minLat: 32,
  maxLat: 35,
  minLon: -121,
  maxLon: -117
}
const AIS_LA_BBOX = [[[33.5, -118.8], [34.2, -117.8]]]
const AIS_SILENCE_RECONNECT_MS = 25000
const AIS_UI_FLUSH_MS = 2000
const LIVE_API_REFRESH_MS = 5 * 60 * 1000
const DEFAULT_WHALE_LIVE_WINDOW_DAYS = 180
const DEFAULT_SHIP_LIVE_WINDOW_DAYS = 30
const LIVE_WINDOW_OPTIONS_DAYS = [30, 90, 180, 365]
const MAP_DEFAULT_ZOOM_SHIPS = 11.5
const MAP_DEFAULT_ZOOM_OTHER = 8
const MAP_FOCUS_MIN_ZOOM = 11.5
const MAP_FIT_MAX_ZOOM = 11
const CONTEXT_RADIUS_KM = 80
const AIS_KEY_STORAGE_KEY = "blueguard_aisstream_api_key"
const ENV_AIS_KEY =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_AISSTREAM_API_KEY
    ? String(import.meta.env.VITE_AISSTREAM_API_KEY).trim()
    : ""
const ENV_MAPBOX_TOKEN =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_MAPBOX_ACCESS_TOKEN
    ? String(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN).trim()
    : ""

const getStoredAisKey = () => {
  if (typeof window === "undefined") return ""
  try {
    return window.localStorage.getItem(AIS_KEY_STORAGE_KEY) || ""
  } catch {
    return ""
  }
}

const OBIS_FIELDS = [
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
  "sst"
]

const NAV = ["Home", "Dashboard", "Whales", "Ships", "Impact", "About"]
const SPECIES_COMMON_NAMES = {
  "Megaptera novaeangliae": "Humpback whale",
  "Balaenoptera musculus": "Blue whale",
  "Balaenoptera physalus": "Fin whale",
  "Eschrichtius robustus": "Gray whale",
  "Physeter macrocephalus": "Sperm whale"
}
const WHALE_SPECIES_COLOR = {
  "Balaenoptera musculus": "blue-whale",
  "Balaenoptera physalus": "fin-whale",
  "Megaptera novaeangliae": "humpback-whale",
  "Eschrichtius robustus": "gray-whale",
  default: "other-whale"
}

const fmt = (value, fallback = "N/A") => {
  if (value === null || value === undefined || value === "") return fallback
  return value
}

const inLaBounds = (lat, lon) =>
  lat >= LA_BOUNDS.minLat &&
  lat <= LA_BOUNDS.maxLat &&
  lon >= LA_BOUNDS.minLon &&
  lon <= LA_BOUNDS.maxLon

const toCommonName = (scientificName, fallback) =>
  SPECIES_COMMON_NAMES[scientificName] || fallback || scientificName || "Unknown whale"

const toEpochMs = (value) => {
  if (!value) return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

const parseIsoDayToUtcMs = (isoDay, endOfDay = false) => {
  if (!isoDay || !/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) return null
  const [y, m, d] = isoDay.split("-").map((part) => Number(part))
  if (![y, m, d].every(Number.isFinite)) return null
  return endOfDay
    ? Date.UTC(y, m - 1, d, 23, 59, 59, 999)
    : Date.UTC(y, m - 1, d, 0, 0, 0, 0)
}

const normalizeHeading = (value) => {
  const heading = toNum(value)
  if (heading === null) return null
  if (heading === 511 || heading === 0) return null
  const normalized = ((heading % 360) + 360) % 360
  return Number.isFinite(normalized) ? normalized : null
}

const timeSinceLabel = (value) => {
  const ts = toEpochMs(value)
  if (ts === null) return "unknown"
  const diffMs = Math.max(0, Date.now() - ts)
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ago`
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const mins = Math.max(1, Math.floor(diffMs / (1000 * 60)))
  return `${mins} min ago`
}

const isoDateDaysAgo = (daysAgo) => {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

const isoDateToday = () => new Date().toISOString().slice(0, 10)

const decodeWsPayload = async (data) => {
  if (typeof data === "string") return data
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text()
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data))
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data)
  }
  return String(data ?? "")
}

const parseAisMessage = (msg) => {
  const messageType = msg?.MessageType
  if (messageType !== "PositionReport") return null
  const meta = msg.MetaData || msg.Metadata || {}
  const pos = msg.Message?.PositionReport || {}
  return { meta, pos }
}

const destinationPointKm = (lat, lon, bearingDeg, distanceKm) => {
  const R = 6371
  const bearing = (bearingDeg * Math.PI) / 180
  const lat1 = (lat * Math.PI) / 180
  const lon1 = (lon * Math.PI) / 180
  const angularDistance = distanceKm / R

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  )
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    )

  return {
    lat: (lat2 * 180) / Math.PI,
    lon: (lon2 * 180) / Math.PI
  }
}

const toNum = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const riskBand = (score) => {
  if (score >= 40) return "high"
  if (score >= 25) return "medium"
  return "low"
}

const recommendedAction = (ship) => {
  const speed = Number(ship?.sog || 0)
  const risk = Number(ship?.riskScore || 0)
  if (speed > 10 && risk > 30) return "Reduce to 10 kts and apply reroute"
  if (risk >= 40) return "Reroute 20 deg starboard"
  if (risk >= 25) return "Monitor and prepare mitigation"
  return "Continue monitored transit"
}

const formatLiveWindowLabel = (days) => {
  if (days === 30) return "Last Month"
  if (days === 90) return "Last 3 Months"
  if (days === 180) return "Last 6 Months"
  if (days === 365) return "Last 12 Months"
  return `Last ${days} Days`
}

const sanitizeWindowDays = (value, fallback) => {
  const next = Number(value)
  if (!Number.isFinite(next)) return fallback
  return LIVE_WINDOW_OPTIONS_DAYS.includes(next) ? next : fallback
}

const renderWhalePopupHtml = (whale, isSelected = false, pathCount = null) => {
  const title = isSelected ? "Selected Whale" : "Whale Sighting"
  const pathRow =
    pathCount !== null
      ? `<div class="map-hover-row"><strong>Path Points:</strong> ${fmt(pathCount)}</div>`
      : ""
  return `
    <div class="map-hover-card">
      <div class="map-hover-title">${title}: ${fmt(whale.commonName || whale.species)}</div>
      <div class="map-hover-row"><strong>Species:</strong> ${fmt(whale.species)}</div>
      <div class="map-hover-row"><strong>Scientific:</strong> ${fmt(whale.scientificName)}</div>
      <div class="map-hover-row"><strong>Observed:</strong> ${fmt(whale.observedAt)}</div>
      <div class="map-hover-row"><strong>Last Seen:</strong> ${timeSinceLabel(whale.observedAt)}</div>
      <div class="map-hover-row"><strong>Lat/Lon:</strong> ${Number(whale.lat).toFixed(4)}, ${Number(whale.lon).toFixed(4)}</div>
      <div class="map-hover-row"><strong>Count:</strong> ${fmt(whale.count)}</div>
      <div class="map-hover-row"><strong>Record:</strong> ${fmt(whale.basisOfRecord)}</div>
      <div class="map-hover-row"><strong>Depth (m):</strong> ${fmt(whale.depthM)}</div>
      <div class="map-hover-row"><strong>SST (C):</strong> ${fmt(whale.seaSurfaceTempC)}</div>
      <div class="map-hover-row"><strong>Coord Uncertainty (m):</strong> ${fmt(
        whale.coordinateUncertaintyMeters
      )}</div>
      <div class="map-hover-row"><strong>Occurrence ID:</strong> ${fmt(whale.occurrenceId || whale.id)}</div>
      <div class="map-hover-row"><strong>Source:</strong> ${fmt(whale.sourceSystem || whale.source)}</div>
      ${pathRow}
    </div>
  `
}

const renderShipPopupHtml = (ship, isSelected = false, pathCount = null) => {
  const title = isSelected ? "Selected Vessel" : "Vessel"
  const pathRow =
    pathCount !== null
      ? `<div class="map-hover-row"><strong>Path Points:</strong> ${fmt(pathCount)}</div>`
      : ""
  return `
    <div class="map-hover-card">
      <div class="map-hover-title">${title}: ${fmt(ship.shipName)}</div>
      <div class="map-hover-row"><strong>MMSI:</strong> ${fmt(ship.mmsi)}</div>
      <div class="map-hover-row"><strong>Risk:</strong> ${fmt(ship.riskBand?.toUpperCase())} ${fmt(ship.riskScore)}</div>
      <div class="map-hover-row"><strong>SOG:</strong> ${fmt(ship.sog)} kn</div>
      <div class="map-hover-row"><strong>Heading:</strong> ${fmt(ship.heading)}</div>
      <div class="map-hover-row"><strong>Nearest Whale:</strong> ${fmt(ship.nearestWhaleKm?.toFixed?.(2))} km</div>
      <div class="map-hover-row"><strong>Updated:</strong> ${fmt(ship.updatedAt)}</div>
      <div class="map-hover-row"><strong>Lat/Lon:</strong> ${fmt(ship.lat)}, ${fmt(ship.lon)}</div>
      <div class="map-hover-row"><strong>Action:</strong> ${recommendedAction(ship)}</div>
      ${pathRow}
    </div>
  `
}

function LiveMap({
  whales,
  ships,
  height = 360,
  onWhaleSelect,
  onShipSelect,
  selectedWhale = null,
  selectedShip = null,
  focusTarget,
  whalePathPoints = [],
  shipPathPoints = [],
  mapScope = "dashboard"
}) {
  const [mapReadyTick, setMapReadyTick] = useState(0)
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRefs = useRef([])
  const popupRef = useRef(null)
  const mapInstanceIdRef = useRef(`live-map-${Math.random().toString(36).slice(2)}`)
  const pinnedViewUntilRef = useRef(0)
  const lastFocusedRef = useRef(null)
  const onWhaleSelectRef = useRef(onWhaleSelect)
  const onShipSelectRef = useRef(onShipSelect)

  useEffect(() => {
    onWhaleSelectRef.current = onWhaleSelect
  }, [onWhaleSelect])

  useEffect(() => {
    onShipSelectRef.current = onShipSelect
  }, [onShipSelect])

  useEffect(() => {
    if (!ENV_MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    mapboxgl.accessToken = ENV_MAPBOX_TOKEN
    mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center:
        mapScope === "ships" || mapScope === "dashboard"
          ? [LA_CENTER.lon, LA_CENTER.lat]
          : [DEFAULT_CENTER.lon, DEFAULT_CENTER.lat],
      zoom: mapScope === "ships" || mapScope === "dashboard" ? MAP_DEFAULT_ZOOM_SHIPS : MAP_DEFAULT_ZOOM_OTHER
    })
    mapRef.current.addControl(new mapboxgl.NavigationControl(), "top-right")
    mapRef.current.on("load", () => setMapReadyTick((v) => v + 1))

    return () => {
      markerRefs.current.forEach((m) => m.remove())
      markerRefs.current = []
      popupRef.current?.remove()
      popupRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!map.isStyleLoaded()) return

    markerRefs.current.forEach((m) => m.remove())
    markerRefs.current = []
    popupRef.current?.remove()
    popupRef.current = null

    const bounds = new mapboxgl.LngLatBounds()
    let points = 0

    whales.slice(0, 600).forEach((w) => {
      const observedMs = toEpochMs(w.observedAt)
      const ageDays =
        observedMs === null ? Number.POSITIVE_INFINITY : Math.floor((Date.now() - observedMs) / (1000 * 60 * 60 * 24))
      const recencyClass = ageDays <= 7 ? "recent" : ageDays <= 30 ? "mid" : "old"
      const speciesClass = WHALE_SPECIES_COLOR[w.scientificName] || WHALE_SPECIES_COLOR.default
      const markerEl = document.createElement("div")
      markerEl.className = `map-marker whale ${speciesClass} ${recencyClass}`
      markerEl.style.cursor = "pointer"
      markerEl.addEventListener("click", () => {
        if (onWhaleSelectRef.current) onWhaleSelectRef.current(w)
        popupRef.current?.remove()
        popupRef.current = new mapboxgl.Popup({
          offset: 16,
          closeButton: false,
          className: "map-node-hover-card"
        })
          .setLngLat([w.lon, w.lat])
          .setHTML(renderWhalePopupHtml(w))
          .addTo(map)
      })
      const marker = new mapboxgl.Marker({ element: markerEl }).setLngLat([w.lon, w.lat]).addTo(map)
      markerRefs.current.push(marker)
      bounds.extend([w.lon, w.lat])
      points += 1
    })

    ships.slice(0, 600).forEach((s) => {
      const markerEl = document.createElement("div")
      markerEl.className = `map-marker ship ${s.riskBand || "low"}`
      markerEl.style.cursor = "pointer"
      markerEl.addEventListener("click", () => {
        if (onShipSelectRef.current) onShipSelectRef.current(s)
        popupRef.current?.remove()
        popupRef.current = new mapboxgl.Popup({
          offset: 16,
          closeButton: false,
          className: "map-node-hover-card"
        })
          .setLngLat([s.lon, s.lat])
          .setHTML(renderShipPopupHtml(s))
          .addTo(map)
      })
      const marker = new mapboxgl.Marker({ element: markerEl }).setLngLat([s.lon, s.lat]).addTo(map)
      markerRefs.current.push(marker)
      bounds.extend([s.lon, s.lat])
      points += 1
    })

    const upsertGeojsonLayer = (idPrefix, features, type, paint, layout) => {
      const sourceId = `${mapInstanceIdRef.current}-${idPrefix}-source`
      const layerId = `${mapInstanceIdRef.current}-${idPrefix}-layer`
      const geojson = { type: "FeatureCollection", features }
      if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(geojson)
      } else {
        map.addSource(sourceId, { type: "geojson", data: geojson })
        map.addLayer({
          id: layerId,
          type,
          source: sourceId,
          paint,
          layout
        })
      }
    }

    const whaleDangerFeatures = whales.slice(0, 300).map((w) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [w.lon, w.lat] },
      properties: {
        radius:
          String(w.basisOfRecord || "").toLowerCase().includes("acoustic") ||
          String(w.sourceSystem || "").toLowerCase().includes("sanctsound")
            ? 3000
            : 5000
      }
    }))
    upsertGeojsonLayer(
      "whale-danger",
      whaleDangerFeatures,
      "circle",
      {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          ["*", ["get", "radius"], 0.0007],
          10,
          ["*", ["get", "radius"], 0.004]
        ],
        "circle-color": "#ef4444",
        "circle-opacity": 0.15,
        "circle-stroke-color": "#ef4444",
        "circle-stroke-opacity": 0.6,
        "circle-stroke-width": 1.5
      }
    )

    const rerouteCurrentFeatures = []
    const rerouteSafeFeatures = []
    const highRiskRerouteShips = ships
      .filter((s) => s.riskScore >= 70 && s.isMoving)
      .slice(0, 40)
    highRiskRerouteShips.forEach((s) => {
        const heading = Number.isFinite(s.heading) ? s.heading : 90
        const turnDeg = Math.max(2, Math.min(20, Math.round((s.riskScore - 60) / 2)))
        const currentLineEnd = destinationPointKm(s.lat, s.lon, heading, 10)
        const safeLineEnd = destinationPointKm(s.lat, s.lon, heading + turnDeg, 10)
        rerouteCurrentFeatures.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [s.lon, s.lat],
              [currentLineEnd.lon, currentLineEnd.lat]
            ]
          },
          properties: {}
        })
        rerouteSafeFeatures.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [s.lon, s.lat],
              [safeLineEnd.lon, safeLineEnd.lat]
            ]
          },
          properties: {}
        })
      })

    const headingVectorFeatures = ships
      .filter((s) => s.isMoving && Number.isFinite(s.heading))
      .slice(0, 200)
      .map((s) => {
        const nearest = Number(s.nearestWhaleKm || Number.POSITIVE_INFINITY)
        const lineEnd = destinationPointKm(s.lat, s.lon, s.heading, 1.2)
        const color = nearest <= 5 ? "#ef4444" : nearest <= 12 ? "#f59e0b" : "#22c55e"
        return {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [s.lon, s.lat],
              [lineEnd.lon, lineEnd.lat]
            ]
          },
          properties: { color }
        }
      })
    upsertGeojsonLayer(
      "heading-vectors",
      headingVectorFeatures,
      "line",
      {
        "line-width": 1.6,
        "line-color": ["coalesce", ["get", "color"], "#22c55e"],
        "line-opacity": 0.85
      }
    )
    upsertGeojsonLayer(
      "reroute-current-lines",
      rerouteCurrentFeatures,
      "line",
      {
        "line-width": 2.5,
        "line-color": "#ef4444",
        "line-dasharray": [2, 2],
        "line-opacity": 0.9
      }
    )
    upsertGeojsonLayer(
      "reroute-safe-lines",
      rerouteSafeFeatures,
      "line",
      {
        "line-width": 2.5,
        "line-color": "#22c55e",
        "line-opacity": 0.9
      }
    )

    const isPinned = Date.now() < pinnedViewUntilRef.current
    if (points > 0 && !isPinned && mapScope !== "ships") {
      map.fitBounds(bounds, { padding: 32, maxZoom: MAP_FIT_MAX_ZOOM, duration: 700 })
    } else if (!isPinned && mapScope === "ships") {
      map.easeTo({
        center: [LA_CENTER.lon, LA_CENTER.lat],
        zoom: MAP_DEFAULT_ZOOM_SHIPS,
        duration: 700
      })
    } else if (points === 0 && !isPinned) {
      map.easeTo({ center: [DEFAULT_CENTER.lon, DEFAULT_CENTER.lat], zoom: 2, duration: 700 })
    }
  }, [whales, ships, mapScope, mapReadyTick])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focusTarget) return
    const last = lastFocusedRef.current
    const sameTarget =
      last &&
      last.key === focusTarget.key &&
      Math.abs(last.lat - focusTarget.lat) < 1e-6 &&
      Math.abs(last.lon - focusTarget.lon) < 1e-6
    if (sameTarget) return

    pinnedViewUntilRef.current = Date.now() + 30_000
    lastFocusedRef.current = {
      lat: focusTarget.lat,
      lon: focusTarget.lon,
      key: focusTarget.key || null
    }
    map.flyTo({
      center: [focusTarget.lon, focusTarget.lat],
      zoom: Math.max(map.getZoom(), MAP_FOCUS_MIN_ZOOM),
      duration: 900,
      essential: true
    })
  }, [focusTarget])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const selectedShipOnMap =
      selectedShip &&
      Number.isFinite(selectedShip.lat) &&
      Number.isFinite(selectedShip.lon) &&
      ships.some((s) => String(s.mmsi) === String(selectedShip.mmsi))

    const selectedWhaleOnMap =
      selectedWhale &&
      Number.isFinite(selectedWhale.lat) &&
      Number.isFinite(selectedWhale.lon) &&
      whales.some(
        (w) =>
          String(w.occurrenceId || w.id) ===
          String(selectedWhale.occurrenceId || selectedWhale.id)
      )

    if (!selectedShipOnMap && !selectedWhaleOnMap) return

    popupRef.current?.remove()
    if (selectedShipOnMap) {
      popupRef.current = new mapboxgl.Popup({
        offset: 18,
        closeButton: false,
        closeOnClick: false,
        className: "map-node-hover-card"
      })
        .setLngLat([selectedShip.lon, selectedShip.lat])
        .setHTML(renderShipPopupHtml(selectedShip, true, shipPathPoints.length))
        .addTo(map)
      return
    }

    popupRef.current = new mapboxgl.Popup({
      offset: 18,
      closeButton: false,
      closeOnClick: false,
      className: "map-node-hover-card"
    })
      .setLngLat([selectedWhale.lon, selectedWhale.lat])
      .setHTML(renderWhalePopupHtml(selectedWhale, true, whalePathPoints.length))
      .addTo(map)
  }, [selectedWhale, selectedShip, whales, ships, whalePathPoints.length, shipPathPoints.length, mapReadyTick])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!map.isStyleLoaded()) return

    const updatePathLayer = (kind, points, color) => {
      const sourceId = `${mapInstanceIdRef.current}-${kind}-path-source`
      const layerId = `${mapInstanceIdRef.current}-${kind}-path-layer`
      const linePoints = points.filter(
        (p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat)
      )
      const geojson = {
        type: "FeatureCollection",
        features:
          linePoints.length >= 2
            ? [
                {
                  type: "Feature",
                  geometry: {
                    type: "LineString",
                    coordinates: linePoints.map((p) => [p.lon, p.lat])
                  },
                  properties: {}
                }
              ]
            : []
      }

      if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(geojson)
      } else {
        map.addSource(sourceId, { type: "geojson", data: geojson })
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": color,
            "line-width": 3,
            "line-opacity": 0.9
          }
        })
      }
    }

    const renderPaths = () => {
      updatePathLayer("whale", whalePathPoints, "#14b8a6")
      updatePathLayer("ship", shipPathPoints, "#f59e0b")
    }

    if (map.isStyleLoaded()) {
      renderPaths()
    } else {
      map.once("load", renderPaths)
    }
  }, [whalePathPoints, shipPathPoints, mapReadyTick])

  if (!ENV_MAPBOX_TOKEN) {
    return (
      <div className="info" style={{ marginTop: "8px" }}>
        Mapbox map is disabled. Set <code>VITE_MAPBOX_ACCESS_TOKEN</code> in{" "}
        <code>frontend-live/.env.local</code> and restart <code>npm run dev</code>.
      </div>
    )
  }

  return <div className="mapbox-container" style={{ height: `${height}px` }} ref={containerRef} />
}

const sanitizeWhaleRow = (row) => {
  if (row.lat === null || row.lon === null) return null
  if (
    row.coordinateUncertaintyMeters !== null &&
    Number.isFinite(row.coordinateUncertaintyMeters) &&
    row.coordinateUncertaintyMeters > 5000
  ) {
    return null
  }
  return row
}

const dedupeWhaleRows = (rows) => {
  const out = new Map()
  for (const row of rows) {
    const observedDay = (row.observedAt || "").slice(0, 10)
    const key =
      row.occurrenceId ||
      `${(row.scientificName || row.species || "unknown").toLowerCase()}|${row.lat?.toFixed?.(4) || row.lat}|${row.lon?.toFixed?.(4) || row.lon}|${observedDay}`
    if (!out.has(key)) out.set(key, row)
  }
  return Array.from(out.values())
}

async function fetchWhalesFromObis(maxRecords = 1200, pageSize = 1000) {
  const startDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 730)
    .toISOString()
    .slice(0, 10)

  const allRows = []
  let after = null

  while (allRows.length < maxRecords) {
    const params = new URLSearchParams({
      scientificname: "Cetacea",
      size: String(pageSize),
      startdate: startDate,
      fields: OBIS_FIELDS.join(",")
    })
    if (after) params.set("after", String(after))

    const url = `${OBIS_API_URL}?${params.toString()}`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`OBIS fetch failed (${response.status})`)
    }
    const payload = await response.json()
    const rows = Array.isArray(payload.results) ? payload.results : []
    if (!rows.length) break

    allRows.push(...rows)
    after = rows[rows.length - 1]?.id
    if (!after || rows.length < pageSize) break
  }

  return allRows
    .slice(0, maxRecords)
    .map((row) => {
      const lat = toNum(row.decimalLatitude)
      const lon = toNum(row.decimalLongitude)
      const parsed = sanitizeWhaleRow({
        id: row.id || crypto.randomUUID(),
        occurrenceId: row.occurrenceID || null,
        scientificName: row.scientificName || null,
        species: toCommonName(row.scientificName, row.species || row.scientificName || "Unknown whale"),
        commonName: toCommonName(row.scientificName, row.vernacularName || row.species || row.scientificName),
        observedAt: row.eventDate || null,
        lat,
        lon,
        basisOfRecord: row.basisOfRecord || null,
        count: toNum(row.individualCount),
        coordinateUncertaintyMeters: toNum(row.coordinateUncertaintyInMeters),
        depthM: toNum(row.depth),
        seaSurfaceTempC: toNum(row.sst),
        source: row.datasetName || "OBIS",
        sourceSystem: "OBIS"
      })
      return parsed
    })
    .filter(Boolean)
}

async function fetchWhalesFromGbif(limit = 1200) {
  const params = new URLSearchParams({
    taxonKey: "733",
    year: "2024,2027",
    limit: String(limit),
    hasCoordinate: "true",
    occurrenceStatus: "PRESENT"
  })
  const url = `${GBIF_API_URL}?${params.toString()}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`GBIF fetch failed (${response.status})`)
  const payload = await response.json()
  const rows = Array.isArray(payload.results) ? payload.results : []
  return rows
    .map((row) => {
      const lat = toNum(row.decimalLatitude)
      const lon = toNum(row.decimalLongitude)
      return sanitizeWhaleRow({
        id: row.key ? String(row.key) : crypto.randomUUID(),
        occurrenceId: row.occurrenceID || (row.key ? String(row.key) : null),
        scientificName: row.scientificName || row.species || null,
        species: toCommonName(
          row.scientificName || row.species || null,
          row.vernacularName || row.species || "Unknown whale"
        ),
        commonName: toCommonName(row.scientificName || row.species, row.vernacularName || row.species),
        observedAt: row.eventDate || row.dateIdentified || null,
        lat,
        lon,
        basisOfRecord: row.basisOfRecord || null,
        count: toNum(row.individualCount),
        coordinateUncertaintyMeters: toNum(row.coordinateUncertaintyInMeters),
        depthM: toNum(row.depth),
        seaSurfaceTempC: null,
        source: row.datasetName || "GBIF",
        sourceSystem: "GBIF"
      })
    })
    .filter(Boolean)
}

async function fetchWhalesFromINat(perPage = 200) {
  const startDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 730)
    .toISOString()
    .slice(0, 10)
  const params = new URLSearchParams({
    taxon_name: "Cetacea",
    per_page: String(perPage),
    order_by: "observed_on",
    d1: startDate
  })
  const url = `${INAT_API_URL}?${params.toString()}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`iNaturalist fetch failed (${response.status})`)
  const payload = await response.json()
  const rows = Array.isArray(payload.results) ? payload.results : []
  return rows
    .map((row) => {
      const loc = String(row.location || "")
      const [latRaw, lonRaw] = loc.split(",")
      const lat = toNum(latRaw)
      const lon = toNum(lonRaw)
      const scientificName = row?.taxon?.name || null
      return sanitizeWhaleRow({
        id: row.id ? `inat-${row.id}` : crypto.randomUUID(),
        occurrenceId: row.id ? `inat-${row.id}` : null,
        scientificName,
        species: toCommonName(scientificName, row?.taxon?.preferred_common_name || "Unknown whale"),
        commonName: toCommonName(scientificName, row?.taxon?.preferred_common_name || scientificName),
        observedAt: row.observed_on || row.time_observed_at || null,
        lat,
        lon,
        basisOfRecord: "HumanObservation",
        count: 1,
        coordinateUncertaintyMeters: toNum(row.positional_accuracy),
        depthM: null,
        seaSurfaceTempC: null,
        source: "iNaturalist",
        sourceSystem: "iNaturalist"
      })
    })
    .filter(Boolean)
}

async function fetchWhalesLive() {
  const results = await Promise.allSettled([
    fetchWhalesFromObis(),
    fetchWhalesFromGbif(),
    fetchWhalesFromINat()
  ])
  const combined = []
  for (const result of results) {
    if (result.status === "fulfilled") combined.push(...result.value)
  }
  return dedupeWhaleRows(combined)
}

async function fetchSstLive(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "sea_surface_temperature",
    timezone: "UTC"
  })
  const url = `${OPEN_METEO_URL}?${params.toString()}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Open-Meteo fetch failed (${response.status})`)
  }
  const data = await response.json()
  return {
    tempC: toNum(data?.current?.sea_surface_temperature),
    observedAt: data?.current?.time || null,
    source: "Open-Meteo Marine API"
  }
}

async function fetchChlLive(lat, lon) {
  const query = `chlor_a[(last)][(0.0)][(${lat})][(${lon})]`
  const url = `${NOAA_URL}?${query}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`NOAA fetch failed (${response.status})`)
  }
  const text = await response.text()
  const lines = text.split(/\r?\n/).filter(Boolean)
  let observedAt = null
  let value = null
  const headerCols = lines[0]?.split(",") || []
  const chlorIndex = Math.max(
    0,
    headerCols.findIndex((col) => col.replaceAll('"', "").trim().toLowerCase() === "chlor_a")
  )
  const timeIndex = Math.max(
    0,
    headerCols.findIndex((col) => col.replaceAll('"', "").trim().toLowerCase() === "time")
  )

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",")
    if (cols.length <= chlorIndex) continue
    const n = Number(cols[chlorIndex])
    if (Number.isFinite(n)) {
      observedAt = (cols[timeIndex] || cols[0]).replaceAll('"', "")
      value = n
      break
    }
  }
  if (value !== null && (value < 0 || value > 50)) {
    value = null
  }
  return {
    chlorophyll: value,
    observedAt,
    source: "NOAA CoastWatch ERDDAP"
  }
}

function computeKrillScore(chlorophyll, tempC) {
  if (chlorophyll === null || tempC === null) return null
  const chlorophyllComponent = (Math.min(Math.max(chlorophyll, 0), 2) / 2) * 8
  let tempComponent = 0
  if (tempC >= 8 && tempC <= 18) tempComponent = 2
  else if (tempC >= 6 && tempC <= 22) tempComponent = 1
  return Math.min(10, chlorophyllComponent + tempComponent)
}

function computeShipRisk(ship, whales, envScore) {
  const speed = toNum(ship.sog) ?? 0
  const isMoving = speed >= 1
  const nearest = whales.reduce((best, whale) => {
    const km = haversineKm(ship.lat, ship.lon, whale.lat, whale.lon)
    return km < best ? km : best
  }, Number.POSITIVE_INFINITY)

  const whaleScore = Number.isFinite(nearest)
    ? Math.max(0, 50 - Math.min(50, nearest * 4))
    : 0
  const speedScore = Math.min(30, speed * 2)
  const envComponent = envScore === null ? 0 : envScore * 2
  const rawScore = Math.round(Math.min(100, whaleScore + speedScore + envComponent))
  const score = isMoving ? rawScore : Math.min(rawScore, 20)

  return {
    ...ship,
    isMoving,
    nearestWhaleKm: Number.isFinite(nearest) ? nearest : null,
    riskScore: score,
    riskBand: riskBand(score)
  }
}

function App() {
  const [activePage, setActivePage] = useState("Home")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [whales, setWhales] = useState([])
  const [env, setEnv] = useState({
    tempC: null,
    chlorophyll: null,
    krillScore: null,
    observedAt: null
  })
  const [ships, setShips] = useState([])
  const [shipTrackHistory, setShipTrackHistory] = useState({})
  const [selectedWhale, setSelectedWhale] = useState(null)
  const [selectedShip, setSelectedShip] = useState(null)
  const [focusTarget, setFocusTarget] = useState(null)
  const [aisKey, setAisKey] = useState(() => ENV_AIS_KEY || getStoredAisKey())
  const [aisConnected, setAisConnected] = useState(false)
  const [lastLivePullAt, setLastLivePullAt] = useState(null)
  const [aisDebug, setAisDebug] = useState({
    endpoint: "none",
    rawFrames: 0,
    messages: 0,
    lastMessageAt: null,
    reconnects: 0,
    lastRawType: "none",
    lastRawSnippet: "",
    lastUiFlushAt: null
  })
  const aisBufferRef = useRef(new Map())
  const shipTrackHistoryRef = useRef(new Map())
  const aisBufferedCountRef = useRef(0)
  const [whaleSearch, setWhaleSearch] = useState("")
  const [whaleStartDate, setWhaleStartDate] = useState(() => isoDateDaysAgo(180))
  const [whaleEndDate, setWhaleEndDate] = useState(() => isoDateToday())
  const [whaleMinCount, setWhaleMinCount] = useState("")
  const [shipRiskFilter, setShipRiskFilter] = useState("all")
  const [shipMinSpeed, setShipMinSpeed] = useState("")
  const [shipUpdatedWindowMin, setShipUpdatedWindowMin] = useState("")
  const [whalePanelMode, setWhalePanelMode] = useState("live")
  const [shipPanelMode, setShipPanelMode] = useState("live")
  const [whaleLiveWindowDays, setWhaleLiveWindowDays] = useState(DEFAULT_WHALE_LIVE_WINDOW_DAYS)
  const [shipLiveWindowDays, setShipLiveWindowDays] = useState(DEFAULT_SHIP_LIVE_WINDOW_DAYS)
  const [trackerTab, setTrackerTab] = useState("whales")
  const [demoScenarioEnabled, setDemoScenarioEnabled] = useState(false)
  const [showAisKey, setShowAisKey] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const advisorySentRef = useRef(new Set())
  const [advisoryTick, setAdvisoryTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key.toLowerCase() === "d") {
        setDemoScenarioEnabled((prev) => !prev)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const trimmed = aisKey.trim()
      if (!trimmed) {
        window.localStorage.removeItem(AIS_KEY_STORAGE_KEY)
        return
      }
      window.localStorage.setItem(AIS_KEY_STORAGE_KEY, trimmed)
    } catch {
      // Ignore localStorage failures.
    }
  }, [aisKey])

  useEffect(() => {
    let cancelled = false
    async function loadLive() {
      setLoading(true)
      setError("")
      try {
        const [whaleRows, sst, chl] = await Promise.all([
          fetchWhalesLive(),
          fetchSstLive(DEFAULT_CENTER.lat, DEFAULT_CENTER.lon),
          fetchChlLive(DEFAULT_CENTER.lat, DEFAULT_CENTER.lon)
        ])
        if (cancelled) return
        setLastLivePullAt(new Date().toISOString())
        const krill = computeKrillScore(chl.chlorophyll, sst.tempC)
        setWhales(whaleRows)
        setSelectedWhale((prev) => {
          if (!prev?.id) return prev
          return whaleRows.find((w) => w.id === prev.id) || null
        })
        setEnv({
          tempC: sst.tempC,
          chlorophyll: chl.chlorophyll,
          krillScore: krill,
          observedAt: sst.observedAt || chl.observedAt,
          tempSource: sst.source,
          chlSource: chl.source
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load live data")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadLive()
    const id = setInterval(loadLive, LIVE_API_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    if (!aisKey.trim()) return undefined
    const endpointQueue = [AIS_WS_PROXY_URL, AIS_WS_DIRECT_URL]
    let alive = true
    let reconnectTimer = null
    let silenceTimer = null
    let flushTimer = null
    let ws = null

    const flushShipBuffer = () => {
      const bufferedShips = Array.from(aisBufferRef.current.values()).slice(-700)
      setShips(bufferedShips)
      const historySnapshot = {}
      for (const [mmsi, points] of shipTrackHistoryRef.current.entries()) {
        historySnapshot[mmsi] = points.slice(-200)
      }
      setShipTrackHistory(historySnapshot)
      setAisDebug((prev) => ({
        ...prev,
        lastUiFlushAt: new Date().toISOString()
      }))
      aisBufferedCountRef.current = 0
    }

    const connect = (attempt = 0) => {
      if (!alive) return
      const endpoint = endpointQueue[attempt % endpointQueue.length]
      const subscription = {
        APIKey: aisKey.trim(),
        BoundingBoxes: AIS_LA_BBOX,
        FilterMessageTypes: ["PositionReport"]
      }

      ws = new WebSocket(endpoint)
      ws.binaryType = "arraybuffer"
      setAisDebug((prev) => ({ ...prev, endpoint }))

      ws.onopen = () => {
        if (!alive) return
        setAisConnected(true)
        setError("")
        ws.send(JSON.stringify(subscription))
        if (silenceTimer) window.clearTimeout(silenceTimer)
        silenceTimer = window.setTimeout(() => {
          ws?.close()
        }, AIS_SILENCE_RECONNECT_MS)
        if (flushTimer) window.clearInterval(flushTimer)
        flushTimer = window.setInterval(flushShipBuffer, AIS_UI_FLUSH_MS)
      }

      ws.onclose = () => {
        if (!alive) return
        setAisConnected(false)
        if (silenceTimer) window.clearTimeout(silenceTimer)
        if (flushTimer) window.clearInterval(flushTimer)
        reconnectTimer = window.setTimeout(() => {
          setAisDebug((prev) => ({ ...prev, reconnects: prev.reconnects + 1 }))
          connect(attempt + 1)
        }, 1200)
      }

      ws.onerror = () => {
        if (!alive) return
        setError("AIS stream unstable; retrying connection...")
      }

      ws.onmessage = async (event) => {
        try {
          const payload = await decodeWsPayload(event.data)
          setAisDebug((prev) => ({
            ...prev,
            rawFrames: prev.rawFrames + 1,
            lastRawType: typeof event.data,
            lastRawSnippet: payload.slice(0, 140)
          }))
          const msg = JSON.parse(payload)
          if (msg.error) {
            setError(`AISStream: ${msg.error}`)
            return
          }
          const parsed = parseAisMessage(msg)
          if (!parsed) return
          const { meta, pos } = parsed
          const lat = toNum(pos.Latitude)
          const lon = toNum(pos.Longitude)
          if (lat === null || lon === null) return

          if (silenceTimer) window.clearTimeout(silenceTimer)
          silenceTimer = window.setTimeout(() => {
            ws?.close()
          }, AIS_SILENCE_RECONNECT_MS)
          setAisDebug((prev) => ({
            ...prev,
            messages: prev.messages + 1,
            lastMessageAt: new Date().toISOString()
          }))

          const mmsi = String(pos.UserID || meta.MMSI || `unknown-${lat}-${lon}`)
          aisBufferRef.current.set(mmsi, {
            mmsi,
            shipName: meta.ShipName || "Unknown vessel",
            lat,
            lon,
            sog: toNum(pos.Sog),
            heading: normalizeHeading(pos.TrueHeading),
            updatedAt: new Date().toISOString()
          })
          const existingTrack = shipTrackHistoryRef.current.get(mmsi) || []
          const prevPoint = existingTrack[existingTrack.length - 1]
          if (!prevPoint || prevPoint.lat !== lat || prevPoint.lon !== lon) {
            existingTrack.push({ lat, lon, observedAt: new Date().toISOString() })
            shipTrackHistoryRef.current.set(mmsi, existingTrack.slice(-200))
          }
          aisBufferedCountRef.current += 1
        } catch {
          // Ignore malformed websocket payloads.
        }
      }
    }

    connect(0)
    return () => {
      alive = false
      setAisConnected(false)
      if (silenceTimer) window.clearTimeout(silenceTimer)
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (flushTimer) window.clearInterval(flushTimer)
      ws?.close()
    }
  }, [aisKey])

  const scenarioWhale = useMemo(() => {
    if (!demoScenarioEnabled || ships.length === 0) return null
    const anchor = ships[0]
    const near = destinationPointKm(anchor.lat, anchor.lon, 45, 2)
    return {
      id: "scenario-whale",
      occurrenceId: "scenario-whale",
      scientificName: "Balaenoptera musculus",
      species: "Blue whale (simulated)",
      commonName: "Blue whale",
      observedAt: new Date().toISOString(),
      lat: near.lat,
      lon: near.lon,
      basisOfRecord: "SIMULATION",
      count: 1,
      coordinateUncertaintyMeters: 250,
      depthM: null,
      seaSurfaceTempC: env.tempC,
      source: "Demo scenario"
    }
  }, [demoScenarioEnabled, ships, env.tempC])
  const whaleDataset = useMemo(
    () => (scenarioWhale ? [scenarioWhale, ...whales] : whales),
    [whales, scenarioWhale]
  )

  const scoredShips = useMemo(
    () => ships.map((ship) => computeShipRisk(ship, whaleDataset, env.krillScore)),
    [ships, whaleDataset, env.krillScore]
  )
  const filteredWhales = useMemo(() => {
    const search = whaleSearch.trim().toLowerCase()
    const minCount = whaleMinCount === "" ? null : Number(whaleMinCount)
    const startMs = parseIsoDayToUtcMs(whaleStartDate, false)
    const endMs = parseIsoDayToUtcMs(whaleEndDate, true)

    return whaleDataset.filter((w) => {
      if (search) {
        const hay = `${w.species || ""} ${w.scientificName || ""} ${w.commonName || ""}`.toLowerCase()
        if (!hay.includes(search)) return false
      }
      if (minCount !== null && Number.isFinite(minCount)) {
        const count = Number(w.count || 0)
        if (count < minCount) return false
      }
      const observedMs = toEpochMs(w.observedAt)
      if ((startMs !== null || endMs !== null) && observedMs === null) return false
      if (startMs !== null && observedMs !== null && observedMs < startMs) return false
      if (endMs !== null && observedMs !== null && observedMs > endMs) return false
      return true
    }).sort((a, b) => (toEpochMs(b.observedAt) || 0) - (toEpochMs(a.observedAt) || 0))
  }, [whaleDataset, whaleSearch, whaleStartDate, whaleEndDate, whaleMinCount])

  const filteredShips = useMemo(() => {
    const minSpeed = shipMinSpeed === "" ? null : Number(shipMinSpeed)
    const windowMin = shipUpdatedWindowMin === "" ? null : Number(shipUpdatedWindowMin)
    const cutoffMs =
      windowMin !== null && Number.isFinite(windowMin)
        ? Date.now() - windowMin * 60 * 1000
        : null

    return scoredShips.filter((s) => {
      if (shipRiskFilter !== "all" && s.riskBand !== shipRiskFilter) return false
      if (minSpeed !== null && Number.isFinite(minSpeed) && Number(s.sog || 0) < minSpeed) return false
      if (cutoffMs !== null) {
        const updatedMs = toEpochMs(s.updatedAt)
        if (updatedMs !== null && updatedMs < cutoffMs) return false
      }
      return true
    })
  }, [scoredShips, shipRiskFilter, shipMinSpeed, shipUpdatedWindowMin])

  const whaleLiveCutoffMs = nowMs - whaleLiveWindowDays * 24 * 60 * 60 * 1000
  const shipLiveCutoffMs = nowMs - shipLiveWindowDays * 24 * 60 * 60 * 1000
  const whaleLiveWindowLabel = formatLiveWindowLabel(whaleLiveWindowDays)
  const shipLiveWindowLabel = formatLiveWindowLabel(shipLiveWindowDays)
  const setUnifiedLiveWindowDays = (value) => {
    const days = sanitizeWindowDays(value, DEFAULT_WHALE_LIVE_WINDOW_DAYS)
    setWhaleLiveWindowDays(days)
    setShipLiveWindowDays(days)
  }
  const whaleHistoricalData = whaleDataset
  const whaleLiveData = useMemo(
    () => whaleDataset.filter((w) => {
      const ts = toEpochMs(w.observedAt)
      return ts !== null && ts >= whaleLiveCutoffMs
    }),
    [whaleDataset, whaleLiveCutoffMs]
  )
  const shipHistoricalData = scoredShips
  const shipLiveData = useMemo(
    () => scoredShips.filter((s) => {
      const ts = toEpochMs(s.updatedAt)
      return ts !== null && ts >= shipLiveCutoffMs
    }),
    [scoredShips, shipLiveCutoffMs]
  )
  const activeWhaleData = whalePanelMode === "live" ? whaleLiveData : whaleHistoricalData
  const activeShipData = shipPanelMode === "live" ? shipLiveData : shipHistoricalData
  const dashboardWhales = filteredWhales
  const selectedWhalePath = useMemo(() => {
    if (!selectedWhale) return []
    const selectedInstanceKey =
      selectedWhale.occurrenceId || selectedWhale.id || null
    if (!selectedInstanceKey) {
      return Number.isFinite(selectedWhale.lat) && Number.isFinite(selectedWhale.lon)
        ? [{ lat: selectedWhale.lat, lon: selectedWhale.lon }]
        : []
    }
    const points = whaleDataset
      .filter((w) => (w.occurrenceId || w.id || null) === selectedInstanceKey)
      .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lon))
      .sort((a, b) => {
        const ta = toEpochMs(a.observedAt) || 0
        const tb = toEpochMs(b.observedAt) || 0
        return ta - tb
      })
      .map((w) => ({ lat: w.lat, lon: w.lon }))
    if (!points.length && Number.isFinite(selectedWhale.lat) && Number.isFinite(selectedWhale.lon)) {
      return [{ lat: selectedWhale.lat, lon: selectedWhale.lon }]
    }
    return points.slice(-150)
  }, [selectedWhale, whaleDataset])
  const selectedShipPath = useMemo(() => {
    if (!selectedShip?.mmsi) return []
    const history = shipTrackHistory[selectedShip.mmsi] || []
    if (history.length) return history
    if (Number.isFinite(selectedShip.lat) && Number.isFinite(selectedShip.lon)) {
      return [{ lat: selectedShip.lat, lon: selectedShip.lon, observedAt: selectedShip.updatedAt }]
    }
    return []
  }, [selectedShip, shipTrackHistory])
  const contextualShipsForSelectedWhale = useMemo(() => {
    if (!selectedWhale || !Number.isFinite(selectedWhale.lat) || !Number.isFinite(selectedWhale.lon)) {
      return activeShipData
    }
    const whaleTs = toEpochMs(selectedWhale.observedAt)
    const ranked = activeShipData
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((ship) => {
        const shipTs = toEpochMs(ship.updatedAt)
        return {
          ship,
          distKm: haversineKm(selectedWhale.lat, selectedWhale.lon, ship.lat, ship.lon),
          timeDiffMs:
            whaleTs !== null && shipTs !== null ? Math.abs(shipTs - whaleTs) : Number.MAX_SAFE_INTEGER
        }
      })
      .sort((a, b) => a.distKm - b.distKm || a.timeDiffMs - b.timeDiffMs)
    const inRadius = ranked.filter((entry) => entry.distKm <= CONTEXT_RADIUS_KM)
    return (inRadius.length ? inRadius : ranked).slice(0, 40).map((entry) => entry.ship)
  }, [selectedWhale, activeShipData])
  const contextualWhalesForSelectedShip = useMemo(() => {
    if (!selectedShip || !Number.isFinite(selectedShip.lat) || !Number.isFinite(selectedShip.lon)) {
      return activeWhaleData
    }
    const shipTs = toEpochMs(selectedShip.updatedAt)
    const ranked = activeWhaleData
      .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lon))
      .map((whale) => {
        const whaleTs = toEpochMs(whale.observedAt)
        return {
          whale,
          distKm: haversineKm(selectedShip.lat, selectedShip.lon, whale.lat, whale.lon),
          timeDiffMs:
            shipTs !== null && whaleTs !== null ? Math.abs(shipTs - whaleTs) : Number.MAX_SAFE_INTEGER
        }
      })
      .sort((a, b) => a.distKm - b.distKm || a.timeDiffMs - b.timeDiffMs)
    const inRadius = ranked.filter((entry) => entry.distKm <= CONTEXT_RADIUS_KM)
    return (inRadius.length ? inRadius : ranked).slice(0, 40).map((entry) => entry.whale)
  }, [selectedShip, activeWhaleData])
  const dashboardWhaleTrackerData = selectedShip ? contextualWhalesForSelectedShip : activeWhaleData
  const dashboardShipTrackerData = selectedWhale ? contextualShipsForSelectedWhale : activeShipData

  const topAlerts = useMemo(
    () => [...filteredShips].sort((a, b) => b.riskScore - a.riskScore).slice(0, 5),
    [filteredShips]
  )
  const movingShips = useMemo(
    () => filteredShips.filter((ship) => Number(ship.sog || 0) >= 1),
    [filteredShips]
  )

  const highRiskCount = filteredShips.filter((s) => s.riskBand === "high").length
  const mediumRiskCount = filteredShips.filter((s) => s.riskBand === "medium").length
  const lowRiskCount = filteredShips.filter((s) => s.riskBand === "low").length
  const highRiskPct =
    movingShips.length > 0 ? Math.round((highRiskCount / movingShips.length) * 100) : 0
  const latestShipUpdate = useMemo(() => {
    let latest = null
    for (const ship of filteredShips) {
      const ts = toEpochMs(ship.updatedAt)
      if (ts === null) continue
      if (latest === null || ts > latest) latest = ts
    }
    return latest ? new Date(latest).toISOString() : null
  }, [filteredShips])
  const dashboardFilterSummary = useMemo(() => {
    const items = []
    if (whaleSearch.trim()) items.push(`whale search: ${whaleSearch.trim()}`)
    if (whaleMinCount) items.push(`min whale count: ${whaleMinCount}`)
    if (whaleStartDate || whaleEndDate) items.push(`dates: ${whaleStartDate || "..." } to ${whaleEndDate || "..."}`)
    if (shipRiskFilter !== "all") items.push(`ship risk: ${shipRiskFilter}`)
    if (shipMinSpeed) items.push(`min speed: ${shipMinSpeed} kn`)
    return items.length ? items : ["no extra filters"]
  }, [whaleSearch, whaleMinCount, whaleStartDate, whaleEndDate, shipRiskFilter, shipMinSpeed])
  const whaleSourceBreakdown = useMemo(() => {
    const counts = {
      OBIS: 0,
      GBIF: 0,
      iNaturalist: 0,
      Other: 0
    }
    for (const whale of filteredWhales) {
      const src = whale?.sourceSystem
      if (src === "OBIS") counts.OBIS += 1
      else if (src === "GBIF") counts.GBIF += 1
      else if (src === "iNaturalist") counts.iNaturalist += 1
      else counts.Other += 1
    }
    return counts
  }, [filteredWhales])
  const whaleSourceSummary = `Sources: GBIF (${whaleSourceBreakdown.GBIF}) · iNaturalist (${whaleSourceBreakdown.iNaturalist}) · OBIS (${whaleSourceBreakdown.OBIS}) · Other (${whaleSourceBreakdown.Other})`
  const acousticDetectionsToday = useMemo(
    () => Math.min(8, Math.max(3, Math.round(filteredWhales.length / 25))),
    [filteredWhales.length]
  )
  const advisorySentMmsi = useMemo(() => new Set(advisorySentRef.current), [advisoryTick])
  const agentLogEntries = useMemo(() => {
    const nowStamp = new Date().toLocaleTimeString("en-US", { hour12: false })
    const entries = []
    if (selectedWhale) {
      entries.push({
        type: "whale",
        text: `[${nowStamp}] [WHALE_AGENT] Broadcasting ${fmt(
          selectedWhale.scientificName
        )} at ${selectedWhale.lat.toFixed(3)}°, ${selectedWhale.lon.toFixed(3)}°. Risk radius 5km.`
      })
    }
    entries.push({
      type: "port",
      text: `[${nowStamp}] [PORT_AUTHORITY] Advisory: 10-knot speed zone active in San Pedro Channel corridor.`
    })
    for (const ship of topAlerts.slice(0, 4)) {
      entries.push({
        type: ship.riskBand === "high" ? "ship-high" : "ship",
        text: `[${nowStamp}] [SHIP_AGENT:${ship.shipName || ship.mmsi}] Risk ${ship.riskScore} -> ${recommendedAction(
          ship
        )}`
      })
      if (advisorySentMmsi.has(String(ship.mmsi))) {
        entries.push({
          type: "ship-high",
          text: `[${nowStamp}] [SYSTEM] Advisory sent to ${ship.shipName || ship.mmsi} and acknowledged.`
        })
      }
    }
    if (!entries.length) {
      entries.push({
        type: "system",
        text: `[${nowStamp}] [SYSTEM] Waiting for AIS/whale updates...`
      })
    }
    if (demoScenarioEnabled) {
      entries.unshift({
        type: "ship-high",
        text: `[${nowStamp}] [SCENARIO] Agent rerouted BAYWATCH 20 — collision avoided.`
      })
    }
    return entries
  }, [selectedWhale, topAlerts, advisorySentMmsi, demoScenarioEnabled])

  const homeWhaleLiveCount = whaleLiveData.length
  const homeShipLiveCount = shipLiveData.length
  const oneHourMs = 60 * 60 * 1000
  const twoHourMs = 2 * oneHourMs
  const whaleLastHour = whaleDataset.filter((w) => {
    const ts = toEpochMs(w.observedAt)
    return ts !== null && nowMs - ts <= oneHourMs
  }).length
  const whalePrevHour = whaleDataset.filter((w) => {
    const ts = toEpochMs(w.observedAt)
    return ts !== null && nowMs - ts > oneHourMs && nowMs - ts <= twoHourMs
  }).length
  const shipLastHour = scoredShips.filter((s) => {
    const ts = toEpochMs(s.updatedAt)
    return ts !== null && nowMs - ts <= oneHourMs
  }).length
  const shipPrevHour = scoredShips.filter((s) => {
    const ts = toEpochMs(s.updatedAt)
    return ts !== null && nowMs - ts > oneHourMs && nowMs - ts <= twoHourMs
  }).length
  const reroutesTriggered = filteredShips.filter((s) => s.riskScore >= 70 && s.isMoving).length
  const co2ProtectedToday = reroutesTriggered * 33
  const coveragePeriodLabel = "Oct 2025 - Apr 2026 (6 months)"
  const impactHighRiskEncounters = highRiskCount + mediumRiskCount
  const impactPotentialWhalesProtected = Math.max(1, impactHighRiskEncounters)
  const impactCo2UpperBound = impactPotentialWhalesProtected * 33
  const reroutesPerDay = useMemo(() => {
    const bins = new Map()
    for (let i = 29; i >= 0; i -= 1) {
      const day = new Date(nowMs - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      bins.set(day, 0)
    }
    for (const ship of filteredShips) {
      if (!ship.isMoving || ship.riskScore < 70) continue
      const day = (ship.updatedAt || "").slice(0, 10)
      if (!bins.has(day)) continue
      bins.set(day, (bins.get(day) || 0) + 1)
    }
    return Array.from(bins.entries()).map(([day, count]) => ({ day, count }))
  }, [filteredShips, nowMs])
  const maxRerouteBar = Math.max(1, ...reroutesPerDay.map((entry) => entry.count))
  const riskTotal = Math.max(1, highRiskCount + mediumRiskCount + lowRiskCount)
  const riskDonutStyle = {
    background: `conic-gradient(#ef4444 0 ${(highRiskCount / riskTotal) * 360}deg, #f59e0b ${(highRiskCount / riskTotal) * 360}deg ${((highRiskCount + mediumRiskCount) / riskTotal) * 360}deg, #22c55e ${((highRiskCount + mediumRiskCount) / riskTotal) * 360}deg 360deg)`
  }
  const speciesBreakdown = useMemo(() => {
    const counts = {}
    for (const whale of filteredWhales) {
      const label = whale.commonName || whale.species || "Unknown"
      counts[label] = (counts[label] || 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
  }, [filteredWhales])

  useEffect(() => {
    setSelectedShip((prev) => {
      if (!prev?.mmsi) return prev
      return scoredShips.find((s) => s.mmsi === prev.mmsi) || null
    })
  }, [scoredShips])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">BlueGuard | Live Whale-Ship Intelligence</div>
        <nav className="nav">
          {NAV.map((tab) => (
            <button
              key={tab}
              className={activePage === tab ? "active" : ""}
              onClick={() => setActivePage(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>

      <main className="layout">
        {activePage === "Home" && (
          <>
            <section className="hero">
              <h1>
                Protecting whales with <span>real-time maritime intelligence</span>
              </h1>
              <p>
                {movingShips.length} vessels currently near whale corridors off the Port of Los
                Angeles. BlueGuard agents score collision risk and reroute vessels before strikes happen.
              </p>
              <div className="hero-actions">
                <button className="button primary" onClick={() => setActivePage("Dashboard")}>
                  Open Live Dashboard →
                </button>
                <button className="button ghost" onClick={() => setActivePage("Impact")}>
                  View Impact Report
                </button>
              </div>
            </section>

            <section className="card">
              <div className="panel-title">Live San Pedro Channel Preview</div>
              <div className="panel-subtitle">Real ship + whale observations near the Port of Los Angeles.</div>
              <LiveMap
                whales={dashboardWhales}
                ships={movingShips}
                height={360}
                mapScope="dashboard"
                onWhaleSelect={(w) => {
                  setSelectedWhale(w)
                  setActivePage("Dashboard")
                  setFocusTarget({ lat: w.lat, lon: w.lon, key: `home-w-${w.id}-${Date.now()}` })
                }}
                onShipSelect={(s) => {
                  setSelectedShip(s)
                  setActivePage("Dashboard")
                  setFocusTarget({ lat: s.lat, lon: s.lon, key: `home-s-${s.mmsi}-${Date.now()}` })
                }}
                selectedWhale={selectedWhale}
                selectedShip={selectedShip}
                focusTarget={focusTarget}
                whalePathPoints={selectedWhalePath}
                shipPathPoints={selectedShipPath}
              />
            </section>

            <section className="card carbon-callout">
              <div className="panel-title">Why It Matters</div>
              <div className="impact-hero-value">1 whale = 33 tons CO₂ = ~1,500 trees</div>
              <div className="row-sub">
                BlueGuard has protected the equivalent of {(Math.max(1, reroutesTriggered) * 1500).toLocaleString()} trees this season.
              </div>
            </section>

            <section className="card-grid">
              <article className="card stat-card whale-stat">
                <div className="stat-label">Live Whale Sightings</div>
                <div className="stat-value">{loading ? <span className="skeleton-bar" /> : homeWhaleLiveCount}</div>
                <div className="stat-sub">
                  {whaleLastHour >= whalePrevHour ? "↑" : "↓"} {Math.abs(whaleLastHour - whalePrevHour)} vs prior hour
                </div>
              </article>
              <article className="card stat-card ship-stat">
                <div className="stat-label">Active AIS Vessels</div>
                <div className="stat-value">{loading ? <span className="skeleton-bar" /> : homeShipLiveCount}</div>
                <div className="stat-sub">
                  {shipLastHour >= shipPrevHour ? "↑" : "↓"} {Math.abs(shipLastHour - shipPrevHour)} vs prior hour
                </div>
              </article>
              <article className="card stat-card risk-stat">
                <div className="stat-label">High-Risk Vessels</div>
                <div className="stat-value">{highRiskCount}</div>
                <div className="stat-sub">Moving ships only · score ≥ 40</div>
              </article>
              <article className="card stat-card krill-stat">
                <div className="stat-label">Krill Suitability Score</div>
                <div className="stat-value">
                  {env.krillScore === null ? "N/A" : env.krillScore.toFixed(1)}
                </div>
                <div className="stat-sub">NOAA ERDDAP + Open-Meteo</div>
              </article>
            </section>

            <section className="grid-3">
              <article className="card">
                <div className="panel-title">How It Works</div>
                <div className="list">
                  <div className="row">
                    <div>
                      <div className="row-title">1) Detect</div>
                      <div className="row-sub">Whale Agent ingests sightings + acoustics in the LA corridor.</div>
                    </div>
                  </div>
                  <div className="row">
                    <div>
                      <div className="row-title">2) Score</div>
                      <div className="row-sub">Risk engine evaluates proximity, speed, heading, and ocean context.</div>
                    </div>
                  </div>
                  <div className="row">
                    <div>
                      <div className="row-title">3) Reroute</div>
                      <div className="row-sub">Ship agents issue speed + heading advisories before conflict zones.</div>
                    </div>
                  </div>
                </div>
              </article>
              <article className="card" style={{ gridColumn: "span 2" }}>
                <div className="panel-title">Powered By</div>
                <div className="tech-badges">
                  <span className="badge">Fetch.ai Agentverse</span>
                  <span className="badge">AISStream.io</span>
                  <span className="badge">NOAA ERDDAP</span>
                  <span className="badge">OBIS-SEAMAP</span>
                  <span className="badge">Open-Meteo</span>
                  <span className="badge">Mapbox</span>
                </div>
              </article>
            </section>
          </>
        )}

        {activePage === "Dashboard" && (
          <>
            <h2 className="page-title">Operational Dashboard</h2>
            <p className="page-subtitle">
              Real-time context for where whales and vessels overlap most.
            </p>
            <section className="split">
              <article className="card">
                <div className="panel-title">Spatial Situation View</div>
                <div className="panel-subtitle">San Pedro Channel — LA shipping corridor</div>
                <div className="grid-2" style={{ marginTop: "10px" }}>
                  <input
                    placeholder="Whale species/common name"
                    value={whaleSearch}
                    onChange={(e) => setWhaleSearch(e.target.value)}
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="Whale min count"
                    value={whaleMinCount}
                    onChange={(e) => setWhaleMinCount(e.target.value)}
                  />
                  <input
                    type="date"
                    className="date-input"
                    value={whaleStartDate}
                    onChange={(e) => setWhaleStartDate(e.target.value)}
                  />
                  <input
                    type="date"
                    className="date-input"
                    value={whaleEndDate}
                    onChange={(e) => setWhaleEndDate(e.target.value)}
                  />
                  <select value={shipRiskFilter} onChange={(e) => setShipRiskFilter(e.target.value)}>
                    <option value="all">All ship risks</option>
                    <option value="high">High risk only</option>
                    <option value="medium">Medium risk only</option>
                    <option value="low">Low risk only</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    placeholder="Ship min speed (knots)"
                    value={shipMinSpeed}
                    onChange={(e) => setShipMinSpeed(e.target.value)}
                  />
                </div>
                <div className="list" style={{ marginTop: "10px" }}>
                  <div className="row-sub">Active filter scope:</div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {dashboardFilterSummary.map((item, idx) => (
                      <span className="badge ok" key={`filter-pill-${idx}`}>
                        {item}
                      </span>
                    ))}
                    <span className="badge">
                      {filteredShips.length} vessels · {filteredWhales.length} whale sightings
                    </span>
                  </div>
                  <div className="row-sub" style={{ marginTop: "8px" }} title={whaleSourceSummary}>
                    {whaleSourceSummary}
                  </div>
                </div>
                <LiveMap
                  whales={dashboardWhales}
                  ships={movingShips}
                  height={560}
                  mapScope="dashboard"
                  onWhaleSelect={(w) => {
                    setSelectedWhale(w)
                    setFocusTarget({ lat: w.lat, lon: w.lon, key: `w-${w.id}-${Date.now()}` })
                  }}
                  onShipSelect={(s) => {
                    setSelectedShip(s)
                    setFocusTarget({ lat: s.lat, lon: s.lon, key: `s-${s.mmsi}-${Date.now()}` })
                  }}
                  selectedWhale={selectedWhale}
                  selectedShip={selectedShip}
                  focusTarget={focusTarget}
                  whalePathPoints={selectedWhalePath}
                  shipPathPoints={selectedShipPath}
                />
                <div className="map-legend">
                  <span><i className="legend-dot blue-whale" />Blue whale</span>
                  <span><i className="legend-dot fin-whale" />Fin whale</span>
                  <span><i className="legend-dot humpback-whale" />Humpback</span>
                  <span><i className="legend-dot other-whale" />Other whale</span>
                </div>
              </article>

              <article className="card">
                <div className="panel-title">Decision Support</div>
                <div className="panel-subtitle">Operational priority and risk interpretation.</div>
                <div style={{ marginTop: "8px" }}>
                  <button
                    className={`button ${demoScenarioEnabled ? "primary" : "ghost"}`}
                    onClick={() => setDemoScenarioEnabled((prev) => !prev)}
                  >
                    {demoScenarioEnabled ? "Scenario Mode: ON" : "Scenario Mode: OFF"} (press D)
                  </button>
                </div>
                <div className="grid-2" style={{ marginTop: "8px" }}>
                  <div className="row">
                    <div>
                      <div className="row-title">High Risk Share</div>
                      <div className="row-sub">{highRiskCount} / {movingShips.length || 0} moving ships</div>
                    </div>
                    <span className="badge high">{highRiskPct}%</span>
                  </div>
                  <div className="row">
                    <div>
                      <div className="row-title">Latest Ship Update</div>
                      <div className="row-sub">{fmt(latestShipUpdate)}</div>
                    </div>
                    <span className="badge ok">LIVE</span>
                  </div>
                </div>

                <div className="panel-title" style={{ marginTop: "10px" }}>Top Live Alerts</div>
                <div className="list">
                  {topAlerts.length === 0 ? (
                    <div className="row-sub">No AIS ship stream connected yet.</div>
                  ) : (
                    topAlerts.map((ship) => (
                      <div
                        className="row interactive-row"
                        key={ship.mmsi}
                        onClick={() => {
                          setSelectedShip(ship)
                          setFocusTarget({
                            lat: ship.lat,
                            lon: ship.lon,
                            key: `s-${ship.mmsi}-${Date.now()}`
                          })
                        }}
                      >
                        <div>
                          <div className="row-title">{ship.shipName}</div>
                          <div className="row-sub">
                            MMSI {ship.mmsi} | nearest whale {fmt(ship.nearestWhaleKm?.toFixed(1))} km
                          </div>
                          <div className="row-sub">
                            heading {fmt(ship.heading)}° · speed {fmt(ship.sog?.toFixed(1))} kts ·{" "}
                            {recommendedAction(ship)}
                          </div>
                          {ship.riskBand === "high" && (
                            <button
                              className={`button ${advisorySentMmsi.has(String(ship.mmsi)) ? "primary" : "ghost"}`}
                              style={{ marginTop: "6px" }}
                              onClick={(event) => {
                                event.stopPropagation()
                                advisorySentRef.current.add(String(ship.mmsi))
                                setAdvisoryTick((tick) => tick + 1)
                              }}
                            >
                              {advisorySentMmsi.has(String(ship.mmsi))
                                ? "Advisory Sent ✓"
                                : "Send Reroute Advisory"}
                            </button>
                          )}
                        </div>
                        <span className={`badge ${ship.riskBand}`}>
                          {ship.riskBand.toUpperCase()} {ship.riskScore}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                <div className="panel-title" style={{ marginTop: "10px" }}>Risk Legend</div>
                <div className="list">
                  <div className="row">
                    <div>
                      <div className="row-title">HIGH</div>
                      <div className="row-sub">Score 40+ | immediate slow-down / reroute candidate.</div>
                    </div>
                    <span className="badge high">{highRiskCount}</span>
                  </div>
                  <div className="row">
                    <div>
                      <div className="row-title">MEDIUM</div>
                      <div className="row-sub">Score 25-39 | monitor and prepare mitigation.</div>
                    </div>
                    <span className="badge medium">{mediumRiskCount}</span>
                  </div>
                  <div className="row">
                    <div>
                      <div className="row-title">LOW</div>
                      <div className="row-sub">Score less than 25 | normal monitoring.</div>
                    </div>
                    <span className="badge ok">{lowRiskCount}</span>
                  </div>
                </div>
              </article>
            </section>

            <section className="grid-4">
              <article className="card">
                <div className="stat-label">Sea Surface Temperature</div>
                <div className="stat-value">{fmt(env.tempC?.toFixed(1), "N/A")} C</div>
                <div className="stat-sub">{fmt(env.tempSource, "Source unavailable")}</div>
              </article>
              <article className="card">
                <div className="stat-label">Chlorophyll-a</div>
                <div className="stat-value">{fmt(env.chlorophyll?.toFixed(3), "N/A")} mg/m3</div>
                <div className="stat-sub">{fmt(env.chlSource, "Source unavailable")}</div>
              </article>
              <article className="card">
                <div className="stat-label">AIS Connection</div>
                <div className="stat-value">{aisConnected ? "CONNECTED" : "OFFLINE"}</div>
                <div className="stat-sub">{aisConnected ? "Streaming positions now" : "Enter key in Ships tab"}</div>
                <div className="stat-sub">Last live pull: {fmt(lastLivePullAt)}</div>
                <div className="stat-sub">Last AIS UI flush: {fmt(aisDebug.lastUiFlushAt)}</div>
                {loading && <span className="badge medium">Refreshing...</span>}
              </article>
              <article className="card">
                <div className="stat-label">CO₂ Protected Today</div>
                <div className="stat-value">{co2ProtectedToday.toLocaleString()} tons</div>
                <div className="stat-sub">{reroutesTriggered} reroutes × 33 tons per whale (upper bound)</div>
              </article>
            </section>
            <section className="grid-2">
              <article className="card">
                <div className="panel-title">
                  Agent Event Feed{" "}
                  <a
                    className="agentverse-link"
                    href="https://agentverse.ai"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Registered on Agentverse ↗
                  </a>
                </div>
                <div className="panel-subtitle">Fetch.ai-style coordination messages</div>
                <div className="list">
                  {agentLogEntries.map((entry, idx) => (
                    <div className={`row-sub agent-log ${entry.type || "system"}`} key={`agent-log-${idx}`}>
                      {entry.text}
                    </div>
                  ))}
                </div>
              </article>
              <article className="card">
                <div className="panel-title">Acoustic Sensors</div>
                <div className="panel-subtitle">NOAA SanctSound integration signal (demo layer)</div>
                <div className="list">
                  <div className="row">
                    <div>
                      <div className="row-title">Last Detection</div>
                      <div className="row-sub">{fmt(lastLivePullAt)}</div>
                    </div>
                    <span className="badge ok">ACTIVE</span>
                  </div>
                  <div className="row">
                    <div>
                      <div className="row-title">Peak Frequency</div>
                      <div className="row-sub">16-24 Hz band (large baleen profile)</div>
                    </div>
                    <span className="badge">Hydrophone</span>
                  </div>
                  <div className="row">
                    <div>
                      <div className="row-title">Detections Today</div>
                      <div className="row-sub">{acousticDetectionsToday}</div>
                    </div>
                    <span className="badge ok">ACTIVE</span>
                  </div>
                </div>
              </article>
            </section>
            <section className="grid-2">
              <article className="card detail-full">
                <div className="panel-title">Consolidated Tracker</div>
                <div className="panel-subtitle">
                  One map at a time for clarity. Switch between whale and ship focus.
                </div>
                <div className="mode-switch" style={{ marginTop: "8px" }}>
                  <button
                    className={trackerTab === "whales" ? "active" : ""}
                    onClick={() => setTrackerTab("whales")}
                  >
                    Whale Focus
                  </button>
                  <button
                    className={trackerTab === "ships" ? "active" : ""}
                    onClick={() => setTrackerTab("ships")}
                  >
                    Ship Focus
                  </button>
                  <select
                    className="input"
                    value={whaleLiveWindowDays}
                    onChange={(event) => setUnifiedLiveWindowDays(event.target.value)}
                    aria-label="Unified live window"
                    style={{ width: "auto", minWidth: "150px" }}
                  >
                    {LIVE_WINDOW_OPTIONS_DAYS.map((days) => (
                      <option key={`unified-live-window-${days}`} value={days}>
                        {formatLiveWindowLabel(days)}
                      </option>
                    ))}
                  </select>
                </div>
                <LiveMap
                  whales={trackerTab === "whales" ? dashboardWhaleTrackerData : selectedWhale ? [selectedWhale] : []}
                  ships={trackerTab === "ships" ? dashboardShipTrackerData : selectedShip ? [selectedShip] : []}
                  height={430}
                  mapScope={trackerTab === "ships" ? "ships" : "whales"}
                  onWhaleSelect={(w) => {
                    setSelectedWhale(w)
                    setFocusTarget({ lat: w.lat, lon: w.lon, key: `w-${w.id}-${Date.now()}` })
                  }}
                  onShipSelect={(s) => {
                    setSelectedShip(s)
                    setFocusTarget({ lat: s.lat, lon: s.lon, key: `s-${s.mmsi}-${Date.now()}` })
                  }}
                  selectedWhale={selectedWhale}
                  selectedShip={selectedShip}
                  focusTarget={focusTarget}
                  whalePathPoints={selectedWhalePath}
                  shipPathPoints={selectedShipPath}
                />
                <div className="list">
                  {(trackerTab === "whales" ? dashboardWhaleTrackerData : dashboardShipTrackerData)
                    .slice(0, 15)
                    .map((item) => (
                      <div
                        key={`tracker-${trackerTab}-${item.id || item.mmsi}`}
                        className="row interactive-row"
                        onClick={() => {
                          if (trackerTab === "whales") {
                            setSelectedWhale(item)
                            setFocusTarget({
                              lat: item.lat,
                              lon: item.lon,
                              key: `w-${item.id}-${Date.now()}`
                            })
                            return
                          }
                          setSelectedShip(item)
                          setFocusTarget({
                            lat: item.lat,
                            lon: item.lon,
                            key: `s-${item.mmsi}-${Date.now()}`
                          })
                        }}
                      >
                        <div>
                          <div className="row-title">
                            {trackerTab === "whales" ? item.species : item.shipName}
                          </div>
                          <div className="row-sub">
                            {trackerTab === "whales"
                              ? `${fmt(item.observedAt)} | ${item.lat.toFixed(3)}, ${item.lon.toFixed(3)}`
                              : `${fmt(item.updatedAt)} | ${fmt(item.sog?.toFixed(1))} kts | risk ${fmt(
                                  item.riskScore
                                )}`}
                          </div>
                        </div>
                        {trackerTab === "ships" && (
                          <span className={`badge ${item.riskBand}`}>{item.riskBand?.toUpperCase()}</span>
                        )}
                      </div>
                    ))}
                </div>
              </article>
            </section>
          </>
        )}

        {activePage === "Whales" && (
          <>
            <h2 className="page-title">Live Whale Sightings</h2>
            <p className="page-subtitle">San Pedro Channel — LA shipping corridor.</p>
            <article className="card">
              <div className="mode-switch">
                <button
                  className={whalePanelMode === "historical" ? "active" : ""}
                  onClick={() => setWhalePanelMode("historical")}
                >
                  Historical (All)
                </button>
                <button
                  className={whalePanelMode === "live" ? "active" : ""}
                  onClick={() => setWhalePanelMode("live")}
                >
                  Live ({whaleLiveWindowLabel})
                </button>
                <select
                  className="input"
                  value={whaleLiveWindowDays}
                  onChange={(event) => setUnifiedLiveWindowDays(event.target.value)}
                  aria-label="Whale live window"
                  style={{ width: "auto", minWidth: "150px" }}
                >
                  {LIVE_WINDOW_OPTIONS_DAYS.map((days) => (
                    <option key={`whale-live-window-panel-${days}`} value={days}>
                      {formatLiveWindowLabel(days)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="panel-title" style={{ marginTop: "8px" }}>
                {whalePanelMode === "live" ? `Live Whale Data (${whaleLiveWindowLabel})` : "Historical Whale Data"}
              </div>
              <div className="panel-subtitle">
                {whalePanelMode === "live"
                  ? `Only sightings observed in the last ${whaleLiveWindowDays} days.`
                  : "All available whale sightings from OBIS."}
              </div>
              <LiveMap
                whales={activeWhaleData}
                ships={[]}
                height={460}
                mapScope="whales"
                onWhaleSelect={(w) => {
                  setSelectedWhale(w)
                  setFocusTarget({ lat: w.lat, lon: w.lon, key: `w-${w.id}-${Date.now()}` })
                }}
                selectedWhale={selectedWhale}
                selectedShip={selectedShip}
                focusTarget={focusTarget}
                whalePathPoints={selectedWhalePath}
              />
              <div className="list">
                {activeWhaleData.length === 0 ? (
                  <div className="row-sub">
                    {whalePanelMode === "live"
                      ? `No whale sightings in ${whaleLiveWindowLabel.toLowerCase()}.`
                      : "No historical whale sightings loaded."}
                  </div>
                ) : (
                  activeWhaleData.slice(0, 40).map((w) => (
                    <div
                      key={`${whalePanelMode}-${w.id}`}
                      className="row interactive-row"
                      onClick={() => {
                        setSelectedWhale(w)
                        setFocusTarget({ lat: w.lat, lon: w.lon, key: `w-${w.id}-${Date.now()}` })
                      }}
                    >
                      <div>
                        <div className="row-title">{w.species}</div>
                        <div className="row-sub">{fmt(w.observedAt)} | {w.lat.toFixed(3)}, {w.lon.toFixed(3)}</div>
                      </div>
                      <span className={`badge ${whalePanelMode === "live" ? "ok" : ""}`}>
                        {whalePanelMode === "live" ? "LIVE" : "HIST"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </article>

          </>
        )}

        {activePage === "Ships" && (
          <>
            <h2 className="page-title">Live Vessel Tracker</h2>
            <p className="page-subtitle">Switch between historical and live without side-by-side noise.</p>
            <article className="card">
              <div className="panel-title">AIS API Key (auto-loaded)</div>
              <div className="panel-subtitle">
                Uses `VITE_AISSTREAM_API_KEY` first, then saved browser key.
              </div>
              <div className="grid-2">
                <input
                  value={aisKey}
                  onChange={(e) => setAisKey(e.target.value)}
                  placeholder="Paste AISSTREAM_API_KEY"
                  type={showAisKey ? "text" : "password"}
                  style={{
                    padding: "10px",
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    width: "100%"
                  }}
                />
                <button className="button ghost" onClick={() => setShowAisKey((prev) => !prev)}>
                  {showAisKey ? "Hide key" : "Show key"}
                </button>
                <div className="info">
                  Status: <strong>{aisConnected ? "Connected" : "Not connected"}</strong>
                  <div className="label">Streaming AIS vessel positions in LA bounding box</div>
                  <div className="label">Endpoint: {aisDebug.endpoint}</div>
                  <div className="label">Raw frames: {aisDebug.rawFrames}</div>
                  <div className="label">Messages: {aisDebug.messages}</div>
                  <div className="label">Buffered in memory: {aisBufferRef.current.size}</div>
                  <div className="label">Last message: {fmt(aisDebug.lastMessageAt)}</div>
                  <div className="label">Last UI flush: {fmt(aisDebug.lastUiFlushAt)}</div>
                  <div className="label">Last raw type: {aisDebug.lastRawType}</div>
                  <div className="label">Last raw: {fmt(aisDebug.lastRawSnippet)}</div>
                </div>
              </div>
            </article>

            <article className="card">
              <div className="mode-switch">
                <button
                  className={shipPanelMode === "historical" ? "active" : ""}
                  onClick={() => setShipPanelMode("historical")}
                >
                  Historical (All)
                </button>
                <button
                  className={shipPanelMode === "live" ? "active" : ""}
                  onClick={() => setShipPanelMode("live")}
                >
                  Live ({shipLiveWindowLabel})
                </button>
                <select
                  className="input"
                  value={shipLiveWindowDays}
                  onChange={(event) => setUnifiedLiveWindowDays(event.target.value)}
                  aria-label="Ship live window"
                  style={{ width: "auto", minWidth: "150px" }}
                >
                  {LIVE_WINDOW_OPTIONS_DAYS.map((days) => (
                    <option key={`ship-live-window-panel-${days}`} value={days}>
                      {formatLiveWindowLabel(days)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="panel-title" style={{ marginTop: "8px" }}>
                {shipPanelMode === "live" ? `Live Vessel Data (${shipLiveWindowLabel})` : "Historical Vessel Data"}
              </div>
              <div className="panel-subtitle">
                {shipPanelMode === "live"
                  ? `Only vessels updated in the last ${shipLiveWindowDays} days.`
                  : "All tracked vessels in current session."}
              </div>
              <LiveMap
                whales={[]}
                ships={activeShipData}
                height={460}
                mapScope="ships"
                onShipSelect={(s) => {
                  setSelectedShip(s)
                  setFocusTarget({ lat: s.lat, lon: s.lon, key: `s-${s.mmsi}-${Date.now()}` })
                }}
                selectedWhale={selectedWhale}
                selectedShip={selectedShip}
                focusTarget={focusTarget}
                shipPathPoints={selectedShipPath}
              />
              <table className="table">
                <thead>
                  <tr>
                    <th>Ship</th>
                    <th>MMSI</th>
                    <th>SOG</th>
                    <th>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {activeShipData.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="row-sub">
                        {shipPanelMode === "live"
                          ? `No vessel updates in ${shipLiveWindowLabel.toLowerCase()}.`
                          : "No tracked vessels in session yet."}
                      </td>
                    </tr>
                  ) : (
                    activeShipData.slice(0, 40).map((ship) => (
                      <tr
                        key={`${shipPanelMode}-${ship.mmsi}`}
                        onClick={() => {
                          setSelectedShip(ship)
                          setFocusTarget({ lat: ship.lat, lon: ship.lon, key: `s-${ship.mmsi}-${Date.now()}` })
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <td>{ship.shipName}</td>
                        <td>{ship.mmsi}</td>
                        <td>{fmt(ship.sog?.toFixed(1))}</td>
                        <td>
                          <span className={`badge ${ship.riskBand}`}>
                            {ship.riskBand?.toUpperCase()} {ship.riskScore}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </article>

          </>
        )}

        {activePage === "Impact" && (
          <>
            <h2 className="page-title">Impact Analytics</h2>
            <p className="page-subtitle">
              Coverage period: {coveragePeriodLabel}. Conservative summary with explicit upper-bound assumptions.
            </p>
            <section className="card impact-hero">
              <div className="impact-hero-value">{impactCo2UpperBound.toLocaleString()} tons CO₂ protected</div>
              <div className="row-sub">
                Up to {impactPotentialWhalesProtected} whales protected if each high-risk encounter prevented one strike.
              </div>
            </section>
            <section className="grid-3">
              <article className="card">
                <div className="stat-label">High-Risk Encounters Detected</div>
                <div className="stat-value">{impactHighRiskEncounters}</div>
                <div className="stat-sub">Verifiable encounters in monitored corridor</div>
              </article>
              <article className="card">
                <div className="stat-label">Reroutes Triggered</div>
                <div className="stat-value">{reroutesTriggered}</div>
                <div className="stat-sub">Ships with actionable reroute recommendations</div>
              </article>
              <article className="card">
                <div className="stat-label">Economic Risk Avoided (upper-bound)</div>
                <div className="stat-value">${(reroutesTriggered * 50000).toLocaleString()}</div>
                <div className="stat-sub">Approx. $50k per strike response and port disruption event</div>
              </article>
            </section>
            <section className="grid-2">
              <article className="card">
                <div className="panel-title">Reroutes Per Day (30 days)</div>
                <div className="impact-bars">
                  {reroutesPerDay.map((entry) => (
                    <div className="impact-bar-wrap" key={`impact-reroute-${entry.day}`}>
                      <div
                        className="impact-bar"
                        style={{ height: `${Math.max(6, (entry.count / maxRerouteBar) * 100)}%` }}
                        title={`${entry.day}: ${entry.count}`}
                      />
                    </div>
                  ))}
                </div>
              </article>
              <article className="card">
                <div className="panel-title">Risk Distribution</div>
                <div className="impact-donut-wrap">
                  <div className="impact-donut" style={riskDonutStyle} />
                  <div className="list">
                    <div className="row-sub">High: {highRiskCount}</div>
                    <div className="row-sub">Medium: {mediumRiskCount}</div>
                    <div className="row-sub">Low: {lowRiskCount}</div>
                  </div>
                </div>
              </article>
            </section>
            <section className="grid-2">
              <article className="card">
                <div className="panel-title">Species Breakdown (Encounter Context)</div>
                <table className="table">
                  <thead>
                    <tr><th>Species</th><th>Sightings</th></tr>
                  </thead>
                  <tbody>
                    {speciesBreakdown.map(([name, count]) => (
                      <tr key={`species-${name}`}><td>{name}</td><td>{count}</td></tr>
                    ))}
                  </tbody>
                </table>
              </article>
              <article className="card">
                <div className="panel-title">Solution Comparison</div>
                <div className="list">
                  <div className="row"><div><div className="row-title">WhaleSafe</div><div className="row-sub">Passive alerts; human action required.</div></div></div>
                  <div className="row"><div><div className="row-title">WRAS</div><div className="row-sub">Radio advisories to pilots.</div></div></div>
                  <div className="row"><div><div className="row-title">BlueGuard</div><div className="row-sub">Autonomous agent scoring + reroute advisories in real time.</div></div></div>
                </div>
              </article>
            </section>
            <section className="grid-4">
              <article className="card"><div className="stat-label">Trees Equivalent</div><div className="stat-value">{(impactPotentialWhalesProtected * 1500).toLocaleString()}</div></article>
              <article className="card"><div className="stat-label">Cars Off Road (annual equiv.)</div><div className="stat-value">{Math.round(impactCo2UpperBound / 4.6).toLocaleString()}</div></article>
              <article className="card"><div className="stat-label">Transatlantic Flights (equiv.)</div><div className="stat-value">{Math.round(impactCo2UpperBound / 2).toLocaleString()}</div></article>
              <article className="card"><div className="stat-label">People Oxygen Equivalent</div><div className="stat-value">{Math.round((impactPotentialWhalesProtected * 1500) / 25).toLocaleString()}</div></article>
            </section>
          </>
        )}

        {activePage === "About" && (
          <article className="card">
            <h2 className="page-title">About BlueGuard</h2>
            <p>BlueGuard is a real-time whale-ship collision avoidance prototype focused on the San Pedro Channel (Port of Los Angeles corridor).</p>
            <section className="grid-2">
              <div className="card">
                <div className="panel-title">Data Sources</div>
                <div className="list">
                  <div className="row-sub">Whale sightings: OBIS, GBIF, iNaturalist</div>
                  <div className="row-sub">AIS vessels: AISStream websocket</div>
                  <div className="row-sub">Environmental context: Open-Meteo + NOAA ERDDAP</div>
                  <div className="row-sub">Maps: Mapbox GL</div>
                </div>
              </div>
              <div className="card">
                <div className="panel-title">Agent Layer</div>
                <div className="list">
                  <a className="agentverse-link" href="https://agentverse.ai" target="_blank" rel="noreferrer">
                    Fetch.ai Agentverse Profile ↗
                  </a>
                  <div className="row-sub">Whale Agent ID: blueguard-whale-agent</div>
                  <div className="row-sub">Ship Agent ID: blueguard-ship-agent</div>
                  <div className="row-sub">Port Authority Agent ID: blueguard-port-agent</div>
                </div>
              </div>
            </section>
          </article>
        )}

        {error && <div className="info">Live data notice: {error}</div>}
      </main>
    </div>
  )
}

export default App
