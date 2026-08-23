# ✈️ Global Aviation Navigation Database & Route Tracing Engine

An extensive global database of aeronautical navigation aids (NavAids / Waypoints / Fixes / VORs / NDBs / DMEs / Airports) and flight plan route tracing engine.

## 🌟 Features
- **Worldwide Database**: 85,901 Airports, 11,008 NavAids, 32,431 Certified Waypoints/Fixes, and 1,466 Enroute Airways.
- **Associated Airport Linking**: Automatic linkage between NavAids and airport ICAOs with radio frequencies, magnetic variations, and elevation data.
- **Smart Flight Plan Route Parser**: Accepts raw route strings (e.g. `KMIA DIW ORF JFK KLGA`), auto-expands airways, resolves waypoint ambiguity using trajectory proximity, and generates great-circle geodesic polylines.
- **GeoJSON & Static Map Integration**: Generates ready-to-render GeoJSON FeatureCollections and Mapbox static flight map URLs.
- **Interactive Visualizer Web UI**: Dark cockpit theme map viewer with route presets, waypoint inspector, and real-time telemetry.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Ingest / update global navigation datasets
npm run ingest

# Start the API server
npm start
```

Open **`http://localhost:3510`** in your browser to view the interactive flight path visualizer!
