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
    { "network": "VATSIM", "id": "1234567" },
    { "network": "FSHUB", "token": "fshub_live_sample_token_abc123xyz456" },
    { "network": "FSHUB", "id": "DemoPilot10" },
    { "network": "IVAO", "id": "765432" }
  ]
}
```

#### Shortcut GET Format:
```http
GET /api/v1/live/multi?vatsim=1234567,2345678&fshub=DemoPilot10&tokens=fshub_live_sample_token_abc123xyz456
```

#### Response Payload (Sample)
```json
{
  "success": true,
  "timestamp": 1787542027796,
  "total_flights": 2,
  "flights": [
    {
      "id": "vatsim_1234567",
      "source": "VATSIM",
      "network": "VATSIM",
      "callsign": "AAL100",
      "pilot_id": 1234567,
      "pilot_name": "Demo Pilot (VATSIM)",
      "pilot_avatar": "/assets/default-pilot-avatar.png",
      "airline": { "name": "American Airlines", "icao": "AAL", "iata": "AA" },
      "aircraft": "B789",
      "departure": "EGLL",
      "arrival": "KJFK",
      "route": "EGLL WOBUN WELIN CPT KENET DIKAS EVRIN CILAN MALOT 54N020W 54N030W 53N040W 50N050W COLOR ALLEX TOPPS ENE PARCH3 KJFK",
      "latitude": 51.4700,
      "longitude": -0.4543,
      "altitude_ft": 36000,
      "groundspeed_kts": 490,
      "heading_deg": 275,
      "squawk": "3421",
      "phase": "ENROUTE",
      "vatsim": {
        "cid": 1234567,
        "is_online": true,
        "callsign": "AAL100",
        "squawk": "3421"
      }
    },
    {
      "id": "fshub_va_N889VA",
      "source": "FSHUB_VA",
      "network": "FSHub",
      "callsign": "N889VA",
      "pilot_id": 99999,
      "pilot_name": "SkyCaptain_Demo",
      "pilot_avatar": "/assets/default-pilot-avatar.png",
      "airline": {
        "id": 101,
        "name": "Global Virtual Airways",
        "abbr": "GVA",
        "is_va": true
      },
      "aircraft": "C680",
      "departure": "KMIA",
      "arrival": "KLGA",
      "route": "KMIA DEFUN AR16 DIW Q87 TAALN Q87 HURTS PROUD2 KLGA",
      "latitude": 28.5383,
      "longitude": -81.3792,
      "altitude_ft": 41000,
      "groundspeed_kts": 460,
      "heading_deg": 18,
      "squawk": "1200",
      "phase": "CRUISE",
      "vatsim": {
        "cid": null,
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
  src="http://localhost:3510/embed.html?fshub_token=YOUR_FSHUB_TOKEN&vatsim=1234567" 
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
| `vatsim` | String | Comma-separated list of VATSIM CIDs or Callsigns (e.g. `1234567,AAL100`) |
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
  "identifier": "AAL100",
  "simbrief_username": "demo_simbrief_user"
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
