const fs = require('fs');
const path = require('path');
const dynamicNavDataService = require('../services/dynamic-navdata-service');

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
    let l1 = lon1;
    let l2 = lon2;
    while (l2 - l1 > 180) l2 -= 360;
    while (l2 - l1 < -180) l2 += 360;

    const p1 = [l1 * Math.PI / 180, lat1 * Math.PI / 180];
    const p2 = [l2 * Math.PI / 180, lat2 * Math.PI / 180];

    const d = 2 * Math.asin(Math.sqrt(
        Math.pow(Math.sin((p1[1] - p2[1]) / 2), 2) +
        Math.cos(p1[1]) * Math.cos(p2[1]) * Math.pow(Math.sin((p1[0] - p2[0]) / 2), 2)
    ));

    if (d === 0 || isNaN(d)) return [[lon1, lat1], [l2, lat2]];

    for (let i = 0; i <= numSegments; i++) {
        const f = i / numSegments;
        const A = Math.sin((1 - f) * d) / Math.sin(d);
        const B = Math.sin(f * d) / Math.sin(d);
        const x = A * Math.cos(p1[1]) * Math.cos(p1[0]) + B * Math.cos(p2[1]) * Math.cos(p2[0]);
        const y = A * Math.cos(p1[1]) * Math.sin(p1[0]) + B * Math.cos(p2[1]) * Math.sin(p2[0]);
        const z = A * Math.sin(p1[1]) + B * Math.sin(p2[1]);
        const lat = Math.atan2(z, Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2))) * 180 / Math.PI;
        let lon = Math.atan2(y, x) * 180 / Math.PI;

        if (coords.length > 0) {
            const prevLon = coords[coords.length - 1][0];
            while (lon - prevLon > 180) lon -= 360;
            while (lon - prevLon < -180) lon += 360;
        } else {
            while (lon - l1 > 180) lon -= 360;
            while (lon - l1 < -180) lon += 360;
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
    return /^NAT[A-Z]$/i.test(token);
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

    // Format 3: ARINC 424 Shorthand (e.g. 5140N, 4970E)
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
    'BALMA': { ident: 'BALMA', name: 'BALMA', type: 'WAYPOINT', latitude: 34.483333, longitude: 35.050000, country_code: 'LB' },
    'CAK': { ident: 'CAK', name: 'CAK', type: 'VOR-DME', latitude: 34.298999, longitude: 35.699699, country_code: 'LB' },
    'LATEB': { ident: 'LATEB', name: 'LATEB', type: 'WAYPOINT', latitude: 34.031667, longitude: 36.401000, country_code: 'SY' },
    'ZELAF': { ident: 'ZELAF', name: 'ZELAF', type: 'WAYPOINT', latitude: 32.950000, longitude: 38.000000, country_code: 'JO' },
    'RASLI': { ident: 'RASLI', name: 'RASLI', type: 'WAYPOINT', latitude: 31.906667, longitude: 38.613333, country_code: 'SA' },
    'TRF': { ident: 'TRF', name: 'TRF', type: 'VOR-DME', latitude: 31.693300, longitude: 38.734699, country_code: 'SA' },
    'NEVOL': { ident: 'NEVOL', name: 'NEVOL', type: 'WAYPOINT', latitude: 30.412778, longitude: 39.644722, country_code: 'SA' },
    'DASVA': { ident: 'DASVA', name: 'DASVA', type: 'WAYPOINT', latitude: 27.426872, longitude: 47.146980, country_code: 'SA' },
    'TOSNA': { ident: 'TOSNA', name: 'TOSNA', type: 'WAYPOINT', latitude: 25.270000, longitude: 52.687778, country_code: 'QA' },
    'UMEVU': { ident: 'UMEVU', name: 'UMEVU', type: 'WAYPOINT', latitude: 24.855483, longitude: 53.668508, country_code: 'AE' },
    'UKILI': { ident: 'UKILI', name: 'UKILI', type: 'WAYPOINT', latitude: 24.648224, longitude: 54.158873, country_code: 'AE' },
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
    'AGASI': { ident: 'AGASI', name: 'AGASI', type: 'WAYPOINT', latitude: 15.000000, longitude: -77.200000, country_code: 'JM' }
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
    }

    loadCustomWaypoints() {
        try {
            if (fs.existsSync(this.customWaypointsDbPath)) {
                const data = JSON.parse(fs.readFileSync(this.customWaypointsDbPath, 'utf8'));
                console.log(`[RouteParser] Loaded ${Object.keys(data).length} curated waypoints from custom-global-waypoints.json`);
                return data;
            }
        } catch (e) {
            console.warn('[RouteParser] Error loading custom waypoints database:', e.message);
        }
        return { ...GLOBAL_WAYPOINTS_CATALOG };
    }

    saveCustomWaypoint(waypoint) {
        if (!waypoint || !waypoint.ident || typeof waypoint.latitude !== 'number' || typeof waypoint.longitude !== 'number') {
            throw new Error('Invalid waypoint object: ident, latitude, and longitude are required');
        }
        const ident = waypoint.ident.trim().toUpperCase();
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
            console.log(`[RouteParser] Successfully saved custom waypoint: ${ident} (${waypoint.latitude}, ${waypoint.longitude}) to persistent database`);
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

        // 2. Check dynamic online resolver persistent cache
        const dynFix = dynamicNavDataService.getFix(clean);
        if (dynFix) {
            allCandidates.push(dynFix);
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

        if (allCandidates.length === 1) {
            return allCandidates[0];
        }

        // If reference point is missing, fallback to next coordinates
        const effectiveRefLat = refLat !== null ? refLat : nextLat;
        const effectiveRefLon = refLon !== null ? refLon : nextLon;

        if (effectiveRefLat === null || effectiveRefLon === null) {
            return allCandidates[0];
        }

        let bestCandidate = allCandidates[0];
        let minScore = Infinity;

        for (const cand of allCandidates) {
            const dRef = haversineDistanceM(effectiveRefLat, effectiveRefLon, cand.latitude, cand.longitude);
            const dNext = (nextLat !== null && nextLon !== null) ? haversineDistanceM(cand.latitude, cand.longitude, nextLat, nextLon) : 0;
            const score = dRef + dNext;
            if (score < minScore) {
                minScore = score;
                bestCandidate = cand;
            }
        }

        return bestCandidate;
    }

    async resolvePointAsync(token, refLat = null, refLon = null, isExplicitAirport = false, nextLat = null, nextLon = null, fraction = 0.5) {
        const clean = sanitizeToken(token);
        if (!clean || isSpeedLevelToken(clean) || isNatTrackToken(clean) || clean === 'DCT' || clean === 'DIRECT') return null;

        const local = this.resolvePoint(token, refLat, refLon, isExplicitAirport, nextLat, nextLon);
        
        // If local candidate exists, verify proximity before querying external resolvers
        if (local) {
            if (refLat === null || refLon === null) return local;
            const distNm = haversineDistanceM(refLat, refLon, local.latitude, local.longitude) / 1852;
            if (distNm <= 1800) {
                return local;
            }
        }

        const online = await dynamicNavDataService.resolveOnline(clean, refLat, refLon, nextLat, nextLon, fraction);
        if (online) {
            if (!this.waypointsByIdent[clean]) this.waypointsByIdent[clean] = [];
            this.waypointsByIdent[clean].push(online);
            return online;
        }
        return local || null;
    }

    parseRoute(routeStr, depIcao = null, arrIcao = null, cruisingAltFt = 35000, speedKts = 450, options = {}) {
        const cacheKey = `${depIcao || ''}:${arrIcao || ''}:${routeStr}:${cruisingAltFt}:${speedKts}:${options.include_labels !== false}`;
        if (this.parsedRouteCache && this.parsedRouteCache.has(cacheKey)) {
            return this.parsedRouteCache.get(cacheKey);
        }

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
            .filter(t => t && !isSpeedLevelToken(t) && !isNatTrackToken(t) && t !== 'DCT' && t !== 'DIRECT');

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
            // 4. STANDARD RESOLUTION
            // ═══════════════════════════════════════════════════════════════════
            // Do not resolve standalone airway designators as points
            if (isAirwayDesignator(token)) {
                continue;
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
                let endLon = pt.longitude;
                while (endLon - startLon > 180) endLon -= 360;
                while (endLon - startLon < -180) endLon += 360;

                const segmentCoords = interpolateGreatCircle(prev.latitude, startLon, pt.latitude, endLon, 12);
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
        const cacheKey = `${depIcao || ''}:${arrIcao || ''}:${routeStr}:${cruisingAltFt}:${speedKts}:${options.include_labels !== false}`;
        if (this.parsedRouteCache && this.parsedRouteCache.has(cacheKey)) {
            return this.parsedRouteCache.get(cacheKey);
        }

        const rawStringTokens = (routeStr || '').replace(/[\r\n\t]+/g, ' ').split(' ').filter(t => t.trim());

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
            .filter(t => t && !isSpeedLevelToken(t) && !isNatTrackToken(t) && t !== 'DCT' && t !== 'DIRECT');

        let depPoint = null;
        let arrPoint = null;

        const firstToken = cleanTokens[0];
        const lastToken = cleanTokens[cleanTokens.length - 1];

        const NON_AIRPORT_STATUSES = ['ENROUTE', 'RAMP', '???', 'STANDBY', 'DIRECT'];

        if (depIcao && !NON_AIRPORT_STATUSES.includes(depIcao.toUpperCase())) {
            depPoint = await this.resolvePointAsync(depIcao, null, null, true);
        } else if (firstToken && firstToken.length === 4 && this.airports[firstToken]) {
            depPoint = await this.resolvePointAsync(firstToken, null, null, true);
        }

        if (arrIcao && !NON_AIRPORT_STATUSES.includes(arrIcao.toUpperCase())) {
            arrPoint = await this.resolvePointAsync(arrIcao, null, null, true);
        } else if (lastToken && lastToken.length === 4 && this.airports[lastToken]) {
            arrPoint = await this.resolvePointAsync(lastToken, null, null, true);
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

            // 1. SID EXPANSION
            const sidKey = depPoint ? `${depPoint.ident}_${token}` : token;
            const sidProc = this.sidsStructured[sidKey] || Object.values(this.sidsStructured).find(s => s.procedure === token);

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
                    const pt = await this.resolvePointAsync(fixName, currentRefLat, currentRefLon);
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
                    const pt = await this.resolvePointAsync(fixName, currentRefLat, currentRefLon);
                    if (pt) {
                        pt.via_procedure = `STAR: ${token}${arrRwy ? ` (RW${arrRwy})` : ''}`;
                        resolvedPoints.push(pt);
                        currentRefLat = pt.latitude;
                        currentRefLon = pt.longitude;
                    }
                }
                continue;
            }

            // 3. AIRWAY EXPANSION
            if ((this.airways[token] || isAirwayDesignator(token)) && resolvedPoints.length > 0 && i + 1 < cleanTokens.length) {
                const prevPoint = resolvedPoints[resolvedPoints.length - 1];
                const nextToken = cleanTokens[i + 1];
                const nextPointCandidate = await this.resolvePointAsync(nextToken, prevPoint.latitude, prevPoint.longitude);

                if (nextPointCandidate) {
                    const airwayLegs = this.airways[token];
                    if (Array.isArray(airwayLegs)) {
                        const prevIdx = airwayLegs.findIndex(leg => leg.fixIdent === prevPoint.ident);
                        const nextIdx = airwayLegs.findIndex(leg => leg.fixIdent === nextPointCandidate.ident);

                        if (prevIdx !== -1 && nextIdx !== -1 && prevIdx !== nextIdx) {
                            const step = prevIdx < nextIdx ? 1 : -1;
                            for (let k = prevIdx + step; k !== nextIdx; k += step) {
                                const intermediateFix = await this.resolvePointAsync(airwayLegs[k].fixIdent, prevPoint.latitude, prevPoint.longitude);
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
            if (isAirwayDesignator(token)) {
                continue;
            }

            // Look ahead for next coordinate to provide geodesic bounds if needed
            let nextCandidateLat = arrPoint ? arrPoint.latitude : null;
            let nextCandidateLon = arrPoint ? arrPoint.longitude : null;
            let gapCount = 1;
            for (let j = i + 1; j < cleanTokens.length; j++) {
                const nextPt = this.resolvePoint(cleanTokens[j], currentRefLat, currentRefLon);
                if (nextPt) {
                    nextCandidateLat = nextPt.latitude;
                    nextCandidateLon = nextPt.longitude;
                    gapCount = (j - i) + 1;
                    break;
                }
            }
            const fraction = 1 / gapCount;

            const point = await this.resolvePointAsync(token, currentRefLat, currentRefLon, false, nextCandidateLat, nextCandidateLon, fraction);
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
                let endLon = pt.longitude;
                while (endLon - startLon > 180) endLon -= 360;
                while (endLon - startLon < -180) endLon += 360;

                const segmentCoords = interpolateGreatCircle(prev.latitude, startLon, pt.latitude, endLon, 12);
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
                country_code: pt.country_code,
                segment_distance_nm: segmentDistanceNm,
                segment_bearing_deg: segmentBearingDeg,
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

        // 2. Anomaly & Detour Analysis across each intermediate waypoint
        for (let i = 1; i < wps.length - 1; i++) {
            const prev = wps[i - 1];
            const curr = wps[i];
            const next = wps[i + 1];

            const dDirect = haversineDistanceM(prev.latitude, prev.longitude, next.latitude, next.longitude) / 1852;
            const dVia = (haversineDistanceM(prev.latitude, prev.longitude, curr.latitude, curr.longitude) +
                          haversineDistanceM(curr.latitude, curr.longitude, next.latitude, next.longitude)) / 1852;
            const detourNm = dVia - dDirect;

            // Anomaly condition: Detour > 250 NM or path detour ratio > 2.0
            const isDetourAnomaly = detourNm > 250 || (dVia > dDirect * 2 && detourNm > 100);
            const isInterpolated = curr.id && String(curr.id).startsWith('INTERP_');

            if (isDetourAnomaly || isInterpolated) {
                issuesFound.push({
                    index: i,
                    ident: curr.ident,
                    type: curr.type,
                    current_lat: curr.latitude,
                    current_lon: curr.longitude,
                    detour_nm: Math.round(detourNm),
                    reason: isDetourAnomaly ? `Excessive corridor detour (${Math.round(detourNm)} NM)` : `Interpolated placeholder fix`
                });

                // 3. Search for optimal global replacement candidate along prev <-> next line
                const clean = sanitizeToken(curr.ident);
                const candidates = [];

                if (this.navaidsByIdent[clean]) candidates.push(...this.navaidsByIdent[clean]);
                if (this.waypointsByIdent[clean]) candidates.push(...this.waypointsByIdent[clean]);
                if (GLOBAL_WAYPOINTS_CATALOG[clean]) candidates.push(GLOBAL_WAYPOINTS_CATALOG[clean]);

                let bestCandidate = null;
                let minCandidateDetour = detourNm;

                for (const cand of candidates) {
                    const candDVia = (haversineDistanceM(prev.latitude, prev.longitude, cand.latitude, cand.longitude) +
                                      haversineDistanceM(cand.latitude, cand.longitude, next.latitude, next.longitude)) / 1852;
                    const candDetour = candDVia - dDirect;
                    if (candDetour < minCandidateDetour) {
                        minCandidateDetour = candDetour;
                        bestCandidate = cand;
                    }
                }

                // If no local candidate improves the route, attempt online scraper probe
                if (!bestCandidate || minCandidateDetour > 200) {
                    try {
                        const onlineFix = await dynamicNavDataService.resolveOnline(clean, prev.latitude, prev.longitude, next.latitude, next.longitude);
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

                // 4. If a significantly better candidate was discovered, persist to database
                if (bestCandidate && (detourNm - minCandidateDetour >= 50 || isInterpolated)) {
                    this.saveCustomWaypoint(clean, {
                        ident: clean,
                        name: bestCandidate.name || clean,
                        type: bestCandidate.type || 'WAYPOINT',
                        latitude: bestCandidate.latitude,
                        longitude: bestCandidate.longitude,
                        country_code: bestCandidate.country_code || null,
                        elevation_ft: bestCandidate.elevation_ft || null
                    });

                    fixesRepaired.push({
                        ident: clean,
                        name: bestCandidate.name || clean,
                        country_code: bestCandidate.country_code || null,
                        previous_coords: { lat: curr.latitude, lon: curr.longitude },
                        corrected_coords: { lat: bestCandidate.latitude, lon: bestCandidate.longitude },
                        distance_saved_nm: Math.round(detourNm - minCandidateDetour)
                    });
                }
            }
        }

        // 5. Re-parse route if any fixes were updated
        if (this.parsedRouteCache) this.parsedRouteCache.clear();
        const finalResult = await this.parseRouteAsync(routeStr, null, null, 35000, 450, options);
        const distanceSaved = Math.max(0, Math.round((initial.total_distance_nm - finalResult.total_distance_nm) * 10) / 10);

        return {
            ...finalResult,
            original_distance_nm: initial.total_distance_nm,
            distance_saved_nm: distanceSaved,
            issues_found: issuesFound,
            fixes_repaired: fixesRepaired,
            status: fixesRepaired.length > 0 ? 'REPAIRED' : (issuesFound.length > 0 ? 'ANOMALIES_DETECTED' : 'OPTIMAL')
        };
    }
}

module.exports = RouteParser;
