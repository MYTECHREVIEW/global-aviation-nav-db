# ✈️ Global Aeronautical Navigation & Route Tracing API Reference

A high-performance global aeronautical database and intelligent flight plan route tracing engine containing **85,901 Airports**, **11,008 NavAids** (VOR, VORTAC, VOR-DME, NDB, TACAN), **32,431 Certified Waypoints/Fixes**, and **1,466 Enroute Airways**.

---

## 📡 Base URL
```http
http://localhost:3510/api/v1
```

---

## 1. Trace Flight Plan Route
Expands flight plan route strings (including airways, direct fixes, and airport ICAOs), resolves trajectory-based coordinate disambiguation, and computes great-circle geodesics with GeoJSON polylines.

- **Endpoint**: `POST /api/v1/route/trace`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "departure": "KMIA",
  "arrival": "KLGA",
  "route": "KMIA DIW ORF JFK KLGA",
  "altitude_ft": 35000,
  "speed_kts": 450
}
```

---

## 2. Search Waypoints, NavAids & Airports
Prioritized multi-source search supporting exact identifier matching, prefix autocomplete, and name fuzzy searching.

- **Endpoint**: `GET /api/v1/waypoints/search?q=MERIT&limit=10`

---

## 3. Waypoint & NavAid Proximity Lookup
Fetch full details for an identifier with optional geographic coordinate bias to resolve identical names across continents.

- **Endpoint**: `GET /api/v1/waypoints/:ident?near_lat=40.75&near_lon=-73.87`

---

## 4. Airport Terminal NavAids
Fetches all radio navigation aids (VORs, ILS, NDBs) directly associated with an airport ICAO as well as all aids within 30 NM radius.

- **Endpoint**: `GET /api/v1/airport/:icao/navaids`

---

## 5. Radial Spatial Proximity Search
Search all NavAids and reporting fixes within a custom nautical mile radius around any GPS position.

- **Endpoint**: `GET /api/v1/waypoints/nearby?lat=40.75&lon=-73.87&radius_nm=30`

---

## 6. Airway Fix Sequence
Retrieve the complete sequence of reporting fixes and VORs along any Jet, Victor, or RNAV airway.

- **Endpoint**: `GET /api/v1/airways/:ident`
