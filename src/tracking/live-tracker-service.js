/**
 * 🛩️ AeroNav Global: Multi-Network Live Aircraft Tracking Service
 * Supports VATSIM, IVAO, and FSHub with 15s in-memory caching and real-time SimBrief route correlation.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// In-Memory Caches with 15s TTL & Non-blocking Stale-While-Revalidate
let vatsimCache = { timestamp: 0, data: null };
let ivaoCache = { timestamp: 0, data: null };
let fshubCache = { timestamp: 0, data: null };
const CACHE_TTL_MS = 15000;

let isFetchingVatsim = false;
async function refreshVatsimCacheAsync() {
    if (isFetchingVatsim) return;
    isFetchingVatsim = true;
    try {
        const data = await fetchJson('https://data.vatsim.net/v3/vatsim-data.json', 4000);
        if (data && data.pilots) {
            vatsimCache = { timestamp: Date.now(), data };
        }
    } catch (e) {
        // Keep existing cache
    } finally {
        isFetchingVatsim = false;
    }
}

let isFetchingIvao = false;
async function refreshIvaoCacheAsync() {
    if (isFetchingIvao) return;
    isFetchingIvao = true;
    try {
        const data = await fetchJson('https://api.ivao.aero/v2/tracker/whazzup', 4000);
        if (data && data.clients) {
            ivaoCache = { timestamp: Date.now(), data };
        }
    } catch (e) {
        // Keep existing cache
    } finally {
        isFetchingIvao = false;
    }
}

// Global Airports Database for GPS location resolving
let airportsCache = null;
function getAirportsDatabase() {
    if (!airportsCache) {
        try {
            const aptPath = path.join(__dirname, '../../data/airports.json');
            if (fs.existsSync(aptPath)) {
                airportsCache = JSON.parse(fs.readFileSync(aptPath, 'utf8'));
            }
        } catch (e) {
            airportsCache = {};
        }
    }
    return airportsCache || {};
}

function findNearestAirport(lat, lon, maxDistanceNm = 25) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || (lat === 0 && lon === 0)) return null;
    const db = getAirportsDatabase();
    let best = null;
    let minDistance = Infinity;

    // Fast bounding box check (+/- 0.6 deg is ~36 NM)
    for (const [icao, a] of Object.entries(db)) {
        if (!a.latitude || !a.longitude) continue;
        if (Math.abs(a.latitude - lat) > 0.6 || Math.abs(a.longitude - lon) > 0.6) continue;

        const distNm = haversineDistanceM(lat, lon, a.latitude, a.longitude) / 1852;
        if (distNm < minDistance && distNm <= maxDistanceNm) {
            minDistance = distNm;
            best = {
                icao: icao,
                iata: a.iata || null,
                name: a.name,
                city: a.city || null,
                elevation_ft: a.elevation_ft || a.elevation || 0,
                distance_nm: Math.round(distNm * 10) / 10
            };
        }
    }

    // Wider fallback if needed (up to 50 NM)
    if (!best) {
        for (const [icao, a] of Object.entries(db)) {
            if (!a.latitude || !a.longitude) continue;
            const distNm = haversineDistanceM(lat, lon, a.latitude, a.longitude) / 1852;
            if (distNm < minDistance && distNm <= 50) {
                minDistance = distNm;
                best = {
                    icao: icao,
                    iata: a.iata || null,
                    name: a.name,
                    city: a.city || null,
                    elevation_ft: a.elevation_ft || a.elevation || 0,
                    distance_nm: Math.round(distNm * 10) / 10
                };
            }
        }
    }

    return best;
}

function haversineDistanceM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
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

/**
 * Normalizes pilot avatars
 */
function resolvePilotAvatar(avatarUrl) {
    if (!avatarUrl || typeof avatarUrl !== 'string' || avatarUrl.includes('u_1_80.png')) {
        return '/assets/default-pilot-avatar.png';
    }
    return avatarUrl;
}

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
    if (!vatsimCache.data) {
        await refreshVatsimCacheAsync();
    } else if (now - vatsimCache.timestamp > CACHE_TTL_MS) {
        refreshVatsimCacheAsync(); // Background async refresh without blocking!
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
        pilot_avatar: resolvePilotAvatar(null),
        latitude: pilot.latitude,
        longitude: pilot.longitude,
        altitude_ft: pilot.altitude,
        groundspeed_kts: pilot.groundspeed,
        heading_deg: pilot.heading,
        transponder: pilot.transponder,
        squawk: pilot.transponder,
        logon_time: pilot.logon_time,
        last_updated: pilot.last_updated,
        vatsim: {
            cid: pilot.cid,
            is_online: true,
            callsign: pilot.callsign,
            squawk: pilot.transponder,
            altitude_ft: pilot.altitude,
            groundspeed_kts: pilot.groundspeed
        },
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
    if (!ivaoCache.data) {
        await refreshIvaoCacheAsync();
    } else if (now - ivaoCache.timestamp > CACHE_TTL_MS) {
        refreshIvaoCacheAsync(); // Background async refresh without blocking!
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
 * Supports FSHub Personal API Tokens, Numeric Pilot IDs, Callsigns/Flight Numbers, and Pilot Usernames.
 */
async function fetchFshubPilot(identifier, apiKey = null) {
    const cleanId = (identifier || '').trim();
    let token = apiKey || (cleanId.length >= 30 && !cleanId.includes(' ') ? cleanId : null) || process.env.FSHUB_API_KEY;
    let targetPilotId = null;
    let targetPilotName = null;
    let userProfile = null;
    let airlines = [];

    // If an API token is provided or detected, look up the authenticated pilot info and their VAs
    if (token) {
        try {
            const userRes = await fetchJson('https://fshub.io/api/v3/user', {
                'X-Pilot-Token': token,
                'Accept': 'application/json'
            });
            if (userRes && userRes.data) {
                userProfile = userRes.data;
                if (userProfile.id) targetPilotId = String(userProfile.id);
                if (userProfile.name) targetPilotName = userProfile.name;
            }
        } catch (e) {
            // If token lookup fails, continue with movements
        }

        if (targetPilotId) {
            try {
                const aRes = await fetchJson(`https://fshub.io/api/v3/pilot/${targetPilotId}/airline`, {
                    'X-Pilot-Token': token,
                    'Accept': 'application/json'
                });
                airlines = aRes?.data || [];
            } catch (e) {}
        }
    }

    // Fetch and cache real-time live movements from FSHub
    const now = Date.now();
    if (!fshubCache.data || now - fshubCache.timestamp > CACHE_TTL_MS) {
        try {
            const movementsData = await fetchJson('https://movements.api.fshub.io/all');
            fshubCache = {
                timestamp: now,
                data: movementsData?.flights || []
            };
        } catch (e) {
            if (!fshubCache.data) {
                throw new Error(`FSHub Live Movements API Error: ${e.message}`);
            }
        }
    }

    const flights = fshubCache.data || [];
    const searchUpper = cleanId.toUpperCase();
    const searchLower = cleanId.toLowerCase();

    // Fetch VATSIM data feed for cross-correlation
    let vatData = null;
    try {
        vatData = await fetchJson('https://data.vatsim.net/v3/vatsim-data.json');
    } catch (e) {}

    // Collect all active VA fleet flights if airlines were found
    let fleetFlights = [];
    let vaPilotsList = [];
    if (airlines.length > 0) {
        for (const va of airlines) {
            try {
                const vpRes = await fetchJson(`https://fshub.io/api/v3/airline/${va.id}/pilot?limit=100`, {
                    'X-Pilot-Token': token,
                    'Accept': 'application/json'
                });
                vaPilotsList = vpRes?.data || [];
            } catch (e) {}

            const activeVaMovements = flights.filter(f => {
                if (f.airline && (f.airline.id === va.id || (va.abbr && f.airline.abbr?.toUpperCase() === va.abbr.toUpperCase()))) return true;
                if (f.pilot && vaPilotsList.some(vp => String(vp.id) === String(f.pilot.id))) return true;
                return false;
            });

            for (const f of activeVaMovements) {
                const altFt = f.position?.altitude_ft || f.position?.alt_asl || 0;
                const gsKts = f.position?.speed_tas_kts || 0;
                const hdgDeg = f.position?.heading || 0;
                let cruiseLvl = f.plan?.cruise_lvl || null;
                if (cruiseLvl && cruiseLvl < 1000) cruiseLvl = cruiseLvl * 100;

                const pId = f.pilot?.id;
                let vcid = null;
                if (pId && pilotProfileCache[pId]) {
                    vcid = pilotProfileCache[pId].handles?.vatsim;
                } else if (pId && token) {
                    try {
                        const prof = await fetchJson(`https://fshub.io/api/v3/pilot/${pId}`, {
                            'X-Pilot-Token': token,
                            'Accept': 'application/json'
                        });
                        if (prof?.data) {
                            pilotProfileCache[pId] = prof.data;
                            vcid = prof.data.handles?.vatsim;
                        }
                    } catch (e) {}
                }

                let vPilot = null;
                if (vatData?.pilots) {
                    if (vcid) {
                        vPilot = vatData.pilots.find(p => String(p.cid) === String(vcid));
                    }
                    if (!vPilot && f.plan?.callsign) {
                        vPilot = vatData.pilots.find(p => p.callsign?.toUpperCase() === f.plan.callsign.toUpperCase());
                    }
                }
                if (vPilot && !vcid) {
                    vcid = vPilot.cid;
                }

                let depIcao = f.plan?.departure || f.departure?.icao || null;
                let arrIcao = f.plan?.arrival || f.arrival?.icao || null;
                let depName = null;
                let nearestApt = null;

                const pLat = f.position?.lat || 0;
                const pLng = f.position?.lng || 0;
                if (pLat !== 0 || pLng !== 0) {
                    nearestApt = findNearestAirport(pLat, pLng);
                    if (!depIcao && nearestApt) {
                        depIcao = nearestApt.icao;
                        depName = nearestApt.name;
                    }
                }
                if (!arrIcao && (!f.plan?.route) && (f.phase === 'awaiting_departure' || f.phase === 'boarding' || f.phase === 'taxiing' || gsKts === 0)) {
                    arrIcao = 'STANDBY';
                }

                fleetFlights.push({
                    id: f.id,
                    network: 'FSHub',
                    user_id: f.pilot?.id || null,
                    pilot_name: f.pilot?.name || 'VA Pilot',
                    pilot_avatar: f.pilot?.avatar_url || null,
                    callsign: f.plan?.callsign || f.plan?.flight_no || f.aircraft?.registration || f.pilot?.name || 'VA-PILOT',
                    airline: f.airline || (va ? { id: va.id, name: va.name, abbr: va.abbr } : null),
                    aircraft: f.aircraft?.icao || f.aircraft?.name || f.plan?.aircraft || null,
                    departure: depIcao,
                    departure_name: depName,
                    arrival: arrIcao,
                    nearest_airport: nearestApt,
                    latitude: pLat,
                    longitude: pLng,
                    altitude_ft: altFt,
                    groundspeed_kts: gsKts,
                    heading_deg: hdgDeg,
                    squawk: f.position?.squawk || null,
                    phase: f.phase || 'ENROUTE',
                    last_updated: f.last_seen || f.last_moved || new Date().toISOString(),
                    vatsim: {
                        cid: vcid || null,
                        is_online: !!vPilot,
                        callsign: vPilot?.callsign || null,
                        squawk: vPilot?.transponder || null,
                        altitude_ft: vPilot?.altitude || null,
                        groundspeed_kts: vPilot?.groundspeed || null
                    },
                    flight_plan: {
                        departure: depIcao,
                        arrival: arrIcao,
                        aircraft: f.aircraft?.icao || f.aircraft?.name || f.plan?.aircraft || null,
                        route: f.plan?.route || null,
                        cruising_altitude: cruiseLvl,
                        cruise_tas: gsKts > 0 ? gsKts : 450
                    }
                });
            }
        }
    }

    // Find personal flight in active movements
    let flight = flights.find(f => {
        if (targetPilotId && f.pilot && String(f.pilot.id) === targetPilotId) return true;
        if (targetPilotName && f.pilot?.name && f.pilot.name.toLowerCase() === targetPilotName.toLowerCase()) return true;
        if (f.pilot && String(f.pilot.id) === cleanId) return true;
        if (f.pilot?.name && f.pilot.name.toLowerCase() === searchLower) return true;
        if (f.plan?.callsign && f.plan.callsign.toUpperCase() === searchUpper) return true;
        if (f.plan?.flight_no && f.plan.flight_no.toUpperCase() === searchUpper) return true;
        if (f.aircraft?.registration && f.aircraft.registration.toUpperCase() === searchUpper) return true;
        if (f.id === cleanId) return true;
        return false;
    });

    if (flight) {
        const altFt = flight.position?.altitude_ft || flight.position?.alt_asl || 0;
        const gsKts = flight.position?.speed_tas_kts || 0;
        const hdgDeg = flight.position?.heading || 0;

        let cruiseLvl = flight.plan?.cruise_lvl || null;
        if (cruiseLvl && cruiseLvl < 1000) cruiseLvl = cruiseLvl * 100;

        return {
            network: 'FSHub',
            identifier: cleanId,
            user_id: flight.pilot?.id || cleanId,
            callsign: flight.plan?.callsign || flight.plan?.flight_no || flight.aircraft?.registration || flight.pilot?.name || 'FSHUB-PILOT',
            pilot_name: flight.pilot?.name || targetPilotName || `Pilot ${cleanId}`,
            airline: flight.airline || (airlines.length > 0 ? { id: airlines[0].id, name: airlines[0].name, abbr: airlines[0].abbr } : null),
            aircraft: flight.aircraft?.icao || flight.aircraft?.name || flight.plan?.aircraft || null,
            latitude: flight.position?.lat || 0,
            longitude: flight.position?.lng || 0,
            altitude_ft: altFt,
            groundspeed_kts: gsKts,
            heading_deg: hdgDeg,
            vertical_speed_fpm: 0,
            squawk: flight.position?.squawk || null,
            last_updated: flight.last_seen || flight.last_moved || new Date().toISOString(),
            flight_plan: {
                departure: flight.plan?.departure || flight.departure?.icao || null,
                arrival: flight.plan?.arrival || flight.arrival?.icao || null,
                aircraft: flight.aircraft?.icao || flight.aircraft?.name || flight.plan?.aircraft || null,
                route: flight.plan?.route || null,
                cruising_altitude: cruiseLvl,
                cruise_tas: gsKts > 0 ? gsKts : 450
            },
            fleet: fleetFlights,
            is_fleet: fleetFlights.length > 0
        };
    }

    // If personal flight not found, but we have active fleet flights, use the first fleet flight as primary while attaching all fleet
    if (fleetFlights.length > 0) {
        const primary = fleetFlights[0];
        return {
            ...primary,
            identifier: cleanId,
            fleet: fleetFlights,
            is_fleet: true
        };
    }

    // Fallback: If user is authenticated with token and online via GPS but not yet in movements flight plan
    if (userProfile && (userProfile.is_online || userProfile.gps)) {
        return {
            network: 'FSHub',
            identifier: cleanId,
            user_id: userProfile.id || cleanId,
            callsign: userProfile.name || 'FSHUB-PILOT',
            pilot_name: userProfile.name || `Pilot ${cleanId}`,
            latitude: userProfile.gps?.lat || 0,
            longitude: userProfile.gps?.lng || 0,
            altitude_ft: 0,
            groundspeed_kts: 0,
            heading_deg: 0,
            vertical_speed_fpm: 0,
            squawk: null,
            last_updated: userProfile.online_at || new Date().toISOString(),
            flight_plan: {
                departure: userProfile.base || null,
                arrival: userProfile.locale || null,
                aircraft: null,
                route: null,
                cruising_altitude: null,
                cruise_tas: null
            },
            fleet: fleetFlights,
            is_fleet: fleetFlights.length > 0
        };
    }

    return null;
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

// In-Memory Caches for Pilot Profiles & VA Rosters
let pilotProfileCache = {};
let airlinePilotsCache = {};

/**
 * 4. FSHub Comprehensive Token Inspector (Personal Pilot & Virtual Airlines)
 * Acquires full user profile, base, locale, stats, bio, VATSIM CID, and all Virtual Airlines.
 * For Virtual Airlines, retrieves all active pilots, live flight plans, telemetry, and VATSIM correlation.
 */
async function inspectFshubToken(token, explicitVaId = null) {
    const cleanToken = (token || '').trim();
    if (!cleanToken) throw new Error('Missing FSHub Token');

    const headers = {
        'X-Pilot-Token': cleanToken,
        'Accept': 'application/json'
    };

    // 1. Fetch authenticated user data
    const userRes = await fetchJson('https://fshub.io/api/v3/user', headers);
    const user = userRes?.data;
    if (!user) throw new Error('Invalid FSHub Token or user data unavailable');

    // 2. Fetch pilot details & stats
    let profile = null;
    let stats = null;
    try {
        const pRes = await fetchJson(`https://fshub.io/api/v3/pilot/${user.id}`, headers);
        profile = pRes?.data;
        if (profile) pilotProfileCache[user.id] = profile;
    } catch (e) {}

    try {
        const sRes = await fetchJson(`https://fshub.io/api/v3/pilot/${user.id}/stats`, headers);
        stats = sRes?.data;
    } catch (e) {}

    // 3. Discover User Airlines
    let airlines = [];
    try {
        const aRes = await fetchJson(`https://fshub.io/api/v3/pilot/${user.id}/airline`, headers);
        airlines = aRes?.data || [];
    } catch (e) {}

    if (explicitVaId && !airlines.some(a => String(a.id) === String(explicitVaId))) {
        try {
            const expRes = await fetchJson(`https://fshub.io/api/v3/airline/${explicitVaId}`, headers);
            if (expRes?.data) airlines.unshift(expRes.data);
        } catch (e) {}
    }

    // 4. Fetch VATSIM Global Network Data (Cached 15s)
    const now = Date.now();
    if (!vatsimCache.data || now - vatsimCache.timestamp > CACHE_TTL_MS) {
        try {
            const vData = await fetchJson('https://data.vatsim.net/v3/vatsim-data.json');
            vatsimCache = { timestamp: now, data: vData };
        } catch (e) {}
    }
    const vatData = vatsimCache.data;

    // Check personal pilot on VATSIM
    const vatsimCid = profile?.handles?.vatsim ? String(profile.handles.vatsim).trim() : null;
    let userVatsimLive = null;
    if (vatsimCid && vatData?.pilots) {
        const vp = vatData.pilots.find(p => String(p.cid) === vatsimCid);
        if (vp) {
            userVatsimLive = {
                is_online: true,
                callsign: vp.callsign,
                cid: String(vp.cid),
                aircraft: vp.flight_plan?.aircraft_short || vp.flight_plan?.aircraft || 'Unknown',
                departure: vp.flight_plan?.departure || null,
                arrival: vp.flight_plan?.arrival || null,
                altitude_ft: vp.altitude,
                groundspeed_kts: vp.groundspeed,
                heading_deg: vp.heading,
                squawk: vp.transponder,
                logon_time: vp.logon_time,
                route: vp.flight_plan?.route || null
            };
        }
    }

    // 5. Fetch FSHub Global Live Movements (Cached 15s)
    if (!fshubCache.data || now - fshubCache.timestamp > CACHE_TTL_MS) {
        try {
            const movementsData = await fetchJson('https://movements.api.fshub.io/all');
            fshubCache = {
                timestamp: now,
                data: movementsData?.flights || []
            };
        } catch (e) {}
    }
    const allMovements = fshubCache.data || [];

    // Find personal active flight
    const personalFlight = allMovements.find(f => f.pilot && (String(f.pilot.id) === String(user.id) || (user.name && f.pilot.name?.toLowerCase() === user.name.toLowerCase())));

    // 6. Process Virtual Airlines & Flying Fleet
    const vaResults = [];
    for (const va of airlines) {
        let vaPilots = [];
        const cacheKey = `va_${va.id}`;
        if (airlinePilotsCache[cacheKey] && now - airlinePilotsCache[cacheKey].timestamp < 60000) {
            vaPilots = airlinePilotsCache[cacheKey].data;
        } else {
            try {
                const vpRes = await fetchJson(`https://fshub.io/api/v3/airline/${va.id}/pilot?limit=100`, headers);
                vaPilots = vpRes?.data || [];
                airlinePilotsCache[cacheKey] = { timestamp: now, data: vaPilots };
            } catch (e) {}
        }

        const onlinePilots = vaPilots.filter(p => p.is_online);

        // Find active flights for this VA
        const vaFlights = allMovements.filter(f => {
            if (f.airline && (f.airline.id === va.id || (va.abbr && f.airline.abbr?.toUpperCase() === va.abbr.toUpperCase()))) return true;
            if (f.pilot && vaPilots.some(vp => String(vp.id) === String(f.pilot.id))) return true;
            return false;
        });

        const detailedActiveFlights = [];
        for (const f of vaFlights) {
            const pId = f.pilot?.id;
            let vcid = null;
            if (pId && pilotProfileCache[pId]) {
                vcid = pilotProfileCache[pId].handles?.vatsim;
            } else if (pId) {
                try {
                    const prof = await fetchJson(`https://fshub.io/api/v3/pilot/${pId}`, headers);
                    if (prof?.data) {
                        pilotProfileCache[pId] = prof.data;
                        vcid = prof.data.handles?.vatsim;
                    }
                } catch (e) {}
            }

            let vPilot = null;
            if (vatData?.pilots) {
                if (vcid) {
                    vPilot = vatData.pilots.find(p => String(p.cid) === String(vcid));
                }
                if (!vPilot && f.plan?.callsign) {
                    vPilot = vatData.pilots.find(p => p.callsign?.toUpperCase() === f.plan.callsign.toUpperCase());
                }
            }

            let cruiseLvl = f.plan?.cruise_lvl || null;
            if (cruiseLvl && cruiseLvl < 1000) cruiseLvl = cruiseLvl * 100;

            let depIcao = f.plan?.departure || f.departure?.icao || null;
            let arrIcao = f.plan?.arrival || f.arrival?.icao || null;
            let depName = null;
            let nearestApt = null;

            const pLat = f.position?.lat || 0;
            const pLng = f.position?.lng || 0;
            if (pLat !== 0 || pLng !== 0) {
                nearestApt = findNearestAirport(pLat, pLng);
                if (!depIcao && nearestApt) {
                    depIcao = nearestApt.icao;
                    depName = nearestApt.name;
                }
            }
            if (!arrIcao && (!f.plan?.route) && (f.phase === 'awaiting_departure' || f.phase === 'boarding' || f.phase === 'taxiing' || f.position?.speed_tas_kts === 0)) {
                arrIcao = 'STANDBY';
            }

            detailedActiveFlights.push({
                id: f.id,
                phase: f.phase || 'ENROUTE',
                pilot_id: f.pilot?.id,
                pilot_name: f.pilot?.name || 'FSHub Pilot',
                pilot_avatar: f.pilot?.avatar_url || null,
                callsign: f.plan?.callsign || f.plan?.flight_no || f.aircraft?.registration || (f.pilot?.name ? `${f.pilot.name}` : 'VA-PILOT'),
                aircraft: f.aircraft?.icao || f.aircraft?.name || 'Unknown',
                departure: depIcao,
                departure_name: depName,
                arrival: arrIcao,
                nearest_airport: nearestApt,
                route: f.plan?.route || null,
                cruise_lvl: cruiseLvl,
                position: {
                    lat: pLat,
                    lng: pLng,
                    altitude_ft: f.position?.altitude_ft || f.position?.alt_asl || 0,
                    heading: f.position?.heading || 0,
                    speed_tas_kts: f.position?.speed_tas_kts || 0,
                    squawk: f.position?.squawk || null
                },
                eta_minutes: f.eta_minutes || null,
                progress: f.progress || 0,
                vatsim: {
                    cid: vcid || null,
                    is_online: !!vPilot,
                    callsign: vPilot?.callsign || null,
                    squawk: vPilot?.transponder || null,
                    altitude_ft: vPilot?.altitude || null,
                    groundspeed_kts: vPilot?.groundspeed || null
                },
                flight_plan: {
                    departure: depIcao,
                    arrival: arrIcao,
                    aircraft: f.aircraft?.icao || null,
                    route: f.plan?.route || null,
                    cruising_altitude: cruiseLvl
                }
            });
        }

        vaResults.push({
            id: va.id,
            name: va.name,
            abbr: va.abbr,
            banner_url: va.banner_url || null,
            logo_url: va.logo_url || null,
            website: va.handles?.website || null,
            total_pilots: vaPilots.length,
            online_pilots_count: onlinePilots.length,
            active_flights: detailedActiveFlights
        });
    }

    return {
        success: true,
        user: {
            id: user.id,
            name: user.name,
            bio: profile?.bio || null,
            base: user.base || null,
            locale: user.locale || null,
            is_online: !!user.is_online,
            gps: user.gps || null,
            vatsim_cid: vatsimCid,
            vatsim_live: userVatsimLive || { is_online: false },
            stats: stats?.all_time || null,
            active_flight: personalFlight ? {
                id: personalFlight.id,
                callsign: personalFlight.plan?.callsign || personalFlight.plan?.flight_no || personalFlight.aircraft?.registration || 'FSHUB-PILOT',
                aircraft: personalFlight.aircraft?.icao || 'Unknown',
                departure: personalFlight.plan?.departure || personalFlight.departure?.icao || null,
                arrival: personalFlight.plan?.arrival || personalFlight.arrival?.icao || null,
                route: personalFlight.plan?.route || null,
                position: personalFlight.position || null,
                phase: personalFlight.phase || 'ENROUTE'
            } : null
        },
        virtual_airlines: vaResults
    };
}

/**
 * Multi-Network Target Array Live Tracking
 * Accepts an array of targets across VATSIM, FSHub, and IVAO,
 * concurrently queries all live feeds, cross-correlates data,
 * and returns a standardized unified array of active flights.
 * 
 * @param {Array|Object} targetsInput Array of targets or object with network arrays
 * @returns {Promise<Object>} Unified multi-network tracking payload
 */
async function trackMultiTargets(targetsInput) {
    const rawTargets = [];

    // Normalize input formats
    if (Array.isArray(targetsInput)) {
        for (const item of targetsInput) {
            if (typeof item === 'string') {
                rawTargets.push({ network: 'AUTO', id: item.trim() });
            } else if (typeof item === 'object' && item !== null) {
                rawTargets.push({
                    network: (item.network || 'AUTO').toUpperCase(),
                    id: String(item.id || item.identifier || item.callsign || item.token || '').trim(),
                    token: item.token || null,
                    va_id: item.va_id || null
                });
            }
        }
    } else if (typeof targetsInput === 'object' && targetsInput !== null) {
        if (Array.isArray(targetsInput.targets)) {
            return trackMultiTargets(targetsInput.targets);
        }
        if (targetsInput.vatsim) {
            const vatsimList = Array.isArray(targetsInput.vatsim) ? targetsInput.vatsim : String(targetsInput.vatsim).split(',');
            vatsimList.forEach(id => rawTargets.push({ network: 'VATSIM', id: id.trim() }));
        }
        if (targetsInput.fshub) {
            const fshubList = Array.isArray(targetsInput.fshub) ? targetsInput.fshub : String(targetsInput.fshub).split(',');
            fshubList.forEach(id => {
                const clean = id.trim();
                if (clean.length >= 30) {
                    rawTargets.push({ network: 'FSHUB', id: clean, token: clean });
                } else {
                    rawTargets.push({ network: 'FSHUB', id: clean });
                }
            });
        }
        if (targetsInput.tokens) {
            const tokenList = Array.isArray(targetsInput.tokens) ? targetsInput.tokens : String(targetsInput.tokens).split(',');
            tokenList.forEach(t => rawTargets.push({ network: 'FSHUB', id: t.trim(), token: t.trim() }));
        }
        if (targetsInput.ivao) {
            const ivaoList = Array.isArray(targetsInput.ivao) ? targetsInput.ivao : String(targetsInput.ivao).split(',');
            ivaoList.forEach(id => rawTargets.push({ network: 'IVAO', id: id.trim() }));
        }
    }

    if (rawTargets.length === 0) {
        return { success: true, timestamp: Date.now(), total_flights: 0, flights: [] };
    }

    const aggregatedFlights = new Map();

    // Concurrently process all targets
    const tasks = rawTargets.map(async (target) => {
        try {
            const net = target.network;
            const id = target.id;
            const token = target.token || (id.length >= 30 ? id : null);

            // 1. FSHub Token Inspection (Fetches Personal Flight + VA Fleet Flights)
            if (token || (net === 'FSHUB' && id.length >= 30)) {
                const fshubData = await inspectFshubToken(token || id, target.va_id);
                if (fshubData && fshubData.success) {
                    // Add personal flight if active
                    const u = fshubData.user;
                    if (u && u.active_flight) {
                        const pf = u.active_flight;
                        const key = `fshub_${pf.id || pf.callsign}`;
                        aggregatedFlights.set(key, {
                            id: key,
                            source: 'FSHUB_PERSONAL',
                            network: 'FSHub',
                            callsign: pf.callsign,
                            pilot_id: u.id,
                            pilot_name: u.name,
                            pilot_avatar: resolvePilotAvatar(u.avatar),
                            airline: null,
                            aircraft: pf.aircraft || 'Unknown',
                            departure: pf.departure,
                            arrival: pf.arrival,
                            route: pf.route,
                            latitude: pf.position?.lat,
                            longitude: pf.position?.lng,
                            altitude_ft: Math.round(pf.position?.altitude_ft || 0),
                            groundspeed_kts: Math.round(pf.position?.speed_tas_kts || 0),
                            heading_deg: Math.round(pf.position?.heading || 0),
                            squawk: String(pf.position?.squawk || '1200'),
                            phase: pf.phase || 'ENROUTE',
                            vatsim: {
                                cid: u.vatsim_cid || null,
                                is_online: !!(u.vatsim_live && u.vatsim_live.is_online),
                                callsign: u.vatsim_live?.callsign || null,
                                squawk: u.vatsim_live?.squawk || null
                            }
                        });
                    }

                    // Add active flights across Virtual Airlines
                    if (Array.isArray(fshubData.virtual_airlines)) {
                        for (const va of fshubData.virtual_airlines) {
                            if (Array.isArray(va.active_flights)) {
                                for (const f of va.active_flights) {
                                    const key = `fshub_va_${f.flight_id || f.callsign}`;
                                    aggregatedFlights.set(key, {
                                        id: key,
                                        source: 'FSHUB_VA_FLEET',
                                        network: 'FSHub',
                                        callsign: f.callsign,
                                        pilot_id: f.pilot_id,
                                        pilot_name: f.pilot_name,
                                        pilot_avatar: resolvePilotAvatar(f.pilot_avatar),
                                        airline: {
                                            id: va.id,
                                            name: va.name,
                                            abbr: va.abbr,
                                            is_va: true
                                        },
                                        aircraft: f.aircraft || f.flight_plan?.aircraft || 'Unknown',
                                        departure: f.departure || f.flight_plan?.departure,
                                        arrival: f.arrival || f.flight_plan?.arrival,
                                        route: f.route || f.flight_plan?.route,
                                        latitude: f.position?.lat,
                                        longitude: f.position?.lng,
                                        altitude_ft: Math.round(f.position?.altitude_ft || 0),
                                        groundspeed_kts: Math.round(f.position?.speed_tas_kts || 0),
                                        heading_deg: Math.round(f.position?.heading || 0),
                                        squawk: String(f.position?.squawk || '1200'),
                                        phase: f.phase || 'ENROUTE',
                                        vatsim: {
                                            cid: f.vatsim_cid || null,
                                            is_online: !!(f.vatsim_live && f.vatsim_live.is_online),
                                            callsign: f.vatsim_live?.callsign || null,
                                            squawk: f.vatsim_live?.squawk || null
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
                return;
            }

            // 2. Direct FSHub Pilot Query by User ID or Callsign
            if (net === 'FSHUB') {
                const pilot = await fetchFshubPilot(id);
                if (pilot) {
                    const key = `fshub_${pilot.user_id || pilot.callsign}`;
                    aggregatedFlights.set(key, {
                        id: key,
                        source: 'FSHUB_DIRECT',
                        network: 'FSHub',
                        callsign: pilot.callsign,
                        pilot_id: pilot.user_id,
                        pilot_name: pilot.pilot_name || pilot.user_name || 'FSHub Pilot',
                        pilot_avatar: resolvePilotAvatar(pilot.pilot_avatar),
                        airline: pilot.airline || null,
                        aircraft: pilot.aircraft || pilot.flight_plan?.aircraft || 'Unknown',
                        departure: pilot.departure || pilot.flight_plan?.departure,
                        arrival: pilot.arrival || pilot.flight_plan?.arrival,
                        route: pilot.route || pilot.flight_plan?.route,
                        latitude: pilot.position?.lat !== undefined ? pilot.position.lat : pilot.latitude,
                        longitude: pilot.position?.lng !== undefined ? pilot.position.lng : pilot.longitude,
                        altitude_ft: Math.round(pilot.altitude_ft !== undefined ? pilot.altitude_ft : (pilot.position?.altitude_ft || 0)),
                        groundspeed_kts: Math.round(pilot.groundspeed_kts !== undefined ? pilot.groundspeed_kts : (pilot.position?.speed_tas_kts || 0)),
                        heading_deg: Math.round(pilot.heading_deg !== undefined ? pilot.heading_deg : (pilot.position?.heading || 0)),
                        squawk: String(pilot.squawk || pilot.position?.squawk || '1200'),
                        phase: pilot.flight_phase || pilot.phase || 'ENROUTE',
                        vatsim: {
                            cid: pilot.vatsim_cid || null,
                            is_online: !!(pilot.vatsim_live && pilot.vatsim_live.is_online),
                            callsign: pilot.vatsim_live?.callsign || null,
                            squawk: pilot.vatsim_live?.squawk || null
                        }
                    });
                }
                return;
            }

            // 3. VATSIM Query by CID or Callsign
            if (net === 'VATSIM' || net === 'AUTO') {
                const vPilot = await fetchVatsimPilot(id);
                if (vPilot) {
                    const key = `vatsim_${vPilot.cid || vPilot.callsign}`;
                    aggregatedFlights.set(key, {
                        id: key,
                        source: 'VATSIM',
                        network: 'VATSIM',
                        callsign: vPilot.callsign,
                        pilot_id: vPilot.cid,
                        pilot_name: vPilot.pilot_name || vPilot.name || `Pilot ${vPilot.cid}`,
                        pilot_avatar: resolvePilotAvatar(vPilot.pilot_avatar),
                        airline: null,
                        aircraft: vPilot.flight_plan?.aircraft || vPilot.flight_plan?.aircraft_short || vPilot.aircraft || 'Unknown',
                        departure: vPilot.flight_plan?.departure || null,
                        arrival: vPilot.flight_plan?.arrival || null,
                        route: vPilot.flight_plan?.route || null,
                        latitude: vPilot.latitude,
                        longitude: vPilot.longitude,
                        altitude_ft: Math.round(vPilot.altitude_ft || vPilot.altitude || 0),
                        groundspeed_kts: Math.round(vPilot.groundspeed_kts || vPilot.groundspeed || 0),
                        heading_deg: Math.round(vPilot.heading_deg || vPilot.heading || 0),
                        squawk: String(vPilot.transponder || vPilot.squawk || '1200'),
                        phase: vPilot.flight_phase || (vPilot.groundspeed_kts > 40 ? 'ENROUTE' : 'TAXIING'),
                        vatsim: {
                            cid: vPilot.cid,
                            is_online: true,
                            callsign: vPilot.callsign,
                            squawk: String(vPilot.transponder || vPilot.squawk || '1200')
                        }
                    });
                    return;
                }
            }

            // 4. IVAO Query
            if (net === 'IVAO') {
                const iPilot = await fetchIvaoPilot(id);
                if (iPilot) {
                    const key = `ivao_${iPilot.vid || iPilot.callsign}`;
                    aggregatedFlights.set(key, {
                        id: key,
                        source: 'IVAO',
                        network: 'IVAO',
                        callsign: iPilot.callsign,
                        pilot_id: iPilot.vid,
                        pilot_name: iPilot.name || `Pilot ${iPilot.vid}`,
                        pilot_avatar: resolvePilotAvatar(iPilot.pilot_avatar),
                        airline: null,
                        aircraft: iPilot.flight_plan?.aircraft || 'Unknown',
                        departure: iPilot.flight_plan?.departure || null,
                        arrival: iPilot.flight_plan?.arrival || null,
                        route: iPilot.flight_plan?.route || null,
                        latitude: iPilot.latitude,
                        longitude: iPilot.longitude,
                        altitude_ft: Math.round(iPilot.altitude_ft || 0),
                        groundspeed_kts: Math.round(iPilot.groundspeed_kts || 0),
                        heading_deg: Math.round(iPilot.heading_deg || 0),
                        squawk: String(iPilot.squawk || '1200'),
                        phase: iPilot.flight_phase || 'ENROUTE',
                        vatsim: { cid: null, is_online: false }
                    });
                }
            }
        } catch (err) {
            console.error(`[MultiTracker] Error resolving target:`, target, err.message);
        }
    });

    await Promise.all(tasks);

    const flightsList = Array.from(aggregatedFlights.values());

    return {
        success: true,
        timestamp: Date.now(),
        total_flights: flightsList.length,
        flights: flightsList
    };
}

module.exports = {
    fetchVatsimPilot,
    fetchIvaoPilot,
    fetchFshubPilot,
    inspectFshubToken,
    trackMultiTargets,
    correlateAircraftWithRoute,
    detectFlightPhase,
    haversineDistanceM,
    calculateBearingDeg,
    crossTrackDistanceNm
};
