const express = require('express');
const cors = require('cors');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const RouteParser = require('./src/parser/route-parser');
const { fetchSimbriefOfp } = require('./src/simbrief/simbrief-service');
const apiKeyManager = require('./src/auth/api-key-manager');

apiKeyManager.initializeKeys();

const app = express();
const PORT = process.env.PORT || 3510;
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || '';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

console.log('📦 Loading Aeronautical Database into Memory...');
const DATA_DIR = path.join(__dirname, 'data');
const airports = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'airports.json'), 'utf8'));
const navaids = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'navaids.json'), 'utf8'));
const navaidsByIdent = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'navaids-by-ident.json'), 'utf8'));
const waypoints = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'waypoints.json'), 'utf8'));
const waypointsByIdent = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'waypoints-by-ident.json'), 'utf8'));
const airways = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'airways.json'), 'utf8'));
const sids = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sids-structured.json'), 'utf8'));
const stars = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'stars-structured.json'), 'utf8'));

console.log(`✅ Loaded ${Object.keys(airports).length.toLocaleString()} Airports, ${navaids.length.toLocaleString()} NavAids, ${waypoints.length.toLocaleString()} Waypoints, ${Object.keys(sids).length.toLocaleString()} SIDs, ${Object.keys(stars).length.toLocaleString()} STARs, ${Object.keys(airways).length.toLocaleString()} Airways.`);

const routeParser = new RouteParser(airports, navaidsByIdent, waypointsByIdent, airways, sids, stars);

// Helper to calculate haversine distance in NM
function haversineNm(lat1, lon1, lat2, lon2) {
    const R = 3440.065; // Radius of earth in nautical miles
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REST API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Health check
 */

// ═══════════════════════════════════════════════════════════════════════════════
// API KEY MANAGEMENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a new API Key
 * POST /api/v1/auth/keys
 * Body: { "name": "Flight Tracker Client", "expires_in_days": 365 }
 */
app.post('/api/v1/auth/keys', (req, res) => {
    const name = req.body?.name || 'API Client';
    const expires = req.body?.expires_in_days ? parseInt(req.body.expires_in_days, 10) : null;
    const newKey = apiKeyManager.generateApiKey(name, expires);
    res.status(201).json({
        success: true,
        message: 'API Key generated successfully. Store this key securely.',
        api_key: newKey
    });
});

/**
 * List all API Keys
 * GET /api/v1/auth/keys
 */
app.get('/api/v1/auth/keys', (req, res) => {
    const keys = apiKeyManager.loadKeys().map(k => ({
        id: k.id,
        name: k.name,
        masked_key: k.key ? k.key.substring(0, 16) + '...' + k.key.slice(-4) : '',
        created_at: k.created_at,
        expires_at: k.expires_at,
        last_used_at: k.last_used_at,
        request_count: k.request_count || 0,
        status: k.status
    }));
    res.json({ count: keys.length, keys });
});

/**
 * Revoke an API Key
 * DELETE /api/v1/auth/keys/:id
 */
app.delete('/api/v1/auth/keys/:id', (req, res) => {
    const id = req.params.id;
    const success = apiKeyManager.revokeApiKey(id);
    if (!success) {
        return res.status(404).json({ error: 'API Key not found.' });
    }
    res.json({ success: true, message: `API Key ${id} has been revoked.` });
});

// Attach API Key validation middleware

// ═══════════════════════════════════════════════════════════════════════════════
// GIT SYNC & CLOUD DEPLOYMENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get current Git Status and Latest Commit
 * GET /api/v1/git/status
 */
app.get('/api/v1/git/status', (req, res) => {
    const cwd = __dirname;
    exec('git log -1 --format="%h - %s (%cr)" 2>/dev/null && echo "---STATUS_DELIM---" && git status --porcelain', { cwd }, (err, stdout, stderr) => {
        if (err) {
            return res.json({ success: false, error: err.message, status: 'Not a git repository' });
        }
        const parts = stdout.split('---STATUS_DELIM---');
        const latestCommit = (parts[0] || '').trim() || 'Initial commit';
        const statusOutput = (parts[1] || '').trim();
        
        const rawLines = statusOutput.split('\n').filter(l => l.trim().length > 0);
        const files = rawLines.map(line => {
            const statusCode = line.substring(0, 2).trim();
            const filePath = line.substring(2).trim();
            let label = 'Modified';
            let badge = 'M';

            if (statusCode.includes('A')) { label = 'Added'; badge = 'A'; }
            else if (statusCode.includes('D')) { label = 'Deleted'; badge = 'D'; }
            else if (statusCode.includes('R')) { label = 'Renamed'; badge = 'R'; }
            else if (statusCode.includes('?')) { label = 'Untracked'; badge = '?'; }

            return {
                status_code: statusCode,
                status_badge: badge,
                status_label: label,
                path: filePath
            };
        });

        res.json({
            success: true,
            latest_commit: latestCommit,
            has_uncommitted_changes: files.length > 0,
            changed_files_count: files.length,
            files: files,
            github_url: 'https://github.com/MYTECHREVIEW/global-aviation-nav-db'
        });
    });
});

/**
 * Push local changes to GitHub
 * POST /api/v1/git/push
 * Body: { "message": "Custom commit message" }
 */
app.post('/api/v1/git/push', (req, res) => {
    const cwd = __dirname;
    const msg = req.body?.message || `update: UI & database sync at ${new Date().toISOString()}`;
    const cleanMsg = msg.replace(/"/g, '\\"');

    const cmd = `./push-to-github.sh "${cleanMsg}"`;

    exec(cmd, { cwd }, (err, stdout, stderr) => {
        if (err) {
            console.error('[Git Push Error]:', stderr || err.message);
            return res.status(500).json({
                success: false,
                error: stderr || err.message,
                output: stdout
            });
        }

        res.json({
            success: true,
            message: 'Successfully pushed all changes to GitHub (main branch).',
            output: stdout,
            github_url: 'https://github.com/MYTECHREVIEW/global-aviation-nav-db'
        });
    });
});

app.use('/api/v1', apiKeyManager.requireApiKey);

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'global-aviation-nav-db',
        total_airports: Object.keys(airports).length,
        total_navaids: navaids.length,
        total_waypoints: waypoints.length,
        total_airways: Object.keys(airways).length,
        timestamp: new Date().toISOString()
    });
});

/**
 * Search waypoints, VORs, NDBs, and Airports
 * GET /api/v1/waypoints/search?q=MERIT&limit=20
 */
app.get('/api/v1/waypoints/search', (req, res) => {
    const query = (req.query.q || '').trim().toUpperCase();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    if (!query || query.length < 1) {
        return res.status(400).json({ error: 'Search query parameter "q" is required.' });
    }

    const exactMatches = [];
    const prefixMatches = [];
    const nameMatches = [];

    // 1. Check exact matches across all collections
    if (navaidsByIdent[query]) exactMatches.push(...navaidsByIdent[query]);
    if (waypointsByIdent[query]) exactMatches.push(...waypointsByIdent[query]);
    if (airports[query]) {
        const apt = airports[query];
        exactMatches.push({
            id: `APT_${apt.icao}`,
            ident: apt.icao,
            name: apt.name,
            type: 'AIRPORT',
            latitude: apt.latitude,
            longitude: apt.longitude,
            elevation_ft: apt.elevation_ft,
            country_code: apt.country,
            city: apt.city
        });
    }

    // 2. Check prefix matches in NavAids & Waypoints
    for (const ident of Object.keys(navaidsByIdent)) {
        if (ident !== query && ident.startsWith(query)) {
            prefixMatches.push(...navaidsByIdent[ident]);
        }
    }
    for (const ident of Object.keys(waypointsByIdent)) {
        if (ident !== query && ident.startsWith(query)) {
            prefixMatches.push(...waypointsByIdent[ident]);
        }
    }
    for (const icao of Object.keys(airports)) {
        if (icao !== query && (icao.startsWith(query) || (airports[icao].iata && airports[icao].iata.startsWith(query)))) {
            const apt = airports[icao];
            prefixMatches.push({
                id: `APT_${apt.icao}`,
                ident: apt.icao,
                name: apt.name,
                type: 'AIRPORT',
                latitude: apt.latitude,
                longitude: apt.longitude,
                elevation_ft: apt.elevation_ft,
                country_code: apt.country,
                city: apt.city
            });
        }
    }

    // 3. Check name substring matches in Airports
    if (exactMatches.length + prefixMatches.length < limit) {
        for (const icao of Object.keys(airports)) {
            const apt = airports[icao];
            if (apt.name.toUpperCase().includes(query) && !exactMatches.some(e => e.ident === icao) && !prefixMatches.some(p => p.ident === icao)) {
                nameMatches.push({
                    id: `APT_${apt.icao}`,
                    ident: apt.icao,
                    name: apt.name,
                    type: 'AIRPORT',
                    latitude: apt.latitude,
                    longitude: apt.longitude,
                    elevation_ft: apt.elevation_ft,
                    country_code: apt.country,
                    city: apt.city
                });
                if (exactMatches.length + prefixMatches.length + nameMatches.length >= limit) break;
            }
        }
    }

    const combined = [...exactMatches, ...prefixMatches, ...nameMatches].slice(0, limit);

    res.json({
        query,
        count: combined.length,
        results: combined
    });
});

/**
 * Get Waypoint or NavAid by Identifier
 * GET /api/v1/waypoints/:ident?near_lat=&near_lon=
 */
app.get('/api/v1/waypoints/:ident', (req, res) => {
    const ident = req.params.ident.trim().toUpperCase();
    const nearLat = req.query.near_lat ? parseFloat(req.query.near_lat) : null;
    const nearLon = req.query.near_lon ? parseFloat(req.query.near_lon) : null;

    const navCandidates = navaidsByIdent[ident] || [];
    const fixCandidates = waypointsByIdent[ident] || [];
    const aptCandidate = airports[ident] ? [{
        id: `APT_${airports[ident].icao}`,
        ident: airports[ident].icao,
        name: airports[ident].name,
        type: 'AIRPORT',
        latitude: airports[ident].latitude,
        longitude: airports[ident].longitude,
        elevation_ft: airports[ident].elevation_ft,
        country_code: airports[ident].country,
        city: airports[ident].city
    }] : [];

    const all = [...navCandidates, ...fixCandidates, ...aptCandidate];

    if (all.length === 0) {
        return res.status(404).json({ error: `Waypoint or NavAid "${ident}" not found.` });
    }

    // If coordinates provided, sort by distance
    if (nearLat !== null && nearLon !== null && !isNaN(nearLat) && !isNaN(nearLon)) {
        all.forEach(pt => {
            pt.distance_nm = Math.round(haversineNm(nearLat, nearLon, pt.latitude, pt.longitude) * 10) / 10;
        });
        all.sort((a, b) => a.distance_nm - b.distance_nm);
    }

    res.json({
        ident,
        count: all.length,
        selected: all[0],
        candidates: all
    });
});

/**
 * Get NavAids linked to an Airport ICAO
 * GET /api/v1/airport/:icao/navaids
 */
app.get('/api/v1/airport/:icao/navaids', (req, res) => {
    const icao = req.params.icao.trim().toUpperCase();
    const apt = airports[icao];

    if (!apt) {
        return res.status(404).json({ error: `Airport with ICAO "${icao}" not found.` });
    }

    const linkedNavs = navaids.filter(n => n.associated_airport_icao === icao);
    // Also include nearby NavAids within 30 NM
    const nearbyNavs = navaids.filter(n => {
        const dist = haversineNm(apt.latitude, apt.longitude, n.latitude, n.longitude);
        return dist <= 30;
    }).map(n => ({
        ...n,
        distance_from_airport_nm: Math.round(haversineNm(apt.latitude, apt.longitude, n.latitude, n.longitude) * 10) / 10
    }));

    res.json({
        airport: apt,
        associated_navaids: linkedNavs,
        nearby_navaids_30nm: nearbyNavs
    });
});

/**
 * Radial Search for Nearby Waypoints and NavAids
 * GET /api/v1/waypoints/nearby?lat=40.75&lon=-73.87&radius_nm=30
 */
app.get('/api/v1/waypoints/nearby', (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const radiusNm = Math.min(parseFloat(req.query.radius_nm) || 25, 100);

    if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ error: 'Query parameters "lat" and "lon" are required numbers.' });
    }

    const nearbyNavaids = [];
    for (const nav of navaids) {
        const dist = haversineNm(lat, lon, nav.latitude, nav.longitude);
        if (dist <= radiusNm) {
            nearbyNavaids.push({ ...nav, distance_nm: Math.round(dist * 10) / 10 });
        }
    }

    const nearbyWaypoints = [];
    for (const wp of waypoints) {
        const dist = haversineNm(lat, lon, wp.latitude, wp.longitude);
        if (dist <= radiusNm) {
            nearbyWaypoints.push({ ...wp, distance_nm: Math.round(dist * 10) / 10 });
        }
    }

    nearbyNavaids.sort((a, b) => a.distance_nm - b.distance_nm);
    nearbyWaypoints.sort((a, b) => a.distance_nm - b.distance_nm);

    res.json({
        center: { latitude: lat, longitude: lon },
        radius_nm: radiusNm,
        navaids_count: nearbyNavaids.length,
        waypoints_count: nearbyWaypoints.length,
        navaids: nearbyNavaids,
        waypoints: nearbyWaypoints.slice(0, 100)
    });
});

/**
 * Fetch Airway Fix Sequence
 * GET /api/v1/airways/:ident
 */
app.get('/api/v1/airways/:ident', (req, res) => {
    const ident = req.params.ident.trim().toUpperCase();
    const airway = airways[ident];

    if (!airway) {
        return res.status(404).json({ error: `Airway "${ident}" not found.` });
    }

    const resolvedLegs = airway.map(leg => {
        const pt = routeParser.resolvePoint(leg.fixIdent);
        return {
            seq: leg.seq,
            ident: leg.fixIdent,
            name: pt ? pt.name : leg.fixIdent,
            type: pt ? pt.type : 'WAYPOINT',
            latitude: pt ? pt.latitude : null,
            longitude: pt ? pt.longitude : null
        };
    });

    res.json({
        airway: ident,
        total_fixes: resolvedLegs.length,
        fixes: resolvedLegs
    });
});

/**
 * Trace Flight Plan Route
 * POST /api/v1/route/trace
 * Body: { "route": "KMIA DIW ORF JFK KLGA", "departure": "KMIA", "arrival": "KLGA", "altitude_ft": 35000, "speed_kts": 450 }
 */
app.post('/api/v1/route/trace', (req, res) => {
    const { route, departure, arrival, altitude_ft, speed_kts } = req.body || {};

    if (!route && (!departure || !arrival)) {
        return res.status(400).json({
            error: 'Either "route" string or both "departure" and "arrival" ICAO codes are required.'
        });
    }

    const routeStr = route || `${departure} ${arrival}`;
    const result = routeParser.parseRoute(
        routeStr,
        departure,
        arrival,
        altitude_ft ? parseInt(altitude_ft, 10) : 35000,
        speed_kts ? parseInt(speed_kts, 10) : 450
    );

    // Build Static Map URL with GeoJSON overlay
    let staticMapUrl = null;
    if (result.route_coordinates.length >= 2 && MAPBOX_ACCESS_TOKEN) {
        const geojsonFeature = encodeURIComponent(JSON.stringify(result.geojson.features[0]));
        staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/geojson(${geojsonFeature})/auto/1000x500@2x?padding=60&access_token=${MAPBOX_ACCESS_TOKEN}`;
    }

    res.json({
        ...result,
        static_map_url: staticMapUrl
    });
});


/**
 * Fetch latest OFP from SimBrief by Username or Pilot ID
 * GET /api/v1/simbrief/fetch?username=mytekreview
 */
app.get('/api/v1/simbrief/fetch', async (req, res) => {
    const user = req.query.username || req.query.userid || req.query.user || req.query.id;
    if (!user) {
        return res.status(400).json({ error: 'Query parameter "username" or "userid" is required.' });
    }

    try {
        const ofp = await fetchSimbriefOfp(user);
        res.json(ofp);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

/**
 * Fetch from SimBrief and automatically Trace Flight Route
 * POST /api/v1/simbrief/trace
 * Body: { "username": "pilot123" }
 */
app.post('/api/v1/simbrief/trace', async (req, res) => {
    const user = req.body?.username || req.body?.userid || req.body?.user || req.query?.username;
    if (!user) {
        return res.status(400).json({ error: 'Field "username" or "userid" is required in request body.' });
    }

    try {
        const ofp = await fetchSimbriefOfp(user);

        // Build full route string with departure and arrival runway suffixes if present
        const depStr = ofp.departure_runway ? `${ofp.departure_icao}/${ofp.departure_runway}` : ofp.departure_icao;
        const arrStr = ofp.arrival_runway ? `${ofp.arrival_icao}/${ofp.arrival_runway}` : ofp.arrival_icao;
        const fullRouteStr = `${depStr} ${ofp.route} ${arrStr}`;

        const result = routeParser.parseRoute(
            fullRouteStr,
            ofp.departure_icao,
            ofp.arrival_icao,
            ofp.cruise_altitude_ft,
            ofp.cruise_tas_kts
        );

        let staticMapUrl = null;
        if (result.route_coordinates.length >= 2 && MAPBOX_ACCESS_TOKEN) {
            const geojsonFeature = encodeURIComponent(JSON.stringify(result.geojson.features[0]));
            staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/geojson(${geojsonFeature})/auto/1000x500@2x?padding=60&access_token=${MAPBOX_ACCESS_TOKEN}`;
        }

        res.json({
            simbrief_ofp: ofp,
            ...result,
            static_map_url: staticMapUrl
        });
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`✈️ Global Aviation Navigation Database & Route API is running on http://localhost:${PORT}`);
});
