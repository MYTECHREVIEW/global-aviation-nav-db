# ✈️ AeroNav Global: Aeronautical Navigation Database & Route Engine

A high-performance global navigation database and flight plan route parser engine. Contains **85,901 Airports**, **11,008 NavAids (VOR/NDB)**, **70,052 Waypoints & Fixes**, **2,139 Standard Instrument Departures (SIDs)**, **1,871 Standard Terminal Arrivals (STARs)**, and **1,466 Jet/Victor/RNAV Airways** parsed from FAA ARINC 424 CIFP and global aeronautical datasets.

---

## 🚀 Features

- **Global Aeronautical Database**: Accurate GPS coordinates, elevations, frequencies, magnetic variations, and terminal airport associations.
- **Runway & Transition-Aware Procedures**: Multi-branch procedure solver that matches filed departure/arrival runways and enroute transition fixes while automatically excluding mutually exclusive branches.
- **Airway Sequence Expansion**: Automatically expands airway segments (e.g. `Q87`, `J79`, `V1`) into ordered waypoint chains.
- **SimBrief Auto-Import**: One-click flight plan fetching and instant route tracing by SimBrief Username or Pilot ID.
- **Waypoint Labels & Visibility Toggling**: Optional ident label rendering on maps and charts for enhanced readability.
- **Geodesic Trajectory Engine**: Computes great-circle distances, leg bearings, estimated enroute times, and GeoJSON lines.
- **Built-in API Key Authentication**: Secure token-based access with usage tracking, request counting, and key revocation.
- **Docker & Portainer Ready**: Public multi-arch Docker container hosted on GitHub Container Registry (`ghcr.io`) for instant deployment in TrueNAS, Portainer, or Dockage.

---

## 🐳 Docker & Portainer Deployment Guide

The container is published as a **public image** on GitHub Container Registry (`ghcr.io`). No Docker login required.

### Option 1: TrueNAS Portainer Stack (Recommended)

1. Open **Portainer** in TrueNAS.
2. Navigate to **Stacks** ➔ **Add stack** (or select **Web Editor**).
3. Paste the following Compose configuration:

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

4. Click **Deploy the stack**.

---

### Option 2: Docker CLI Run Command

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

### Option 3: Local Build & Docker Compose

```bash
git clone https://github.com/MYTECHREVIEW/global-aviation-nav-db.git
cd global-aviation-nav-db

# Run with docker compose
docker compose up -d
```

---

## 📡 API Usage & Code Examples

### Base URL: `http://localhost:3510` (or your TrueNAS IP:3510)

### 1. Health Check
```bash
curl http://localhost:3510/health
```

### 2. Generate an API Key
```bash
curl -X POST http://localhost:3510/api/v1/auth/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "Production App Client", "expires_in_days": 365}'
```

### 3. Trace a Flight Plan Route
```bash
curl -X POST http://localhost:3510/api/v1/route/trace \
  -H "Content-Type: application/json" \
  -H "X-API-Key: aeronav_live_YOUR_API_KEY" \
  -d '{
    "departure": "KEYW",
    "arrival": "KLGA",
    "route": "KEYW/09 N0460F380 BUFTT1 MATLK Q87 ZERBO/N0461F370 Q87 TAALN/N0457F390 Q87 HURTS PROUD2 KLGA/04",
    "altitude_ft": 38000,
    "airspeed_kts": 460,
    "include_labels": true
  }'
```

### 4. Fetch & Trace SimBrief OFP in One Call
```bash
curl -X POST http://localhost:3510/api/v1/simbrief/trace \
  -H "Content-Type: application/json" \
  -H "X-API-Key: aeronav_live_YOUR_API_KEY" \
  -d '{"username": "my_simbrief_user"}'
```

---

## 💻 Language SDK Examples

### Python (`requests`)
```python
import requests

url = "http://localhost:3510/api/v1/route/trace"
headers = {
    "Content-Type": "application/json",
    "X-API-Key": "aeronav_live_YOUR_KEY"
}
payload = {
    "departure": "KEYW",
    "arrival": "KLGA",
    "route": "KEYW/09 BUFTT1 MATLK Q87 HURTS PROUD2 KLGA/04"
}

response = requests.post(url, json=payload, headers=headers)
data = response.json()

print(f"Route: {data['departure']['icao']}/{data['departure']['runway']} -> {data['arrival']['icao']}/{data['arrival']['runway']}")
print(f"Total Distance: {data['total_distance_nm']} NM | Est. Time: {data['estimated_time_enroute_formatted']}")

for wp in data['waypoints']:
    via = f"({wp['via_procedure'] or wp['via_airway']})" if wp.get('via_procedure') or wp.get('via_airway') else ""
    print(f" - {wp['sequence']:02d}. {wp['ident']:<7} [{wp['type']:<18}] {via:<25} +{wp['segment_distance_nm']:>5} NM -> {wp['cumulative_distance_nm']:>6} NM")
```

### JavaScript / Node.js
```javascript
const res = await fetch('http://localhost:3510/api/v1/route/trace', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'aeronav_live_YOUR_KEY'
  },
  body: JSON.stringify({
    departure: 'KEYW',
    arrival: 'KLGA',
    route: 'KEYW/09 BUFTT1 MATLK Q87 HURTS PROUD2 KLGA/04'
  })
});

const data = await res.json();
console.log('Waypoints:', data.waypoints);
```
