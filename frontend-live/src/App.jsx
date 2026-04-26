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
const SIM_FORECAST_MINUTES = 30
const SIM_STEP_MINUTES = 5
const SIM_MIN_WHALE_CANDIDATES = 24
const MOCK_RECENT_WHALES_COUNT = 180
const FORECAST_HORIZON_OPTIONS = [
  { id: "1d", label: "1 Day", minutes: 24 * 60, stepMinutes: 30 },
  { id: "7d", label: "1 Week", minutes: 7 * 24 * 60, stepMinutes: 180 },
  { id: "30d", label: "1 Month", minutes: 30 * 24 * 60, stepMinutes: 720 }
]
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

const NAV = ["Home", "Dashboard", "Impact", "About"]
const HOME_HOW_IT_WORKS_STEPS = [
  {
    id: "detect",
    badge: "01",
    title: "Detect",
    detail: "Whale sightings, acoustics, and environmental data are fused into a live corridor view."
  },
  {
    id: "score",
    badge: "02",
    title: "Predict Risk",
    detail: "BlueGuard models project ship and whale motion, then score collision probability in minutes."
  },
  {
    id: "advise",
    badge: "03",
    title: "Advise Captains",
    detail: "High-risk vessels receive speed and heading recommendations before entering danger zones."
  },
  {
    id: "verify",
    badge: "04",
    title: "Verify Impact",
    detail: "Reroutes and avoided encounters are logged so ports can measure ecological and economic gains."
  }
]
const IMPACT_EVIDENCE_CARDS = [
  {
    id: "carbon",
    kicker: "Climate",
    title: "Whales are climate allies",
    lead:
      "Great whales function as long-term carbon stores and shape ocean processes that matter for the global climate system. Protecting them is a tangible piece of a broader ocean-climate strategy.",
    reasonBullets: [
      {
        value: "~33 tons",
        label: "Carbon per whale",
        detail: "Research cited by the IMF frames a great whale as sequestering on the order of tens of tons of CO2 over a lifetime, keeping that carbon out of the atmosphere for long periods when populations recover."
      },
      {
        value: "Centuries",
        label: "Durable storage",
        detail: "Whale carcasses that sink to the deep seafloor can lock away carbon in sediments, extending the benefit beyond the animal’s life at the surface."
      },
      {
        value: "Ecosystems",
        label: "Fertilizing seas",
        detail: "Excretion and movement recycle nutrients that support phytoplankton; healthy phytoplankton underpins part of the ocean’s natural carbon drawdown."
      },
      {
        value: "Policy",
        label: "Worth pricing in",
        detail: "Economic work on whale carbon underlines that valuation and protection can sit alongside other climate tools, making whale recovery an investable public good."
      }
    ],
    image:
      "https://images.unsplash.com/photo-1568430462989-44163eb1752f?auto=format&fit=crop&w=1200&q=80",
    alt: "Whale surfacing in open ocean",
    link: "https://www.imf.org/en/Publications/fandd/issues/2019/12/nature-work-climate-change-whale-carbon-pricing-chami",
    cta: "Read IMF analysis"
  },
  {
    id: "ship-strikes",
    kicker: "Safety",
    title: "Ship strikes are preventable",
    lead:
      "NOAA and partners emphasize that large whales and busy shipping often overlap, but risk is not fate: operational changes and planning can cut serious injury and mortality where commitment exists.",
    reasonBullets: [
      {
        value: "Core threat",
        label: "Speed & mass",
        detail: "A fast-moving vessel in whale habitat is an outsized risk: impact energy scales with speed, and the animal often cannot avoid a closing hull in time."
      },
      {
        value: "Corridors",
        label: "Known hotspots",
        detail: "Strikes concentrate where seasonal whale presence, feeding, and major routes coincide; mapping and seasonal measures target the worst overlaps first."
      },
      {
        value: "Proven tools",
        label: "Slowing & re-routing",
        detail: "Regulators and port programs have tested speed limits, fairway shifts, and advisories so captains can reduce strike probability with planning."
      },
      {
        value: "Shared duty",
        label: "One coordinated effort",
        detail: "Vessel operators, pilots, and ocean managers can align on alerts, training, and reporting so strikes are not an acceptable by-product of business as usual."
      }
    ],
    image:
      "https://images.pexels.com/photos/262353/pexels-photo-262353.jpeg?auto=compress&cs=tinysrgb&w=1200",
    alt: "Cargo vessel crossing marine habitat",
    link: "https://www.fisheries.noaa.gov/national/endangered-species-conservation/reducing-ship-strikes-large-whales",
    cta: "See NOAA guidance"
  },
  {
    id: "human-stakes",
    kicker: "Human stakes",
    title: "Why This Matters For Humans",
    lead:
      "Whale protection is not only a wildlife goal. It is a sustainability strategy that helps people by supporting climate stability, food systems, and resilient coastal economies.",
    reasonBullets: [
      {
        value: "33 tons CO2",
        label: "Climate Buffer",
        detail: "A single great whale can store roughly 33 tons of carbon, helping stabilize climate systems people rely on."
      },
      {
        value: "Ocean productivity",
        label: "Food & fisheries",
        detail: "Whales support nutrient cycling that helps sustain marine food webs, protecting fisheries and coastal food security."
      },
      {
        value: "Ports + tourism",
        label: "Coastal livelihoods",
        detail: "Reducing strikes protects biodiversity while lowering disruption risk for shipping, tourism, and local coastal jobs."
      },
      {
        value: "Resilient oceans",
        label: "Human wellbeing",
        detail: "Healthier oceans support cleaner air, climate resilience, and long-term community wellbeing for future generations."
      }
    ],
    image:
      "https://images.unsplash.com/photo-1583212292454-1fe6229603b7?auto=format&fit=crop&w=1200&q=80",
    alt: "Whale and ocean with vessel on horizon",
    link: "https://www.imf.org/en/Publications/fandd/issues/2019/12/nature-work-climate-change-whale-carbon-pricing-chami",
    cta: "IMF: whales & climate"
  },
  {
    id: "ecosystem",
    kicker: "Ocean health",
    title: "Whales support ocean food webs",
    lead:
      "Whales are not passively drifting through the water column. Their movement, feeding, and waste transport energy and nutrients that ripple through food webs and productivity, as ocean science and NOAA public materials describe.",
    reasonBullets: [
      {
        value: "Whale pump",
        label: "Vertical mixing",
        detail: "As whales surface and dive, they help move nutrients from depth toward sunlit water where tiny plants and animals can use them, feeding broader productivity."
      },
      {
        value: "Nitrogen & iron",
        label: "Fertilizer at scale",
        detail: "Excretion releases key nutrients in forms other organisms can use, linking whale presence to blooms and prey availability over large areas."
      },
      {
        value: "Prey & predators",
        label: "Food web links",
        detail: "Whales are huge consumers and carrion sources; their role ties together forage fish, krill, birds, and deeper benthic communities in connected systems."
      },
      {
        value: "Biodiversity",
        label: "Cascading value",
        detail: "Losing top consumers can restructure who thrives in an ecosystem, so whale recovery is as much about restoring function as it is about saving individual species."
      }
    ],
    image:
      "https://images.unsplash.com/photo-1530053969600-caed2596d242?auto=format&fit=crop&w=1200&q=80",
    alt: "Whale breaching near coastline",
    link: "https://oceanservice.noaa.gov/facts/whales.html",
    cta: "Explore NOAA whale facts"
  },
  {
    id: "urgency",
    kicker: "Recovery",
    title: "Blue whales remain endangered",
    lead:
      "NOAA and international listings remind us that the largest animals on Earth have not fully recovered from industrial-era pressure; human activity at sea still shapes their outlook.",
    reasonBullets: [
      {
        value: "ESA & global",
        label: "Still protected",
        detail: "Blue whales remain listed in the U.S. under the Endangered Species Act; international status underscores that recovery is incomplete and not automatic without care."
      },
      {
        value: "Vessel strikes",
        label: "Ongoing risk",
        detail: "In busy feeding and migration areas, a single serious strike can remove breeding-age animals from a still-limited modern population, slowing any upward trend."
      },
      {
        value: "Habitat & prey",
        label: "Ecosystem context",
        detail: "Challenges include shifts in forage, ocean noise, and climate-linked changes that affect where and how whales can feed successfully."
      },
      {
        value: "Stewardship",
        label: "We set the path",
        detail: "Proactive management—shipping measures, data sharing, and enforcement—turns a cautionary status into a managed recovery with measurable milestones."
      }
    ],
    image:
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
    alt: "Open ocean with distant vessel",
    link: "https://www.fisheries.noaa.gov/species/blue-whale",
    cta: "Read species status"
  },
  {
    id: "coexistence",
    kicker: "Operations",
    title: "Shipping can adapt quickly",
    lead:
      "Conservation bodies and regulators treat strike risk as a management problem. Adjustments to how and where ships move can be implemented with existing technology and good communication.",
    reasonBullets: [
      {
        value: "Speed limits",
        label: "Time to react",
        detail: "Slowing in designated zones is a widely discussed lever: lower impact speed gives whales and mariners a larger margin in shared water."
      },
      {
        value: "Rerouting",
        label: "Geometry that helps",
        detail: "Shifting traffic away from feeding aggregations and sensitive grounds can mean large risk reductions for modest added distance in many corridors."
      },
      {
        value: "IWC & guidelines",
        label: "Proven playbooks",
        detail: "International and regional ship-strike work outlines mitigation menus so operators can match measures to local whale presence, weather, and traffic."
      },
      {
        value: "Today’s toolkit",
        label: "Agents & AIS",
        detail: "Fusing whale intelligence with navigation decisions is the kind of intervention BlueGuard-style systems are built to support in real time."
      }
    ],
    image:
      "https://images.pexels.com/photos/1295036/pexels-photo-1295036.jpeg?auto=compress&cs=tinysrgb&w=1200",
    alt: "Cargo ship crossing blue sea",
    link: "https://iwc.int/management-and-conservation/anthropogenic-threats/ship-strikes",
    cta: "See mitigation actions"
  }
]
const IMPACT_ARTICLE_LINKS = [
  {
    title: "NOAA: Reducing ship strikes to large whales",
    href: "https://www.fisheries.noaa.gov/national/endangered-species-conservation/reducing-ship-strikes-large-whales"
  },
  {
    title: "IMO: Guidance on minimizing whale collisions",
    href: "https://www.imo.org/en/OurWork/Environment/Pages/Particularly-Sensitive-Sea-Areas.aspx"
  },
  {
    title: "IWC: Vessel strikes and whale conservation",
    href: "https://iwc.int/management-and-conservation/anthropogenic-threats/ship-strikes"
  }
]
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

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const headingBetween = (lat1, lon1, lat2, lon2) => {
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon)
  const bearing = (Math.atan2(y, x) * 180) / Math.PI
  return ((bearing % 360) + 360) % 360
}

const hashToUnit = (seed) => {
  let hash = 0
  const text = String(seed || "blueguard")
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash % 10000) / 10000
}

const seededRandom = (seed) => {
  let t = seed + 0x6d2b79f5
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const coastlineLonForLat = (lat) => {
  // Conservative seaward envelope for the SoCal coastline.
  // Values are intentionally pushed well WEST of the real shoreline so generated
  // mock points stay clearly in open water (San Pedro Channel, Catalina Channel,
  // Santa Monica Bay) and never land on Palos Verdes peninsula or the harbor.
  if (lat <= 33.4) return -117.95   // San Diego coast / open ocean approach
  if (lat <= 33.55) return -118.0   // Newport / Huntington
  if (lat <= 33.7) return -118.2    // approaches to Long Beach harbor
  if (lat <= 33.85) return -118.5   // west of Palos Verdes peninsula
  if (lat <= 34.0) return -118.6    // Santa Monica Bay (offshore)
  return -118.75
}

const isLikelyOceanPoint = (lat, lon) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
  if (!inLaBounds(lat, lon)) return false

  // Hard guard: nothing east of -118.0 is treated as ocean (cuts inland LA basin).
  if (lon > -118.0) return false

  // Hard guard: nothing inside the Palos Verdes / harbor land bulge.
  // Roughly the peninsula footprint is lat 33.70-33.82, lon -118.42 to -118.18.
  if (lat >= 33.7 && lat <= 33.82 && lon >= -118.42 && lon <= -118.18) return false

  // Conservative coastline test: must be at least ~1.5 km seaward of envelope.
  return lon <= coastlineLonForLat(lat) - 0.015
}

const generateMockRecentWhales = (count = MOCK_RECENT_WHALES_COUNT, center = LA_CENTER) => {
  const nowMs = Date.now()
  const speciesPool = [
    { scientificName: "Balaenoptera musculus", commonName: "Blue whale", weight: 0.28 },
    { scientificName: "Megaptera novaeangliae", commonName: "Humpback whale", weight: 0.32 },
    { scientificName: "Balaenoptera physalus", commonName: "Fin whale", weight: 0.2 },
    { scientificName: "Eschrichtius robustus", commonName: "Gray whale", weight: 0.2 }
  ]
  const totalWeight = speciesPool.reduce((sum, row) => sum + row.weight, 0)

  const pickSpecies = (u) => {
    let cursor = 0
    for (const row of speciesPool) {
      cursor += row.weight / totalWeight
      if (u <= cursor) return row
    }
    return speciesPool[0]
  }

  return Array.from({ length: count }).map((_, idx) => {
    const u1 = seededRandom(10101 + idx * 13)
    let u2 = seededRandom(20202 + idx * 17)
    let u3 = seededRandom(30303 + idx * 19)
    let u4 = seededRandom(40404 + idx * 23)
    let u5 = seededRandom(50505 + idx * 29)
    const species = pickSpecies(u1)
    let point = destinationPointKm(center.lat, center.lon, 262, 20)
    let foundWater = false
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const radiusKm = 8 + u2 * 46
      const bearingDeg = u3 * 360
      const candidate = destinationPointKm(center.lat, center.lon, bearingDeg, radiusKm)
      if (isLikelyOceanPoint(candidate.lat, candidate.lon)) {
        point = candidate
        foundWater = true
        break
      }
      u2 = seededRandom(20202 + idx * 17 + attempt * 131)
      u3 = seededRandom(30303 + idx * 19 + attempt * 151)
    }
    if (!foundWater) {
      point = destinationPointKm(center.lat, center.lon, 250 + (idx % 20), 22 + (idx % 12))
    }
    const observedAt = new Date(nowMs - u4 * 1000 * 60 * 60 * 24 * 14).toISOString()
    const individualCount = 1 + Math.floor(u5 * 4)
    return {
      id: `mock-recent-whale-${idx}`,
      occurrenceId: `mock-recent-whale-${idx}`,
      scientificName: species.scientificName,
      species: species.commonName,
      commonName: species.commonName,
      observedAt,
      lat: point.lat,
      lon: point.lon,
      basisOfRecord: "ModelSimulation",
      count: individualCount,
      coordinateUncertaintyMeters: Math.round(100 + u2 * 500),
      depthM: Math.round(40 + u3 * 180),
      seaSurfaceTempC: Number((13 + u4 * 6).toFixed(2)),
      source: "BlueGuard Mock Generator",
      sourceSystem: "MOCK_RECENT"
    }
  })
}

const projectTrack = ({ lat, lon, headingDeg, speedKnots, minutes = SIM_FORECAST_MINUTES, stepMin = SIM_STEP_MINUTES }) => {
  const points = [{ lat, lon, tMin: 0 }]
  const steps = Math.max(1, Math.floor(minutes / stepMin))
  const kmPerStep = Math.max(0, Number(speedKnots || 0)) * 1.852 * (stepMin / 60)
  let curLat = lat
  let curLon = lon
  for (let i = 1; i <= steps; i += 1) {
    const next = destinationPointKm(curLat, curLon, headingDeg, kmPerStep)
    curLat = next.lat
    curLon = next.lon
    points.push({ lat: curLat, lon: curLon, tMin: i * stepMin })
  }
  return points
}

const trimPathToProgress = (path, progress01) => {
  if (!Array.isArray(path) || path.length === 0) return []
  const progress = clamp(progress01, 0, 1)
  const maxIdx = Math.max(1, Math.floor((path.length - 1) * progress))
  return path.slice(0, maxIdx + 1)
}

const lastPoint = (path) => (Array.isArray(path) && path.length ? path[path.length - 1] : null)

/** GeoJSON LineString from path points; coerces lon/lat so Mapbox always receives numbers. */
const pathToLineStringFeatures = (path) => {
  const coords = (Array.isArray(path) ? path : [])
    .map((p) => [Number(p?.lon), Number(p?.lat)])
    .filter(([lo, la]) => Number.isFinite(lo) && Number.isFinite(la))
  if (coords.length < 2) return []
  return [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {}
    }
  ]
}

const pathHeadPointFeatures = (path) => {
  const last = lastPoint(path)
  if (!last) return []
  const lo = Number(last.lon)
  const la = Number(last.lat)
  if (!Number.isFinite(lo) || !Number.isFinite(la)) return []
  return [{ type: "Feature", geometry: { type: "Point", coordinates: [lo, la] }, properties: {} }]
}

const kalmanSmoothSeries = (values, processNoise = 0.08, measurementNoise = 1.8) => {
  const clean = values.filter((v) => Number.isFinite(v))
  if (!clean.length) return null
  let estimate = clean[0]
  let p = 1
  for (let i = 1; i < clean.length; i += 1) {
    p += processNoise
    const k = p / (p + measurementNoise)
    estimate = estimate + k * (clean[i] - estimate)
    p = (1 - k) * p
  }
  return estimate
}

const deriveShipMotionFromHistory = (ship, historyPoints = []) => {
  const points = (historyPoints || [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
    .slice(-10)
  if (points.length < 2) {
    return {
      headingDeg: Number.isFinite(Number(ship?.heading)) ? Number(ship.heading) : 100,
      speedKnots: clamp(Number(ship?.sog || 0), 0, 30),
      source: "ais_snapshot"
    }
  }

  const headingSamples = []
  const speedSamples = []
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const heading = headingBetween(a.lat, a.lon, b.lat, b.lon)
    headingSamples.push(heading)

    const tA = toEpochMs(a.observedAt)
    const tB = toEpochMs(b.observedAt)
    if (tA === null || tB === null || tB <= tA) continue
    const dtHours = (tB - tA) / (1000 * 60 * 60)
    const distanceKm = haversineKm(a.lat, a.lon, b.lat, b.lon)
    const knots = (distanceKm / dtHours) / 1.852
    if (Number.isFinite(knots)) speedSamples.push(knots)
  }

  // Smooth heading by converting to vector components to avoid wrap-around artifacts.
  const headingX = headingSamples.map((h) => Math.cos((h * Math.PI) / 180))
  const headingY = headingSamples.map((h) => Math.sin((h * Math.PI) / 180))
  const smoothX = kalmanSmoothSeries(headingX, 0.05, 0.6)
  const smoothY = kalmanSmoothSeries(headingY, 0.05, 0.6)
  let headingDeg = Number.isFinite(Number(ship?.heading)) ? Number(ship.heading) : 100
  if (smoothX !== null && smoothY !== null) {
    headingDeg = ((Math.atan2(smoothY, smoothX) * 180) / Math.PI + 360) % 360
  }
  const smoothedSpeed = kalmanSmoothSeries(speedSamples, 0.08, 2.4)
  const fallbackSpeed = clamp(Number(ship?.sog || 0), 0, 30)
  const speedKnots = clamp(smoothedSpeed ?? fallbackSpeed, 0, 30)

  return { headingDeg, speedKnots, source: "kalman_history" }
}

const ensureWhaleCandidates = (ship, whales, envKrillScore) => {
  const recentCutoffMs = Date.now() - 45 * 24 * 60 * 60 * 1000
  const nearby = whales
    .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lon))
    .filter((w) => {
      const ts = toEpochMs(w.observedAt)
      return ts === null || ts >= recentCutoffMs
    })
    .map((w) => ({ ...w, distKm: haversineKm(ship.lat, ship.lon, w.lat, w.lon) }))
    .sort((a, b) => a.distKm - b.distKm)
    .filter((w) => w.distKm <= 80)
    .slice(0, SIM_MIN_WHALE_CANDIDATES + 8)

  const syntheticNeeded = Math.max(0, SIM_MIN_WHALE_CANDIDATES - nearby.length)
  if (!syntheticNeeded) return nearby

  const score = clamp(Number(envKrillScore || 0), 0, 10)
  const maxRadiusKm = 22 - score * 0.8
  const synthetic = Array.from({ length: syntheticNeeded }).map((_, idx) => {
    const seed = `${ship.mmsi || ship.shipName || "ship"}-${idx}`
    let p = destinationPointKm(ship.lat, ship.lon, 260, 6)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = hashToUnit(`${seed}-a-${attempt}`) * 360
      const radius = 2 + hashToUnit(`${seed}-r-${attempt}`) * maxRadiusKm
      const candidate = destinationPointKm(ship.lat, ship.lon, angle, radius)
      if (isLikelyOceanPoint(candidate.lat, candidate.lon)) {
        p = candidate
        break
      }
    }
    return {
      id: `sim-whale-${seed}`,
      occurrenceId: `sim-whale-${seed}`,
      species: "Synthetic Blue Whale",
      sourceSystem: "SIMULATION",
      lat: p.lat,
      lon: p.lon,
      observedAt: new Date().toISOString(),
      distKm: haversineKm(ship.lat, ship.lon, p.lat, p.lon)
    }
  })

  return [...nearby, ...synthetic]
}

const speciesMigrationHeading = (scientificName, observedAtIso) => {
  const month = Number(new Date(observedAtIso || Date.now()).getUTCMonth()) + 1
  if (scientificName === "Balaenoptera musculus") {
    // Blue whales typically trend NW in CA feeding season.
    return month >= 4 && month <= 10 ? 315 : 165
  }
  if (scientificName === "Megaptera novaeangliae") {
    return month >= 4 && month <= 10 ? 300 : 150
  }
  if (scientificName === "Eschrichtius robustus") {
    return month >= 3 && month <= 7 ? 320 : 140
  }
  if (scientificName === "Balaenoptera physalus") {
    return 305
  }
  return 300
}

const projectWhaleTrack = (
  whale,
  shipHeadingDeg,
  envKrillScore,
  horizonMinutes = SIM_FORECAST_MINUTES,
  stepMinutes = SIM_STEP_MINUTES
) => {
  const seed = whale.occurrenceId || whale.id || whale.species || "whale"
  const migrationHeading = speciesMigrationHeading(whale.scientificName, whale.observedAt)
  const envBoost = clamp(Number(envKrillScore || 0) / 10, 0, 1)
  const baseSpeed = 1.6 + hashToUnit(`${seed}-spd`) * 2.0 + envBoost * 1.0
  const steps = Math.max(1, Math.floor(horizonMinutes / stepMinutes))
  const points = [{ lat: whale.lat, lon: whale.lon, tMin: 0 }]
  let curLat = whale.lat
  let curLon = whale.lon

  for (let i = 1; i <= steps; i += 1) {
    const noise = (hashToUnit(`${seed}-noise-${i}`) - 0.5) * 18
    const drift = Math.sin((i / steps) * Math.PI * 1.5) * 6
    const heading = ((migrationHeading * 0.75 + shipHeadingDeg * 0.1 + (migrationHeading + noise + drift) * 0.15) % 360 + 360) % 360
    const stepSpeed = clamp(baseSpeed + (hashToUnit(`${seed}-spd-${i}`) - 0.5) * 0.6, 1.2, 4.8)
    const kmPerStep = stepSpeed * 1.852 * (stepMinutes / 60)
    const next = destinationPointKm(curLat, curLon, heading, kmPerStep)
    curLat = next.lat
    curLon = next.lon
    points.push({ lat: curLat, lon: curLon, tMin: i * stepMinutes })
  }

  return points
}

const scoreRouteRisk = (shipPath, whaleTracks, speedKnots, envKrillScore) => {
  let proximityRisk = 0
  let minCpaKm = Number.POSITIVE_INFINITY
  for (let i = 0; i < shipPath.length; i += 1) {
    const shipPoint = shipPath[i]
    if (!shipPoint) continue
    for (const whaleTrack of whaleTracks) {
      const whalePoint = whaleTrack[Math.min(i, whaleTrack.length - 1)]
      if (!whalePoint) continue
      const dKm = haversineKm(shipPoint.lat, shipPoint.lon, whalePoint.lat, whalePoint.lon)
      if (dKm < minCpaKm) minCpaKm = dKm
      const proximity = clamp((8 - dKm) / 8, 0, 1)
      const timeWeight = 1 - i / Math.max(1, shipPath.length - 1)
      proximityRisk += proximity * (0.7 + 0.3 * timeWeight)
    }
  }
  const normalizedProximity = whaleTracks.length
    ? proximityRisk / (shipPath.length * whaleTracks.length)
    : 0
  const speedRisk = clamp(Number(speedKnots || 0) / 20, 0, 1)
  const envRisk = clamp(Number(envKrillScore || 0) / 10, 0, 1)
  const totalRisk = clamp(normalizedProximity * 0.68 + speedRisk * 0.2 + envRisk * 0.12, 0, 1)
  return { totalRisk, minCpaKm }
}

const collisionProbability = (cpaKm, speedKnots, whaleCount) => {
  const cpaFactor = clamp((3.5 - cpaKm) / 3.5, 0, 1)
  const speedFactor = clamp(Number(speedKnots || 0) / 18, 0, 1)
  const whaleFactor = clamp(whaleCount / 24, 0, 1)
  const raw = cpaFactor * 0.55 + speedFactor * 0.25 + whaleFactor * 0.2
  return clamp(raw, 0, 1)
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
  simulationCurrentPath = [],
  simulationRecommendedPath = [],
  simulationWhaleTracks = [],
  mapScope = "dashboard"
}) {
  const [mapReadyTick, setMapReadyTick] = useState(0)
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRefs = useRef([])
  const simulationDotRefs = useRef([])
  const popupRef = useRef(null)
  const mapInstanceIdRef = useRef(`live-map-${Math.random().toString(36).slice(2)}`)
  const pinnedViewUntilRef = useRef(0)
  const initialViewSetRef = useRef(false)
  const lastScopeRef = useRef(null)
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
        mapScope === "ships" || mapScope === "dashboard" || mapScope === "simulation"
          ? [LA_CENTER.lon, LA_CENTER.lat]
          : [DEFAULT_CENTER.lon, DEFAULT_CENTER.lat],
      zoom:
        mapScope === "ships" || mapScope === "dashboard" || mapScope === "simulation"
          ? MAP_DEFAULT_ZOOM_SHIPS
          : MAP_DEFAULT_ZOOM_OTHER
    })
    mapRef.current.addControl(new mapboxgl.NavigationControl(), "top-right")
    mapRef.current.on("load", () => setMapReadyTick((v) => v + 1))

    return () => {
      markerRefs.current.forEach((m) => m.remove())
      markerRefs.current = []
      simulationDotRefs.current.forEach((m) => m.remove())
      simulationDotRefs.current = []
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
    simulationDotRefs.current.forEach((m) => m.remove())
    simulationDotRefs.current = []
    popupRef.current?.remove()
    popupRef.current = null

    const bounds = new mapboxgl.LngLatBounds()
    let points = 0

    whales.slice(0, 600).forEach((w) => {
      const observedMs = toEpochMs(w.observedAt)
      const ageDays =
        observedMs === null ? Number.POSITIVE_INFINITY : Math.floor((Date.now() - observedMs) / (1000 * 60 * 60 * 24))
      const recencyClass = ageDays <= 7 ? "recent" : ageDays <= 30 ? "mid" : "old"
      const markerEl = document.createElement("div")
      const isMock = String(w.sourceSystem || "").toUpperCase() === "MOCK_RECENT"
      markerEl.className = `map-marker whale ${isMock ? "mock" : "real"} ${recencyClass}`
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

    if (mapScope === "simulation") {
      simulationCurrentPath
        .filter((p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat))
        .forEach((p) => bounds.extend([p.lon, p.lat]))
      simulationRecommendedPath
        .filter((p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat))
        .forEach((p) => bounds.extend([p.lon, p.lat]))
      simulationWhaleTracks
        .flatMap((track) => track || [])
        .filter((p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat))
        .slice(0, 300)
        .forEach((p) => bounds.extend([p.lon, p.lat]))
    }

    const upsertGeojsonLayer = (idPrefix, features, type, paint, layout) => {
      const sourceId = `${mapInstanceIdRef.current}-${idPrefix}-source`
      const layerId = `${mapInstanceIdRef.current}-${idPrefix}-layer`
      const geojson = { type: "FeatureCollection", features }
      if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(geojson)
        if (paint && map.getLayer(layerId)) {
          Object.entries(paint).forEach(([k, v]) => {
            try { map.setPaintProperty(layerId, k, v) } catch (_) { /* paint key may not apply */ }
          })
        }
        if (layout && map.getLayer(layerId)) {
          Object.entries(layout).forEach(([k, v]) => {
            try { map.setLayoutProperty(layerId, k, v) } catch (_) { /* layout key may not apply */ }
          })
        }
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

    const simPathIn =
      mapScope === "simulation" ? simulationCurrentPath : []
    const simPathRec =
      mapScope === "simulation" ? simulationRecommendedPath : []
    const simTracksIn =
      mapScope === "simulation" ? simulationWhaleTracks : []

    const simCurrentFeatures = pathToLineStringFeatures(simPathIn)
    upsertGeojsonLayer(
      "sim-current-halo",
      simCurrentFeatures,
      "line",
      {
        "line-width": 9,
        "line-color": "#020617",
        "line-opacity": 0.5
      },
      { "line-cap": "round", "line-join": "round" }
    )
    upsertGeojsonLayer(
      "sim-current-route",
      simCurrentFeatures,
      "line",
      {
        "line-width": 5.5,
        "line-color": "#fb923c",
        "line-opacity": 1,
        "line-dasharray": [2.5, 1.5]
      },
      { "line-cap": "round", "line-join": "round" }
    )
    upsertGeojsonLayer(
      "sim-current-dots",
      [],
      "circle",
      {
        "circle-radius": 0,
        "circle-color": "#fb923c",
        "circle-opacity": 0
      }
    )

    const simRecommendedFeatures = pathToLineStringFeatures(simPathRec)
    upsertGeojsonLayer(
      "sim-recommended-halo",
      simRecommendedFeatures,
      "line",
      {
        "line-width": 9.2,
        "line-color": "#020617",
        "line-opacity": 0.5
      },
      { "line-cap": "round", "line-join": "round" }
    )
    upsertGeojsonLayer(
      "sim-recommended-route",
      simRecommendedFeatures,
      "line",
      {
        "line-width": 5.8,
        "line-color": "#22c55e",
        "line-opacity": 1,
        "line-dasharray": [2.5, 1.5]
      },
      { "line-cap": "round", "line-join": "round" }
    )
    upsertGeojsonLayer(
      "sim-recommended-dots",
      [],
      "circle",
      {
        "circle-radius": 0,
        "circle-color": "#22c55e",
        "circle-opacity": 0
      }
    )

    upsertGeojsonLayer("sim-current-head", pathHeadPointFeatures(simPathIn), "circle", {
      "circle-radius": 7.2,
      "circle-color": "#fb923c",
      "circle-opacity": 0.95,
      "circle-stroke-color": "#fff7ed",
      "circle-stroke-width": 1.6
    })
    upsertGeojsonLayer("sim-recommended-head", pathHeadPointFeatures(simPathRec), "circle", {
      "circle-radius": 7.8,
      "circle-color": "#22c55e",
      "circle-opacity": 0.98,
      "circle-stroke-color": "#ecfdf5",
      "circle-stroke-width": 1.8
    })

    const simWhalePoints = simTracksIn.flatMap((track) =>
      (track || [])
        .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
        .map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [Number(p.lon), Number(p.lat)] },
          properties: { radius: 1800 }
        }))
    )
    upsertGeojsonLayer(
      "sim-whale-cloud",
      simWhalePoints.slice(0, 260),
      "circle",
      {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          ["*", ["get", "radius"], 0.0006],
          10,
          ["*", ["get", "radius"], 0.0038]
        ],
        "circle-color": "#60a5fa",
        "circle-opacity": 0.14,
        "circle-stroke-color": "#3b82f6",
        "circle-stroke-opacity": 0.4,
        "circle-stroke-width": 1
      }
    )

    if (mapScope === "simulation") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => map.resize())
      })
    }

    // Prevent jitter: only auto-frame on first load or scope switch.
    const isPinned = Date.now() < pinnedViewUntilRef.current
    const scopeChanged = lastScopeRef.current !== mapScope
    if (scopeChanged) lastScopeRef.current = mapScope
    const shouldAutoFrame = !isPinned && (scopeChanged || !initialViewSetRef.current)
    if (shouldAutoFrame) {
      if (points > 0 && mapScope !== "ships") {
        map.fitBounds(bounds, {
          padding: mapScope === "simulation" ? 48 : 32,
          maxZoom: mapScope === "simulation" ? 13.5 : MAP_FIT_MAX_ZOOM,
          duration: 700
        })
      } else if (mapScope === "ships") {
        map.easeTo({
          center: [LA_CENTER.lon, LA_CENTER.lat],
          zoom: MAP_DEFAULT_ZOOM_SHIPS,
          duration: 700
        })
      } else {
        map.easeTo({ center: [DEFAULT_CENTER.lon, DEFAULT_CENTER.lat], zoom: 2, duration: 700 })
      }
      initialViewSetRef.current = true
    }
  }, [
    whales,
    ships,
    mapScope,
    mapReadyTick,
    simulationCurrentPath,
    simulationRecommendedPath,
    simulationWhaleTracks
  ])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focusTarget) return
    const focusLat = Number(focusTarget.lat)
    const focusLon = Number(focusTarget.lon)
    if (!Number.isFinite(focusLat) || !Number.isFinite(focusLon)) return
    const last = lastFocusedRef.current
    const sameTarget =
      last &&
      last.key === focusTarget.key &&
      Math.abs(last.lat - focusLat) < 1e-6 &&
      Math.abs(last.lon - focusLon) < 1e-6
    if (sameTarget) return

    pinnedViewUntilRef.current = Date.now() + 30_000
    lastFocusedRef.current = {
      lat: focusLat,
      lon: focusLon,
      key: focusTarget.key || null
    }
    map.flyTo({
      center: [focusLon, focusLat],
      zoom: Math.max(map.getZoom(), mapScope === "simulation" ? 11.8 : MAP_FOCUS_MIN_ZOOM),
      duration: 900,
      essential: true
    })
  }, [focusTarget, mapScope])

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
  const [simulationPanelOpen, setSimulationPanelOpen] = useState(false)
  const [simulationFocusTarget, setSimulationFocusTarget] = useState(null)
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
  const [useMockRecentWhales, setUseMockRecentWhales] = useState(true)
  const [forecastHorizonId, setForecastHorizonId] = useState("1d")
  const [forecastPlaying, setForecastPlaying] = useState(true)
  const [forecastProgress, setForecastProgress] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const advisorySentRef = useRef(new Set())
  const [advisoryTick, setAdvisoryTick] = useState(0)
  const layoutRef = useRef(null)
  const heroRef = useRef(null)

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
    if (!NAV.includes(activePage)) {
      setActivePage("Home")
    }
  }, [activePage])

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    const enableSnapViewport = activePage === "Impact" && !reduceMotion
    const html = document.documentElement
    const body = document.body

    html.classList.toggle("viewport-snap", enableSnapViewport)
    body.classList.toggle("viewport-snap", enableSnapViewport)

    if (activePage === "Impact") {
      window.scrollTo({ top: 0, behavior: "smooth" })
    }

    return () => {
      html.classList.remove("viewport-snap")
      body.classList.remove("viewport-snap")
    }
  }, [activePage])

  useEffect(() => {
    const root = layoutRef.current
    if (!root) return undefined

    const revealTargets = Array.from(
      root.querySelectorAll("section, article, .page-title, .page-subtitle")
    )
    if (!revealTargets.length) return undefined

    revealTargets.forEach((node, index) => {
      node.classList.add("scroll-reveal")
      node.style.setProperty("--reveal-delay", `${Math.min(index * 55, 420)}ms`)
    })

    if (activePage === "Impact") {
      // Impact uses full-screen sections; ensure they never remain hidden by reveal timing.
      revealTargets.forEach((node) => node.classList.add("is-visible"))
      return undefined
    }

    if (
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      typeof IntersectionObserver === "undefined"
    ) {
      revealTargets.forEach((node) => node.classList.add("is-visible"))
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add("is-visible")
          observer.unobserve(entry.target)
        })
      },
      { threshold: 0.16, rootMargin: "0px 0px -10% 0px" }
    )

    revealTargets.forEach((node) => {
      if (node.getBoundingClientRect().top < window.innerHeight * 0.88) {
        node.classList.add("is-visible")
      } else {
        observer.observe(node)
      }
    })

    return () => observer.disconnect()
  }, [activePage, simulationPanelOpen])

  useEffect(() => {
    if (activePage !== "Home") return undefined
    const heroNode = heroRef.current
    if (!heroNode) return undefined
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined

    let ticking = false

    const applyParallax = () => {
      const rect = heroNode.getBoundingClientRect()
      const viewportHeight = window.innerHeight || 1
      const centerOffset = rect.top + rect.height / 2 - viewportHeight / 2
      const normalized = clamp(centerOffset / viewportHeight, -1, 1)
      heroNode.style.setProperty("--hero-shift", `${Math.round(normalized * -22)}px`)
      heroNode.style.setProperty("--hero-tilt", `${(normalized * -0.9).toFixed(3)}deg`)
      ticking = false
    }

    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(applyParallax)
    }

    applyParallax()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [activePage])

  const forecastConfig = useMemo(() => {
    return (
      FORECAST_HORIZON_OPTIONS.find((option) => option.id === forecastHorizonId) ||
      FORECAST_HORIZON_OPTIONS[0]
    )
  }, [forecastHorizonId])

  useEffect(() => {
    if (!forecastPlaying) return undefined
    const id = window.setInterval(() => {
      setForecastProgress((prev) => {
        const next = prev + 0.015
        if (next >= 1) {
          setForecastPlaying(false)
          return 1
        }
        return next
      })
    }, 120)
    return () => window.clearInterval(id)
  }, [forecastPlaying])

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
  const mockRecentWhales = useMemo(
    () => (useMockRecentWhales ? generateMockRecentWhales(MOCK_RECENT_WHALES_COUNT, LA_CENTER) : []),
    [useMockRecentWhales]
  )
  const mergedWhaleData = useMemo(
    () => dedupeWhaleRows([...whales, ...mockRecentWhales]),
    [whales, mockRecentWhales]
  )
  const whaleDataset = useMemo(
    () => (scenarioWhale ? [scenarioWhale, ...mergedWhaleData] : mergedWhaleData),
    [mergedWhaleData, scenarioWhale]
  )

  const scoredShips = useMemo(
    () => ships.map((ship) => computeShipRisk(ship, whaleDataset, env.krillScore)),
    [ships, whaleDataset, env.krillScore]
  )
  /** Only the user-selected vessel drives simulation — no silent fallback to highest-risk ship. */
  const simulationShip = useMemo(() => selectedShip || null, [selectedShip])
  const shipSimulation = useMemo(() => {
    if (!simulationShip) return null
    try {
      const shipLat = Number(simulationShip.lat)
      const shipLon = Number(simulationShip.lon)
      if (!Number.isFinite(shipLat) || !Number.isFinite(shipLon)) {
        return {
          error: "Selected ship has invalid position data.",
          selectedShipName: simulationShip.shipName || simulationShip.mmsi || "Selected vessel"
        }
      }

      const shipHistory = shipTrackHistory[String(simulationShip.mmsi)] || []
      const shipMotion = deriveShipMotionFromHistory(simulationShip, shipHistory)
      const heading = shipMotion.headingDeg
      const speed = shipMotion.speedKnots
      const currentPath = projectTrack({
        lat: shipLat,
        lon: shipLon,
        headingDeg: heading,
        speedKnots: speed,
        minutes: forecastConfig.minutes,
        stepMin: forecastConfig.stepMinutes
      })
      const whaleCandidates = ensureWhaleCandidates(
        { ...simulationShip, lat: shipLat, lon: shipLon },
        whaleDataset,
        env.krillScore
      ).slice(0, 30)
      const whaleTracks = whaleCandidates.map((w) =>
        projectWhaleTrack(
          w,
          heading,
          Number(env.krillScore || 0),
          forecastConfig.minutes,
          forecastConfig.stepMinutes
        )
      )

      const beforeScore = scoreRouteRisk(currentPath, whaleTracks, speed, Number(env.krillScore || 0))
      const cpaBeforeKm = beforeScore.minCpaKm
      const riskBefore = collisionProbability(cpaBeforeKm, speed, whaleTracks.length)

      const candidateTurns = [-24, -20, -16, -12, -8, -4, 0, 4, 8, 12, 16, 20, 24]
      const speedTargets = [5, 8, 10, 12, 14, 16, 18, 22, 25]
      let bestPlan = null
      const allPlans = []

      for (const turn of candidateTurns) {
        for (const target of speedTargets) {
          const candidateSpeed = clamp((speed * 0.45 + target * 0.55), 4.5, 25)
          const candidateHeading = (heading + turn + 360) % 360
          const path = projectTrack({
            lat: shipLat,
            lon: shipLon,
            headingDeg: candidateHeading,
            speedKnots: candidateSpeed,
            minutes: forecastConfig.minutes,
            stepMin: forecastConfig.stepMinutes
          })
          const scored = scoreRouteRisk(path, whaleTracks, candidateSpeed, Number(env.krillScore || 0))
          const cpa = scored.minCpaKm
          const p = collisionProbability(cpa, candidateSpeed, whaleTracks.length)

          const etaPenalty = clamp((speed / Math.max(4.5, candidateSpeed) - 1) * 0.28, 0, 0.8)
          const turnPenalty = clamp(Math.abs(turn) / 45, 0, 1) * 0.1
          const objective = p + etaPenalty + turnPenalty
          const plan = {
            objective,
            turnDeg: turn,
            path,
            speedAfter: candidateSpeed,
            cpaAfterKm: cpa,
            riskAfter: p
          }
          allPlans.push(plan)

          if (!bestPlan || objective < bestPlan.objective) {
            bestPlan = plan
          }
        }
      }

      const fallbackPlan = {
        turnDeg: 12,
        path: projectTrack({
          lat: shipLat,
          lon: shipLon,
          headingDeg: (heading + 12) % 360,
          speedKnots: speed * 0.85,
          minutes: forecastConfig.minutes,
          stepMin: forecastConfig.stepMinutes
        }),
        speedAfter: speed * 0.85,
        cpaAfterKm: cpaBeforeKm,
        riskAfter: riskBefore
      }
      let chosenPlan = bestPlan || fallbackPlan
      const meaningfulPlans = allPlans.filter(
        (plan) => Math.abs(plan.turnDeg) >= 6 || Math.abs(plan.speedAfter - speed) >= 1.0
      )
      const improvedPlans = meaningfulPlans.filter((plan) => plan.riskAfter <= riskBefore - 0.02)
      if (improvedPlans.length) {
        chosenPlan = improvedPlans.reduce((best, plan) =>
          !best || plan.objective < best.objective ? plan : best
        , null) || chosenPlan
      } else if (meaningfulPlans.length) {
        // Force visible divergence when improvement is small by picking strongest CPA gain.
        chosenPlan = meaningfulPlans.reduce((best, plan) =>
          !best || plan.cpaAfterKm > best.cpaAfterKm ? plan : best
        , null) || chosenPlan
      }
      const recommendedPath = chosenPlan.path
      const cpaAfterKm = chosenPlan.cpaAfterKm
      const riskAfter = chosenPlan.riskAfter

      const decision = riskAfter >= 0.4 ? "SLOWDOWN" : riskAfter >= 0.2 ? "CAUTION" : "GO"

      return {
        selectedShipName: simulationShip.shipName || simulationShip.mmsi || "Selected vessel",
        forecastMinutes: forecastConfig.minutes,
        forecastStepMinutes: forecastConfig.stepMinutes,
        shipMotionSource: shipMotion.source,
        currentPath,
        recommendedPath,
        whaleTracks,
        whaleCandidatesUsed: whaleCandidates.length,
        cpaBeforeKm: Number.isFinite(cpaBeforeKm) ? cpaBeforeKm : null,
        cpaAfterKm: Number.isFinite(cpaAfterKm) ? cpaAfterKm : null,
        riskBefore,
        riskAfter,
        turnDeg: chosenPlan.turnDeg,
        speedBefore: speed,
        speedAfter: chosenPlan.speedAfter,
        decision,
        improvementPct: clamp(Math.round((riskBefore - riskAfter) * 100), 0, 100)
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Simulation failed unexpectedly.",
        selectedShipName: simulationShip.shipName || simulationShip.mmsi || "Selected vessel"
      }
    }
  }, [simulationShip, whaleDataset, env.krillScore, shipTrackHistory, forecastConfig])
  useEffect(() => {
    setForecastProgress(0)
  }, [simulationShip?.mmsi, forecastHorizonId])

  useEffect(() => {
    // Start showing a visible segment immediately after rerender.
    if (forecastProgress === 0 && forecastPlaying) {
      setForecastProgress(0.08)
    }
  }, [forecastProgress, forecastPlaying])

  const animatedSimulationCurrentPath = useMemo(
    () => trimPathToProgress(shipSimulation?.currentPath || [], forecastProgress),
    [shipSimulation?.currentPath, forecastProgress]
  )
  const animatedSimulationRecommendedPath = useMemo(
    () => trimPathToProgress(shipSimulation?.recommendedPath || [], forecastProgress),
    [shipSimulation?.recommendedPath, forecastProgress]
  )
  const animatedSimulationWhaleTracks = useMemo(
    () => (shipSimulation?.whaleTracks || []).map((track) => trimPathToProgress(track || [], forecastProgress)),
    [shipSimulation?.whaleTracks, forecastProgress]
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

  const openSimulationForShip = (ship, keyPrefix = "s") => {
    if (!ship) return
    setSelectedShip(ship)
    setSimulationPanelOpen(true)
    setForecastPlaying(true)
    setForecastProgress((prev) => (prev <= 0.02 ? 0.12 : prev))
    const lat = Number(ship.lat)
    const lon = Number(ship.lon)
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const nextFocus = { lat, lon, key: `${keyPrefix}-${ship.mmsi || ship.id}-${Date.now()}` }
      setFocusTarget(nextFocus)
      setSimulationFocusTarget({ ...nextFocus, key: `sim-focus-${nextFocus.key}` })
    }
  }

  const openSimulationForWhale = (whale, keyPrefix = "w") => {
    if (!whale) return
    setSelectedWhale(whale)
    if (Number.isFinite(whale.lat) && Number.isFinite(whale.lon)) {
      setFocusTarget({ lat: whale.lat, lon: whale.lon, key: `${keyPrefix}-${whale.id || whale.occurrenceId}-${Date.now()}` })
    }
  }

  const simulationPanelWhales = useMemo(() => {
    const base = selectedWhale ? [selectedWhale] : []
    const nearby = contextualWhalesForSelectedShip.slice(0, 60)
    return dedupeWhaleRows([...base, ...nearby]).slice(0, 90)
  }, [selectedWhale, contextualWhalesForSelectedShip])

  const simulationPanelShips = useMemo(() => {
    return selectedShip ? [selectedShip] : []
  }, [selectedShip])

  const simulationPanelCurrentPathMock = useMemo(() => {
    const shipLat = Number(selectedShip?.lat)
    const shipLon = Number(selectedShip?.lon)
    if (!Number.isFinite(shipLat) || !Number.isFinite(shipLon)) return []
    const OFFSHORE_ANCHOR = { lat: 32.6, lon: -119.6 }
    const oceanBearing = headingBetween(shipLat, shipLon, OFFSHORE_ANCHOR.lat, OFFSHORE_ANCHOR.lon)
    const shipHeading = Number(selectedShip?.heading)
    const initialTest = Number.isFinite(shipHeading)
      ? destinationPointKm(shipLat, shipLon, shipHeading, 1.5)
      : null
    const baseHeading =
      initialTest && isLikelyOceanPoint(initialTest.lat, initialTest.lon) ? shipHeading : oceanBearing
    const points = [{ lat: shipLat, lon: shipLon }]
    let curLat = shipLat
    let curLon = shipLon
    let heading = baseHeading
    for (let i = 1; i <= 14; i += 1) {
      const wiggled = heading + Math.sin(i / 2.8) * 2.5
      let next = destinationPointKm(curLat, curLon, wiggled, 1.2)
      if (!isLikelyOceanPoint(next.lat, next.lon)) {
        heading = headingBetween(curLat, curLon, OFFSHORE_ANCHOR.lat, OFFSHORE_ANCHOR.lon)
        next = destinationPointKm(curLat, curLon, heading, 1.2)
      }
      curLat = next.lat
      curLon = next.lon
      points.push({ lat: curLat, lon: curLon, tMin: i * 5 })
    }
    return points
  }, [selectedShip])

  const simulationPanelRecommendedPathMock = useMemo(() => {
    const shipLat = Number(selectedShip?.lat)
    const shipLon = Number(selectedShip?.lon)
    if (!Number.isFinite(shipLat) || !Number.isFinite(shipLon)) return []
    const OFFSHORE_ANCHOR = { lat: 32.6, lon: -119.6 }
    const oceanBearing = headingBetween(shipLat, shipLon, OFFSHORE_ANCHOR.lat, OFFSHORE_ANCHOR.lon)
    const shipHeading = Number(selectedShip?.heading)
    const initialTest = Number.isFinite(shipHeading)
      ? destinationPointKm(shipLat, shipLon, shipHeading, 1.5)
      : null
    const baseHeading =
      initialTest && isLikelyOceanPoint(initialTest.lat, initialTest.lon) ? shipHeading : oceanBearing
    const turn = 18
    const plusEnd = destinationPointKm(shipLat, shipLon, baseHeading + turn, 6)
    const minusEnd = destinationPointKm(shipLat, shipLon, baseHeading - turn, 6)
    const plusOcean = isLikelyOceanPoint(plusEnd.lat, plusEnd.lon)
    const minusOcean = isLikelyOceanPoint(minusEnd.lat, minusEnd.lon)
    const turnSign = plusOcean && !minusOcean ? 1 : minusOcean && !plusOcean ? -1 : plusOcean ? 1 : -1
    const points = [{ lat: shipLat, lon: shipLon }]
    let curLat = shipLat
    let curLon = shipLon
    for (let i = 1; i <= 14; i += 1) {
      const adaptiveTurn = (i <= 4 ? turn * (i / 4) : turn) * turnSign
      let candidateHeading = baseHeading + adaptiveTurn
      let next = destinationPointKm(curLat, curLon, candidateHeading, 0.95)
      if (!isLikelyOceanPoint(next.lat, next.lon)) {
        candidateHeading = headingBetween(curLat, curLon, OFFSHORE_ANCHOR.lat, OFFSHORE_ANCHOR.lon)
        next = destinationPointKm(curLat, curLon, candidateHeading, 0.95)
      }
      curLat = next.lat
      curLon = next.lon
      points.push({ lat: curLat, lon: curLon, tMin: i * 5 })
    }
    return points
  }, [selectedShip])

  const simulationNarrative = useMemo(() => {
    const ship = selectedShip
    const whale = selectedWhale
    if (!ship && !whale) {
      return "Select a ship or whale on the dashboard map to open a focused simulation."
    }
    if (ship && whale) {
      const distKm = Number.isFinite(ship.lat) && Number.isFinite(ship.lon) && Number.isFinite(whale.lat) && Number.isFinite(whale.lon)
        ? haversineKm(ship.lat, ship.lon, whale.lat, whale.lon)
        : null
      return `Scenario: ${ship.shipName || ship.mmsi} is being evaluated against ${
        whale.commonName || whale.species || "nearby whale activity"
      }. ${
        distKm === null ? "" : `Current ship-to-whale separation is ${distKm.toFixed(2)} km. `
      }The orange path is baseline motion and the green path is the model-recommended route based on projected whale movement and vessel constraints.`
    }
    if (ship) {
      return `Scenario: ${ship.shipName || ship.mmsi} reroute simulation uses nearby whale sightings, migration tendency, vessel speed, and heading to generate the recommended green path.`
    }
    return `Scenario: ${
      whale?.commonName || whale?.species || "Selected whale"
    } migration context is used to identify the nearest vessel and generate a route recommendation around projected whale movement.`
  }, [selectedShip, selectedWhale])

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
  const mockWhalesVisible = filteredWhales.filter((w) => w.sourceSystem === "MOCK_RECENT").length
  const realWhalesVisible = filteredWhales.length - mockWhalesVisible
  const advisorySentMmsi = useMemo(() => new Set(advisorySentRef.current), [advisoryTick])

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

      <main
        className={`layout page-shell page-${activePage.toLowerCase().replace(/\s+/g, "-")}`}
        ref={layoutRef}
      >
        {activePage === "Home" && (
          <>
            <section className="hero hero-premium home-hero" ref={heroRef}>
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
                <button
                  className="button ghost"
                  onClick={() =>
                    document
                      .getElementById("home-live-preview")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  Explore Live Preview ↓
                </button>
              </div>
            </section>

            <section className="card home-section" id="home-live-preview">
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
                simulationCurrentPath={animatedSimulationCurrentPath}
                simulationRecommendedPath={animatedSimulationRecommendedPath}
                simulationWhaleTracks={animatedSimulationWhaleTracks}
              />
            </section>

            <section className="card-grid home-section">
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
                    <span className="badge ok">real whales: {realWhalesVisible}</span>
                    <span className="badge">mock recent whales: {mockWhalesVisible}</span>
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
                  onWhaleSelect={(w) => openSimulationForWhale(w, "dash-w")}
                  onShipSelect={(s) => openSimulationForShip(s, "dash-s")}
                  selectedWhale={selectedWhale}
                  selectedShip={selectedShip}
                  focusTarget={focusTarget}
                  whalePathPoints={selectedWhalePath}
                  shipPathPoints={selectedShipPath}
                  simulationCurrentPath={animatedSimulationCurrentPath}
                  simulationRecommendedPath={animatedSimulationRecommendedPath}
                  simulationWhaleTracks={animatedSimulationWhaleTracks}
                />
                <div className="map-legend">
                  <span><i className="legend-dot whale-real" />Real whale sightings</span>
                  <span><i className="legend-dot whale-mock" />Mock recent whales</span>
                  <span><i className="legend-dot" style={{ background: "#fb923c" }} />Predicted current path (growing dots)</span>
                  <span><i className="legend-dot" style={{ background: "#22c55e" }} />AI recommended path (growing dots)</span>
                  <span><i className="legend-dot" style={{ background: "#3b82f6" }} />Whale forecast (growing dots)</span>
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
                  <button
                    className={`button ${useMockRecentWhales ? "primary" : "ghost"}`}
                    style={{ marginLeft: "8px" }}
                    onClick={() => setUseMockRecentWhales((prev) => !prev)}
                  >
                    {useMockRecentWhales ? "Mock Whale Data: ON" : "Mock Whale Data: OFF"}
                  </button>
                </div>
                <div className="row-sub" style={{ marginTop: "6px" }}>
                  AI model input currently uses {realWhalesVisible} real + {mockWhalesVisible} mock recent whale sightings.
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
                        onClick={() => openSimulationForShip(ship, "alerts-s")}
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
                  onWhaleSelect={(w) => openSimulationForWhale(w, "tracker-w")}
                  onShipSelect={(s) => openSimulationForShip(s, "tracker-s")}
                  selectedWhale={selectedWhale}
                  selectedShip={selectedShip}
                  focusTarget={focusTarget}
                  whalePathPoints={selectedWhalePath}
                  shipPathPoints={selectedShipPath}
                  simulationCurrentPath={animatedSimulationCurrentPath}
                  simulationRecommendedPath={animatedSimulationRecommendedPath}
                  simulationWhaleTracks={animatedSimulationWhaleTracks}
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
                            openSimulationForWhale(item, "tracker-list-w")
                            return
                          }
                          openSimulationForShip(item, "tracker-list-s")
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
                simulationCurrentPath={animatedSimulationCurrentPath}
                simulationRecommendedPath={animatedSimulationRecommendedPath}
                simulationWhaleTracks={animatedSimulationWhaleTracks}
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
                simulationCurrentPath={animatedSimulationCurrentPath}
                simulationRecommendedPath={animatedSimulationRecommendedPath}
                simulationWhaleTracks={animatedSimulationWhaleTracks}
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
            <section className="impact-fullscreen-hero">
              <h2 className="impact-fullscreen-title">Impact Analytics</h2>
              <p className="impact-fullscreen-subtitle">
                Coverage period: {coveragePeriodLabel}. Conservative summary with explicit upper-bound assumptions.
              </p>
              <p className="impact-sublead">
                Every avoided strike protects biodiversity, preserves ocean carbon storage, and reduces operational
                disruption for ships and ports.
              </p>
              <div className="impact-hero-value">{impactCo2UpperBound.toLocaleString()} tons CO₂ protected</div>
              <div className="row-sub impact-fullscreen-note">
                Up to {impactPotentialWhalesProtected} whales protected if each high-risk encounter prevented one strike.
              </div>
            </section>

            <section className="impact-reason-panel">
              <div className="impact-reason-grid">
                {IMPACT_EVIDENCE_CARDS.map((item) => (
                  <article className="impact-reason-card" key={item.id}>
                    <img
                      className="impact-reason-image"
                      src={item.image}
                      alt={item.alt}
                      loading="lazy"
                      onError={(event) => {
                        const img = event.currentTarget
                        if (img.dataset.fallbackApplied === "true") return
                        img.dataset.fallbackApplied = "true"
                        img.src =
                          "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1600&q=80"
                      }}
                    />
                    <div className="impact-reason-content">
                      <div className="impact-reason-kicker">{item.kicker || "Why this matters"}</div>
                      <h3>{item.title}</h3>
                      <div className="impact-reason-hover-details">
                        {item.lead && (item.reasonBullets || item.humanBullets) ? (
                          <>
                            <p className="impact-reason-lead">{item.lead}</p>
                            <ul className="impact-reason-bullets">
                              {(item.reasonBullets || item.humanBullets).map((b) => (
                                <li key={`${item.id}-${b.label}`}>
                                  <span className="impact-reason-bullet-value">{b.value}</span>
                                  <span className="impact-reason-bullet-label">{b.label}</span>
                                  <span className="impact-reason-bullet-detail">{b.detail}</span>
                                </li>
                              ))}
                            </ul>
                            <a className="impact-source-link" href={item.link} target="_blank" rel="noreferrer">
                              {item.cta} ↗
                            </a>
                          </>
                        ) : (
                          <>
                            <blockquote>{item.quote}</blockquote>
                            <div className="row-sub">— {item.attribution}</div>
                            <a className="impact-source-link" href={item.link} target="_blank" rel="noreferrer">
                              {item.cta} ↗
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="impact-fullscreen-outro">
              <div className="panel-title">Read The Science & Policy</div>
              <div className="list">
                {IMPACT_ARTICLE_LINKS.map((entry) => (
                  <a
                    key={entry.href}
                    className="impact-source-link"
                    href={entry.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {entry.title} ↗
                  </a>
                ))}
              </div>
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
            <section className="home-section" style={{ marginTop: "12px" }}>
              <article className="card how-it-works-card">
                <div className="panel-title">How It Works</div>
                <div className="panel-subtitle">From detection to intervention in under two minutes.</div>
                <div className="how-it-works-steps">
                  {HOME_HOW_IT_WORKS_STEPS.map((step) => (
                    <div className="how-step" key={`about-how-${step.id}`}>
                      <div className="how-step-badge">{step.badge}</div>
                      <div>
                        <div className="row-title">{step.title}</div>
                        <div className="row-sub">{step.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="how-it-works-footer">
                  Every recommendation is logged so ports can audit outcomes and improve policy.
                </div>
              </article>
            </section>
          </article>
        )}

        {activePage === "Dashboard" && simulationPanelOpen && selectedShip && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(2, 6, 23, 0.72)",
              zIndex: 80,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px"
            }}
            onClick={() => setSimulationPanelOpen(false)}
          >
            <section
              className="card"
              style={{
                width: "min(1300px, 96vw)",
                maxHeight: "92vh",
                overflow: "auto",
                padding: "16px"
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "10px"
                }}
              >
                <div>
                  <div className="panel-title">Simulation Panel (Focused Scenario)</div>
                  <div className="panel-subtitle">
                    Separate map for baseline vs AI-recommended route based on clicked ship.
                  </div>
                </div>
                <button className="button ghost" onClick={() => setSimulationPanelOpen(false)}>
                  Close
                </button>
              </div>
              <div className="row-sub" style={{ marginTop: "8px" }}>
                {simulationNarrative}
              </div>
              <div className="row-sub" style={{ marginTop: "4px" }}>
                Debug: baseline dots {simulationPanelCurrentPathMock.length} · recommended dots{" "}
                {simulationPanelRecommendedPathMock.length} · whale forecast tracks{" "}
                {animatedSimulationWhaleTracks.length}
              </div>
              <LiveMap
                whales={simulationPanelWhales}
                ships={simulationPanelShips}
                height={460}
                mapScope="simulation"
                onWhaleSelect={(w) => openSimulationForWhale(w, "sim-w")}
                onShipSelect={(s) => openSimulationForShip(s, "sim-s")}
                selectedWhale={selectedWhale}
                selectedShip={selectedShip}
                focusTarget={simulationFocusTarget || focusTarget}
                whalePathPoints={selectedWhalePath}
                shipPathPoints={selectedShipPath}
                simulationCurrentPath={simulationPanelCurrentPathMock}
                simulationRecommendedPath={simulationPanelRecommendedPathMock}
                simulationWhaleTracks={animatedSimulationWhaleTracks}
              />
              <div className="map-legend">
                <span><i className="legend-dot whale-real" />Observed whale sightings in scenario</span>
                <span><i className="legend-dot whale-mock" />Mock/synthetic support points</span>
                <span><i className="legend-dot" style={{ background: "#fb923c" }} />Ship baseline path</span>
                <span><i className="legend-dot" style={{ background: "#22c55e" }} />AI recommended path</span>
                <span><i className="legend-dot" style={{ background: "#3b82f6" }} />Projected whale movement</span>
              </div>
              <div className="row-sub" style={{ marginTop: "6px" }}>
                Mockup UI using live data features. Model can be replaced with trained backend artifact later.
              </div>
            </section>
          </div>
        )}

      </main>
    </div>
  )
}

export default App
