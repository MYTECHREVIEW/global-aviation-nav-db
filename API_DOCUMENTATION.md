# 📡 AeroNav Global REST API Documentation

Comprehensive reference for the AeroNav Global Navigation & Flight Path Tracing REST API.

**Base URL**: `http://localhost:3510` (or your Docker container hostname)

---

## 🐳 Docker Deployment

### 1. Docker Compose (Portainer Stack)
```yaml
version: '3.8'

services:
  global-aviation-nav-db:
    image: global-aviation-nav-db:latest
    build: .
    container_name: global-aviation-nav-db
    restart: unless-stopped
    ports:
      - "3510:3510"
    environment:
      - PORT=3510
      - NODE_ENV=production
    volumes:
      - nav_data_keys:/app/data/api-keys.json

volumes:
  nav_data_keys:
    name: global_aviation_nav_keys
```

### 2. Docker CLI Run Command
```bash
docker run -d \
  --name global-aviation-nav-db \
  -p 3510:3510 \
  --restart unless-stopped \
  -e PORT=3510 \
  -e NODE_ENV=production \
  -v $(pwd)/data/api-keys.json:/app/data/api-keys.json \
  global-aviation-nav-db:latest
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
Traces a flight plan string into sequentially resolved waypoints, great-circle coordinates, and GeoJSON.

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

#### Response
```json
{
  "departure": { "icao": "KEYW", "name": "Key West Intl", "runway": "09", "lat": 24.555, "lon": -81.759 },
  "arrival": { "icao": "KLGA", "name": "LaGuardia", "runway": "04", "lat": 40.777, "lon": -73.872 },
  "total_waypoints": 47,
  "total_distance_nm": 1105.3,
  "total_distance_km": 2047.0,
  "estimated_time_enroute_formatted": "2h 24m",
  "waypoints": [
    { "sequence": 1, "ident": "KEYW", "type": "AIRPORT", "latitude": 24.555, "longitude": -81.759, "cumulative_distance_nm": 0 },
    { "sequence": 2, "ident": "MOODI", "type": "TERMINAL_WAYPOINT", "via_procedure": "SID: BUFTT1 (RW09)", "latitude": 24.632, "longitude": -81.597, "segment_distance_nm": 10.2, "cumulative_distance_nm": 10.2 },
    { "sequence": 3, "ident": "BUFTT", "type": "TERMINAL_WAYPOINT", "via_procedure": "SID: BUFTT1 (RW09)", "latitude": 24.721, "longitude": -81.464, "segment_distance_nm": 9.6, "cumulative_distance_nm": 19.8 }
  ],
  "route_coordinates": [[-81.759, 24.555], [-81.597, 24.632], ...],
  "geojson": { ... }
}
```

---

## ⚡ 2. SimBrief OFP Endpoints

### `GET /api/v1/simbrief/fetch?username={username}`
Fetches the latest active flight plan (OFP) from SimBrief.

### `POST /api/v1/simbrief/trace`
Fetches and instantly traces the flight plan in a single call.
```json
{
  "username": "my_simbrief_user"
}
```

---

## 🔍 3. Waypoint & NavAid Search

### `GET /api/v1/waypoints/search?q={query}`
Lookup airports, VORs, NDBs, and fixes worldwide.

### `GET /api/v1/waypoints/:ident`
Get full data for a specific identifier.

### `GET /api/v1/airport/:icao/navaids`
Get all navigation aids within 30 NM of an airport.

---

## 🔑 4. API Key Management

### `POST /api/v1/auth/keys`
Generate a new API key.
```json
{
  "name": "My Client App",
  "expires_in_days": 365
}
```

### `GET /api/v1/auth/keys`
List registered keys.

### `DELETE /api/v1/auth/keys/:id`
Revoke an API key.
