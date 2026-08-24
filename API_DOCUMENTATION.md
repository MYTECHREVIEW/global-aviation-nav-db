# 📡 AeroNav Global REST API Documentation

Comprehensive reference for the **AeroNav Global Navigation Database, Multi-Network Live Tracking Engine, Clean Embed Radar SDK, and Flight Plan Route Tracing REST API**.

**Base URL**: `http://localhost:3510` (or `http://<truenas-ip>:3510`)

---

## 🐳 Docker & Portainer Deployment

### Docker Compose Stack (Portainer Web Editor / Dockage)
```yaml
version: '3.8'

services:
  global-aviation-nav-db:
    image: ghcr.io/mytechreview/global-aviation-nav-db:latest
    container_name: global-aviation-nav-db
    restart: unless-stopped
    ports:
      - "3510:3510"
    environment:
      - PORT=3510
      - NODE_ENV=production
      - MAPBOX_ACCESS_TOKEN=
    volumes:
      # Persistent directory volume for API keys and custom waypoints
      - aeronav_keys:/app/data/keys
      - aeronav_data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3510/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  aeronav_keys:
    name: aeronav_api_keys
  aeronav_data:
    name: aeronav_custom_data
```

### Docker CLI Command
```bash
docker run -d \
  --name global-aviation-nav-db \
  -p 3510:3510 \
  --restart unless-stopped \
  -e PORT=3510 \
  -e NODE_ENV=production \
  -v aeronav_api_keys:/app/data/keys \
  ghcr.io/mytechreview/global-aviation-nav-db:latest
```

---

## 🔑 Authentication
Include your API Key in requests via the `X-API-Key` header or `?api_key=` query parameter:

```http
X-API-Key: aeronav_live_YOUR_API_KEY
```
*(Public live tracking and map embed endpoints also support direct browser CORS access).*

---

## 🌐 1. Multi-Network Live Target Array API (VATSIM, FSHub, IVAO)

Concurrently queries, cross-correlates, and tracks any batch array of targets across VATSIM CIDs, FSHub tokens/users/Virtual Airlines, and IVAO VIDs in a single request.

### `POST /api/v1/live/multi`
**Request Headers:** `Content-Type: application/json`

#### Request Body
```json
{
  "targets": [
    { "network": "VATSIM", "id": "1134998" },
    { "network": "FSHUB", "token": "18bXlTA3OUu6F2ShL0XGuHBtCE1AEWsXef4ISoIs6pPM2XaU6KVgKNuudu6Q" },
    { "network": "FSHUB", "id": "NeightWolf49" },
    { "network": "IVAO", "id": "123456" }
  ]
}
```

#### Shortcut GET Format:
```http
GET /api/v1/live/multi?vatsim=1134998,1011180&fshub=NeightWolf49&tokens=18bXlTA3OUu6F2ShL0XGuHBtCE1AEWsXef4ISoIs6pPM2XaU6KVgKNuudu6Q
```

#### Response Payload (Sample)
```json
{
  "success": true,
  "timestamp": 1787542027796,
  "total_flights": 2,
  "flights": [
    {
      "id": "vatsim_1134998",
      "source": "VATSIM",
      "network": "VATSIM",
      "callsign": "THY33",
      "pilot_id": 1134998,
      "pilot_name": "Burak Sadikoglu LTAC",
      "pilot_avatar": "/assets/default-pilot-avatar.png",
      "airline": null,
      "aircraft": "B77W",
      "departure": "LTFM",
      "arrival": "KIAH",
      "route": "TUDBU DCT ETUBA DCT NAVOD DCT MAVIR DCT ARSIN DCT PEROL DCT RENKA DCT INBED DCT BOMBI DCT ADKUV DCT LENDO DCT DENUT L610 KOPUL Q60 OKSAW DCT TEWXI DCT VATRY/N0486F340 DCT SUTEX DCT DOGAL/M083F340 DCT 54N020W 54N030W 52N040W 49N050W DCT JOOPY/N0486F360 N326A BRADD DCT BOS DCT BAF Q448 PTW J48 CSN DCT FANPO Q40 MAULS/N0481F380 Q40 AEX ZEEKK3",
      "latitude": 41.2748,
      "longitude": 28.7321,
      "altitude_ft": 32262,
      "groundspeed_kts": 443,
      "heading_deg": 268,
      "squawk": "1234",
      "phase": "ENROUTE",
      "vatsim": {
        "cid": 1134998,
        "is_online": true,
        "callsign": "THY33",
        "squawk": "1234"
      }
    },
    {
      "id": "fshub_va_N121HJ",
      "source": "FSHUB_VA",
      "network": "FSHub",
      "callsign": "N121HJ",
      "pilot_id": 29950,
      "pilot_name": "gorillaglue4",
      "pilot_avatar": "https://g.fshubcdn.com/avatars/u_29950_80.png",
      "airline": {
        "id": 5169,
        "name": "WolfAir Aviation",
        "abbr": "WLF",
        "is_va": true
      },
      "aircraft": "HDJT",
      "departure": "GMMX",
      "arrival": "LEMD",
      "route": "GMMX OBOGA VALBA TOLSI KORIS VJF HIJ PARKA SOTUK LEMD",
      "latitude": 40.7018,
      "longitude": -3.5758,
      "altitude_ft": 5444,
      "groundspeed_kts": 126,
      "heading_deg": 185,
      "squawk": "2117",
      "phase": "ON APPROACH",
      "vatsim": {
        "cid": "1011180",
        "is_online": false
      }
    }
  ]
}
```

---

## 🛩️ 2. Standalone Clean Embed Radar SDK

Embed a pure, responsive 60 FPS live radar map with aircraft motion smoothing, flight route corridors, and slide-over pilot inspector card without any management sidebars or controls.

### Embed HTML Tag
```html
<iframe 
  src="http://localhost:3510/embed.html?fshub_token=YOUR_TOKEN&vatsim=1134998" 
  width="100%" 
  height="700px" 
  frameborder="0" 
  style="border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); overflow: hidden;">
</iframe>
```

### Supported URL Query Parameters
| Parameter | Type | Description |
| :--- | :--- | :--- |
| `fshub_token` | String | FSHub Personal API Token (auto-inspects pilot & Virtual Airline fleet) |
| `vatsim` | String | Comma-separated list of VATSIM CIDs or Callsigns (e.g. `1134998,1011180`) |
| `fshub` | String | Comma-separated list of FSHub usernames or IDs |
| `ivao` | String | Comma-separated list of IVAO VIDs |
| `hud` | Boolean | Pass `?hud=false` to hide the top-left floating cockpit HUD |
| `route` | String | Custom route string to force-draw on initial load |

---

## 💾 3. Custom Global Waypoints Management API

Manage the persistent curated navigation fix database stored at `data/custom-global-waypoints.json`.

### `GET /api/v1/waypoints/custom`
List all custom and curated global waypoints.
```http
GET /api/v1/waypoints/custom
```
**Response:**
```json
{
  "success": true,
  "total_custom_waypoints": 81,
  "database_file": "data/custom-global-waypoints.json",
  "waypoints": {
    "OKSAW": {
      "ident": "OKSAW",
      "name": "OKSAW",
      "type": "WAYPOINT",
      "latitude": 52.05,
      "longitude": -2.1,
      "country_code": "GB",
      "region": "Europe"
    }
  }
}
```

### `POST /api/v1/waypoints/custom`
Add or update a waypoint in the persistent database.
```json
{
  "ident": "OKSAW",
  "name": "OKSAW (UK Airway Q60)",
  "type": "WAYPOINT",
  "latitude": 52.050000,
  "longitude": -2.100000,
  "country_code": "GB",
  "region": "Europe"
}
```

---

## 🛫 4. Flight Plan Route Tracing Engine

### `POST /api/v1/route/trace`
Traces a flight plan route string with SIDs, Airways, STARs, and international fixes. Returns sequential waypoints, bearings, distances, and GeoJSON.

#### Request Body
```json
{
  "departure": "KEYW",
  "arrival": "KLGA",
  "route": "KEYW/09 N0460F380 BUFTT1 MATLK Q87 ZERBO/N0461F370 Q87 TAALN/N0457F390 Q87 HURTS PROUD2 KLGA/04",
  "altitude_ft": 38000,
  "airspeed_kts": 460,
  "include_labels": true
}
```

#### Response Payload (Sample)
```json
{
  "departure": { "icao": "KEYW", "name": "Key West Intl", "runway": "09", "lat": 24.555, "lon": -81.759 },
  "arrival": { "icao": "KLGA", "name": "LaGuardia", "runway": "04", "lat": 40.777, "lon": -73.872 },
  "total_waypoints": 47,
  "total_distance_nm": 1105.3,
  "total_distance_km": 2047.0,
  "estimated_time_enroute_formatted": "2h 24m",
  "include_labels": true,
  "waypoints": [
    {
      "sequence": 1,
      "ident": "KEYW",
      "type": "AIRPORT",
      "latitude": 24.555,
      "longitude": -81.759,
      "segment_distance_nm": 0,
      "cumulative_distance_nm": 0
    }
  ],
  "route_coordinates": [[-81.759, 24.555], [-81.597, 24.632]],
  "geojson": { ... }
}
```

---

## 📡 5. Single Pilot Live Tracking (VATSIM / FSHub / IVAO)

### `POST /api/v1/live/track`
Directly tracks a single flight with real-time SimBrief OFP correlation.
```json
{
  "network": "VATSIM",
  "identifier": "THY33",
  "simbrief_username": "my_simbrief_user"
}
```

### Direct Network Lookups
- `GET /api/v1/live/vatsim/:identifier` — Query VATSIM pilot by CID or Callsign.
- `GET /api/v1/live/fshub/:identifier` — Query FSHub pilot by User ID or Token.
- `GET /api/v1/live/ivao/:identifier` — Query IVAO pilot by VID or Callsign.

---

## 🔍 6. Navigation Search & Airport NavAids

- `GET /api/v1/waypoints/search?q={query}` — Search airports, VORs, NDBs, and fixes worldwide.
- `GET /api/v1/waypoints/:ident` — Fetch coordinates and details by fix ident.
- `GET /api/v1/waypoints/nearby?lat=40.75&lon=-73.87&radius_nm=30` — Radial search around GPS coords.
- `GET /api/v1/airport/:icao/navaids` — Get all navigation aids within 30 NM of an airport.
- `GET /api/v1/airways/:ident` — Get ordered fix sequence along an enroute airway.

---

## ⚡ 7. SimBrief Integration

- `GET /api/v1/simbrief/fetch?username={username}` — Fetches latest active flight plan (OFP).
- `POST /api/v1/simbrief/trace` — Fetches and instantly traces flight plan into waypoints & GeoJSON.
