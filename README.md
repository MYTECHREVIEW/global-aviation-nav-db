# ✈️ AeroNav Global: Aeronautical Navigation Database & Route Engine

A comprehensive global navigation database and high-performance flight plan route parser engine. Contains **85,901 Airports**, **11,008 NavAids (VOR/NDB)**, **70,052 Waypoints & Fixes**, **2,139 Standard Instrument Departures (SIDs)**, **1,871 Standard Terminal Arrivals (STARs)**, and **1,466 Jet/Victor/RNAV Airways** parsed directly from FAA ARINC 424 CIFP and worldwide aeronautical sources.

---

## 🚀 Features

- **Global Aeronautical Database**: High-precision GPS coordinates, elevations, frequencies, magnetic variations, and terminal airport associations.
- **Transition & Runway-Aware SIDs / STARs**: Intelligent branch filtering that selects specific departure/arrival runways and enroute transition fixes while automatically excluding mutually exclusive branches.
- **Airway Sequence Expansion**: Expands airway legs (e.g. `Q87`, `J79`, `V1`) into ordered waypoint chains.
- **SimBrief OFP Auto-Import**: One-click flight plan fetching by SimBrief Username or Pilot ID.
- **Geodesic Trajectory Engine**: Computes great-circle distances, leg bearings, estimated enroute times, and GeoJSON lines.
- **Built-in API Key Auth**: Secure token-based access with rate tracking and revocation.
- **Docker & Portainer Ready**: Production container ready to deploy as a TrueNAS Portainer Stack.

---

## 🐳 Docker Deployment Guide

### Option 1: TrueNAS Portainer Stack (Recommended)
1. Open **Portainer** in TrueNAS.
2. Navigate to **Stacks** ➔ **Add stack**.
3. Select **Repository**:
   - **Repository URL**: `https://github.com/MYTECHREVIEW/global-aviation-nav-db.git`
   - **Repository reference**: `refs/heads/main`
   - **Compose path**: `docker-compose.yml`
4. Click **Deploy the stack**.

---

### Option 2: Docker Compose CLI
```bash
git clone https://github.com/MYTECHREVIEW/global-aviation-nav-db.git
cd global-aviation-nav-db

# Launch container in detached mode
docker compose up -d --build
```

---

### Option 3: Docker Run CLI
```bash
# Build local image
docker build -t global-aviation-nav-db:latest .

# Run container with persistent API keys volume
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

## 📡 API Usage Examples (Docker / Local)

### 1. Health Check
```bash
curl http://localhost:3510/health
```

### 2. Generate an API Key
```bash
curl -X POST http://localhost:3510/api/v1/auth/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "Flight Tracker Client", "expires_in_days": 365}'
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
    "airspeed_kts": 460
  }'
```

### 4. Fetch & Trace SimBrief OFP in One Step
```bash
curl -X POST http://localhost:3510/api/v1/simbrief/trace \
  -H "Content-Type: application/json" \
  -H "X-API-Key: aeronav_live_YOUR_API_KEY" \
  -d '{"username": "my_simbrief_user"}'
```

---

## 💻 Code Examples

### Python Example
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

print(f"Total Distance: {data['total_distance_nm']} NM")
print(f"Estimated Time: {data['estimated_time_enroute_formatted']}")
for wp in data['waypoints']:
    print(f" - {wp['ident']} ({wp['type']}) +{wp['segment_distance_nm']} NM -> {wp['cumulative_distance_nm']} NM")
```

### JavaScript / Node.js Example
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
console.log(data.waypoints);
```
