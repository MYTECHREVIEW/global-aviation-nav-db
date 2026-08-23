/**
 * 🛩️ AeroNav Global: Multi-Network Live Aircraft Tracking Service
 * Supports VATSIM, IVAO, and FSHub with 15s in-memory caching and real-time SimBrief route correlation.
 */

const https = require('https');
const http = require('http');

// In-Memory Caches with 15s TTL
let vatsimCache = { timestamp: 0, data: null };
let ivaoCache = { timestamp: 0, data: null };
const CACHE_TTL_MS = 15000;

function fetchJson(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const options = {
            headers: {
                'User-Agent': 'AeroNav-Global-Route-Engine/1.0',
                ...headers
            },
            timeout: 10000
        };

        const req = client.get(url, options, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            }

            let rawData = '';
            res.on('data', chunk => { rawData += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(rawData);
                    resolve(parsed);
                } catch (e) {
                    reject(new Error(`JSON Parse Error: ${e.message}`));
                }
            });
        });

        req.on('error', err => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Connection timed out'));
        });
    });
}

/**
 * 1. VATSIM Live Pilot Fetcher
 */
async function fetchVatsimPilot(identifier) {
    const cleanId = (identifier || '').trim().toUpperCase();
    if (!cleanId) throw new Error('Missing VATSIM CID or Callsign');

    const now = Date.now();
    if (!vatsimCache.data || now - vatsimCache.timestamp > CACHE_TTL_MS) {
        try {
            const data = await fetchJson('https://data.vatsim.net/v3/vatsim-data.json');
            vatsimCache = { timestamp: now, data };
        } catch (e) {
            if (!vatsimCache.data) throw new Error(`VATSIM Data Feed Unavailable: ${e.message}`);
        }
    }

    const pilots = vatsimCache.data?.pilots || [];
    const pilot = pilots.find(p => 
        String(p.cid) === cleanId || 
        (p.callsign && p.callsign.toUpperCase() === cleanId)
    );

    if (!pilot) {
        return null;
    }

    return {
        network: 'VATSIM',
        identifier: cleanId,
        cid: pilot.cid,
        callsign: pilot.callsign,
        pilot_name: pilot.name || null,
        latitude: pilot.latitude,
        longitude: pilot.longitude,
        altitude_ft: pilot.altitude,
        groundspeed_kts: pilot.groundspeed,
        heading_deg: pilot.heading,
        transponder: pilot.transponder,
        logon_time: pilot.logon_time,
        last_updated: pilot.last_updated,
        flight_plan: pilot.flight_plan ? {
            departure: pilot.flight_plan.departure,
            arrival: pilot.flight_plan.arrival,
            alternate: pilot.flight_plan.alternate,
            aircraft: pilot.flight_plan.aircraft_short || pilot.flight_plan.aircraft,
            cruising_altitude: pilot.flight_plan.altitude,
            cruise_tas: pilot.flight_plan.cruise_tas,
            route: pilot.flight_plan.route,
            remarks: pilot.flight_plan.remarks
        } : null
    };
}

/**
 * 2. IVAO Live Pilot Fetcher
 */
async function fetchIvaoPilot(identifier) {
    const cleanId = (identifier || '').trim().toUpperCase();
    if (!cleanId) throw new Error('Missing IVAO VID or Callsign');

    const now = Date.now();
    if (!ivaoCache.data || now - ivaoCache.timestamp > CACHE_TTL_MS) {
        try {
            const data = await fetchJson('https://api.ivao.aero/v2/tracker/whazzup');
            ivaoCache = { timestamp: now, data };
        } catch (e) {
            if (!ivaoCache.data) throw new Error(`IVAO Whazzup Feed Unavailable: ${e.message}`);
        }
    }

    const pilots = ivaoCache.data?.clients?.pilots || [];
    const pilot = pilots.find(p => 
        String(p.userId) === cleanId || 
        (p.callsign && p.callsign.toUpperCase() === cleanId)
    );

    if (!pilot) {
        return null;
    }

    const track = pilot.lastTrack || {};
    const fp = pilot.flightPlan || {};

    return {
        network: 'IVAO',
        identifier: cleanId,
        vid: pilot.userId,
        callsign: pilot.callsign,
        pilot_name: pilot.userId ? `IVAO Pilot ${pilot.userId}` : null,
        latitude: track.latitude || 0,
        longitude: track.longitude || 0,
        altitude_ft: track.altitude || 0,
        groundspeed_kts: track.groundSpeed || 0,
        heading_deg: track.heading || 0,
        transponder: track.transponder || null,
        last_updated: track.timestamp || new Date().toISOString(),
        flight_plan: fp ? {
            departure: fp.departureId,
            arrival: fp.arrivalId,
            alternate: fp.alternativeId,
            aircraft: fp.aircraftId,
            cruising_altitude: fp.cruisingSpeed ? `${fp.cruisingSpeed}` : null,
            cruise_tas: fp.cruisingSpeed,
            route: fp.route,
            remarks: fp.remarks
        } : null
    };
}

/**
 * 3. FSHub Live Pilot Fetcher
 */
async function fetchFshubPilot(identifier, apiKey = null) {
    const cleanId = (identifier || '').trim();
    if (!cleanId) throw new Error('Missing FSHub User ID or Token');

    const headers = {};
    if (apiKey || process.env.FSHUB_API_KEY) {
        headers['X-FSHUB-TOKEN'] = apiKey || process.env.FSHUB_API_KEY;
    }

    try {
        const data = await fetchJson(`https://fshub.io/api/v3/user/${encodeURIComponent(cleanId)}/live`, headers);
        if (!data || !data.data) {
            return null;
        }

        const flight = data.data;
        return {
            network: 'FSHub',
            identifier: cleanId,
            user_id: cleanId,
            callsign: flight.callsign || flight.aircraft?.registration || 'FSHUB-PILOT',
            pilot_name: flight.user?.name || `Pilot ${cleanId}`,
            latitude: flight.location?.lat || flight.lat || 0,
            longitude: flight.location?.lon || flight.lon || 0,
            altitude_ft: flight.location?.altitude || flight.altitude || 0,
            groundspeed_kts: flight.location?.ground_speed || flight.ground_speed || 0,
            heading_deg: flight.location?.heading || flight.heading || 0,
            vertical_speed_fpm: flight.location?.vertical_speed || 0,
            last_updated: flight.updated_at || new Date().toISOString(),
            flight_plan: {
                departure: flight.departure?.icao || flight.origin || null,
                arrival: flight.arrival?.icao || flight.destination || null,
                aircraft: flight.aircraft?.icao || flight.aircraft?.name || null,
                route: flight.route || null
            }
        };
    } catch (e) {
        throw new Error(`FSHub Live API Error: ${e.message}`);
    }
}

function haversineDistanceM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateBearingDeg(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function crossTrackDistanceNm(lat, lon, lat1, lon1, lat2, lon2) {
    const R_NM = 3440.065;
    const d13 = haversineDistanceM(lat1, lon1, lat, lon) / 1852 / R_NM;
    const brg13 = calculateBearingDeg(lat1, lon1, lat, lon) * Math.PI / 180;
    const brg12 = calculateBearingDeg(lat1, lon1, lat2, lon2) * Math.PI / 180;
    const xtd = Math.asin(Math.sin(d13) * Math.sin(brg13 - brg12));
    return xtd * R_NM;
}

function correlateAircraftWithRoute(telemetry, routeResult) {
    if (!routeResult || !routeResult.waypoints || routeResult.waypoints.length < 2) {
        return {
            flight_phase: detectFlightPhase(telemetry),
            cross_track_deviation_nm: 0,
            distance_flown_nm: 0,
            distance_remaining_nm: 0,
            progress_percent: 0,
            next_waypoint: null
        };
    }

    const { latitude: aLat, longitude: aLon, groundspeed_kts: gs, altitude_ft: alt } = telemetry;
    const waypoints = routeResult.waypoints;

    let minDistanceToLeg = Infinity;
    let activeLegIndex = 0;
    let closestXtdNm = 0;

    for (let i = 0; i < waypoints.length - 1; i++) {
        const p1 = waypoints[i];
        const p2 = waypoints[i + 1];

        const distM = haversineDistanceM(aLat, aLon, p2.latitude, p2.longitude);
        const xtd = crossTrackDistanceNm(aLat, aLon, p1.latitude, p1.longitude, p2.latitude, p2.longitude);

        if (Math.abs(xtd) < Math.abs(closestXtdNm) || i === 0) {
            closestXtdNm = xtd;
        }

        if (distM < minDistanceToLeg) {
            minDistanceToLeg = distM;
            activeLegIndex = i + 1;
        }
    }

    const nextWp = waypoints[activeLegIndex] || waypoints[waypoints.length - 1];
    const distToNextWpNm = Math.round((haversineDistanceM(aLat, aLon, nextWp.latitude, nextWp.longitude) / 1852) * 10) / 10;
    const bearingToNextWp = Math.round(calculateBearingDeg(aLat, aLon, nextWp.latitude, nextWp.longitude));

    const distFromNextToEndNm = Math.max(0, (routeResult.total_distance_nm || 0) - (nextWp.cumulative_distance_nm || 0));
    const totalRemainingNm = Math.round((distToNextWpNm + distFromNextToEndNm) * 10) / 10;
    const totalFlownNm = Math.max(0, Math.round(((routeResult.total_distance_nm || 0) - totalRemainingNm) * 10) / 10);
    const progressPercent = routeResult.total_distance_nm > 0 
        ? Math.min(100, Math.max(0, Math.round((totalFlownNm / routeResult.total_distance_nm) * 100))) 
        : 0;

    const effectiveSpeed = gs > 50 ? gs : 400;
    const remainingMinutes = Math.round((totalRemainingNm / effectiveSpeed) * 60);
    const remainingFormatted = `${Math.floor(remainingMinutes / 60)}h ${remainingMinutes % 60}m`;

    return {
        flight_phase: detectFlightPhase(telemetry, progressPercent),
        cross_track_deviation_nm: Math.round(closestXtdNm * 10) / 10,
        distance_flown_nm: totalFlownNm,
        distance_remaining_nm: totalRemainingNm,
        progress_percent: progressPercent,
        estimated_time_remaining_minutes: remainingMinutes,
        estimated_time_remaining_formatted: remainingFormatted,
        next_waypoint: {
            ident: nextWp.ident,
            type: nextWp.type,
            sequence: nextWp.sequence,
            distance_to_go_nm: distToNextWpNm,
            bearing_deg: bearingToNextWp,
            via: nextWp.via_procedure || nextWp.via_airway || null
        }
    };
}

function detectFlightPhase(telemetry, progressPercent = 0) {
    const alt = telemetry.altitude_ft || 0;
    const gs = telemetry.groundspeed_kts || 0;

    if (gs < 35 && alt < 2000 && progressPercent < 5) return 'TAXI_OUT';
    if (gs >= 35 && gs < 200 && alt < 5000 && progressPercent < 15) return 'TAKEOFF_CLIMB';
    if (alt >= 18000 && gs >= 250) return 'CRUISE';
    if (alt < 18000 && alt >= 3000 && progressPercent > 70) return 'DESCENT';
    if (alt < 3000 && gs < 180 && progressPercent > 85) return 'APPROACH';
    if (gs < 35 && progressPercent > 90) return 'LANDED_TAXI_IN';
    return 'ENROUTE';
}

module.exports = {
    fetchVatsimPilot,
    fetchIvaoPilot,
    fetchFshubPilot,
    correlateAircraftWithRoute,
    detectFlightPhase,
    haversineDistanceM,
    calculateBearingDeg,
    crossTrackDistanceNm
};
