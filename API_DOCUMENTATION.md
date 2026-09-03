# 📡 AeroNav Global REST API Documentation

Comprehensive reference for the **AeroNav Global Navigation Database, Multi-Network Live Tracking Engine, Clean Embed Radar SDK, Route Analysis & Auto-Fix Engine, and Discord Route Issue Reporting REST API**.

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
      - DISCORD_WEBHOOK_URL=
    volumes:
      # Persistent directory volumes for custom waypoints, API keys, and reports
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
  -v aeronav_custom_data:/app/data \
  ghcr.io/mytechreview/global-aviation-nav-db:latest
```

---

## 📄 Integration Keys Configuration (`STTAPI.txt`)

You can supply third-party API credentials, tokens, and webhooks in a simple plain-text configuration file named `STTAPI.txt` in the root application directory:

```ini
# 1. AeroNav API Key
AERONAV_API_KEY=aeronav_live_YOUR_KEY_HERE

# 2. FSHub Personal API Token (Used for personal telemetry & Virtual Airline fleet tracking)
FSHUB_TOKEN=YOUR_FSHUB_API_TOKEN_HERE

# 3. VATSIM Numeric Pilot CID
VATSIM_CID=YOUR_VATSIM_CID_HERE

# 4. IVAO Pilot VID / Token
IVAO_TOKEN=YOUR_IVAO_TOKEN_HERE

# 5. Discord Webhook URL (For instant 🚩 Route Issue Report notifications)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
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

Concurrently queries, cross-correlates, and tracks any batch array of targets across VATSIM CIDs, FSHub tokens/users/Virtual Airlines, and IVAO VIDs in a single request with sub-50ms in-memory response times.

### `POST /api/v1/live/multi`
**Request Headers:** `Content-Type: application/json`

#### Request Body
```json
{
  "targets": [
    { "network": "VATSIM", "id": "1234567" },
    { "network": "FSHUB", "token": "fshub_sample_token_xyz123" },
    { "network": "FSHUB", "id": "DemoPilot10" },
    { "network": "IVAO", "id": "765432" }
  ]
}
```

#### Shortcut GET Format:
```http
GET /api/v1/live/multi?vatsim=1234567,2345678&fshub=DemoPilot10&tokens=fshub_sample_token_xyz123
```

#### Response Payload (Sample)
```json
{
  "success": true,
  "timestamp": 1787542027796,
  "total_flights": 2,
  "flights": [
    {
      "id": "89881d473e023d1abbcc857d1beaf8c9",
      "network": "FSHub",
      "pilot_id": 27427,
      "pilot_name": "Eilqar",
      "pilot_avatar": "https://g.fshubcdn.com/avatars/u_27427_80.png",
      "callsign": "WLF1632",
      "airline": {
        "id": 5169,
        "name": "WolfAir Aviation",
        "abbr": "WLF",
        "is_va": true
      },
      "aircraft": "B738",
      "departure": "EDDS",
      "arrival": "EDDF",
      "nearest_airport": {
        "icao": "EDDS",
        "iata": "STR",
        "name": "Stuttgart Airport",
        "city": "Stuttgart",
        "elevation_ft": 1276,
        "distance_nm": 1.1
      },
      "route": "EDDS ETASA SPESA EDDF",
      "latitude": 48.68893,
      "longitude": 9.194298,
      "altitude_ft": 1314,
      "groundspeed_kts": 1,
      "heading_deg": 339,
      "squawk": "1000",
      "phase": "taxiing_to_runway",
      "flight_plan": {
        "departure": "EDDS",
        "arrival": "EDDF",
        "aircraft": "B738",
        "route": "EDDS ETASA SPESA EDDF",
        "cruising_altitude": 22000
      }
    }
  ]
}
```

---

## 🔬 2. Intelligent Route Analysis & Auto-Fix Engine

Analyzes flight plan route strings for Great-Circle corridor detours, duplicate international idents, 180° backtracks, or missing/interpolated fixes. Automatically selects the optimal global candidate or probes regional databases, **persists the corrected coordinates directly to `data/custom-global-waypoints.json`**, and recalculates the repaired flight trajectory.

### `POST /api/v1/route/analyze`
**Request Headers:** `Content-Type: application/json`

#### Request Body
```json
{
  "route": "GCRR VASTO NIDEB TIGGI PINEK KORUL KOLEK EBOMO RUSIB SHIRI TOJAQ EGGD",
  "include_labels": true
}
```

#### Response Payload
```json
{
  "success": true,
  "status": "REPAIRED",
  "departure": { "icao": "GCRR", "name": "Lanzarote Airport", "lat": 28.945, "lon": -13.605 },
  "arrival": { "icao": "EGGD", "name": "Bristol Airport", "lat": 51.382, "lon": -2.719 },
  "total_waypoints": 12,
  "total_distance_nm": 1442.3,
  "original_distance_nm": 4682.1,
  "distance_saved_nm": 3239.8,
  "estimated_time_enroute_formatted": "3h 12m",
  "fixes_repaired": [
    {
      "ident": "TNT",
      "name": "Trent VOR-DME",
      "country_code": "GB",
      "previous_coords": { "lat": 15.65, "lon": -86.98 },
      "corrected_coords": { "lat": 53.0583, "lon": -1.4183 },
      "distance_saved_nm": 3239.8
    }
  ],
  "issues_found": [],
  "waypoints": [ ... ],
  "route_coordinates": [ ... ],
  "geojson": { ... }
}
```

---

## 🚩 3. Discord Route Issue Reporting API

Allows pilots or managers to flag any flight plan route or waypoint issue with a single click. Formats and delivers rich Discord Webhook embeds while storing reports in `data/route-reports.json`.

### `POST /api/v1/report/discord`
**Request Headers:** `Content-Type: application/json`

#### Request Body
```json
{
  "pilot_name": "Eilqar",
  "callsign": "WLF1632",
  "network": "WolfAir Aviation VA",
  "route": "EDDS ETASA SPESA EDDF",
  "departure": "EDDS",
  "arrival": "EDDF",
  "aircraft": "B738",
  "altitude_ft": 22000,
  "groundspeed_kts": 420
}
```

#### Response Payload
```json
{
  "success": true,
  "delivered_to_discord": true,
  "message": "Discord notification dispatched successfully!",
  "report": {
    "id": "REP-MT7PO0SA",
    "pilot": "Eilqar",
    "callsign": "WLF1632",
    "network": "WolfAir Aviation VA",
    "route": "EDDS ETASA SPESA EDDF",
    "departure": "EDDS",
    "arrival": "EDDF",
    "aircraft": "B738",
    "submitted_at": "2026-08-24T20:51:12.249Z",
    "submitted_at_formatted": "Mon, 24 Aug 2026 20:51:12 GMT",
    "delivered_to_discord": true
  }
}
```

### `GET /api/v1/report/list`
Retrieves all historical route issue reports submitted by pilots.
```http
GET /api/v1/report/list
```

---

## 🛩️ 4. Standalone Clean Embed Radar SDK & Pilot Cards

Embed a pure, responsive 60 FPS live radar map with aircraft motion smoothing, flight route corridors, dynamic network color classification, and customizable pilot telemetry cards.

### Embed HTML Tag
```html
<iframe 
  src="https://routes.simtechtracker.com/embed.html?popup_style=mini&stats=true" 
  width="100%" 
  height="650px" 
  frameborder="0" 
  style="border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); overflow: hidden;">
</iframe>
```

---

### 📇 Pilot Card Style Variations
The radar includes 3 built-in, responsive card layouts selectable via `popup_style=` (or `card_style=`):

| Style | Width | Dimensions | Content & Layout |
| :--- | :--- | :--- | :--- |
| **`mini`** | `410px` | Ultra-compact single-row HUD | Pilot avatar, name/callsign, route pill (`EDDS ➔ EDDF FL220`), telemetry grid (`ALT`, `SPD`, `HDG`, `SQK`), expand toggle button `⤢`, and one-click Discord report 🚩. |
| **`compact`** | `380px` | Medium card with full corridor | Adds commercial airline / operating VA badges (`🏢 Op by WLF`), aircraft type, full flight plan corridor box, flight phase pill, and collapse button `⤡`. |
| **`full`** | `440px` | Full slide-over inspector | Includes detailed progress bars, departure/arrival runways, nearest airport elevation, and full waypoint log. |

#### Live Interactive Card Toggle Behavior:
- When starting in **`mini`**, clicking `⤢` expands directly to **`compact`**.
- When in **`compact`**, clicking `⤡` collapses back to **`mini`**.
- Whenever the user closes the card or clicks on a different aircraft, the card **automatically reverts back to the default style** (`mini`).

---

### 📊 Bottom-Right Fleet Summary HUD Card
Enable the ultra-compact 4-metric fleet status HUD by passing `&stats=true` or `&stats=1` in the embed URL:

```http
https://routes.simtechtracker.com/embed.html?fshub_token=YOUR_TOKEN&stats=true&popup_style=mini
```

#### Metrics Displayed:
- **Active Pilots**: Total pilots currently connected (Airborne + Ground).
- **Airborne**: Aircraft actively flying (velocity-based, ignoring ground elevation).
- **Ground**: Aircraft parked, taxiing, at the gate, or on standby.
- **VATSIM Online**: Count of pilots actively flying on the VATSIM network.

---

### 💻 Client-Side JavaScript Control API
When embedded in custom applications or iframes, programmatic controls are available on `window`:

```javascript
// 1. Toggle pilot card style between mini and compact
window.toggleInspectorCardStyle();

// 2. Programmatically show or hide the bottom-right fleet stats HUD
window.setFleetStatsVisible(true);  // Show
window.setFleetStatsVisible(false); // Hide

// 3. Toggle fleet stats HUD visibility on the fly
window.toggleFleetStats();

// 4. Report active pilot route issue directly
window.reportCurrentPilotRoute();
```

---

### 🛠️ Example: Building a Custom Pilot Card with API Telemetry

If you prefer building your own custom HTML telemetry widgets instead of using the iframe embed, fetch live flight metrics directly from `POST /api/v1/live/multi`:

```javascript
// Fetch live fleet telemetry from AeroNav API
async function fetchAndRenderCustomPilotCard() {
    const response = await fetch('https://routes.simtechtracker.com/api/v1/live/multi', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'YOUR_AERONAV_API_KEY_HERE'
        },
        body: JSON.stringify({
            targets: [
                { network: 'FSHUB', token: 'YOUR_FSHUB_TOKEN_HERE' },
                { network: 'VATSIM', id: '1234567' }
            ]
        })
    });

    const data = await response.json();
    if (!data.flights || data.flights.length === 0) return;

    // Render first active flight into a custom HTML card
    const flight = data.flights[0];
    const cardContainer = document.getElementById('myPilotCard');

    cardContainer.innerHTML = `
        <div class="custom-pilot-card">
            <!-- Header -->
            <div class="pilot-header">
                <img src="${flight.pilot_avatar || '/assets/default-pilot-avatar.png'}" class="pilot-avatar">
                <div>
                    <h3 class="pilot-callsign">${flight.callsign}</h3>
                    <span class="pilot-name">${flight.pilot_name}</span>
                </div>
                <span class="flight-phase-badge ${flight.phase}">${flight.phase}</span>
            </div>

            <!-- Route Corridor -->
            <div class="flight-corridor">
                <span class="airport-code">${flight.departure || 'N/A'}</span>
                <span class="route-arrow">➔</span>
                <span class="airport-code">${flight.arrival || 'N/A'}</span>
                <span class="aircraft-type">${flight.aircraft || 'B738'}</span>
            </div>

            <!-- Live Telemetry Metrics Grid -->
            <div class="telemetry-grid">
                <div class="telem-item">
                    <label>ALTITUDE</label>
                    <span class="telem-val text-green">${flight.altitude_ft?.toLocaleString() || 0} ft</span>
                </div>
                <div class="telem-item">
                    <label>GROUNDSPEED</label>
                    <span class="telem-val text-cyan">${flight.groundspeed_kts || 0} kts</span>
                </div>
                <div class="telem-item">
                    <label>HEADING</label>
                    <span class="telem-val text-amber">${String(flight.heading_deg || 0).padStart(3, '0')}°</span>
                </div>
                <div class="telem-item">
                    <label>SQUAWK</label>
                    <span class="telem-val text-white">${flight.squawk || '1200'}</span>
                </div>
            </div>
        </div>
    `;
}
```

#### Supported URL Query Parameters
| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `popup_style` / `card_style` | String | `auto` | Inspector card layout variation: `full`, `compact`, `mini`, or `auto`. |
| `stats` / `show_stats` | Boolean | `false` | Pass `?stats=true` or `?stats=1` to display the bottom-right 4-metric Fleet Summary HUD. |
| `fshub_token` | String | *optional* | FSHub Personal API Token (auto-inspects pilot & Virtual Airline fleet). |
| `vatsim` | String | *optional* | Comma-separated list of VATSIM CIDs or Callsigns (e.g. `1234567,WLF416`). |
| `fshub` | String | *optional* | Comma-separated list of FSHub usernames or IDs. |
| `ivao` | String | *optional* | Comma-separated list of IVAO VIDs. |
| `hud` | Boolean | `true` | Pass `?hud=false` to hide the top-left floating cockpit HUD. |
| `route` | String | *optional* | Custom route string to force-draw on initial load. |
| `style` | String | `dark` | Map basemap style: `dark`, `satellite`, or `voyager`. |

---

## 💾 5. Custom Global Waypoints & Grist Cloud Redundancy Database

Manage the persistent curated navigation fix database stored locally at `data/custom-global-waypoints.json` with cloud redundancy on **Grist** (`wj7bUFrVUiV7`).

### ☁️ Cloud Redundancy Architecture (Grist Schema)
All verified waypoints and navaids are automatically categorized and synchronized into 5 dedicated Grist tables:

| Table ID | Navigation Type | Description |
| :--- | :--- | :--- |
| **`Fixes`** | `WAYPOINT`, `TERMINAL_WAYPOINT` | RNAV fixes, enroute airway intersections, SID/STAR fixes. |
| **`VORs`** | `VOR`, `VOR-DME` | VHF Omnidirectional Range navigation beacons. |
| **`VORTACs_TACANs`** | `VORTAC`, `TACAN`, `DME` | Military and co-located tactical air navigation beacons. |
| **`NDBs`** | `NDB` | Non-Directional radio beacons. |
| **`Airports`** | `AIRPORT` | Global ICAO aerodromes and landing facilities. |
| **`Airways`** | `AIRWAY` | High/Low altitude enroute airway corridors, sequential leg fixes, and coordinates. |

#### Standard NavAid & Waypoint Field Schema (`Fixes`, `VORs`, `VORTACs_TACANs`, `NDBs`, `Airports`):
- **`Ident`** *(Text)*: ICAO/IATA identifier (e.g. `POS`, `GERTU`, `OKSAW`).
- **`Name`** *(Text)*: Official aeronautical facility name.
- **`Type`** *(Text)*: Classification (`WAYPOINT`, `VOR`, `VORTAC`, `NDB`, `AIRPORT`).
- **`Latitude`** *(Numeric)*: Decimal WGS-84 latitude.
- **`Longitude`** *(Numeric)*: Decimal WGS-84 longitude.
- **`CountryCode`** *(Text)*: 2-letter ISO country code (e.g. `BR`, `TT`, `MX`, `US`).
- **`Region`** *(Text)*: Airspace FIR / Regional authority.
- **`ElevationFt`** *(Numeric)*: Station elevation above mean sea level.
- **`FrequencyMHz`** *(Text)*: Radio frequency in MHz or kHz (e.g. `116.30`).
- **`Source`** *(Text)*: Authoritative source (e.g. `DECEA_AIP`, `TTCAA_AIP`, `OPENNAV_ONLINE`).
- **`DateUploaded`** *(DateTime)*: Timestamp when the record was initially ingested.
- **`DateUpdated`** *(DateTime)*: Timestamp when the record was last verified or repaired.

#### Dedicated `Airways` Table Schema:
- **`AirwayIdent`** *(Text)*: Airway corridor designator (e.g. `B458`, `W37`, `Q87`, `J79`).
- **`Sequence`** *(Numeric)*: Sequential order index of the fix along the airway (e.g. `10`, `20`, `30`).
- **`FixIdent`** *(Text)*: Fix or NavAid identifier at this leg (e.g. `LHT`, `TMR`, `DADGA`).
- **`FixType`** *(Text)*: Fix classification (`WAYPOINT`, `VOR`, `VORTAC`, `NDB`).
- **`Latitude`** *(Numeric)*: Decimal WGS-84 latitude of the waypoint.
- **`Longitude`** *(Numeric)*: Decimal WGS-84 longitude of the waypoint.
- **`CountryCode`** *(Text)*: 2-letter ISO country code of the waypoint.
- **`Source`** *(Text)*: Provenance (e.g. `Curated`, `GLOBAL_NAV_DB`, `AERONAV_AIRWAY_FIX`).
- **`DateUpdated`** *(DateTime)*: Timestamp when this airway leg was synchronized.

---

### `GET /api/v1/waypoints/custom`
List all custom and curated global waypoints.
```http
GET /api/v1/waypoints/custom
```

### `POST /api/v1/waypoints/custom`
Add or update a waypoint in the persistent database and automatically sync to Grist cloud redundancy:
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

### `GET /api/v1/airways`
List all global and custom airways with search and pagination:
```http
GET /api/v1/airways?search=Q480&limit=50&offset=0
```

#### Response (JSON)
```json
{
  "total": 1,
  "count": 1,
  "offset": 0,
  "limit": 50,
  "airways": [
    {
      "ident": "Q480",
      "total_fixes": 8,
      "entry_fix": "CUGGR",
      "exit_fix": "ZANDR"
    }
  ]
}
```

### `GET /api/v1/airways/:ident`
Fetch ordered fix sequence along an airway with resolved coordinates and navigation metadata:
```http
GET /api/v1/airways/B458
```

#### Response (JSON)
```json
{
  "airway": "B458",
  "total_fixes": 4,
  "entry_fix": "LHT",
  "exit_fix": "DADGA",
  "fixes": [
    {
      "seq": 10,
      "ident": "LHT",
      "name": "Hamamatsu",
      "type": "TACAN",
      "latitude": 34.747200,
      "longitude": 137.710006,
      "country_code": "JP",
      "frequency_mhz": "114.70"
    },
    {
      "seq": 20,
      "ident": "TMR",
      "name": "Thumrait",
      "type": "VORTAC",
      "latitude": 17.668199,
      "longitude": 54.025699,
      "country_code": "OM",
      "frequency_mhz": "115.30"
    },
    {
      "seq": 30,
      "ident": "TZH",
      "name": "Tianzhen",
      "type": "VOR-DME",
      "latitude": 40.411701,
      "longitude": 114.050003,
      "country_code": "CN",
      "frequency_mhz": "116.60"
    },
    {
      "seq": 40,
      "ident": "DADGA",
      "name": "DADGA (Airway B458)",
      "type": "WAYPOINT",
      "latitude": 36.012234,
      "longitude": 113.470668,
      "country_code": "CN",
      "frequency_mhz": null
    }
  ]
}
```

### `POST /api/v1/airways`
Create or update a custom airway. Persists to `data/custom-global-airways.json` and automatically synchronizes all legs with resolved coordinates to the Grist **`Airways`** table in the Waypoints Database (`wj7bUFrVUiV7`):
```json
{
  "ident": "B458",
  "legs": [
    { "seq": 10, "fixIdent": "LHT" },
    { "seq": 20, "fixIdent": "TMR" },
    { "seq": 30, "fixIdent": "TZH" },
    { "seq": 40, "fixIdent": "DADGA" }
  ]
}
```

#### Response (JSON)
```json
{
  "success": true,
  "message": "Airway \"B458\" saved successfully with 4 fixes.",
  "airway": "B458",
  "total_fixes": 4,
  "legs": [
    { "seq": 10, "fixIdent": "LHT" },
    { "seq": 20, "fixIdent": "TMR" },
    { "seq": 30, "fixIdent": "TZH" },
    { "seq": 40, "fixIdent": "DADGA" }
  ]
}
```

---

### `POST /api/v1/route/trace`
High-speed route tracing engine with multi-layer in-memory LRU caching (`<0.2ms` repeated response times) and parallel dynamic online waypoint resolution. Traces flight plan route strings with SIDs, Airways, STARs, and international fixes. Returns sequential waypoints, bearings, distances, and GeoJSON.

#### ⚡ Automatic Missing Airway Detection & Corridor Expansion
When consecutive filed waypoints share a published enroute airway corridor but the airway designator was omitted (e.g., filed as `DIYAP OAL` instead of `DIYAP Q136 OAL`), the engine **automatically detects the connecting airway, infers the designator, and expands all intermediate waypoints** along the corridor with exact geodetic coordinates.

- **`infer_airways`** *(Boolean, optional, default: `true`)*: Enables automatic airway inference. Set to `false` for strict direct waypoint-to-waypoint navigation.

#### Request Body
```json
{
  "route": "KORD PEKUE PIPPN ROTTN DIYAP OAL INYOE KSFO",
  "departure": "KORD",
  "arrival": "KSFO",
  "infer_airways": true,
  "include_labels": true
}
```

#### Response Payload (Sample)
```json
{
  "total_waypoints": 27,
  "total_distance_nm": 1614.8,
  "inferred_airways": [
    {
      "airway": "Q136",
      "from": "DIYAP",
      "to": "OAL",
      "intermediate_fixes_count": 19,
      "intermediate_fixes": [
        "HIBAV", "BVEEE", "WRNCH", "TURCK", "AYEGI", "SYTHH", "KAWWA",
        "ZIRKL", "BBULL", "COUGH", "VOAXA", "ELLFF", "WEEMN", "MANRD",
        "TRALP", "GDGET", "CRLES", "KATTS", "RUMPS"
      ],
      "direct_distance_nm": 1121.7,
      "airway_distance_nm": 1123.4
    }
  ],
  "waypoints": [
    {
      "sequence": 5,
      "ident": "DIYAP",
      "type": "WAYPOINT",
      "latitude": 40.974733,
      "longitude": -93.790497
    },
    {
      "sequence": 6,
      "ident": "HIBAV",
      "type": "WAYPOINT",
      "via_airway": "Q136",
      "inferred_airway": true,
      "latitude": 40.930700,
      "longitude": -94.331500
    },
    ...
  ]
}
```

---

## 🔍 7. Navigation Search & Airport NavAids

- `GET /api/v1/waypoints/search?q={query}` — Search airports, VORs, NDBs, and fixes worldwide.
- `GET /api/v1/waypoints/:ident` — Fetch coordinates and details by fix ident.
- `GET /api/v1/waypoints/nearby?lat=40.75&lon=-73.87&radius_nm=30` — Radial search around GPS coords.
- `GET /api/v1/airport/:icao/navaids` — Get all navigation aids within 30 NM of an airport.
- `GET /api/v1/airways/:ident` — Get ordered fix sequence along an enroute airway.

---

## ⚡ 8. SimBrief Integration

- `GET /api/v1/simbrief/fetch?username={username}` — Fetches latest active flight plan (OFP).
- `POST /api/v1/simbrief/trace` — Fetches and instantly traces flight plan into waypoints & GeoJSON.

---

## 🗺️ 9. Mapbox Dark Black View & Static Map Snapshot API

AeroNav Global API integrates with Mapbox high-resolution dark black vector and satellite styling (`mapbox/dark-v11`).

### 1. Static Route Map Image Generation (`POST /api/v1/route/trace`)
Whenever a route contains 2 or more coordinates, `POST /api/v1/route/trace` and `POST /api/v1/simbrief/trace` automatically generate a `static_map_url` containing the flight plan route line string rendered over the Mapbox Dark Black View (`dark-v11`).

### 2. Standalone Mapbox Static Map Endpoint (`GET /api/v1/map/static`)
Stream high-resolution static PNG snapshots or retrieve JSON metadata directly:

```http
GET /api/v1/map/static?lat=40.75&lon=-73.87&zoom=12&style=dark-v11
```

| Query Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `lat` | Number | *Required* | Center latitude. |
| `lon` | Number | *Required* | Center longitude. |
| `zoom` | Number | `12` | Zoom level (1–20). |
| `width` | Number | `1000` | Image width (100–1280px). |
| `height` | Number | `500` | Image height (100–1280px). |
| `bearing` | Number | `0` | Camera heading rotation (0–360°). |
| `pitch` | Number | `0` | Camera tilt angle (0–60°). |
| `style` | String | `dark-v11` | Mapbox style: `dark-v11`, `satellite-v9`, `navigation-night-v1`. |
| `format` | String | `image` | `image` (streams PNG bytes), `json` (returns URL payload), or `redirect`. |
