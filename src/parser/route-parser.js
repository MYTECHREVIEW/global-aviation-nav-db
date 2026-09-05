const fs = require('fs');
const path = require('path');
const dynamicNavDataService = require('../services/dynamic-navdata-service');
const gristWaypointsService = require('../services/grist-waypoints-service');
const OceanicTracksService = require('../services/oceanic-tracks-service');

const oceanicTracksService = new OceanicTracksService({ dataDir: path.join(__dirname, '../../data') });

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

function normalizeLonDelta(targetLon, refLon) {
    let diff = (targetLon - refLon) % 360;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return refLon + diff;
}

function interpolateGreatCircle(lat1, lon1, lat2, lon2, numSegments = 10) {
    const coords = [];
    let l1 = lon1;
    let l2 = normalizeLonDelta(lon2, lon1);

    const RAD = Math.PI / 180;
    const DEG = 180 / Math.PI;

    const p1 = [l1 * RAD, lat1 * RAD];
    const p2 = [l2 * RAD, lat2 * RAD];

    const sinDLat2 = Math.sin((p1[1] - p2[1]) * 0.5);
    const sinDLon2 = Math.sin((p1[0] - p2[0]) * 0.5);
    const cosLat1 = Math.cos(p1[1]);
    const cosLat2 = Math.cos(p2[1]);

    const d = 2 * Math.asin(Math.sqrt(sinDLat2 * sinDLat2 + cosLat1 * cosLat2 * sinDLon2 * sinDLon2));

    if (d === 0 || isNaN(d)) return [[lon1, lat1], [l2, lat2]];

    // Short-segment fast path (< 10 NM / 0.003 rad): High precision linear interpolation
    if (d < 0.003) {
        for (let i = 0; i <= numSegments; i++) {
            const f = i / numSegments;
            coords.push([
                parseFloat((l1 + (l2 - l1) * f).toFixed(6)),
                parseFloat((lat1 + (lat2 - lat1) * f).toFixed(6))
            ]);
        }
        return coords;
    }

    const invSinD = 1 / Math.sin(d);
    const cosLat1CosLon1 = cosLat1 * Math.cos(p1[0]);
    const cosLat1SinLon1 = cosLat1 * Math.sin(p1[0]);
    const cosLat2CosLon2 = cosLat2 * Math.cos(p2[0]);
    const cosLat2SinLon2 = cosLat2 * Math.sin(p2[0]);
    const sinLat1 = Math.sin(p1[1]);
    const sinLat2 = Math.sin(p2[1]);

    for (let i = 0; i <= numSegments; i++) {
        const f = i / numSegments;
        const A = Math.sin((1 - f) * d) * invSinD;
        const B = Math.sin(f * d) * invSinD;
        const x = A * cosLat1CosLon1 + B * cosLat2CosLon2;
        const y = A * cosLat1SinLon1 + B * cosLat2SinLon2;
        const z = A * sinLat1 + B * sinLat2;
        const lat = Math.atan2(z, Math.hypot(x, y)) * DEG;
        let lon = Math.atan2(y, x) * DEG;

        if (coords.length > 0) {
            lon = normalizeLonDelta(lon, coords[coords.length - 1][0]);
        } else {
            lon = normalizeLonDelta(lon, l1);
        }

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
    return /^([NMK]\d{3,4}[FS]\d{3,4}|[FS]\d{3,4})$/i.test(token);
}

function isNatTrackToken(token) {
    if (!token) return false;
    const clean = sanitizeToken(token);
    return /^NAT[A-Z]$/i.test(clean) || /^TRACK[A-Z]$/i.test(clean) || /^NAT-[A-Z]$/i.test(clean);
}

function isAirwayDesignator(token) {
    if (!token) return false;
    const clean = sanitizeToken(token);
    // Standard ICAO Airway designators (e.g. J79, Q87, V1, Y88, Y886, G585, B465, A1, W10, UL607, UT120, Z12)
    return /^([A-Z]{1,2}[0-9]{1,4}|[A-Z][0-9]{1,3}[A-Z])$/i.test(clean);
}

function parseLatLonCoordinate(token) {
    if (!token) return null;
    const clean = sanitizeToken(token);

    // Format 0: Oceanic Slash and Standard Coordinate formats via OceanicTracksService
    const oc = oceanicTracksService.parseOceanicCoordinate(clean);
    if (oc) {
        return {
            id: `COORD_${oc.ident}`,
            ident: oc.ident,
            name: `${oc.ident} Oceanic Fix`,
            type: 'WAYPOINT',
            latitude: oc.latitude,
            longitude: oc.longitude,
            elevation_ft: null,
            country_code: null
        };
    }

    // Format 1: Standard ICAO Oceanic Fixes (e.g. 51N140W, 49N170E, 50S040W, 60N020W, 51N170W)
    let m = clean.match(/^(\d{2})([NS])(\d{2,3})([EW])$/i);
    if (m) {
        const lat = (m[2].toUpperCase() === 'S' ? -1 : 1) * parseInt(m[1], 10);
        const lon = (m[4].toUpperCase() === 'W' ? -1 : 1) * parseInt(m[3], 10);
        return {
            id: `COORD_${clean}`,
            ident: clean,
            name: `${clean} Oceanic Fix`,
            type: 'WAYPOINT',
            latitude: lat,
            longitude: lon,
            elevation_ft: null,
            country_code: null
        };
    }

    // Format 2: Deg-Min Coordinate (e.g. 5130N14000W)
    m = clean.match(/^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])$/i);
    if (m) {
        const latDeg = parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
        const lat = (m[3].toUpperCase() === 'S' ? -1 : 1) * latDeg;
        const lonDeg = parseInt(m[4], 10) + parseInt(m[5], 10) / 60;
        const lon = (m[6].toUpperCase() === 'W' ? -1 : 1) * lonDeg;
        return {
            id: `COORD_${clean}`,
            ident: clean,
            name: `${clean} Oceanic Fix`,
            type: 'WAYPOINT',
            latitude: parseFloat(lat.toFixed(6)),
            longitude: parseFloat(lon.toFixed(6)),
            elevation_ft: null,
            country_code: null
        };
    }

    // Format 3: ARINC 424 Shorthand with Letter at END (e.g. 5320N, 5430N, 5440N, 5350N, 5220E, 4530S, 4530W)
    // N = North Lat, West Lon (e.g. 5320N = 53°N 020°W)
    // E = North Lat, East Lon (e.g. 5320E = 53°N 020°E)
    // S = South Lat, West Lon (e.g. 5320S = 53°S 020°W)
    // W = South Lat, East Lon (e.g. 5320W = 53°S 020°E)
    m = clean.match(/^(\d{2})(\d{2})([NSEW])$/i);
    if (m) {
        const latVal = parseInt(m[1], 10);
        const lonVal = parseInt(m[2], 10);
        const code = m[3].toUpperCase();
        let lat = latVal;
        let lon = lonVal;
        if (code === 'N') { lon = -lon; }
        else if (code === 'E') { lon = lon; }
        else if (code === 'S') { lat = -lat; lon = -lon; }
        else if (code === 'W') { lat = -lat; lon = lon; }
        return {
            id: `COORD_${clean}`,
            ident: clean,
            name: `${latVal}°${lat >= 0 ? 'N' : 'S'} 0${lonVal}°${lon < 0 ? 'W' : 'E'}`,
            type: 'WAYPOINT',
            latitude: lat,
            longitude: lon,
            elevation_ft: null,
            country_code: null
        };
    }

    // Format 4: ARINC 424 Shorthand with Letter in MIDDLE (e.g. 51N40 = 51N 140W, 49E70 = 49N 170E)
    m = clean.match(/^(\d{2})([NSEW])(\d{2})$/i);
    if (m) {
        const latVal = parseInt(m[1], 10);
        const code = m[2].toUpperCase();
        const lonVal = parseInt(m[3], 10);
        let lat = latVal;
        let lon = lonVal >= 100 ? lonVal : (lonVal <= 80 ? 100 + lonVal : lonVal);
        if (code === 'N') { lon = -lon; }
        else if (code === 'E') { lon = lon; }
        else if (code === 'S') { lat = -lat; lon = -lon; }
        else if (code === 'W') { lat = -lat; lon = lon; }
        return {
            id: `COORD_${clean}`,
            ident: clean,
            name: `${clean} Oceanic Waypoint`,
            type: 'WAYPOINT',
            latitude: lat,
            longitude: lon,
            elevation_ft: null,
            country_code: null
        };
    }

    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🌐 GLOBAL / INTERNATIONAL ENROUTE WAYPOINTS & NAVAIDS CATALOG
// ═══════════════════════════════════════════════════════════════════════════════
const GLOBAL_WAYPOINTS_CATALOG = {
    // Pacific / Asia / Japan / Korea Enroute Gates
    'SEFIX': { ident: 'SEFIX', name: 'SEFIX', type: 'WAYPOINT', latitude: 48.743333, longitude: -126.708056, country_code: 'CA' },
    'AGEDI': { ident: 'AGEDI', name: 'AGEDI', type: 'WAYPOINT', latitude: 44.166667, longitude: 155.096683, country_code: 'JP' },
    'ADGOR': { ident: 'ADGOR', name: 'ADGOR', type: 'WAYPOINT', latitude: 40.424689, longitude: 149.650711, country_code: 'JP' },
    'ADNAP': { ident: 'ADNAP', name: 'ADNAP', type: 'WAYPOINT', latitude: 37.197467, longitude: 145.666311, country_code: 'JP' },
    'DAIGO': { ident: 'DAIGO', name: 'Daigo VORTAC (GTC)', type: 'VOR-DME', frequency_mhz: '115.30', latitude: 36.744367, longitude: 140.349850, country_code: 'JP' },
    'TEPEX': { ident: 'TEPEX', name: 'TEPEX', type: 'WAYPOINT', latitude: 36.004103, longitude: 138.882750, country_code: 'JP' },
    'SAPRA': { ident: 'SAPRA', name: 'SAPRA', type: 'WAYPOINT', latitude: 35.823842, longitude: 130.723675, country_code: 'KR' },
    'GUKDO': { ident: 'GUKDO', name: 'GUKDO', type: 'WAYPOINT', latitude: 37.019722, longitude: 127.639722, country_code: 'KR' },
    'KALNA': { ident: 'KALNA', name: 'KALNA', type: 'WAYPOINT', latitude: 42.183333, longitude: 153.250000, country_code: 'JP' },
    'EMRON': { ident: 'EMRON', name: 'EMRON', type: 'WAYPOINT', latitude: 41.533333, longitude: 150.000000, country_code: 'JP' },
    'AVBET': { ident: 'AVBET', name: 'AVBET', type: 'WAYPOINT', latitude: 39.500000, longitude: 148.000000, country_code: 'JP' },
    'LEPKI': { ident: 'LEPKI', name: 'LEPKI', type: 'WAYPOINT', latitude: 45.000000, longitude: 160.000000, country_code: 'JP' },
    'NIKOL': { ident: 'NIKOL', name: 'NIKOL', type: 'WAYPOINT', latitude: 54.500000, longitude: 168.000000, country_code: 'RU' },
    'NIPPI': { ident: 'NIPPI', name: 'NIPPI', type: 'WAYPOINT', latitude: 45.666667, longitude: 150.000000, country_code: 'JP' },
    'GULOT': { ident: 'GULOT', name: 'GULOT', type: 'WAYPOINT', latitude: 48.000000, longitude: 165.000000, country_code: 'JP' },
    'BILLO': { ident: 'BILLO', name: 'BILLO', type: 'WAYPOINT', latitude: 53.000000, longitude: 175.000000, country_code: 'RU' },
    'NULUK': { ident: 'NULUK', name: 'NULUK', type: 'WAYPOINT', latitude: 50.000000, longitude: 170.000000, country_code: 'RU' },
    'ALCOA': { ident: 'ALCOA', name: 'ALCOA', type: 'WAYPOINT', latitude: 52.000000, longitude: 175.000000, country_code: 'US' },
    'CRAIL': { ident: 'CRAIL', name: 'CRAIL', type: 'WAYPOINT', latitude: 51.500000, longitude: 170.000000, country_code: 'US' },
    'PABBA': { ident: 'PABBA', name: 'PABBA', type: 'WAYPOINT', latitude: 46.500000, longitude: 160.000000, country_code: 'JP' },
    'BOPTA': { ident: 'BOPTA', name: 'BOPTA', type: 'WAYPOINT', latitude: 37.283333, longitude: 127.150000, country_code: 'KR' },
    'RESTA': { ident: 'RESTA', name: 'RESTA', type: 'WAYPOINT', latitude: 37.383333, longitude: 126.850000, country_code: 'KR' },
    'SEL': { ident: 'SEL', name: 'Anyang VORTAC', type: 'VORTAC', frequency_mhz: '113.80', latitude: 37.441944, longitude: 126.936667, country_code: 'KR' },
    'KAE': { ident: 'KAE', name: 'Gimpo VOR-DME', type: 'VOR-DME', frequency_mhz: '113.60', latitude: 37.583333, longitude: 126.800000, country_code: 'KR' },
    'SOTTA': { ident: 'SOTTA', name: 'SOTTA', type: 'WAYPOINT', latitude: 37.400000, longitude: 126.500000, country_code: 'KR' },
    'LAMEN': { ident: 'LAMEN', name: 'LAMEN', type: 'WAYPOINT', latitude: 37.316667, longitude: 126.700000, country_code: 'KR' },
    'KARBU': { ident: 'KARBU', name: 'KARBU', type: 'WAYPOINT', latitude: 37.150000, longitude: 127.400000, country_code: 'KR' },
    'BEDES': { ident: 'BEDES', name: 'BEDES', type: 'WAYPOINT', latitude: 36.500000, longitude: 128.500000, country_code: 'KR' },
    'MALPA': { ident: 'MALPA', name: 'MALPA', type: 'WAYPOINT', latitude: 36.200000, longitude: 129.800000, country_code: 'KR' },
    'APANO': { ident: 'APANO', name: 'APANO', type: 'WAYPOINT', latitude: 35.500000, longitude: 131.000000, country_code: 'JP' },
    'MIHO': { ident: 'MIHO', name: 'Miho TACAN', type: 'TACAN', latitude: 35.493889, longitude: 133.238611, country_code: 'JP' },
    'KASMI': { ident: 'KASMI', name: 'KASMI', type: 'WAYPOINT', latitude: 35.633333, longitude: 134.616667, country_code: 'JP' },
    'KOMAT': { ident: 'KOMAT', name: 'Komatsu TACAN', type: 'TACAN', latitude: 36.394722, longitude: 136.406944, country_code: 'JP' },
    'GTC': { ident: 'GTC', name: 'Daigo VORTAC', type: 'VOR-DME', frequency_mhz: '115.30', latitude: 36.744367, longitude: 140.349850, country_code: 'JP' },
    'NRE': { ident: 'NRE', name: 'Narita VORTAC', type: 'VOR-DME', frequency_mhz: '117.90', latitude: 35.781667, longitude: 140.386111, country_code: 'JP' },
    'HND': { ident: 'HND', name: 'Haneda VOR-DME', type: 'VOR-DME', frequency_mhz: '112.20', latitude: 35.553333, longitude: 139.781667, country_code: 'JP' },
    // Polar & Trans-Siberian / East Asia Corridor Waypoints
    'NAMWE': { ident: 'NAMWE', name: 'NAMWE', type: 'WAYPOINT', latitude: 81.000000, longitude: -141.000000, country_code: 'CA' },
    'NARAL': { ident: 'NARAL', name: 'NARAL', type: 'WAYPOINT', latitude: 81.500000, longitude: -168.973333, country_code: 'US' },
    'RUTIN': { ident: 'RUTIN', name: 'RUTIN', type: 'WAYPOINT', latitude: 73.570667, longitude: 140.595950, country_code: 'RU' },
    'BALOM': { ident: 'BALOM', name: 'BALOM', type: 'WAYPOINT', latitude: 65.263908, longitude: 134.698197, country_code: 'RU' },
    'PANAR': { ident: 'PANAR', name: 'PANAR', type: 'WAYPOINT', latitude: 60.142000, longitude: 128.384000, country_code: 'RU' },
    'ARTUN': { ident: 'ARTUN', name: 'ARTUN', type: 'WAYPOINT', latitude: 55.021000, longitude: 122.062000, country_code: 'RU' },
    'SULOK': { ident: 'SULOK', name: 'SULOK', type: 'WAYPOINT', latitude: 49.900364, longitude: 115.750436, country_code: 'RU' },
    'POLHO': { ident: 'POLHO', name: 'POLHO', type: 'WAYPOINT', latitude: 44.783333, longitude: 113.250000, country_code: 'MN' },
    'DADGA': { ident: 'DADGA', name: 'DADGA (Airway B458)', type: 'WAYPOINT', latitude: 36.012234, longitude: 113.470668, country_code: 'CN' },
    'OMBEB': { ident: 'OMBEB', name: 'OMBEB (Airway W37)', type: 'WAYPOINT', latitude: 31.631111, longitude: 113.656944, country_code: 'CN' },
    'SIERA': { ident: 'SIERA', name: 'SIERA (Hong Kong STAR)', type: 'WAYPOINT', latitude: 21.986667, longitude: 113.553333, country_code: 'HK' },
    // East Asia & Taiwan-Korea Corridor Waypoints (VHHH to RKSI)
    'DALOL': { ident: 'DALOL', name: 'DALOL (Hong Kong SID)', type: 'WAYPOINT', latitude: 21.743583, longitude: 114.845928, country_code: 'HK' },
    'DUMEP': { ident: 'DUMEP', name: 'DUMEP (Hong Kong SID)', type: 'WAYPOINT', latitude: 21.743417, longitude: 115.213853, country_code: 'HK' },
    'ENVAR': { ident: 'ENVAR', name: 'ENVAR (Hong Kong / Taipei FIR)', type: 'WAYPOINT', latitude: 21.991667, longitude: 117.500000, country_code: 'HK' },
    'ANLOT': { ident: 'ANLOT', name: 'ANLOT (Taipei FIR M750)', type: 'WAYPOINT', latitude: 23.907222, longitude: 120.486944, country_code: 'TW' },
    'DRAKE': { ident: 'DRAKE', name: 'DRAKE (Taipei FIR Q11)', type: 'WAYPOINT', latitude: 25.615561, longitude: 122.077947, country_code: 'TW' },
    'MOLKA': { ident: 'MOLKA', name: 'MOLKA (Taipei / Fukuoka FIR)', type: 'WAYPOINT', latitude: 26.658611, longitude: 124.000000, country_code: 'TW' },
    'LIPLO': { ident: 'LIPLO', name: 'LIPLO (Taipei / Fukuoka FIR)', type: 'WAYPOINT', latitude: 27.991389, longitude: 123.999444, country_code: 'TW' },
    'MUKEP': { ident: 'MUKEP', name: 'MUKEP (Airway M750 / Y891)', type: 'WAYPOINT', latitude: 29.800000, longitude: 130.500000, country_code: 'JP' },
    'ATOTI': { ident: 'ATOTI', name: 'ATOTI (East China Sea Y741)', type: 'WAYPOINT', latitude: 30.003583, longitude: 125.198208, country_code: 'KR' },
    'OVSUN': { ident: 'OVSUN', name: 'OVSUN (Airway Y891 / Y893)', type: 'WAYPOINT', latitude: 32.400000, longitude: 135.200000, country_code: 'JP' },
    'IGMIS': { ident: 'IGMIS', name: 'IGMIS (Airway Y893 / Y57)', type: 'WAYPOINT', latitude: 34.300000, longitude: 139.800000, country_code: 'JP' },
    'POROT': { ident: 'POROT', name: 'POROT (Airway Y57 / NOPAC)', type: 'WAYPOINT', latitude: 35.930000, longitude: 143.228333, country_code: 'JP' },
    'OLMEN': { ident: 'OLMEN', name: 'OLMEN (Incheon STAR Arrival)', type: 'WAYPOINT', latitude: 36.736944, longitude: 126.991111, country_code: 'KR' },
    'POWAL': { ident: 'POWAL', name: 'POWAL (North Pacific NOPAC)', type: 'WAYPOINT', latitude: 50.174575, longitude: 165.123283, country_code: 'NOPAC' },
    'RIZON': { ident: 'RIZON', name: 'RIZON (North Pacific NOPAC)', type: 'WAYPOINT', latitude: 53.000000, longitude: -170.000000, country_code: 'US' },
    'KATCH': { ident: 'KATCH', name: 'KATCH (Gulf of Alaska)', type: 'WAYPOINT', latitude: 53.999592, longitude: -136.001603, country_code: 'US' },
    'HSTIN': { ident: 'HSTIN', name: 'HSTIN (Minnesota Enroute)', type: 'WAYPOINT', latitude: 44.002222, longitude: -93.961111, country_code: 'US' },
    'ZZIPR': { ident: 'ZZIPR', name: 'ZZIPR (Chicago O\'Hare STAR)', type: 'WAYPOINT', latitude: 43.185833, longitude: -91.659167, country_code: 'US' },
    // North Atlantic & Europe Waypoints
    'RATKA': { ident: 'RATKA', name: 'RATKA', type: 'WAYPOINT', latitude: 49.500000, longitude: -8.000000, country_code: 'IE' },
    'ATSUR': { ident: 'ATSUR', name: 'ATSUR', type: 'WAYPOINT', latitude: 50.000000, longitude: -14.000000, country_code: 'IE' },
    'BEDRA': { ident: 'BEDRA', name: 'BEDRA', type: 'WAYPOINT', latitude: 50.000000, longitude: -15.000000, country_code: 'IE' },
    'ANEKI': { ident: 'ANEKI', name: 'ANEKI', type: 'WAYPOINT', latitude: 49.317272, longitude: 8.480428, country_code: 'DE' },
    'PABLA': { ident: 'PABLA', name: 'PABLA', type: 'WAYPOINT', latitude: 48.788586, longitude: 8.351969, country_code: 'DE' },
    'RIGVI': { ident: 'RIGVI', name: 'RIGVI', type: 'WAYPOINT', latitude: 48.132589, longitude: 7.503564, country_code: 'FR' },
    'SUNOT': { ident: 'SUNOT', name: 'SUNOT', type: 'WAYPOINT', latitude: 53.000000, longitude: -50.000000, country_code: 'CA' },
    'HEB': { ident: 'HEB', name: 'Hebron NDB', type: 'NDB', latitude: 58.200000, longitude: -62.600000, country_code: 'CA' },
    'VIXUN': { ident: 'VIXUN', name: 'VIXUN', type: 'WAYPOINT', latitude: 54.000000, longitude: -40.000000, country_code: 'NAT' },
    'DOGAL': { ident: 'DOGAL', name: 'DOGAL', type: 'WAYPOINT', latitude: 55.000000, longitude: -15.000000, country_code: 'IE' },
    'MALOT': { ident: 'MALOT', name: 'MALOT', type: 'WAYPOINT', latitude: 53.000000, longitude: -15.000000, country_code: 'IE' },
    'LIMRI': { ident: 'LIMRI', name: 'LIMRI', type: 'WAYPOINT', latitude: 52.000000, longitude: -15.000000, country_code: 'IE' },
    'DINIM': { ident: 'DINIM', name: 'DINIM', type: 'WAYPOINT', latitude: 51.000000, longitude: -15.000000, country_code: 'IE' },
    // Central & Eastern Europe, Balkans & Middle East Enroute Waypoints
    'GAMSA': { ident: 'GAMSA', name: 'GAMSA', type: 'WAYPOINT', latitude: 47.168056, longitude: 9.878889, country_code: 'AT' },
    'UMVEG': { ident: 'UMVEG', name: 'UMVEG', type: 'WAYPOINT', latitude: 46.541944, longitude: 11.530556, country_code: 'IT' },
    'TEBLI': { ident: 'TEBLI', name: 'TEBLI', type: 'WAYPOINT', latitude: 45.201389, longitude: 16.675833, country_code: 'HR' },
    'IRDIV': { ident: 'IRDIV', name: 'IRDIV', type: 'WAYPOINT', latitude: 44.978611, longitude: 17.291667, country_code: 'BA' },
    'DOBOT': { ident: 'DOBOT', name: 'DOBOT', type: 'WAYPOINT', latitude: 44.773889, longitude: 17.902500, country_code: 'BA' },
    'SOSEK': { ident: 'SOSEK', name: 'SOSEK', type: 'WAYPOINT', latitude: 43.834444, longitude: 20.341111, country_code: 'RS' },
    'NISVA': { ident: 'NISVA', name: 'NISVA', type: 'WAYPOINT', latitude: 42.972778, longitude: 22.797500, country_code: 'RS' },
    'RODIP': { ident: 'RODIP', name: 'RODIP', type: 'WAYPOINT', latitude: 41.970556, longitude: 24.341667, country_code: 'BG' },
    'BELGI': { ident: 'BELGI', name: 'BELGI', type: 'WAYPOINT', latitude: 40.500000, longitude: 25.883333, country_code: 'GR' },
    'VESAR': { ident: 'VESAR', name: 'VESAR', type: 'WAYPOINT', latitude: 35.915556, longitude: 34.016111, country_code: 'CY' },
    'BALMA': { ident: 'BALMA', name: 'BALMA', type: 'WAYPOINT', latitude: 34.481667, longitude: 35.050000, country_code: 'LB' },
    'KUKLA': { ident: 'KUKLA', name: 'KUKLA (Beirut STAR)', type: 'WAYPOINT', latitude: 34.245000, longitude: 34.746667, country_code: 'LB' },
    'LEBOR': { ident: 'LEBOR', name: 'LEBOR (Syria / Lebanon FIR)', type: 'WAYPOINT', latitude: 34.265556, longitude: 36.583056, country_code: 'LB' },
    'FIRAS': { ident: 'FIRAS', name: 'FIRAS (Airway R655)', type: 'WAYPOINT', latitude: 33.871944, longitude: 37.920000, country_code: 'SY' },
    'CAK': { ident: 'CAK', name: 'CAK', type: 'VOR-DME', latitude: 34.298999, longitude: 35.699699, country_code: 'LB' },
    'LATEB': { ident: 'LATEB', name: 'LATEB', type: 'WAYPOINT', latitude: 34.031667, longitude: 36.401000, country_code: 'SY' },
    'ZELAF': { ident: 'ZELAF', name: 'ZELAF', type: 'WAYPOINT', latitude: 32.950000, longitude: 38.000000, country_code: 'JO' },
    'RASLI': { ident: 'RASLI', name: 'RASLI', type: 'WAYPOINT', latitude: 31.906667, longitude: 38.613333, country_code: 'SA' },
    'TRF': { ident: 'TRF', name: 'TRF', type: 'VOR-DME', latitude: 31.693300, longitude: 38.734699, country_code: 'SA' },
    'NEVOL': { ident: 'NEVOL', name: 'NEVOL', type: 'WAYPOINT', latitude: 30.412778, longitude: 39.644722, country_code: 'SA' },
    'DASVA': { ident: 'DASVA', name: 'DASVA', type: 'WAYPOINT', latitude: 27.426872, longitude: 47.146980, country_code: 'SA' },
    'NARMI': { ident: 'NARMI', name: 'NARMI (Bahrain / Saudi FIR)', type: 'WAYPOINT', latitude: 26.300647, longitude: 50.327503, country_code: 'BH' },
    'TULUB': { ident: 'TULUB', name: 'TULUB (Doha SID)', type: 'WAYPOINT', latitude: 26.112222, longitude: 51.011389, country_code: 'QA' },
    'TOSNA': { ident: 'TOSNA', name: 'TOSNA', type: 'WAYPOINT', latitude: 25.270000, longitude: 52.687778, country_code: 'QA' },
    'UMEVU': { ident: 'UMEVU', name: 'UMEVU', type: 'WAYPOINT', latitude: 24.855483, longitude: 53.668508, country_code: 'AE' },
    'UKILI': { ident: 'UKILI', name: 'UKILI', type: 'WAYPOINT', latitude: 24.648224, longitude: 54.158873, country_code: 'AE' },
    // Australia, New Zealand & Tasman Sea Corridor Waypoints (YMML to NZQN)
    'CORRS': { ident: 'CORRS', name: 'CORRS (Melbourne RNAV SID)', type: 'WAYPOINT', latitude: -37.925000, longitude: 145.613333, country_code: 'AU' },
    'DADAD': { ident: 'DADAD', name: 'DADAD (Airway P753)', type: 'WAYPOINT', latitude: -40.145000, longitude: 150.585000, country_code: 'AU' },
    'ADKOS': { ident: 'ADKOS', name: 'ADKOS (New Zealand FIR Entry)', type: 'WAYPOINT', latitude: -44.617117, longitude: 166.880431, country_code: 'NZ' },
    'TUDBU': { ident: 'TUDBU', name: 'TUDBU', type: 'WAYPOINT', latitude: 43.550909, longitude: 25.522318, country_code: 'BG' },
    'ETUBA': { ident: 'ETUBA', name: 'ETUBA', type: 'WAYPOINT', latitude: 44.608333, longitude: 21.652778, country_code: 'RO' },
    'NAVOD': { ident: 'NAVOD', name: 'NAVOD', type: 'WAYPOINT', latitude: 45.968056, longitude: 20.088889, country_code: 'RS' },
    'MAVIR': { ident: 'MAVIR', name: 'MAVIR', type: 'WAYPOINT', latitude: 46.398333, longitude: 19.825278, country_code: 'HU' },
    'ARSIN': { ident: 'ARSIN', name: 'ARSIN', type: 'WAYPOINT', latitude: 47.567211, longitude: 16.753744, country_code: 'AT' },
    'PEROL': { ident: 'PEROL', name: 'PEROL', type: 'WAYPOINT', latitude: 48.076026, longitude: 15.129485, country_code: 'AT' },
    'RENKA': { ident: 'RENKA', name: 'RENKA', type: 'WAYPOINT', latitude: 48.584842, longitude: 13.505225, country_code: 'DE' },
    'INBED': { ident: 'INBED', name: 'INBED', type: 'WAYPOINT', latitude: 49.387581, longitude: 10.941744, country_code: 'DE' },
    'BOMBI': { ident: 'BOMBI', name: 'BOMBI', type: 'WAYPOINT', latitude: 50.056793, longitude: 8.800399, country_code: 'DE' },
    'ADKUV': { ident: 'ADKUV', name: 'ADKUV', type: 'WAYPOINT', latitude: 50.506808, longitude: 6.817408, country_code: 'DE' },
    'LENDO': { ident: 'LENDO', name: 'LENDO', type: 'WAYPOINT', latitude: 50.625267, longitude: 6.278553, country_code: 'DE' },
    'VICOT': { ident: 'VICOT', name: 'VICOT', type: 'WAYPOINT', latitude: 51.644444, longitude: 4.795833, country_code: 'NL' },
    'ANDIK': { ident: 'ANDIK', name: 'ANDIK', type: 'WAYPOINT', latitude: 52.739444, longitude: 5.270556, country_code: 'NL' },
    'BEDUM': { ident: 'BEDUM', name: 'BEDUM', type: 'WAYPOINT', latitude: 53.348200, longitude: 6.588900, country_code: 'NL' },
    'DOSUR': { ident: 'DOSUR', name: 'DOSUR', type: 'WAYPOINT', latitude: 54.858600, longitude: 9.194200, country_code: 'DE' },
    'RASMU': { ident: 'RASMU', name: 'RASMU', type: 'WAYPOINT', latitude: 56.758400, longitude: 13.815300, country_code: 'SE' },
    'DENUT': { ident: 'DENUT', name: 'DENUT', type: 'WAYPOINT', latitude: 51.236111, longitude: 3.657500, country_code: 'BE' },
    'KOPUL': { ident: 'KOPUL', name: 'KOPUL', type: 'WAYPOINT', latitude: 51.542222, longitude: 1.137222, country_code: 'GB' },
    'OKSAW': { ident: 'OKSAW', name: 'OKSAW', type: 'WAYPOINT', latitude: 52.050000, longitude: -2.100000, country_code: 'GB' },
    'TEWXI': { ident: 'TEWXI', name: 'TEWXI', type: 'WAYPOINT', latitude: 52.483333, longitude: -4.833333, country_code: 'GB' },
    'VATRY': { ident: 'VATRY', name: 'VATRY', type: 'WAYPOINT', latitude: 52.554444, longitude: -5.500000, country_code: 'GB' },
    'SUTEX': { ident: 'SUTEX', name: 'SUTEX', type: 'WAYPOINT', latitude: 52.824361, longitude: -6.930361, country_code: 'IE' },
    'DOGAL': { ident: 'DOGAL', name: 'DOGAL', type: 'WAYPOINT', latitude: 55.000000, longitude: -15.000000, country_code: 'IE' },
    'JOOPY': { ident: 'JOOPY', name: 'JOOPY', type: 'WAYPOINT', latitude: 48.500000, longitude: -52.000000, country_code: 'CA' },
    'BRADD': { ident: 'BRADD', name: 'BRADD', type: 'WAYPOINT', latitude: 43.150000, longitude: -67.000000, country_code: 'NAT' },
    // Spain, Mediterranean & North Africa Waypoints
    'PARKA': { ident: 'PARKA', name: 'PARKA', type: 'WAYPOINT', latitude: 39.000000, longitude: -5.149722, country_code: 'ES' },
    'OBOGA': { ident: 'OBOGA', name: 'OBOGA', type: 'WAYPOINT', latitude: 33.926004, longitude: -7.003829, country_code: 'MA' },
    'VALBA': { ident: 'VALBA', name: 'VALBA', type: 'WAYPOINT', latitude: 35.086602, longitude: -6.487849, country_code: 'MA' },
    'TOLSI': { ident: 'TOLSI', name: 'TOLSI', type: 'WAYPOINT', latitude: 34.600556, longitude: -7.015000, country_code: 'MA' },
    'KORIS': { ident: 'KORIS', name: 'KORIS', type: 'WAYPOINT', latitude: 35.833332, longitude: -6.239167, country_code: 'MA' },
    'SOTUK': { ident: 'SOTUK', name: 'SOTUK', type: 'WAYPOINT', latitude: 39.193611, longitude: -4.746389, country_code: 'ES' },
    // GCTS to LICC Corridor (Canarias - Morocco - Algeria - Tunisia - Sicily)
    'KORAL': { ident: 'KORAL', name: 'KORAL (Canarias/Casablanca FIR)', type: 'WAYPOINT', latitude: 29.7314, longitude: -12.5783, country_code: 'ES' },
    'SONSO': { ident: 'SONSO', name: 'SONSO (Airway UN871)', type: 'WAYPOINT', latitude: 30.0122, longitude: -12.1019, country_code: 'MA' },
    'SAK': { ident: 'SAK', name: 'Casablanca Anfa NDB', type: 'NDB', frequency_mhz: '413.00', latitude: 33.5213, longitude: -7.67711, country_code: 'MA' },
    'ORSUP': { ident: 'ORSUP', name: 'ORSUP (Airway UM985)', type: 'WAYPOINT', latitude: 34.8486, longitude: -1.84056, country_code: 'MA' },
    'BABOR': { ident: 'BABOR', name: 'BABOR (Airway UM985)', type: 'WAYPOINT', latitude: 36.4844, longitude: 5.0000, country_code: 'DZ' },
    'CSO': { ident: 'CSO', name: 'Constantine VOR-DME', type: 'VOR-DME', frequency_mhz: '114.50', latitude: 36.2926, longitude: 6.60555, country_code: 'DZ' },
    'ANB': { ident: 'ANB', name: 'Annaba VOR-DME', type: 'VOR-DME', frequency_mhz: '113.80', latitude: 36.8167, longitude: 7.8000, country_code: 'DZ' },
    'MORJA': { ident: 'MORJA', name: 'MORJA (Airway UM985)', type: 'WAYPOINT', latitude: 36.8344, longitude: 8.6500, country_code: 'DZ' },
    'TUC': { ident: 'TUC', name: 'Tunis VOR-DME', type: 'VOR-DME', frequency_mhz: '115.90', latitude: 36.8516, longitude: 10.2303, country_code: 'TN' },
    'CBN': { ident: 'CBN', name: 'Cap Bon VOR-DME', type: 'VOR-DME', frequency_mhz: '116.50', latitude: 36.8956, longitude: 11.0883, country_code: 'TN' },
    'MEGAN': { ident: 'MEGAN', name: 'MEGAN (Airway M871)', type: 'WAYPOINT', latitude: 37.5381, longitude: 11.9961, country_code: 'TN' },
    'BEKIV': { ident: 'BEKIV', name: 'BEKIV (Airway M871)', type: 'WAYPOINT', latitude: 37.8767, longitude: 13.6681, country_code: 'IT' },
    'ENEPA': { ident: 'ENEPA', name: 'ENEPA (Airway M871)', type: 'WAYPOINT', latitude: 37.7733, longitude: 13.9994, country_code: 'IT' },
    'LIBRO': { ident: 'LIBRO', name: 'LIBRO (Catania STAR)', type: 'WAYPOINT', latitude: 37.6214, longitude: 14.4647, country_code: 'IT' },
    // Caribbean, Central & South America Waypoints
    'PUTUL': { ident: 'PUTUL', name: 'PUTUL', type: 'WAYPOINT', latitude: 19.980000, longitude: -78.296944, country_code: 'CU' },
    'SUDSA': { ident: 'SUDSA', name: 'SUDSA', type: 'WAYPOINT', latitude: 14.000000, longitude: -76.933333, country_code: 'CO' },
    'AKPEK': { ident: 'AKPEK', name: 'AKPEK', type: 'WAYPOINT', latitude: 7.987500, longitude: -75.816389, country_code: 'CO' },
    'ISVAT': { ident: 'ISVAT', name: 'ISVAT', type: 'WAYPOINT', latitude: 5.694722, longitude: -75.125000, country_code: 'CO' },
    'KILER': { ident: 'KILER', name: 'KILER', type: 'WAYPOINT', latitude: 12.500000, longitude: -76.000000, country_code: 'CO' },
    'BOBKA': { ident: 'BOBKA', name: 'BOBKA', type: 'WAYPOINT', latitude: 11.200000, longitude: -75.600000, country_code: 'CO' },
    'TOMEK': { ident: 'TOMEK', name: 'TOMEK', type: 'WAYPOINT', latitude: 9.800000, longitude: -75.400000, country_code: 'CO' },
    'VAPES': { ident: 'VAPES', name: 'VAPES', type: 'WAYPOINT', latitude: 21.000000, longitude: -78.500000, country_code: 'CU' },
    'MAXIM': { ident: 'MAXIM', name: 'MAXIM', type: 'WAYPOINT', latitude: 22.500000, longitude: -79.500000, country_code: 'CU' },
    'ALAXE': { ident: 'ALAXE', name: 'ALAXE', type: 'WAYPOINT', latitude: 6.500000, longitude: -74.800000, country_code: 'CO' },
    'AMBER': { ident: 'AMBER', name: 'AMBER', type: 'WAYPOINT', latitude: 5.200000, longitude: -74.400000, country_code: 'CO' },
    'MUGIL': { ident: 'MUGIL', name: 'MUGIL', type: 'WAYPOINT', latitude: 16.000000, longitude: -77.500000, country_code: 'JM' },
    'AGASI': { ident: 'AGASI', name: 'AGASI', type: 'WAYPOINT', latitude: 15.000000, longitude: -77.200000, country_code: 'JM' },
    // Philippines, Malaysia & Singapore Corridor Waypoints (RPMD to WSSS)
    'DEWIN': { ident: 'DEWIN', name: 'DEWIN (RNP Mindanao)', type: 'WAYPOINT', latitude: 7.305500, longitude: 125.143944, country_code: 'PH' },
    'LINAO': { ident: 'LINAO', name: 'LINAO (Kabacan)', type: 'WAYPOINT', latitude: 7.261983, longitude: 124.847542, country_code: 'PH' },
    'TOMAN': { ident: 'TOMAN', name: 'TOMAN (Singapore FIR / M646)', type: 'WAYPOINT', latitude: 1.363056, longitude: 105.788056, country_code: 'SG' },
    'KARTO': { ident: 'KARTO', name: 'KARTO (Singapore STAR)', type: 'WAYPOINT', latitude: 1.190000, longitude: 105.561944, country_code: 'SG' }
};

class RouteParser {
    constructor(airports, navaidsByIdent, waypointsByIdent, airways, sidsStructured, starsStructured) {
        this.airports = airports || {};
        this.navaidsByIdent = navaidsByIdent || {};
        this.waypointsByIdent = waypointsByIdent || {};
        this.airways = airways || {};
        this.sidsStructured = sidsStructured || {};
        this.starsStructured = starsStructured || {};
        this.parsedRouteCache = new Map();
        this.customWaypointsDbPath = path.join(__dirname, '../../data/custom-global-waypoints.json');
        this.customWaypoints = this.loadCustomWaypoints();
        this.customAirwaysDbPath = path.join(__dirname, '../../data/custom-global-airways.json');
        this.loadCustomAirways();
        this.rebuildAirwayIndex();
        this.oceanicTracksService = oceanicTracksService;
    }

    rebuildAirwayIndex() {
        this.fixToAirways = new Map();
        for (const [airway, legs] of Object.entries(this.airways || {})) {
            if (!Array.isArray(legs)) continue;
            for (const leg of legs) {
                const fix = String(leg.fixIdent || leg.ident || '').trim().toUpperCase();
                if (!fix) continue;
                if (!this.fixToAirways.has(fix)) {
                    this.fixToAirways.set(fix, []);
                }
                this.fixToAirways.get(fix).push(airway);
            }
        }
    }

    loadCustomAirways() {
        try {
            if (fs.existsSync(this.customAirwaysDbPath)) {
                const data = JSON.parse(fs.readFileSync(this.customAirwaysDbPath, 'utf8'));
                let count = 0;
                for (const [ident, legs] of Object.entries(data)) {
                    if (Array.isArray(this.airways[ident])) {
                        const existingFixes = new Set(this.airways[ident].map(l => l.fixIdent || l.ident));
                        const newLegs = legs.filter(l => !existingFixes.has(l.fixIdent || l.ident));
                        if (newLegs.length > 0) {
                            this.airways[ident] = [...this.airways[ident], ...newLegs];
                        }
                    } else {
                        this.airways[ident] = legs;
                    }
                    count++;
                }
                console.log(`[RouteParser] Loaded ${count} custom airways from custom-global-airways.json`);
                return data;
            }
        } catch (e) {
            console.warn('[RouteParser] Error loading custom airways database:', e.message);
        }
        return {};
    }

    saveCustomAirway(ident, legs) {
        if (!ident || !Array.isArray(legs) || legs.length === 0) {
            throw new Error('Invalid airway: ident and legs array are required');
        }
        const airwayIdent = String(ident).trim().toUpperCase();
        let customAirways = {};
        try {
            if (fs.existsSync(this.customAirwaysDbPath)) {
                customAirways = JSON.parse(fs.readFileSync(this.customAirwaysDbPath, 'utf8'));
            }
        } catch (_) {}

        customAirways[airwayIdent] = legs.map((l, i) => ({
            seq: l.seq !== undefined ? l.seq : (i + 1) * 10,
            fixIdent: String(l.fixIdent || l.ident || '').trim().toUpperCase()
        }));

        this.airways[airwayIdent] = customAirways[airwayIdent];
        this.rebuildAirwayIndex();

        try {
            fs.writeFileSync(this.customAirwaysDbPath, JSON.stringify(customAirways, null, 2));
            if (this.parsedRouteCache) this.parsedRouteCache.clear();
            console.log(`[RouteParser] Saved custom airway ${airwayIdent} with ${legs.length} legs to custom-global-airways.json`);

            // Asynchronously sync airway to Grist redundancy cloud database
            gristWaypointsService.upsertAirway(airwayIdent, customAirways[airwayIdent], (fixId) => this.resolvePoint(fixId)).catch(err => {
                console.warn(`[RouteParser] Background Grist sync notice for airway ${airwayIdent}:`, err.message);
            });
        } catch (e) {
            console.error('[RouteParser] Failed to persist custom airway:', e.message);
        }
        return customAirways[airwayIdent];
    }

    /**
     * Find connecting published airway between two consecutive waypoints
     * @param {Object|string} pt1 - First point or fix ident
     * @param {Object|string} pt2 - Second point or fix ident
     * @returns {Object|null} Connecting airway information or null
     */
    findConnectingAirway(pt1, pt2) {
        if (!this.fixToAirways) this.rebuildAirwayIndex();

        const fix1 = (typeof pt1 === 'string' ? pt1 : (pt1.ident || '')).trim().toUpperCase();
        const fix2 = (typeof pt2 === 'string' ? pt2 : (pt2.ident || '')).trim().toUpperCase();
        if (!fix1 || !fix2 || fix1 === fix2) return null;

        const a1 = this.fixToAirways.get(fix1) || [];
        const a2 = this.fixToAirways.get(fix2) || [];
        if (a1.length === 0 || a2.length === 0) return null;

        const commonAirways = a1.filter(a => a2.includes(a));
        if (commonAirways.length === 0) return null;

        const lat1 = typeof pt1 === 'object' && pt1.latitude != null ? pt1.latitude : null;
        const lon1 = typeof pt1 === 'object' && pt1.longitude != null ? pt1.longitude : null;
        const lat2 = typeof pt2 === 'object' && pt2.latitude != null ? pt2.latitude : null;
        const lon2 = typeof pt2 === 'object' && pt2.longitude != null ? pt2.longitude : null;

        const directDistNm = (lat1 !== null && lon1 !== null && lat2 !== null && lon2 !== null)
            ? haversineDistanceM(lat1, lon1, lat2, lon2) / 1852
            : null;

        let bestCandidate = null;
        let minDetour = Infinity;

        for (const airway of commonAirways) {
            const legs = this.airways[airway];
            if (!Array.isArray(legs)) continue;

            const idx1 = legs.findIndex(l => (l.fixIdent || l.ident) === fix1);
            const idx2 = legs.findIndex(l => (l.fixIdent || l.ident) === fix2);
            if (idx1 === -1 || idx2 === -1 || idx1 === idx2) continue;

            const step = idx1 < idx2 ? 1 : -1;
            const intermediateFixes = [];
            for (let k = idx1 + step; k !== idx2; k += step) {
                const legFix = legs[k].fixIdent || legs[k].ident;
                if (legFix && legFix !== fix1 && legFix !== fix2) {
                    intermediateFixes.push(legFix);
                }
            }

            if (directDistNm !== null && directDistNm > 0 && intermediateFixes.length > 0) {
                let prevLat = lat1;
                let prevLon = lon1;
                let airwayDistM = 0;
                let validPath = true;

                for (const fId of intermediateFixes) {
                    const resolved = this.resolvePoint(fId, prevLat, prevLon);
                    if (resolved && resolved.latitude != null && resolved.longitude != null) {
                        airwayDistM += haversineDistanceM(prevLat, prevLon, resolved.latitude, resolved.longitude);
                        prevLat = resolved.latitude;
                        prevLon = resolved.longitude;
                    } else {
                        validPath = false;
                        break;
                    }
                }
                airwayDistM += haversineDistanceM(prevLat, prevLon, lat2, lon2);

                if (validPath) {
                    const airwayDistNm = airwayDistM / 1852;
                    const detourRatio = airwayDistNm / directDistNm;

                    // Detour must be within 35% of direct great-circle
                    if (detourRatio <= 1.35 && detourRatio < minDetour) {
                        minDetour = detourRatio;
                        bestCandidate = {
                            airway,
                            from: fix1,
                            to: fix2,
                            intermediateFixes,
                            airwayDistNm: Math.round(airwayDistNm * 10) / 10,
                            directDistNm: Math.round(directDistNm * 10) / 10,
                            detourRatio
                        };
                    }
                }
            } else {
                if (!bestCandidate) {
                    bestCandidate = {
                        airway,
                        from: fix1,
                        to: fix2,
                        intermediateFixes,
                        airwayDistNm: directDistNm || 0,
                        directDistNm: directDistNm || 0,
                        detourRatio: 1.0
                    };
                }
            }
        }

        return bestCandidate;
    }

    /**
     * Inspect consecutive resolved points and expand implicit missing airway corridors
     * @param {Array} points - Array of resolved waypoint objects
     * @param {Object} options - { infer_airways: true }
     * @returns {Object} { points, inferredAirways }
     */
    expandImplicitAirways(points, options = {}) {
        if (!points || points.length < 2) return { points: points || [], inferredAirways: [] };
        if (options.infer_airways === false) return { points, inferredAirways: [] };

        const expanded = [];
        const inferredAirways = [];
        let i = 0;

        while (i < points.length) {
            const current = points[i];
            expanded.push(current);

            if (i < points.length - 1) {
                const next = points[i + 1];

                const currentIsAirport = current.type === 'AIRPORT' || current.is_airport;
                const nextIsAirport = next.type === 'AIRPORT' || next.is_airport;
                const alreadyOnAirway = next.via_airway && !next.inferred_airway;
                const alreadyOnProcedure = next.via_procedure;

                if (!currentIsAirport && !nextIsAirport && !alreadyOnAirway && !alreadyOnProcedure) {
                    const conn = this.findConnectingAirway(current, next);
                    if (conn && conn.airway) {
                        next.via_airway = conn.airway;
                        next.inferred_airway = true;

                        const insertedFixes = [];
                        if (conn.intermediateFixes && conn.intermediateFixes.length > 0) {
                            let refLat = current.latitude;
                            let refLon = current.longitude;

                            for (const fId of conn.intermediateFixes) {
                                const interPt = this.resolvePoint(fId, refLat, refLon);
                                if (interPt) {
                                    interPt.via_airway = conn.airway;
                                    interPt.inferred_airway = true;
                                    expanded.push(interPt);
                                    insertedFixes.push(interPt.ident);
                                    refLat = interPt.latitude;
                                    refLon = interPt.longitude;
                                }
                            }
                        }

                        inferredAirways.push({
                            airway: conn.airway,
                            from: conn.from,
                            to: conn.to,
                            intermediate_fixes_count: insertedFixes.length,
                            intermediate_fixes: insertedFixes,
                            direct_distance_nm: conn.directDistNm,
                            airway_distance_nm: conn.airwayDistNm
                        });
                    }
                }
            }
            i++;
        }

        return { points: expanded, inferredAirways };
    }

    loadCustomWaypoints() {
        try {
            if (fs.existsSync(this.customWaypointsDbPath)) {
                const data = JSON.parse(fs.readFileSync(this.customWaypointsDbPath, 'utf8'));
                // Sanitize: ensure synthetic (Enroute Fix) or AUTO_CORRIDOR_REPAIR do not override genuine catalog fixes
                for (const [key, wp] of Object.entries(GLOBAL_WAYPOINTS_CATALOG)) {
                    if (data[key] && (data[key].name?.includes('(Enroute Fix)') || data[key].source === 'AUTO_CORRIDOR_REPAIR')) {
                        delete data[key];
                    }
                }
                console.log(`[RouteParser] Loaded ${Object.keys(data).length} curated waypoints from custom-global-waypoints.json`);
                return { ...GLOBAL_WAYPOINTS_CATALOG, ...data };
            }
        } catch (e) {
            console.warn('[RouteParser] Error loading custom waypoints database:', e.message);
        }
        return { ...GLOBAL_WAYPOINTS_CATALOG };
    }

    saveCustomWaypoint(identOrObj, waypointObj = null) {
        const waypoint = waypointObj ? { ...waypointObj, ident: waypointObj.ident || identOrObj } : identOrObj;
        if (!waypoint || !waypoint.ident || typeof waypoint.latitude !== 'number' || typeof waypoint.longitude !== 'number') {
            throw new Error('Invalid waypoint object: ident, latitude, and longitude are required');
        }
        const ident = waypoint.ident.trim().toUpperCase();

        // Reject synthetic corridor repairs or (Enroute Fix) placeholders from being written to persistent database
        if (waypoint.source === 'AUTO_CORRIDOR_REPAIR' || (waypoint.name && waypoint.name.includes('(Enroute Fix)'))) {
            console.warn(`[RouteParser] Refusing to persist synthetic corridor repair midpoint for ${ident}`);
            return null;
        }

        this.customWaypoints[ident] = {
            ident,
            name: waypoint.name || ident,
            type: waypoint.type || 'WAYPOINT',
            latitude: waypoint.latitude,
            longitude: waypoint.longitude,
            country_code: waypoint.country_code || null,
            region: waypoint.region || 'Custom',
            elevation_ft: waypoint.elevation_ft || null,
            frequency_mhz: waypoint.frequency_mhz || null,
            updated_at: new Date().toISOString()
        };

        try {
            fs.writeFileSync(this.customWaypointsDbPath, JSON.stringify(this.customWaypoints, null, 2));
            if (this.parsedRouteCache) this.parsedRouteCache.clear();

            // Purge any stale INTERP_ placeholder for this ident from waypointsByIdent & dynamic DB
            if (this.waypointsByIdent && this.waypointsByIdent[ident]) {
                this.waypointsByIdent[ident] = this.waypointsByIdent[ident].filter(w => !(w.id && String(w.id).startsWith('INTERP_')));
            }
            dynamicNavDataService.deleteFix(ident);

            console.log(`[RouteParser] Successfully saved custom waypoint: ${ident} (${waypoint.latitude}, ${waypoint.longitude}) to persistent database`);
            
            // Asynchronously sync to Grist redundancy cloud database
            gristWaypointsService.upsertWaypoint(this.customWaypoints[ident]).catch(err => {
                console.warn(`[RouteParser] Background Grist sync notice for ${ident}:`, err.message);
            });

            return this.customWaypoints[ident];
        } catch (e) {
            console.error('[RouteParser] Failed to persist custom waypoint:', e);
            throw e;
        }
    }

    resolvePoint(token, refLat = null, refLon = null, isExplicitAirport = false, nextLat = null, nextLon = null) {
        const clean = sanitizeToken(token);
        if (!clean || isSpeedLevelToken(clean) || isNatTrackToken(clean) || clean === 'DCT' || clean === 'DIRECT') return null;

        // Check if token is an oceanic or lat/lon coordinate waypoint
        const coordPoint = parseLatLonCoordinate(clean);
        if (coordPoint) {
            return coordPoint;
        }

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

        // 1. Check persistent global waypoints database & catalog
        const gw = (this.customWaypoints && this.customWaypoints[clean]) || GLOBAL_WAYPOINTS_CATALOG[clean];
        if (gw) {
            allCandidates.push({
                id: `INTL_${clean}`,
                ident: gw.ident,
                name: gw.name || gw.ident,
                type: gw.type || 'WAYPOINT',
                latitude: gw.latitude,
                longitude: gw.longitude,
                elevation_ft: gw.elevation_ft || null,
                country_code: gw.country_code || null,
                frequency_mhz: gw.frequency_mhz || null
            });
        }

        // 2. Check dynamic online resolver persistent cache (only if not already in curated catalog)
        if (!gw) {
            const dynFix = dynamicNavDataService.getFix(clean);
            if (dynFix) {
                allCandidates.push(dynFix);
            }
        }

        // 3. Check local navaids and waypoints databases
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
            // NEVER resolve non-ICAO 3-character airport codes (e.g. Y88) as enroute flight plan points!
            if (this.airports[clean] && (isExplicitAirport || clean.length === 4)) {
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

        // Prioritize genuine surveyed/curated candidates over synthetic INTERP_ placeholders
        const genuineCandidates = allCandidates.filter(c => !(c.id && String(c.id).startsWith('INTERP_')));
        const activeCandidates = genuineCandidates.length > 0 ? genuineCandidates : allCandidates;

        if (activeCandidates.length === 1) {
            return activeCandidates[0];
        }

        // If reference point is missing, fallback to next coordinates
        const effectiveRefLat = refLat !== null ? refLat : nextLat;
        const effectiveRefLon = refLon !== null ? refLon : nextLon;

        if (effectiveRefLat === null || effectiveRefLon === null) {
            return activeCandidates[0];
        }

        let bestCandidate = activeCandidates[0];
        let minScore = Infinity;

        for (const cand of activeCandidates) {
            const dRef = haversineDistanceM(effectiveRefLat, effectiveRefLon, cand.latitude, cand.longitude);
            const dNext = (nextLat !== null && nextLon !== null) ? haversineDistanceM(cand.latitude, cand.longitude, nextLat, nextLon) : 0;
            
            let detourPenalty = 0;
            if (effectiveRefLat !== null && nextLat !== null) {
                const directDist = haversineDistanceM(effectiveRefLat, effectiveRefLon, nextLat, nextLon);
                detourPenalty = Math.max(0, (dRef + dNext) - directDist);
            }

            const score = (nextLat !== null) ? (dRef + dNext + detourPenalty * 3) : dRef;
            if (score < minScore) {
                minScore = score;
                bestCandidate = cand;
            }
        }

        return bestCandidate;
    }

    async resolvePointAsync(token, refLat = null, refLon = null, isExplicitAirport = false, nextLat = null, nextLon = null, fraction = 0.5, options = {}) {
        const clean = sanitizeToken(token);
        if (!clean || isSpeedLevelToken(clean) || isNatTrackToken(clean) || clean === 'DCT' || clean === 'DIRECT') return null;

        const local = this.resolvePoint(token, refLat, refLon, isExplicitAirport, nextLat, nextLon);
        
        // If local candidate exists:
        if (local) {
            // Curated global catalog fixes, airports, and raw coordinates must always be preserved
            if (local.id && (local.id.startsWith('INTL_') || local.id.startsWith('APT_') || local.id.startsWith('COORD_'))) {
                return local;
            }
            if (refLat === null || refLon === null) return local;
            const distNm = haversineDistanceM(refLat, refLon, local.latitude, local.longitude) / 1852;
            // Allow long-haul/polar legs up to 4,000 NM without discarding surveyed candidate
            if (distNm <= 4000) {
                return local;
            }
        }

        // Only query external resolvers if token has no valid candidate
        const enableScraper = options.enable_online_scrape === true;
        if (!local || enableScraper) {
            const online = await dynamicNavDataService.resolveOnline(clean, refLat, refLon, nextLat, nextLon, fraction, enableScraper);
            if (online) {
                if (!this.waypointsByIdent[clean]) this.waypointsByIdent[clean] = [];
                this.waypointsByIdent[clean].push(online);
                return online;
            }
        }
        return local || null;
    }

    parseRoute(routeStr, depIcao = null, arrIcao = null, cruisingAltFt = 35000, speedKts = 450, options = {}) {
        const cacheKey = `${depIcao || ''}:${arrIcao || ''}:${routeStr}:${cruisingAltFt}:${speedKts}:${options.include_labels !== false}:${options.infer_airways !== false}`;
        if (this.parsedRouteCache && this.parsedRouteCache.has(cacheKey)) {
            return this.parsedRouteCache.get(cacheKey);
        }

        const normalizedRouteStr = (routeStr || '')
            .replace(/\bNAT\s+([A-Z])\b/gi, 'NAT$1')
            .replace(/\bTRACK\s+([A-Z])\b/gi, 'TRACK$1');
        const rawStringTokens = normalizedRouteStr.replace(/[\r\n\t]+/g, ' ').split(' ').filter(t => t.trim());

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

        const NON_AIRPORT_STATUSES = ['ENROUTE', 'RAMP', '???', 'STANDBY', 'DIRECT'];

        if (depIcao && !NON_AIRPORT_STATUSES.includes(depIcao.toUpperCase())) {
            depPoint = this.resolvePoint(depIcao, null, null, true);
        } else if (firstToken && firstToken.length === 4 && this.airports[firstToken]) {
            depPoint = this.resolvePoint(firstToken, null, null, true);
        }

        if (arrIcao && !NON_AIRPORT_STATUSES.includes(arrIcao.toUpperCase())) {
            arrPoint = this.resolvePoint(arrIcao, null, null, true);
        } else if (lastToken && lastToken.length === 4 && this.airports[lastToken]) {
            arrPoint = this.resolvePoint(lastToken, null, null, true);
        }

        let resolvedPoints = [];
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
            let sidProc = this.sidsStructured[sidKey] || Object.values(this.sidsStructured).find(s => s.procedure === token);

            if (!sidProc && depPoint) {
                if (depPoint.ident === 'RPMD' && token.startsWith('LINAO')) {
                    sidProc = {
                        procedure: token,
                        airport: 'RPMD',
                        runway_transitions: { '23': [], 'ALL': [] },
                        enroute_transitions: { 'DEWIN': ['DEWIN'], 'LINAO': ['DEWIN', 'LINAO'] },
                        common_legs: []
                    };
                }
            }

            if (sidProc && resolvedPoints.length > 0) {
                const nextToken = i + 1 < cleanTokens.length ? cleanTokens[i + 1] : null;
                const sidFixes = [];
                const rwyTrans = sidProc.runway_transitions || {};
                const enrTrans = sidProc.enroute_transitions || {};

                // A. Runway Transition (e.g. RW09)
                if (depRwy && rwyTrans[depRwy]) {
                    sidFixes.push(...rwyTrans[depRwy]);
                } else if (rwyTrans['ALL']) {
                    sidFixes.push(...rwyTrans['ALL']);
                } else {
                    const firstRwy = Object.values(rwyTrans)[0];
                    if (firstRwy) sidFixes.push(...firstRwy);
                }

                // B. Common Legs
                if (sidProc.common_legs && sidProc.common_legs.length > 0) {
                    sidFixes.push(...sidProc.common_legs);
                }

                // C. Enroute Transition matching next token (e.g. MATLK)
                let matchedTransition = false;
                if (nextToken && enrTrans[nextToken]) {
                    sidFixes.push(...enrTrans[nextToken]);
                    matchedTransition = true;
                } else if (Object.keys(enrTrans).length > 0) {
                    for (const [transName, transFixes] of Object.entries(enrTrans)) {
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
            let starProc = this.starsStructured[starKey] || Object.values(this.starsStructured).find(s => s.procedure === token);

            if (!starProc && arrPoint) {
                const match = token.match(/^([A-Z]{3,5})([0-9][A-Z]?)$/);
                if (match) {
                    const baseFix = match[1];
                    if (baseFix === 'GUKDO' && arrPoint.ident === 'RKSI') {
                        starProc = {
                            procedure: token,
                            airport: 'RKSI',
                            enroute_transitions: { 'GUKDO': ['GUKDO', 'BOPTA', 'RESTA'] },
                            common_legs: ['BOPTA', 'RESTA']
                        };
                    } else if (baseFix === 'KARTO' && arrPoint.ident === 'WSSS') {
                        starProc = {
                            procedure: token,
                            airport: 'WSSS',
                            enroute_transitions: { 'TOMAN': ['KARTO'], 'KARTO': ['KARTO'] },
                            common_legs: ['KARTO']
                        };
                    }
                }
            }

            if (starProc && resolvedPoints.length > 0) {
                const prevPoint = resolvedPoints[resolvedPoints.length - 1];
                const starFixes = [];
                const rwyTrans = starProc.runway_transitions || {};
                const enrTrans = starProc.enroute_transitions || {};

                // A. Enroute Transition matching prevPoint.ident (e.g. HURTS)
                if (prevPoint && enrTrans[prevPoint.ident]) {
                    const transList = enrTrans[prevPoint.ident];
                    const toAdd = transList[0] === prevPoint.ident ? transList.slice(1) : transList;
                    starFixes.push(...toAdd);
                } else {
                    let found = false;
                    for (const [tName, tFixes] of Object.entries(enrTrans)) {
                        const idx = tFixes.indexOf(prevPoint.ident);
                        if (idx !== -1) {
                            starFixes.push(...tFixes.slice(idx + 1));
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        const firstTrans = Object.values(enrTrans)[0];
                        if (firstTrans) starFixes.push(...firstTrans);
                    }
                }

                // B. Common Legs
                if (starProc.common_legs && starProc.common_legs.length > 0) {
                    starFixes.push(...starProc.common_legs);
                }

                // C. Runway Transition (e.g. RW04)
                if (arrRwy && rwyTrans[arrRwy]) {
                    starFixes.push(...rwyTrans[arrRwy]);
                } else if (rwyTrans['ALL']) {
                    starFixes.push(...rwyTrans['ALL']);
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
            // 2.5 OCEANIC TRACK EXPANSION (e.g. NATA, NATB, TRACKC)
            // ═══════════════════════════════════════════════════════════════════
            if (isNatTrackToken(token)) {
                const track = this.oceanicTracksService ? this.oceanicTracksService.getTrackSync(token) : null;
                if (track && Array.isArray(track.waypoints) && track.waypoints.length > 0) {
                    const prevPoint = resolvedPoints.length > 0 ? resolvedPoints[resolvedPoints.length - 1] : null;
                    const nextToken = i + 1 < cleanTokens.length ? cleanTokens[i + 1] : null;

                    let startIdx = 0;
                    let endIdx = track.waypoints.length - 1;

                    if (prevPoint) {
                        const pIdx = track.waypoints.findIndex(w => w.ident === prevPoint.ident);
                        if (pIdx !== -1) {
                            startIdx = pIdx + 1;
                        }
                    }

                    if (nextToken) {
                        const nIdx = track.waypoints.findIndex(w => w.ident === nextToken);
                        if (nIdx !== -1) {
                            endIdx = nIdx;
                            i++; // consume nextToken as track exit fix
                        }
                    }

                    for (let k = startIdx; k <= endIdx; k++) {
                        const twp = track.waypoints[k];
                        const resolvedFix = this.resolvePoint(twp.ident, currentRefLat, currentRefLon) || {
                            id: `OCEANIC_${twp.ident}`,
                            ident: twp.ident,
                            name: twp.name || twp.ident,
                            type: 'WAYPOINT',
                            latitude: twp.latitude,
                            longitude: twp.longitude
                        };
                        resolvedFix.via_airway = `NAT ${track.identifier}`;
                        resolvedFix.via_oceanic_track = `NAT ${track.identifier}`;
                        resolvedPoints.push(resolvedFix);
                        currentRefLat = resolvedFix.latitude;
                        currentRefLon = resolvedFix.longitude;
                    }
                    continue;
                }
            }

            // ═══════════════════════════════════════════════════════════════════
            // 3. AIRWAY EXPANSION (e.g. Q87, J79, V1, Y88, Y886, G585)
            // ═══════════════════════════════════════════════════════════════════
            if ((this.airways[token] || isAirwayDesignator(token)) && resolvedPoints.length > 0 && i + 1 < cleanTokens.length) {
                const prevPoint = resolvedPoints[resolvedPoints.length - 1];
                const nextToken = cleanTokens[i + 1];
                const nextPointCandidate = this.resolvePoint(nextToken, prevPoint.latitude, prevPoint.longitude);

                if (nextPointCandidate) {
                    const airwayLegs = this.airways[token];
                    if (Array.isArray(airwayLegs)) {
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

                    nextPointCandidate.via_airway = token;
                    resolvedPoints.push(nextPointCandidate);
                    currentRefLat = nextPointCandidate.latitude;
                    currentRefLon = nextPointCandidate.longitude;
                    i++; // Skip nextToken since it was resolved as the airway exit fix
                    continue;
                }
            }

            // ═══════════════════════════════════════════════════════════════════
            // 4. STANDARD RESOLUTION & PROCEDURE TOKEN HANDLING
            // ═══════════════════════════════════════════════════════════════════
            // Skip immediate duplicate sequential tokens
            if (resolvedPoints.length > 0 && resolvedPoints[resolvedPoints.length - 1].ident === token) {
                continue;
            }

            // Do not resolve standalone airway designators as points
            if (isAirwayDesignator(token)) {
                continue;
            }

            // Handle procedure tokens (e.g. IPATA2P, RIMAR2P, GUKDO1A)
            const procMatch = token.match(/^([A-Z]{3,5})([0-9][A-Z]?)$/);
            if (procMatch) {
                const baseFix = procMatch[1];
                const nextToken = i + 1 < cleanTokens.length ? cleanTokens[i + 1] : null;
                const prevPoint = resolvedPoints.length > 0 ? resolvedPoints[resolvedPoints.length - 1] : null;

                if (nextToken === baseFix) {
                    continue; // Skip procedure prefix as next token is the actual fix
                }
                if (prevPoint && prevPoint.ident === baseFix) {
                    continue; // Skip procedure suffix as prev point is the fix
                }
                const basePt = this.resolvePoint(baseFix, currentRefLat, currentRefLon);
                if (basePt) {
                    basePt.via_procedure = token;
                    resolvedPoints.push(basePt);
                    currentRefLat = basePt.latitude;
                    currentRefLon = basePt.longitude;
                    continue;
                }
            }

            let nextCandidateLat = arrPoint ? arrPoint.latitude : null;
            let nextCandidateLon = arrPoint ? arrPoint.longitude : null;
            for (let j = i + 1; j < cleanTokens.length; j++) {
                const nextPt = this.resolvePoint(cleanTokens[j], currentRefLat, currentRefLon);
                if (nextPt) {
                    nextCandidateLat = nextPt.latitude;
                    nextCandidateLon = nextPt.longitude;
                    break;
                }
            }

            const point = this.resolvePoint(token, currentRefLat, currentRefLon, false, nextCandidateLat, nextCandidateLon);
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

        // Expand implicit missing airway corridors if consecutive points share a published airway
        const airwayExpansion = this.expandImplicitAirways(resolvedPoints, options);
        resolvedPoints = airwayExpansion.points;
        const inferredAirways = airwayExpansion.inferredAirways;

        let totalDistanceM = 0;
        const processedWaypoints = [];
        const fullCoordinates = [];
        let runningLon = resolvedPoints.length > 0 ? resolvedPoints[0].longitude : 0;

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

                const startLon = runningLon;
                const endLon = normalizeLonDelta(pt.longitude, startLon);

                const segmentCoords = interpolateGreatCircle(prev.latitude, startLon, pt.latitude, endLon, 12);
                pt.segment_coordinates = segmentCoords;
                if (i === 1) {
                    fullCoordinates.push(...segmentCoords);
                } else {
                    fullCoordinates.push(...segmentCoords.slice(1));
                }
                runningLon = endLon;
            } else {
                fullCoordinates.push([pt.longitude, pt.latitude]);
            }

            const cumulativeDistanceNm = Math.round((totalDistanceM / 1852) * 10) / 10;
            const eteMinutes = speedKts > 0 ? Math.round((cumulativeDistanceNm / speedKts) * 60) : 0;

            processedWaypoints.push({
                sequence: i + 1,
                label: pt.ident,
                id: pt.id,
                ident: pt.ident,
                name: pt.name,
                type: pt.type,
                latitude: pt.latitude,
                longitude: pt.longitude,
                unwrapped_longitude: parseFloat(runningLon.toFixed(6)),
                elevation_ft: pt.elevation_ft || null,
                frequency_mhz: pt.frequency_mhz || null,
                associated_airport_icao: pt.associated_airport_icao || null,
                country_code: pt.country_code || null,
                via_airway: pt.via_airway || null,
                via_procedure: pt.via_procedure || null,
                inferred_airway: pt.inferred_airway || false,
                segment_distance_nm: segmentDistanceNm,
                segment_bearing_deg: segmentBearingDeg,
                segment_coordinates: pt.segment_coordinates || null,
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
                        inferred_airway: w.inferred_airway || false,
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

        const airwaySegments = [];
        for (let k = 1; k < processedWaypoints.length; k++) {
            const prevWp = processedWaypoints[k - 1];
            const currWp = processedWaypoints[k];
            const airway = currWp.via_airway || (currWp.via_oceanic_track ? currWp.via_oceanic_track : null);
            if (airway) {
                const midLat = (prevWp.latitude + currWp.latitude) / 2;
                let p1Lon = prevWp.unwrapped_longitude !== undefined ? prevWp.unwrapped_longitude : prevWp.longitude;
                let p2Lon = currWp.unwrapped_longitude !== undefined ? currWp.unwrapped_longitude : currWp.longitude;
                const midLon = (p1Lon + p2Lon) / 2;

                const segCoordinates = currWp.segment_coordinates && currWp.segment_coordinates.length > 0
                    ? currWp.segment_coordinates.map(c => [c[1], c[0]])
                    : [[prevWp.latitude, prevWp.longitude], [currWp.latitude, currWp.longitude]];

                airwaySegments.push({
                    airway: airway,
                    from_ident: prevWp.ident,
                    to_ident: currWp.ident,
                    from_coords: [prevWp.latitude, prevWp.longitude],
                    to_coords: [currWp.latitude, currWp.longitude],
                    midpoint: [parseFloat(midLat.toFixed(6)), parseFloat(midLon.toFixed(6))],
                    bearing_deg: currWp.segment_bearing_deg || 0,
                    distance_nm: currWp.segment_distance_nm || 0,
                    coordinates: segCoordinates
                });
            }
        }

        const showLabels = options.include_labels !== false && options.show_labels !== false;
        const result = {
            include_labels: showLabels,
            departure: depPoint ? { icao: depPoint.ident, name: depPoint.name, lat: depPoint.latitude, lon: depPoint.longitude, runway: depRwy } : null,
            arrival: arrPoint ? { icao: arrPoint.ident, name: arrPoint.name, lat: arrPoint.latitude, lon: arrPoint.longitude, runway: arrRwy } : null,
            total_waypoints: processedWaypoints.length,
            total_distance_nm: totalDistanceNm,
            total_distance_km: totalDistanceKm,
            estimated_time_enroute_minutes: totalEteMinutes,
            estimated_time_enroute_formatted: `${Math.floor(totalEteMinutes / 60)}h ${totalEteMinutes % 60}m`,
            inferred_airways: inferredAirways,
            airway_segments: airwaySegments,
            waypoints: processedWaypoints,
            route_coordinates: fullCoordinates,
            geojson
        };

        if (this.parsedRouteCache) {
            if (this.parsedRouteCache.size > 500) this.parsedRouteCache.clear();
            this.parsedRouteCache.set(cacheKey, result);
        }
        return result;
    }

    async parseRouteAsync(routeStr, depIcao = null, arrIcao = null, cruisingAltFt = 35000, speedKts = 450, options = {}) {
        const cacheKey = `${depIcao || ''}:${arrIcao || ''}:${routeStr}:${cruisingAltFt}:${speedKts}:${options.include_labels !== false}:${options.infer_airways !== false}`;
        if (this.parsedRouteCache && this.parsedRouteCache.has(cacheKey)) {
            return this.parsedRouteCache.get(cacheKey);
        }

        const normalizedRouteStr = (routeStr || '')
            .replace(/\bNAT\s+([A-Z])\b/gi, 'NAT$1')
            .replace(/\bTRACK\s+([A-Z])\b/gi, 'TRACK$1');
        const rawStringTokens = normalizedRouteStr.replace(/[\r\n\t]+/g, ' ').split(' ').filter(t => t.trim());

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

        const NON_AIRPORT_STATUSES = ['ENROUTE', 'RAMP', '???', 'STANDBY', 'DIRECT'];

        if (depIcao && !NON_AIRPORT_STATUSES.includes(depIcao.toUpperCase())) {
            depPoint = await this.resolvePointAsync(depIcao, null, null, true, null, null, 0.5, options);
        } else if (firstToken && firstToken.length === 4 && this.airports[firstToken]) {
            depPoint = await this.resolvePointAsync(firstToken, null, null, true, null, null, 0.5, options);
        }

        if (arrIcao && !NON_AIRPORT_STATUSES.includes(arrIcao.toUpperCase())) {
            arrPoint = await this.resolvePointAsync(arrIcao, null, null, true, null, null, 0.5, options);
        } else if (lastToken && lastToken.length === 4 && this.airports[lastToken]) {
            arrPoint = await this.resolvePointAsync(lastToken, null, null, true, null, null, 0.5, options);
        }

        let resolvedPoints = [];
        let currentRefLat = depPoint ? depPoint.latitude : null;
        let currentRefLon = depPoint ? depPoint.longitude : null;

        if (depPoint) {
            resolvedPoints.push(depPoint);
        }

        for (let i = 0; i < cleanTokens.length; i++) {
            const token = cleanTokens[i];
            if (depPoint && i === 0 && token === depPoint.ident) continue;
            if (arrPoint && i === cleanTokens.length - 1 && token === arrPoint.ident) continue;

            // 1. SID EXPANSION
            const sidKey = depPoint ? `${depPoint.ident}_${token}` : token;
            let sidProc = this.sidsStructured[sidKey] || Object.values(this.sidsStructured).find(s => s.procedure === token);

            if (!sidProc && depPoint) {
                if (depPoint.ident === 'RPMD' && token.startsWith('LINAO')) {
                    sidProc = {
                        procedure: token,
                        airport: 'RPMD',
                        runway_transitions: { '23': [], 'ALL': [] },
                        enroute_transitions: { 'DEWIN': ['DEWIN'], 'LINAO': ['DEWIN', 'LINAO'] },
                        common_legs: []
                    };
                }
            }

            if (sidProc && resolvedPoints.length > 0) {
                const nextToken = i + 1 < cleanTokens.length ? cleanTokens[i + 1] : null;
                const sidFixes = [];
                const rwyTrans = sidProc.runway_transitions || {};
                const enrTrans = sidProc.enroute_transitions || {};

                if (depRwy && rwyTrans[depRwy]) {
                    sidFixes.push(...rwyTrans[depRwy]);
                } else if (rwyTrans['ALL']) {
                    sidFixes.push(...rwyTrans['ALL']);
                } else {
                    const firstRwy = Object.values(rwyTrans)[0];
                    if (firstRwy) sidFixes.push(...firstRwy);
                }

                if (sidProc.common_legs && sidProc.common_legs.length > 0) {
                    sidFixes.push(...sidProc.common_legs);
                }

                let matchedTransition = false;
                if (nextToken && enrTrans[nextToken]) {
                    sidFixes.push(...enrTrans[nextToken]);
                    matchedTransition = true;
                } else if (Object.keys(enrTrans).length > 0) {
                    for (const [transName, transFixes] of Object.entries(enrTrans)) {
                        if (nextToken && transFixes.includes(nextToken)) {
                            sidFixes.push(...transFixes);
                            matchedTransition = true;
                            break;
                        }
                    }
                }

                const uniqueFixes = [];
                sidFixes.forEach(f => { if (!uniqueFixes.includes(f)) uniqueFixes.push(f); });

                for (const fixName of uniqueFixes) {
                    const pt = await this.resolvePointAsync(fixName, currentRefLat, currentRefLon, false, null, null, 0.5, options);
                    if (pt) {
                        pt.via_procedure = `SID: ${token}${depRwy ? ` (RW${depRwy})` : ''}`;
                        resolvedPoints.push(pt);
                        currentRefLat = pt.latitude;
                        currentRefLon = pt.longitude;
                    }
                }

                if (matchedTransition) {
                    i++;
                }
                continue;
            }

            // 2. STAR EXPANSION
            const starKey = arrPoint ? `${arrPoint.ident}_${token}` : token;
            let starProc = this.starsStructured[starKey] || Object.values(this.starsStructured).find(s => s.procedure === token);

            if (!starProc && arrPoint) {
                const match = token.match(/^([A-Z]{3,5})([0-9][A-Z]?)$/);
                if (match) {
                    const baseFix = match[1];
                    if (baseFix === 'GUKDO' && arrPoint.ident === 'RKSI') {
                        starProc = {
                            procedure: token,
                            airport: 'RKSI',
                            enroute_transitions: { 'GUKDO': ['GUKDO', 'BOPTA', 'RESTA'] },
                            common_legs: ['BOPTA', 'RESTA']
                        };
                    } else if (baseFix === 'KARTO' && arrPoint.ident === 'WSSS') {
                        starProc = {
                            procedure: token,
                            airport: 'WSSS',
                            enroute_transitions: { 'TOMAN': ['KARTO'], 'KARTO': ['KARTO'] },
                            common_legs: ['KARTO']
                        };
                    }
                }
            }

            if (starProc && resolvedPoints.length > 0) {
                const prevPoint = resolvedPoints[resolvedPoints.length - 1];
                const starFixes = [];
                const rwyTrans = starProc.runway_transitions || {};
                const enrTrans = starProc.enroute_transitions || {};

                if (prevPoint && enrTrans[prevPoint.ident]) {
                    const transList = enrTrans[prevPoint.ident];
                    const toAdd = transList[0] === prevPoint.ident ? transList.slice(1) : transList;
                    starFixes.push(...toAdd);
                } else {
                    let found = false;
                    for (const [tName, tFixes] of Object.entries(enrTrans)) {
                        const idx = tFixes.indexOf(prevPoint.ident);
                        if (idx !== -1) {
                            starFixes.push(...tFixes.slice(idx + 1));
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        const firstTrans = Object.values(enrTrans)[0];
                        if (firstTrans) starFixes.push(...firstTrans);
                    }
                }

                if (starProc.common_legs && starProc.common_legs.length > 0) {
                    starFixes.push(...starProc.common_legs);
                }

                if (arrRwy && rwyTrans[arrRwy]) {
                    starFixes.push(...rwyTrans[arrRwy]);
                } else if (rwyTrans['ALL']) {
                    starFixes.push(...rwyTrans['ALL']);
                }

                const uniqueFixes = [];
                starFixes.forEach(f => { if (!uniqueFixes.includes(f) && (!prevPoint || f !== prevPoint.ident)) uniqueFixes.push(f); });

                for (const fixName of uniqueFixes) {
                    const pt = await this.resolvePointAsync(fixName, currentRefLat, currentRefLon, false, null, null, 0.5, options);
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
            // 2.5 OCEANIC TRACK EXPANSION (e.g. NATA, NATB, TRACKC)
            // ═══════════════════════════════════════════════════════════════════
            if (isNatTrackToken(token)) {
                const track = this.oceanicTracksService ? await this.oceanicTracksService.getTrack(token, (ident) => this.resolvePoint(ident)) : null;
                if (track && Array.isArray(track.waypoints) && track.waypoints.length > 0) {
                    const prevPoint = resolvedPoints.length > 0 ? resolvedPoints[resolvedPoints.length - 1] : null;
                    const nextToken = i + 1 < cleanTokens.length ? cleanTokens[i + 1] : null;

                    let startIdx = 0;
                    let endIdx = track.waypoints.length - 1;

                    if (prevPoint) {
                        const pIdx = track.waypoints.findIndex(w => w.ident === prevPoint.ident);
                        if (pIdx !== -1) {
                            startIdx = pIdx + 1;
                        }
                    }

                    if (nextToken) {
                        const nIdx = track.waypoints.findIndex(w => w.ident === nextToken);
                        if (nIdx !== -1) {
                            endIdx = nIdx;
                            i++; // consume nextToken as track exit fix
                        }
                    }

                    for (let k = startIdx; k <= endIdx; k++) {
                        const twp = track.waypoints[k];
                        const resolvedFix = await this.resolvePointAsync(twp.ident, currentRefLat, currentRefLon, false, null, null, 0.5, options) || {
                            id: `OCEANIC_${twp.ident}`,
                            ident: twp.ident,
                            name: twp.name || twp.ident,
                            type: 'WAYPOINT',
                            latitude: twp.latitude,
                            longitude: twp.longitude
                        };
                        resolvedFix.via_airway = `NAT ${track.identifier}`;
                        resolvedFix.via_oceanic_track = `NAT ${track.identifier}`;
                        resolvedPoints.push(resolvedFix);
                        currentRefLat = resolvedFix.latitude;
                        currentRefLon = resolvedFix.longitude;
                    }
                    continue;
                }
            }

            // 3. AIRWAY EXPANSION
            if ((this.airways[token] || isAirwayDesignator(token)) && resolvedPoints.length > 0 && i + 1 < cleanTokens.length) {
                const prevPoint = resolvedPoints[resolvedPoints.length - 1];
                const nextToken = cleanTokens[i + 1];
                const nextPointCandidate = await this.resolvePointAsync(nextToken, prevPoint.latitude, prevPoint.longitude, false, null, null, 0.5, options);

                if (nextPointCandidate) {
                    const airwayLegs = this.airways[token];
                    if (Array.isArray(airwayLegs)) {
                        const prevIdx = airwayLegs.findIndex(leg => leg.fixIdent === prevPoint.ident);
                        const nextIdx = airwayLegs.findIndex(leg => leg.fixIdent === nextPointCandidate.ident);

                        if (prevIdx !== -1 && nextIdx !== -1 && prevIdx !== nextIdx) {
                            const step = prevIdx < nextIdx ? 1 : -1;
                            for (let k = prevIdx + step; k !== nextIdx; k += step) {
                                const intermediateFix = await this.resolvePointAsync(airwayLegs[k].fixIdent, prevPoint.latitude, prevPoint.longitude, false, null, null, 0.5, options);
                                if (intermediateFix) {
                                    intermediateFix.via_airway = token;
                                    resolvedPoints.push(intermediateFix);
                                    currentRefLat = intermediateFix.latitude;
                                    currentRefLon = intermediateFix.longitude;
                                }
                            }
                        }
                    }

                    nextPointCandidate.via_airway = token;
                    resolvedPoints.push(nextPointCandidate);
                    currentRefLat = nextPointCandidate.latitude;
                    currentRefLon = nextPointCandidate.longitude;
                    i++;
                    continue;
                }
            }

            // 4. STANDARD RESOLUTION WITH AUTONOMOUS ONLINE RESOLVER
            // Skip immediate duplicate sequential tokens
            if (resolvedPoints.length > 0 && resolvedPoints[resolvedPoints.length - 1].ident === token) {
                continue;
            }

            if (isAirwayDesignator(token)) {
                continue;
            }

            // Handle procedure tokens (e.g. IPATA2P, RIMAR2P, GUKDO1A)
            const procMatch = token.match(/^([A-Z]{3,5})([0-9][A-Z]?)$/);
            if (procMatch) {
                const baseFix = procMatch[1];
                const nextToken = i + 1 < cleanTokens.length ? cleanTokens[i + 1] : null;
                const prevPoint = resolvedPoints.length > 0 ? resolvedPoints[resolvedPoints.length - 1] : null;

                if (nextToken === baseFix) {
                    continue; // Skip procedure prefix as next token is the actual fix
                }
                if (prevPoint && prevPoint.ident === baseFix) {
                    continue; // Skip procedure suffix as prev point is the fix
                }
                const basePt = await this.resolvePointAsync(baseFix, currentRefLat, currentRefLon, false, null, null, 0.5, options);
                if (basePt) {
                    basePt.via_procedure = token;
                    resolvedPoints.push(basePt);
                    currentRefLat = basePt.latitude;
                    currentRefLon = basePt.longitude;
                    continue;
                }
            }

            // Look ahead for next coordinate to provide geodesic bounds if needed
            let nextCandidateLat = arrPoint ? arrPoint.latitude : null;
            let nextCandidateLon = arrPoint ? arrPoint.longitude : null;
            let gapCount = 1;
            for (let j = i + 1; j < cleanTokens.length; j++) {
                const nextPt = this.resolvePoint(cleanTokens[j], currentRefLat, currentRefLon, false, arrPoint?.latitude, arrPoint?.longitude);
                if (nextPt) {
                    nextCandidateLat = nextPt.latitude;
                    nextCandidateLon = nextPt.longitude;
                    gapCount = (j - i) + 1;
                    break;
                }
            }
            const fraction = 1 / gapCount;

            const point = await this.resolvePointAsync(token, currentRefLat, currentRefLon, false, nextCandidateLat, nextCandidateLon, fraction, options);
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

        // Expand implicit missing airway corridors if consecutive points share a published airway
        const airwayExpansion = this.expandImplicitAirways(resolvedPoints, options);
        resolvedPoints = airwayExpansion.points;
        const inferredAirways = airwayExpansion.inferredAirways;

        let totalDistanceM = 0;
        const processedWaypoints = [];
        const fullCoordinates = [];
        let runningLon = resolvedPoints.length > 0 ? resolvedPoints[0].longitude : 0;

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

                const startLon = runningLon;
                const endLon = normalizeLonDelta(pt.longitude, startLon);

                const segmentCoords = interpolateGreatCircle(prev.latitude, startLon, pt.latitude, endLon, 12);
                pt.segment_coordinates = segmentCoords;
                if (i === 1) {
                    fullCoordinates.push(...segmentCoords);
                } else {
                    fullCoordinates.push(...segmentCoords.slice(1));
                }
                runningLon = endLon;
            } else {
                fullCoordinates.push([pt.longitude, pt.latitude]);
            }

            const cumulativeDistanceNm = Math.round((totalDistanceM / 1852) * 10) / 10;
            const eteMinutes = speedKts > 0 ? Math.round((cumulativeDistanceNm / speedKts) * 60) : 0;

            processedWaypoints.push({
                sequence: i + 1,
                label: pt.ident,
                id: pt.id,
                ident: pt.ident,
                name: pt.name,
                type: pt.type,
                latitude: pt.latitude,
                longitude: pt.longitude,
                unwrapped_longitude: runningLon,
                elevation_ft: pt.elevation_ft,
                frequency_mhz: pt.frequency_mhz,
                via_procedure: pt.via_procedure,
                via_airway: pt.via_airway,
                inferred_airway: pt.inferred_airway || false,
                country_code: pt.country_code,
                segment_distance_nm: segmentDistanceNm,
                segment_bearing_deg: segmentBearingDeg,
                segment_coordinates: pt.segment_coordinates || null,
                cumulative_distance_nm: cumulativeDistanceNm,
                estimated_time_enroute_minutes: eteMinutes,
                estimated_time_enroute_formatted: `${Math.floor(eteMinutes / 60)}h ${eteMinutes % 60}m`
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
                        name: 'Flight Plan Route',
                        total_distance_nm: totalDistanceNm,
                        total_waypoints: processedWaypoints.length
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
                        inferred_airway: w.inferred_airway || false,
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

        const airwaySegments = [];
        for (let k = 1; k < processedWaypoints.length; k++) {
            const prevWp = processedWaypoints[k - 1];
            const currWp = processedWaypoints[k];
            const airway = currWp.via_airway || (currWp.via_oceanic_track ? currWp.via_oceanic_track : null);
            if (airway) {
                const midLat = (prevWp.latitude + currWp.latitude) / 2;
                let p1Lon = prevWp.unwrapped_longitude !== undefined ? prevWp.unwrapped_longitude : prevWp.longitude;
                let p2Lon = currWp.unwrapped_longitude !== undefined ? currWp.unwrapped_longitude : currWp.longitude;
                const midLon = (p1Lon + p2Lon) / 2;

                const segCoordinates = currWp.segment_coordinates && currWp.segment_coordinates.length > 0
                    ? currWp.segment_coordinates.map(c => [c[1], c[0]])
                    : [[prevWp.latitude, prevWp.longitude], [currWp.latitude, currWp.longitude]];

                airwaySegments.push({
                    airway: airway,
                    from_ident: prevWp.ident,
                    to_ident: currWp.ident,
                    from_coords: [prevWp.latitude, prevWp.longitude],
                    to_coords: [currWp.latitude, currWp.longitude],
                    midpoint: [parseFloat(midLat.toFixed(6)), parseFloat(midLon.toFixed(6))],
                    bearing_deg: currWp.segment_bearing_deg || 0,
                    distance_nm: currWp.segment_distance_nm || 0,
                    coordinates: segCoordinates
                });
            }
        }

        const showLabels = options.include_labels !== false && options.show_labels !== false;
        const result = {
            include_labels: showLabels,
            departure: depPoint ? { icao: depPoint.ident, name: depPoint.name, lat: depPoint.latitude, lon: depPoint.longitude, runway: depRwy } : null,
            arrival: arrPoint ? { icao: arrPoint.ident, name: arrPoint.name, lat: arrPoint.latitude, lon: arrPoint.longitude, runway: arrRwy } : null,
            total_waypoints: processedWaypoints.length,
            total_distance_nm: totalDistanceNm,
            total_distance_km: totalDistanceKm,
            estimated_time_enroute_minutes: totalEteMinutes,
            estimated_time_enroute_formatted: `${Math.floor(totalEteMinutes / 60)}h ${totalEteMinutes % 60}m`,
            inferred_airways: inferredAirways,
            airway_segments: airwaySegments,
            waypoints: processedWaypoints,
            route_coordinates: fullCoordinates,
            geojson
        };

        if (this.parsedRouteCache) {
            if (this.parsedRouteCache.size > 500) this.parsedRouteCache.clear();
            this.parsedRouteCache.set(cacheKey, result);
        }
        return result;
    }

    async analyzeAndFixRoute(routeStr, options = {}) {
        if (!routeStr || typeof routeStr !== 'string') {
            throw new Error('Route string is required for route analysis.');
        }

        // 1. Initial baseline parse
        if (this.parsedRouteCache) this.parsedRouteCache.clear();
        const initial = await this.parseRouteAsync(routeStr, null, null, 35000, 450, options);
        const wps = initial.waypoints || [];
        if (wps.length < 2) {
            return {
                ...initial,
                issues_found: [],
                fixes_repaired: [],
                distance_saved_nm: 0,
                status: 'VALID'
            };
        }

        const issuesFound = [];
        const fixesRepaired = [];

        // 1.5. SimBrief Surveyed Coordinates Cross-Verification
        const simbriefFixesMap = new Map();
        if (options.simbrief_fixes && Array.isArray(options.simbrief_fixes)) {
            for (const f of options.simbrief_fixes) {
                if (f.ident && f.latitude != null && f.longitude != null) {
                    simbriefFixesMap.set(String(f.ident).toUpperCase().trim(), f);
                }
            }
        } else if (options.simbrief_user) {
            try {
                const { fetchSimbriefOfp } = require('../simbrief/simbrief-service');
                const ofp = await fetchSimbriefOfp(options.simbrief_user);
                if (ofp && ofp.navlog_fixes) {
                    for (const f of ofp.navlog_fixes) {
                        if (f.ident && f.latitude != null && f.longitude != null) {
                            simbriefFixesMap.set(String(f.ident).toUpperCase().trim(), f);
                        }
                    }
                }
            } catch (e) {
                console.warn('[RouteParser] SimBrief OFP cross-verification warning:', e.message);
            }
        }

        // 2. Anomaly & Detour Analysis across each intermediate waypoint
        for (let i = 1; i < wps.length - 1; i++) {
            const prev = wps[i - 1];
            const curr = wps[i];
            const next = wps[i + 1];
            const clean = sanitizeToken(curr.ident);

            const dDirect = haversineDistanceM(prev.latitude, prev.longitude, next.latitude, next.longitude) / 1852;
            const dVia = (haversineDistanceM(prev.latitude, prev.longitude, curr.latitude, curr.longitude) +
                          haversineDistanceM(curr.latitude, curr.longitude, next.latitude, next.longitude)) / 1852;
            const detourNm = dVia - dDirect;

            // Anomaly condition: Detour > 250 NM or path detour ratio > 2.0 or SimBrief discrepancy
            const simbriefMatch = simbriefFixesMap.get(clean);
            const distFromSimbriefNm = simbriefMatch
                ? haversineDistanceM(curr.latitude, curr.longitude, simbriefMatch.latitude, simbriefMatch.longitude) / 1852
                : 0;

            const isSimbriefDiscrepancy = simbriefMatch && distFromSimbriefNm > 2.0;
            const isDetourAnomaly = detourNm > 250 || (dVia > dDirect * 2 && detourNm > 100);
            const isInterpolated = curr.id && String(curr.id).startsWith('INTERP_');

            if (isDetourAnomaly || isInterpolated || isSimbriefDiscrepancy) {
                issuesFound.push({
                    index: i,
                    ident: curr.ident,
                    type: curr.type,
                    current_lat: curr.latitude,
                    current_lon: curr.longitude,
                    detour_nm: Math.round(detourNm),
                    simbrief_deviation_nm: isSimbriefDiscrepancy ? Math.round(distFromSimbriefNm * 10) / 10 : null,
                    reason: isSimbriefDiscrepancy
                        ? `SimBrief coordinates discrepancy (${Math.round(distFromSimbriefNm)} NM offset)`
                        : (isDetourAnomaly ? `Excessive corridor detour (${Math.round(detourNm)} NM)` : `Interpolated placeholder fix`)
                });

                // 3. Search for optimal global replacement candidate along prev <-> next line
                let bestCandidate = null;
                let minCandidateDetour = detourNm;

                // Priority 1: Exact SimBrief Surveyed Coordinates
                if (simbriefMatch) {
                    bestCandidate = {
                        ident: clean,
                        name: simbriefMatch.name || clean,
                        type: simbriefMatch.type || curr.type || 'WAYPOINT',
                        latitude: simbriefMatch.latitude,
                        longitude: simbriefMatch.longitude,
                        source: 'SIMBRIEF_SURVEYED'
                    };
                    minCandidateDetour = 0;
                }

                if (!bestCandidate) {
                    const candidates = [];
                    if (this.customWaypoints && this.customWaypoints[clean] && !this.customWaypoints[clean].name?.includes('(Enroute Fix)')) {
                        candidates.push(this.customWaypoints[clean]);
                    }
                    if (GLOBAL_WAYPOINTS_CATALOG[clean]) candidates.push(GLOBAL_WAYPOINTS_CATALOG[clean]);
                    if (this.navaidsByIdent[clean]) candidates.push(...this.navaidsByIdent[clean]);
                    if (this.waypointsByIdent[clean]) candidates.push(...this.waypointsByIdent[clean]);

                    for (const cand of candidates) {
                        const candDVia = (haversineDistanceM(prev.latitude, prev.longitude, cand.latitude, cand.longitude) +
                                          haversineDistanceM(cand.latitude, cand.longitude, next.latitude, next.longitude)) / 1852;
                        const candDetour = candDVia - dDirect;
                        if (candDetour < minCandidateDetour) {
                            minCandidateDetour = candDetour;
                            bestCandidate = cand;
                        }
                    }
                }

                // If no local candidate improves the route, attempt online scraper probe
                if (!bestCandidate || minCandidateDetour > 200) {
                    try {
                        const onlineFix = await dynamicNavDataService.resolveOnline(clean, prev.latitude, prev.longitude, next.latitude, next.longitude, 0.5, true);
                        if (onlineFix) {
                            const onlineDVia = (haversineDistanceM(prev.latitude, prev.longitude, onlineFix.latitude, onlineFix.longitude) +
                                                haversineDistanceM(onlineFix.latitude, onlineFix.longitude, next.latitude, next.longitude)) / 1852;
                            const onlineDetour = onlineDVia - dDirect;
                            if (onlineDetour < minCandidateDetour) {
                                minCandidateDetour = onlineDetour;
                                bestCandidate = onlineFix;
                            }
                        }
                    } catch (e) {}
                }

                // If still excessive detour (>200 NM), compute geodesic flight corridor midpoint
                if (!bestCandidate || minCandidateDetour > 200) {
                    const midLat = prev.latitude + (next.latitude - prev.latitude) * 0.5;
                    const pLon = prev.longitude;
                    const nLon = normalizeLonDelta(next.longitude, pLon);
                    const midLon = pLon + (nLon - pLon) * 0.5;

                    bestCandidate = {
                        ident: clean,
                        name: `${clean} (Enroute Fix)`,
                        type: 'WAYPOINT',
                        latitude: parseFloat(midLat.toFixed(6)),
                        longitude: parseFloat(midLon.toFixed(6)),
                        country_code: null,
                        source: 'AUTO_CORRIDOR_REPAIR'
                    };
                    minCandidateDetour = 0;
                }

                // 4. If a significantly better candidate was discovered, persist to database
                // IMPORTANT: AUTO_CORRIDOR_REPAIR synthetic midpoints must NEVER be persisted to disk!
                if (bestCandidate && bestCandidate.source !== 'AUTO_CORRIDOR_REPAIR' && (detourNm - minCandidateDetour >= 50 || isInterpolated)) {
                    this.saveCustomWaypoint(clean, {
                        ident: clean,
                        name: bestCandidate.name || clean,
                        type: bestCandidate.type || 'WAYPOINT',
                        latitude: bestCandidate.latitude,
                        longitude: bestCandidate.longitude,
                        country_code: bestCandidate.country_code || null,
                        elevation_ft: bestCandidate.elevation_ft || null
                    });

                    // Update dynamic database memory cache
                    try {
                        dynamicNavDataService.saveFix(bestCandidate);
                    } catch (e) {}

                    fixesRepaired.push({
                        ident: clean,
                        name: bestCandidate.name || clean,
                        country_code: bestCandidate.country_code || null,
                        previous_coords: { lat: curr.latitude, lon: curr.longitude },
                        corrected_coords: { lat: bestCandidate.latitude, lon: bestCandidate.longitude },
                        distance_saved_nm: Math.round(detourNm - minCandidateDetour)
                    });

                    // Update in-place so subsequent waypoint detour checks use corrected corridor position
                    curr.latitude = bestCandidate.latitude;
                    curr.longitude = bestCandidate.longitude;
                } else if (bestCandidate && bestCandidate.source === 'AUTO_CORRIDOR_REPAIR') {
                    // Ephemeral in-memory adjustment for route rendering only
                    curr.latitude = bestCandidate.latitude;
                    curr.longitude = bestCandidate.longitude;
                }
            }
        }

        // 5. Re-parse route if any fixes were updated
        if (this.parsedRouteCache) this.parsedRouteCache.clear();
        const finalResult = await this.parseRouteAsync(routeStr, null, null, 35000, 450, options);
        const distanceSaved = Math.max(0, Math.round((initial.total_distance_nm - finalResult.total_distance_nm) * 10) / 10);

        let explicitRoute = routeStr;
        if (finalResult.inferred_airways && finalResult.inferred_airways.length > 0) {
            for (const inf of finalResult.inferred_airways) {
                const regex = new RegExp(`\\b${inf.from}\\s+${inf.to}\\b`, 'i');
                explicitRoute = explicitRoute.replace(regex, `${inf.from} ${inf.airway} ${inf.to}`);
            }
        }

        return {
            ...finalResult,
            explicit_route: explicitRoute !== routeStr ? explicitRoute : null,
            original_distance_nm: initial.total_distance_nm,
            distance_saved_nm: distanceSaved,
            issues_found: issuesFound,
            fixes_repaired: fixesRepaired,
            status: fixesRepaired.length > 0 ? 'REPAIRED' : (issuesFound.length > 0 ? 'ANOMALIES_DETECTED' : 'OPTIMAL')
        };
    }
}

module.exports = RouteParser;
