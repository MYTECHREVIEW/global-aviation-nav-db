# 📡 AeroNav Global REST API Documentation

Comprehensive reference for the AeroNav Global Navigation Database & Flight Plan Route Tracing REST API.

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
      # Persistent directory volume for API keys
      - aeronav_keys:/app/data/keys
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3510/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  aeronav_keys:
    name: aeronav_api_keys
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
Include your API Key in every request via the `X-API-Key` header or `?api_key=` query parameter:

```http
X-API-Key: aeronav_live_YOUR_API_KEY
```

---

## 🛫 1. Route Tracing Endpoints

### `POST /api/v1/route/trace`
Traces a flight plan route string with SIDs, Airways, STARs, and returns sequential waypoints, bearings, distances, and GeoJSON.

#### Request Body
```json
{
  "departure": "KEYW",
  "arrival": "KLGA",
  "route": "KEYW/09 N0460F380 BUFTT1 MATLK Q87 ZERBO/N0461F370 Q87 TAALN/N0457F390 Q87 HURTS PROUD2 KLGA/04",
  "altitude_ft": 38000,
  "airspeed_kts": 460
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
  "waypoints": [
    { "sequence": 1, "ident": "KEYW", "type": "AIRPORT", "latitude": 24.555, "longitude": -81.759, "segment_distance_nm": 0, "cumulative_distance_nm": 0 },
    { "sequence": 2, "ident": "MOODI", "type": "TERMINAL_WAYPOINT", "via_procedure": "SID: BUFTT1 (RW09)", "latitude": 24.632, "longitude": -81.597, "segment_distance_nm": 10.2, "cumulative_distance_nm": 10.2 },
    { "sequence": 3, "ident": "BUFTT", "type": "TERMINAL_WAYPOINT", "via_procedure": "SID: BUFTT1 (RW09)", "latitude": 24.721, "longitude": -81.464, "segment_distance_nm": 9.6, "cumulative_distance_nm": 19.8 },
    { "sequence": 4, "ident": "TOWIE", "type": "TERMINAL_WAYPOINT", "via_procedure": "SID: BUFTT1 (RW09)", "latitude": 25.485, "longitude": -81.411, "segment_distance_nm": 46.0, "cumulative_distance_nm": 65.8 },
    { "sequence": 5, "ident": "GRIDS", "type": "WAYPOINT", "via_procedure": "SID: BUFTT1 (RW09)", "latitude": 26.518, "longitude": -81.339, "segment_distance_nm": 62.3, "cumulative_distance_nm": 128.1 },
    { "sequence": 6, "ident": "TIRCO", "type": "WAYPOINT", "via_procedure": "SID: BUFTT1 (RW09)", "latitude": 27.421, "longitude": -81.275, "segment_distance_nm": 54.5, "cumulative_distance_nm": 182.6 },
    { "sequence": 7, "ident": "MATLK", "type": "WAYPOINT", "via_procedure": "SID: BUFTT1 (RW09)", "latitude": 27.935, "longitude": -81.238, "segment_distance_nm": 31.0, "cumulative_distance_nm": 213.5 }
  ],
  "route_coordinates": [[-81.759, 24.555], [-81.597, 24.632], ...],
  "geojson": { ... }
}
```

---

## ⚡ 2. SimBrief OFP Endpoints

### `GET /api/v1/simbrief/fetch?username={username}`
Fetches the user's latest active flight plan (OFP) from SimBrief.

### `POST /api/v1/simbrief/trace`
Fetches and instantly traces the flight plan into waypoints and GeoJSON in a single call.
```json
{
  "username": "my_simbrief_user"
}
```

---

## 🔍 3. Waypoint & NavAid Search

### `GET /api/v1/waypoints/search?q={query}`
Search airports, VORs, NDBs, and fixes worldwide.

### `GET /api/v1/waypoints/:ident`
Fetch detailed coordinates, frequency, and airport associations.

### `GET /api/v1/airport/:icao/navaids`
Get all navigation aids within 30 NM of an airport.

### `GET /api/v1/airways/:ident`
Get ordered fix sequence along an enroute airway (e.g. `Q87` or `J79`).

---

## 🔑 4. API Key Management

### `POST /api/v1/auth/keys`
Generate a new API key programmatically.
```json
{
  "name": "My Client App",
  "expires_in_days": 365
}
```

### `GET /api/v1/auth/keys`
List registered keys with masked tokens and request statistics.

### `DELETE /api/v1/auth/keys/:id`
Revoke an API key.
