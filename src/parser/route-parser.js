const fs = require('fs');
const path = require('path');

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

function calculateBearingDeg(lat1, lon1, lat2, lon2) {
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const lambda1 = lon1 * Math.PI / 180;
    const lambda2 = lon2 * Math.PI / 180;

    const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) -
              Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
    const theta = Math.atan2(y, x);
    return (theta * 180 / Math.PI + 360) % 360;
}

function interpolateGreatCircle(lat1, lon1, lat2, lon2, numSegments = 10) {
    const coords = [];
    const p1 = [lon1 * Math.PI / 180, lat1 * Math.PI / 180];
    const p2 = [lon2 * Math.PI / 180, lat2 * Math.PI / 180];

    const d = 2 * Math.asin(Math.sqrt(
        Math.pow(Math.sin((p1[1] - p2[1]) / 2), 2) +
        Math.cos(p1[1]) * Math.cos(p2[1]) * Math.pow(Math.sin((p1[0] - p2[0]) / 2), 2)
    ));

    if (d === 0 || isNaN(d)) return [[lon1, lat1], [lon2, lat2]];

    for (let i = 0; i <= numSegments; i++) {
        const f = i / numSegments;
        const A = Math.sin((1 - f) * d) / Math.sin(d);
        const B = Math.sin(f * d) / Math.sin(d);
        const x = A * Math.cos(p1[1]) * Math.cos(p1[0]) + B * Math.cos(p2[1]) * Math.cos(p2[0]);
        const y = A * Math.cos(p1[1]) * Math.sin(p1[0]) + B * Math.cos(p2[1]) * Math.sin(p2[0]);
        const z = A * Math.sin(p1[1]) + B * Math.sin(p2[1]);
        const lat = Math.atan2(z, Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2))) * 180 / Math.PI;
        const lon = Math.atan2(y, x) * 180 / Math.PI;
        coords.push([parseFloat(lon.toFixed(6)), parseFloat(lat.toFixed(6))]);
    }
    return coords;
}

function sanitizeToken(raw) {
    if (!raw) return '';
    let token = raw.trim().toUpperCase();
    if (token.includes('/')) {
        token = token.split('/')[0].trim();
    }
    return token;
}

function extractRunway(raw) {
    if (!raw || !raw.includes('/')) return null;
    const part = raw.split('/')[1].trim().toUpperCase();
    return part.replace(/^RW/, '').trim();
}

function isSpeedLevelToken(token) {
    return /^([NMK]\d{3,4}[FS]\d{3,4}|[FS]\d{3,4})$/.test(token);
}

class RouteParser {
    constructor(airports, navaidsByIdent, waypointsByIdent, airways, sidsStructured, starsStructured) {
        this.airports = airports || {};
        this.navaidsByIdent = navaidsByIdent || {};
        this.waypointsByIdent = waypointsByIdent || {};
        this.airways = airways || {};
        this.sidsStructured = sidsStructured || {};
        this.starsStructured = starsStructured || {};
    }

    resolvePoint(token, refLat = null, refLon = null, isExplicitAirport = false) {
        const clean = sanitizeToken(token);
        if (!clean || isSpeedLevelToken(clean) || clean === 'DCT' || clean === 'DIRECT') return null;

        if (isExplicitAirport && this.airports[clean]) {
            const apt = this.airports[clean];
            return {
                id: `APT_${apt.icao}`,
                ident: apt.icao,
                name: apt.name,
                type: 'AIRPORT',
                latitude: apt.latitude,
                longitude: apt.longitude,
                elevation_ft: apt.elevation_ft,
                country_code: apt.country,
                city: apt.city
            };
        }

        const allCandidates = [];

        if (this.navaidsByIdent[clean]) allCandidates.push(...this.navaidsByIdent[clean]);
        if (this.waypointsByIdent[clean]) allCandidates.push(...this.waypointsByIdent[clean]);

        if (clean.length === 4 && this.airports[clean]) {
            const apt = this.airports[clean];
            allCandidates.push({
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

        if (allCandidates.length === 0) {
            if (this.airports[clean]) {
                const apt = this.airports[clean];
                return {
                    id: `APT_${apt.icao}`,
                    ident: apt.icao,
                    name: apt.name,
                    type: 'AIRPORT',
                    latitude: apt.latitude,
                    longitude: apt.longitude,
                    elevation_ft: apt.elevation_ft,
                    country_code: apt.country,
                    city: apt.city
                };
            }
            return null;
        }

        if (allCandidates.length === 1 || refLat === null || refLon === null) {
            return allCandidates[0];
        }

        let bestCandidate = allCandidates[0];
        let minDistance = haversineDistanceM(refLat, refLon, bestCandidate.latitude, bestCandidate.longitude);

        for (let i = 1; i < allCandidates.length; i++) {
            const cand = allCandidates[i];
            const dist = haversineDistanceM(refLat, refLon, cand.latitude, cand.longitude);
            if (dist < minDistance) {
                minDistance = dist;
                bestCandidate = cand;
            }
        }

        return bestCandidate;
    }

    parseRoute(routeStr, depIcao = null, arrIcao = null, cruisingAltFt = 35000, speedKts = 450) {
        const rawStringTokens = (routeStr || '').replace(/[\r\n\t]+/g, ' ').split(' ').filter(t => t.trim());

        // Extract departure/arrival runways if present in string (e.g. KEYW/09 or KLGA/04)
        let depRwy = null;
        let arrRwy = null;

        if (rawStringTokens.length > 0 && rawStringTokens[0].includes('/')) {
            depRwy = extractRunway(rawStringTokens[0]);
        }
        if (rawStringTokens.length > 1 && rawStringTokens[rawStringTokens.length - 1].includes('/')) {
            arrRwy = extractRunway(rawStringTokens[rawStringTokens.length - 1]);
        }

        const cleanTokens = rawStringTokens
            .map(t => sanitizeToken(t))
            .filter(t => t && !isSpeedLevelToken(t) && t !== 'DCT' && t !== 'DIRECT');

        let depPoint = null;
        let arrPoint = null;

        const firstToken = cleanTokens[0];
        const lastToken = cleanTokens[cleanTokens.length - 1];

        if (depIcao) {
            depPoint = this.resolvePoint(depIcao, null, null, true);
        } else if (firstToken && firstToken.length === 4 && this.airports[firstToken]) {
            depPoint = this.resolvePoint(firstToken, null, null, true);
        }

        if (arrIcao) {
            arrPoint = this.resolvePoint(arrIcao, null, null, true);
        } else if (lastToken && lastToken.length === 4 && this.airports[lastToken]) {
            arrPoint = this.resolvePoint(lastToken, null, null, true);
        }

        const resolvedPoints = [];
        let currentRefLat = depPoint ? depPoint.latitude : null;
        let currentRefLon = depPoint ? depPoint.longitude : null;

        if (depPoint) {
            resolvedPoints.push(depPoint);
        }

        for (let i = 0; i < cleanTokens.length; i++) {
            const token = cleanTokens[i];
            if (depPoint && i === 0 && token === depPoint.ident) continue;
            if (arrPoint && i === cleanTokens.length - 1 && token === arrPoint.ident) continue;

            // ═══════════════════════════════════════════════════════════════════
            // 1. STRUCTURED SID DEPARTURE EXPANSION (Runway & Enroute Aware)
            // ═══════════════════════════════════════════════════════════════════
            const sidKey = depPoint ? `${depPoint.ident}_${token}` : token;
            const sidProc = this.sidsStructured[sidKey] || Object.values(this.sidsStructured).find(s => s.procedure === token);

            if (sidProc && resolvedPoints.length > 0) {
                const nextToken = i + 1 < cleanTokens.length ? cleanTokens[i + 1] : null;
                const sidFixes = [];

                // A. Runway Transition (e.g. RW09)
                if (depRwy && sidProc.runway_transitions[depRwy]) {
                    sidFixes.push(...sidProc.runway_transitions[depRwy]);
                } else if (sidProc.runway_transitions['ALL']) {
                    sidFixes.push(...sidProc.runway_transitions['ALL']);
                } else {
                    const firstRwy = Object.values(sidProc.runway_transitions)[0];
                    if (firstRwy) sidFixes.push(...firstRwy);
                }

                // B. Common Legs
                if (sidProc.common_legs && sidProc.common_legs.length > 0) {
                    sidFixes.push(...sidProc.common_legs);
                }

                // C. Enroute Transition matching next token (e.g. MATLK)
                let matchedTransition = false;
                if (nextToken && sidProc.enroute_transitions[nextToken]) {
                    sidFixes.push(...sidProc.enroute_transitions[nextToken]);
                    matchedTransition = true;
                } else if (Object.keys(sidProc.enroute_transitions).length > 0) {
                    // Fallback to enroute transition containing nextToken
                    for (const [transName, transFixes] of Object.entries(sidProc.enroute_transitions)) {
                        if (nextToken && transFixes.includes(nextToken)) {
                            sidFixes.push(...transFixes);
                            matchedTransition = true;
                            break;
                        }
                    }
                }

                // Deduplicate ordered fixes
                const uniqueFixes = [];
                sidFixes.forEach(f => { if (!uniqueFixes.includes(f)) uniqueFixes.push(f); });

                for (const fixName of uniqueFixes) {
                    const pt = this.resolvePoint(fixName, currentRefLat, currentRefLon);
                    if (pt) {
                        pt.via_procedure = `SID: ${token}${depRwy ? ` (RW${depRwy})` : ''}`;
                        resolvedPoints.push(pt);
                        currentRefLat = pt.latitude;
                        currentRefLon = pt.longitude;
                    }
                }

                if (matchedTransition) {
                    i++; // Skip transition token since it was expanded
                }
                continue;
            }

            // ═══════════════════════════════════════════════════════════════════
            // 2. STRUCTURED STAR ARRIVAL EXPANSION (Transition & Runway Aware)
            // ═══════════════════════════════════════════════════════════════════
            const starKey = arrPoint ? `${arrPoint.ident}_${token}` : token;
            const starProc = this.starsStructured[starKey] || Object.values(this.starsStructured).find(s => s.procedure === token);

            if (starProc && resolvedPoints.length > 0) {
                const prevPoint = resolvedPoints[resolvedPoints.length - 1];
                const starFixes = [];

                // A. Enroute Transition matching prevPoint.ident (e.g. HURTS)
                if (prevPoint && starProc.enroute_transitions[prevPoint.ident]) {
                    const transList = starProc.enroute_transitions[prevPoint.ident];
                    // Skip the first fix if it's already the prevPoint
                    const toAdd = transList[0] === prevPoint.ident ? transList.slice(1) : transList;
                    starFixes.push(...toAdd);
                } else {
                    // Search for transition containing prevPoint
                    let found = false;
                    for (const [tName, tFixes] of Object.entries(starProc.enroute_transitions)) {
                        const idx = tFixes.indexOf(prevPoint.ident);
                        if (idx !== -1) {
                            starFixes.push(...tFixes.slice(idx + 1));
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        const firstTrans = Object.values(starProc.enroute_transitions)[0];
                        if (firstTrans) starFixes.push(...firstTrans);
                    }
                }

                // B. Common Legs
                if (starProc.common_legs && starProc.common_legs.length > 0) {
                    starFixes.push(...starProc.common_legs);
                }

                // C. Runway Transition (e.g. RW04)
                if (arrRwy && starProc.runway_transitions[arrRwy]) {
                    starFixes.push(...starProc.runway_transitions[arrRwy]);
                } else if (starProc.runway_transitions['ALL']) {
                    starFixes.push(...starProc.runway_transitions['ALL']);
                }

                const uniqueFixes = [];
                starFixes.forEach(f => { if (!uniqueFixes.includes(f) && (!prevPoint || f !== prevPoint.ident)) uniqueFixes.push(f); });

                for (const fixName of uniqueFixes) {
                    const pt = this.resolvePoint(fixName, currentRefLat, currentRefLon);
                    if (pt) {
                        pt.via_procedure = `STAR: ${token}${arrRwy ? ` (RW${arrRwy})` : ''}`;
                        resolvedPoints.push(pt);
                        currentRefLat = pt.latitude;
                        currentRefLon = pt.longitude;
                    }
                }
                continue;
            }

            // ═══════════════════════════════════════════════════════════════════
            // 3. AIRWAY EXPANSION (e.g. Q87, J79, V1)
            // ═══════════════════════════════════════════════════════════════════
            if (this.airways[token] && resolvedPoints.length > 0 && i + 1 < cleanTokens.length) {
                const prevPoint = resolvedPoints[resolvedPoints.length - 1];
                const nextToken = cleanTokens[i + 1];
                const nextPointCandidate = this.resolvePoint(nextToken, prevPoint.latitude, prevPoint.longitude);

                if (nextPointCandidate) {
                    const airwayLegs = this.airways[token];
                    const prevIdx = airwayLegs.findIndex(leg => leg.fixIdent === prevPoint.ident);
                    const nextIdx = airwayLegs.findIndex(leg => leg.fixIdent === nextPointCandidate.ident);

                    if (prevIdx !== -1 && nextIdx !== -1 && prevIdx !== nextIdx) {
                        const step = prevIdx < nextIdx ? 1 : -1;
                        for (let k = prevIdx + step; k !== nextIdx; k += step) {
                            const intermediateFix = this.resolvePoint(airwayLegs[k].fixIdent, prevPoint.latitude, prevPoint.longitude);
                            if (intermediateFix) {
                                intermediateFix.via_airway = token;
                                resolvedPoints.push(intermediateFix);
                                currentRefLat = intermediateFix.latitude;
                                currentRefLon = intermediateFix.longitude;
                            }
                        }
                    }
                }
                continue;
            }

            // ═══════════════════════════════════════════════════════════════════
            // 4. STANDARD RESOLUTION
            // ═══════════════════════════════════════════════════════════════════
            const point = this.resolvePoint(token, currentRefLat, currentRefLon);
            if (point) {
                resolvedPoints.push(point);
                currentRefLat = point.latitude;
                currentRefLon = point.longitude;
            } else {
                console.warn(`[RouteParser] Unresolved route token: ${token}`);
            }
        }

        if (arrPoint && (!resolvedPoints.length || resolvedPoints[resolvedPoints.length - 1].ident !== arrPoint.ident)) {
            resolvedPoints.push(arrPoint);
        }

        let totalDistanceM = 0;
        const processedWaypoints = [];
        const fullCoordinates = [];

        for (let i = 0; i < resolvedPoints.length; i++) {
            const pt = resolvedPoints[i];
            let segmentDistanceNm = 0;
            let segmentBearingDeg = 0;

            if (i > 0) {
                const prev = resolvedPoints[i - 1];
                const distM = haversineDistanceM(prev.latitude, prev.longitude, pt.latitude, pt.longitude);
                totalDistanceM += distM;
                segmentDistanceNm = Math.round((distM / 1852) * 10) / 10;
                segmentBearingDeg = Math.round(calculateBearingDeg(prev.latitude, prev.longitude, pt.latitude, pt.longitude) * 10) / 10;

                const segmentCoords = interpolateGreatCircle(prev.latitude, prev.longitude, pt.latitude, pt.longitude, 12);
                if (i === 1) {
                    fullCoordinates.push(...segmentCoords);
                } else {
                    fullCoordinates.push(...segmentCoords.slice(1));
                }
            } else {
                fullCoordinates.push([pt.longitude, pt.latitude]);
            }

            const cumulativeDistanceNm = Math.round((totalDistanceM / 1852) * 10) / 10;
            const eteMinutes = speedKts > 0 ? Math.round((cumulativeDistanceNm / speedKts) * 60) : 0;

            processedWaypoints.push({
                sequence: i + 1,
                id: pt.id,
                ident: pt.ident,
                name: pt.name,
                type: pt.type,
                latitude: pt.latitude,
                longitude: pt.longitude,
                elevation_ft: pt.elevation_ft || null,
                frequency_mhz: pt.frequency_mhz || null,
                associated_airport_icao: pt.associated_airport_icao || null,
                country_code: pt.country_code || null,
                via_airway: pt.via_airway || null,
                via_procedure: pt.via_procedure || null,
                segment_distance_nm: segmentDistanceNm,
                segment_bearing_deg: segmentBearingDeg,
                cumulative_distance_nm: cumulativeDistanceNm,
                ete_minutes: eteMinutes
            });
        }

        const totalDistanceNm = Math.round((totalDistanceM / 1852) * 10) / 10;
        const totalDistanceKm = Math.round((totalDistanceM / 1000) * 10) / 10;
        const totalEteMinutes = speedKts > 0 ? Math.round((totalDistanceNm / speedKts) * 60) : 0;

        const geojson = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: {
                        name: `Flight Route: ${depPoint?.ident || 'DEP'} ➔ ${arrPoint?.ident || 'ARR'}`,
                        total_distance_nm: totalDistanceNm,
                        total_distance_km: totalDistanceKm,
                        stroke: '#00ff88',
                        'stroke-width': 3,
                        'stroke-opacity': 0.9
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: fullCoordinates
                    }
                },
                ...processedWaypoints.map(w => ({
                    type: 'Feature',
                    properties: {
                        sequence: w.sequence,
                        ident: w.ident,
                        name: w.name,
                        type: w.type,
                        via: w.via_procedure || w.via_airway || null,
                        elevation_ft: w.elevation_ft,
                        frequency_mhz: w.frequency_mhz,
                        segment_bearing_deg: w.segment_bearing_deg,
                        segment_distance_nm: w.segment_distance_nm,
                        cumulative_distance_nm: w.cumulative_distance_nm,
                        'marker-color': w.type === 'AIRPORT' ? '38bdf8' : (w.type.includes('VOR') ? '00ff88' : 'ff1e42'),
                        'marker-size': 'small'
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [w.longitude, w.latitude]
                    }
                }))
            ]
        };

        return {
            departure: depPoint ? { icao: depPoint.ident, name: depPoint.name, lat: depPoint.latitude, lon: depPoint.longitude, runway: depRwy } : null,
            arrival: arrPoint ? { icao: arrPoint.ident, name: arrPoint.name, lat: arrPoint.latitude, lon: arrPoint.longitude, runway: arrRwy } : null,
            total_waypoints: processedWaypoints.length,
            total_distance_nm: totalDistanceNm,
            total_distance_km: totalDistanceKm,
            estimated_time_enroute_minutes: totalEteMinutes,
            estimated_time_enroute_formatted: `${Math.floor(totalEteMinutes / 60)}h ${totalEteMinutes % 60}m`,
            waypoints: processedWaypoints,
            route_coordinates: fullCoordinates,
            geojson
        };
    }
}

module.exports = RouteParser;
