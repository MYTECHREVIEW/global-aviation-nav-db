# ✈️ AeroNav Global: Aeronautical Navigation Database & Route Engine

A high-performance global navigation database, multi-network live tracking engine, and flight plan route parser. Contains **85,901 Airports**, **11,008 NavAids (VOR/NDB)**, **70,052 Waypoints & Fixes**, **2,139 Standard Instrument Departures (SIDs)**, **1,871 Standard Terminal Arrivals (STARs)**, and **1,466 Jet/Victor/RNAV Airways** parsed from FAA ARINC 424 CIFP and global aeronautical datasets.

---

## 🚀 Features

- **Multi-Network Live Target Array Tracking**: Concurrently track any batch of **VATSIM CIDs**, **FSHub API tokens & Virtual Airline fleets**, and **IVAO VIDs** in a single API call with sub-50ms in-memory response times.
- **Standalone Clean Embed Radar SDK (`/embed.html`)**: Embed a full-screen, 60 FPS live radar view with route corridors and slide-over pilot inspector without sidebars or management controls.
- **Persistent Global Custom Waypoints Database**: Curated catalog of global fixes across North America, Europe, the North Atlantic, the Middle East, Asia, and South America with dynamic runtime additions.
- **Runway & Transition-Aware Procedures**: Multi-branch procedure solver that matches filed departure/arrival runways and enroute transitions.
- **Airway Sequence Expansion**: Automatically expands airway segments (e.g. `Q87`, `J79`, `V1`, `UT38`, `L610`) into ordered waypoint chains.
- **SimBrief Auto-Import**: One-click flight plan fetching and instant route tracing by SimBrief Username or Pilot ID.
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

## 📡 API Endpoints Overview

### 1. Multi-Network Live Target Array API
```bash
# Query any combination of VATSIM, FSHub tokens, and IVAO IDs
curl -X POST http://localhost:3510/api/v1/live/multi \
  -H "Content-Type: application/json" \
  -d '{
    "targets": [
      { "network": "VATSIM", "id": "1234567" },
      { "network": "FSHUB", "token": "fshub_live_sample_token_abc123" }
    ]
  }'
```

### 2. Standalone Radar Embed (`/embed.html`)
```html
<iframe 
  src="http://localhost:3510/embed.html?fshub_token=YOUR_FSHUB_TOKEN&vatsim=1234567" 
  width="100%" 
  height="650px" 
  frameborder="0">
</iframe>
```

### 3. Trace a Flight Plan Route
```bash
curl -X POST http://localhost:3510/api/v1/route/trace \
  -H "Content-Type: application/json" \
  -d '{
    "departure": "KEYW",
    "arrival": "KLGA",
    "route": "KEYW/09 N0460F380 BUFTT1 MATLK Q87 HURTS PROUD2 KLGA/04",
    "altitude_ft": 38000,
    "airspeed_kts": 460,
    "include_labels": true
  }'
```

### 4. Custom Waypoints Database Management
```bash
# List all custom waypoints
curl http://localhost:3510/api/v1/waypoints/custom

# Add / Update a waypoint
curl -X POST http://localhost:3510/api/v1/waypoints/custom \
  -H "Content-Type: application/json" \
  -d '{
    "ident": "OKSAW",
    "name": "OKSAW (UK Airway Q60)",
    "type": "WAYPOINT",
    "latitude": 52.050000,
    "longitude": -2.100000,
    "country_code": "GB",
    "region": "Europe"
  }'
```

For complete API schema definitions, parameters, and payloads, refer to [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md).
