/**
 * AeroNav Global Embeddable Radar Engine
 * Clean, lightweight, standalone 60FPS telemetry glide & multi-target tracking SDK
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ⚙️ INITIALIZATION & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1541538696329691186/KV15a40LEm4SDnlBGI05vMok-k7Jw04CxrH0C7xRksvE6jm3qJgS96dKCpFYMCzkAZlN';

const urlParams = new URLSearchParams(window.location.search);
const config = {
    apiKey: urlParams.get('api_key') || urlParams.get('key') || '',
    vatsim: urlParams.get('vatsim') || '',
    fshubToken: urlParams.get('fshub_token') || urlParams.get('token') || '',
    fshub: urlParams.get('fshub') || '',
    ivao: urlParams.get('ivao') || '',
    route: urlParams.get('route') || '',
    discordWebhook: urlParams.get('discord_webhook') || urlParams.get('webhook') || DEFAULT_DISCORD_WEBHOOK,
    pollIntervalMs: parseInt(urlParams.get('interval') || '4000', 10),
    style: urlParams.get('style') || 'dark'
};

let map = null;
let tileLayer = null;
let currentTileStyle = 'dark';
let activeRouteLayer = null;
let activeWaypointsLayerGroup = null;
let activeRouteData = null;
let selectedPilotId = null;
let initialBoundsFitted = false;

// Aircraft tracking buffers
const fleetBuffers = new Map();
let motionAnimId = null;
let pollTimerId = null;

const DEFAULT_MB = atob('cGsuZXlKMUlqb2liWGwwWldOb2NtVjJhV1YzSWl3aVlTSTZJbU50YTNJM2JXTjVlVEJpTnpBelpuQjFkM3BuTm1WMWFXMGlmUS5lM1A2MG9ybF93U0NVYjUtMVJKR3pn');
const MAPBOX_TOKEN = urlParams.get('mapbox_token') || DEFAULT_MB;

// Tile Layer URLs (Mapbox Dark Black View default)
const TILE_STYLES = {
    dark: `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`,
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    voyager: `https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`
};

const AIRLINE_ICAO_DATABASE = {
    'WLF': { name: 'Wolfair Aviation', isVa: true, callsign: 'WOLFAIR' },
    'WVA': { name: 'Wolfair Aviation', isVa: true, callsign: 'WOLFAIR' },
    'VAA': { name: 'Virtual Airlines of America', isVa: true, callsign: 'VIRTFLEET' },
    'AAL': { name: 'American Airlines', country: 'US', callsign: 'AMERICAN' },
    'UAL': { name: 'United Airlines', country: 'US', callsign: 'UNITED' },
    'DAL': { name: 'Delta Air Lines', country: 'US', callsign: 'DELTA' },
    'SWA': { name: 'Southwest Airlines', country: 'US', callsign: 'SOUTHWEST' },
    'BAW': { name: 'British Airways', country: 'GB', callsign: 'SPEEDBIRD' },
    'AFR': { name: 'Air France', country: 'FR', callsign: 'AIRFRANS' },
    'DLH': { name: 'Lufthansa', country: 'DE', callsign: 'LUFTHANSA' },
    'KLM': { name: 'KLM Royal Dutch Airlines', country: 'NL', callsign: 'KLM' },
    'UAE': { name: 'Emirates', country: 'AE', callsign: 'EMIRATES' },
    'QFA': { name: 'Qantas', country: 'AU', callsign: 'QANTAS' },
    'ACA': { name: 'Air Canada', country: 'CA', callsign: 'AIR CANADA' },
    'AMX': { name: 'Aeroméxico', country: 'MX', callsign: 'AEROMEXICO' },
    'AVA': { name: 'Avianca', country: 'CO', callsign: 'AVIANCA' },
    'LAN': { name: 'LATAM Airlines', country: 'CL', callsign: 'LAN' },
    'CMP': { name: 'Copa Airlines', country: 'PA', callsign: 'COPA' },
    'IBE': { name: 'Iberia', country: 'ES', callsign: 'IBERIA' },
    'VIR': { name: 'Virgin Atlantic', country: 'GB', callsign: 'VIRGIN' },
    'JAL': { name: 'Japan Airlines', country: 'JP', callsign: 'JAPANAIR' },
    'ANA': { name: 'All Nippon Airways', country: 'JP', callsign: 'ALL NIPPON' },
    'CPA': { name: 'Cathay Pacific', country: 'HK', callsign: 'CATHAY' },
    'SIA': { name: 'Singapore Airlines', country: 'SG', callsign: 'SINGAPORE' },
    'QTR': { name: 'Qatar Airways', country: 'QA', callsign: 'QATARI' },
    'THY': { name: 'Turkish Airlines', country: 'TR', callsign: 'TURKISH' },
    'WJA': { name: 'WestJet', country: 'CA', callsign: 'WESTJET' },
    'JBU': { name: 'JetBlue', country: 'US', callsign: 'JETBLUE' },
    'FFT': { name: 'Frontier Airlines', country: 'US', callsign: 'FRONTIER FLIGHT' },
    'NKS': { name: 'Spirit Airlines', country: 'US', callsign: 'SPIRIT WINGS' },
    'ASA': { name: 'Alaska Airlines', country: 'US', callsign: 'ALASKA' },
    'VOI': { name: 'Volaris', country: 'MX', callsign: 'VOLARIS' },
    'AZU': { name: 'Azul Brazilian Airlines', country: 'BR', callsign: 'AZUL' },
    'GLO': { name: 'GOL Linhas Aéreas', country: 'BR', callsign: 'GOL' },
    'TAP': { name: 'TAP Air Portugal', country: 'PT', callsign: 'AIR PORTUGAL' },
    'SAS': { name: 'Scandinavian Airlines', country: 'SE', callsign: 'SCANDINAVIAN' },
    'FIN': { name: 'Finnair', country: 'FI', callsign: 'FINNAIR' },
    'RYR': { name: 'Ryanair', country: 'IE', callsign: 'RYANAIR' },
    'EZY': { name: 'easyJet', country: 'GB', callsign: 'EASY' },
    'WZZ': { name: 'Wizz Air', country: 'HU', callsign: 'WIZZ AIR' },
    'FDX': { name: 'FedEx Express', country: 'US', callsign: 'FEDEX' },
    'UPS': { name: 'UPS Airlines', country: 'US', callsign: 'UPS' },
    'GTI': { name: 'Atlas Air', country: 'US', callsign: 'GIANT' },
    'CLX': { name: 'Cargolux', country: 'LU', callsign: 'CARGOLUX' },
    'BOX': { name: 'AeroLogic', country: 'DE', callsign: 'GERMAN CARGO' },
    'ABX': { name: 'ABX Air', country: 'US', callsign: 'ABEX' },
    'ETD': { name: 'Etihad Airways', country: 'AE', callsign: 'ETIHAD' },
    'KAC': { name: 'Kuwait Airways', country: 'KW', callsign: 'KUWAITI' },
    'MSR': { name: 'EgyptAir', country: 'EG', callsign: 'EGYPTAIR' },
    'SVA': { name: 'Saudia', country: 'SA', callsign: 'SAUDIA' },
    'AIC': { name: 'Air India', country: 'IN', callsign: 'AIRINDIA' },
    'KAL': { name: 'Korean Air', country: 'KR', callsign: 'KOREANAIR' },
    'EVA': { name: 'EVA Air', country: 'TW', callsign: 'EVA' },
    'ANZ': { name: 'Air New Zealand', country: 'NZ', callsign: 'NEW ZEALAND' },
    'VOZ': { name: 'Virgin Australia', country: 'AU', callsign: 'VELOCITY' },
    'ETH': { name: 'Ethiopian Airlines', country: 'ET', callsign: 'ETHIOPIAN' },
    'ARG': { name: 'Aerolíneas Argentinas', country: 'AR', callsign: 'ARGENTINA' },
    'SWR': { name: 'Swiss International Air Lines', country: 'CH', callsign: 'SWISS' },
    'AUA': { name: 'Austrian Airlines', country: 'AT', callsign: 'AUSTRIAN' },
    'LOT': { name: 'LOT Polish Airlines', country: 'PL', callsign: 'POLLOT' }
};

function resolveAirlineInfo(callsign, flightData = null) {
    if (!callsign && !flightData) return null;
    const cs = String(callsign || flightData?.callsign || '').toUpperCase().trim();

    if (flightData?.airline) {
        const vaName = flightData.airline.name || flightData.airline.title || '';
        const vaAbbr = (flightData.airline.abbr || flightData.airline.code || '').toUpperCase();
        if (vaName) {
            const isVa = flightData.airline.is_va !== false;
            return {
                name: isVa ? `${vaName} VA` : vaName,
                abbr: vaAbbr || cs.slice(0, 3),
                isVa: isVa,
                badge: `${vaAbbr ? vaAbbr + ' • ' : ''}${vaName}${isVa ? ' VA' : ''}`
            };
        }
    }

    const match = cs.match(/^([A-Z]{3})/);
    if (match) {
        const icao3 = match[1];
        if (AIRLINE_ICAO_DATABASE[icao3]) {
            const entry = AIRLINE_ICAO_DATABASE[icao3];
            const isVa = !!entry.isVa;
            return {
                name: isVa ? `${entry.name} VA` : entry.name,
                abbr: icao3,
                isVa: isVa,
                badge: `${icao3} • ${entry.name}${isVa ? ' VA' : ''}`
            };
        }
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ✈️ AIRCRAFT TYPE CLASSIFIER & SVG RENDERER (IDENTICAL TO MAIN API WEB APP)
// ═══════════════════════════════════════════════════════════════════════════════

function classifyAircraftType(rawIcao, routeStr = '') {
    if (!rawIcao) return { icao: '', name: '', category: 'NARROWBODY_TWIN', label: '', size: 32, haloSize: 36 };

    let cleanIcao = typeof rawIcao === 'object' ? (rawIcao.icao || rawIcao.name || rawIcao.type || '') : String(rawIcao);
    cleanIcao = cleanIcao.trim().toUpperCase();
    if (!cleanIcao || cleanIcao === '[OBJECT OBJECT]' || cleanIcao.includes('OBJECT') || cleanIcao === 'UNKNOWN' || cleanIcao === 'AIRCRAFT' || cleanIcao === 'PLANE' || cleanIcao === '****') {
        return { icao: '', name: '', category: 'NARROWBODY_TWIN', label: '', size: 32, haloSize: 36 };
    }

    const rawUpper = `${cleanIcao} ${String(routeStr || '').toUpperCase()}`;

    // 1. Helicopters
    if (
        /(^|\b|_|-)(H1[2345][05]|H225|EC[1234][0-9]{2}|AS3[56][0-9]|B06|B407|B429|S76|S92|UH60|AH64|CH47|R22|R44|R66|AW1[0368]9|A109|MD50|BK117)(\b|_|-|$)/i.test(rawUpper) ||
        rawUpper.includes('ROTOR') || rawUpper.includes('COPTER') || rawUpper.includes('HELI')
    ) {
        return {
            icao: cleanIcao || 'HELI',
            name: `Helicopter (${cleanIcao || 'Rotorcraft'})`,
            category: 'HELICOPTER',
            label: `🚁 ${cleanIcao || 'Rotorcraft'}`,
            size: 32,
            haloSize: 36
        };
    }

    // 2. 4-Engine Heavy Jets
    if (
        /(^|\b|_|-)(B74[1-8]|A34[2-6]|A388|AN22|A124|A225|IL76|IL96|BA46|B46[1-3]|RJ[78][0-9]|RJ100|B52|C5M)(\b|_|-|$)/i.test(rawUpper) ||
        rawUpper.includes('747') || rawUpper.includes('380') || rawUpper.includes('340') || rawUpper.includes('ANTONOV')
    ) {
        return {
            icao: cleanIcao || 'B744',
            name: `Heavy Quad-Jet (${cleanIcao || 'B747'})`,
            category: 'HEAVY_4_JET',
            label: `✈️ Heavy Quad-Jet (${cleanIcao})`,
            size: 44,
            haloSize: 48
        };
    }

    // 3. Widebody Twin Jets
    if (
        /(^|\b|_|-)(B77[2389W]|B78[89X]|A35[9K]|A33[2389]|B76[234]|DC10|MD11|L101)(\b|_|-|$)/i.test(rawUpper) ||
        rawUpper.includes('777') || rawUpper.includes('787') || rawUpper.includes('350') || rawUpper.includes('330') || rawUpper.includes('767')
    ) {
        return {
            icao: cleanIcao || 'B772',
            name: `Widebody Twin (${cleanIcao || 'B777'})`,
            category: 'WIDEBODY_TWIN',
            label: `✈️ Widebody Twin (${cleanIcao})`,
            size: 38,
            haloSize: 42
        };
    }

    // 4. Regional Rear-Engine Jets
    if (
        /(^|\b|_|-)(CRJ[1279X]|E145|E135|MD8[0-8]|MD90|B712|F70|F100|F28)(\b|_|-|$)/i.test(rawUpper) ||
        rawUpper.includes('CRJ') || rawUpper.includes('MD8') || rawUpper.includes('MD-8')
    ) {
        return {
            icao: cleanIcao || 'CRJ',
            name: `Regional Jet (${cleanIcao || 'CRJ'})`,
            category: 'REAR_ENGINE_JET',
            label: `✈️ Regional Jet (${cleanIcao})`,
            size: 28,
            haloSize: 32
        };
    }

    // 5. Business Jets
    if (
        /(^|\b|_|-)(GLF[2-7]|GLEX|C5[0-9]{2}|C680|C700|C750|CL3[05]|CL60|E55P|E50P|FA[578]X|FA50|LJ[2-7][0-9]|HA420|PC24|HONDA|LEARJET|CITATION|FALCON|GULFSTREAM|PHENOM)(\b|_|-|$)/i.test(rawUpper)
    ) {
        return {
            icao: cleanIcao || 'BIZJET',
            name: `Business Jet (${cleanIcao || 'Citation'})`,
            category: 'BIZJET',
            label: `✈️ Business Jet (${cleanIcao})`,
            size: 26,
            haloSize: 30
        };
    }

    // 6. Turboprops
    if (
        /(^|\b|_|-)(DH8[A-D]|AT7[256]|AT4[2356]|B350|BE20|BE99|BE19|SW4|C402|C414|PA31|PA34|PA44|DA42|DA62|DO228|DO328|DHC[2-7]|BN2P|JS[34][0-9]|L410|SF34|SB20|AT72|AT76|DASH)(\b|_|-|$)/i.test(rawUpper) ||
        rawUpper.includes('KING AIR') || rawUpper.includes('TWIN OTTER') || rawUpper.includes('CARAVAN') || rawUpper.includes('ATR')
    ) {
        return {
            icao: cleanIcao || 'TURBOPROP',
            name: `Turboprop (${cleanIcao || 'King Air'})`,
            category: 'TURBOPROP',
            label: `🛩️ Turboprop (${cleanIcao})`,
            size: 30,
            haloSize: 34
        };
    }

    // 7. Single Engine Light GA
    if (
        /(^|\b|_|-)(C1[578][0-9]|C20[68]|PA28|PA32|PA46|SR2[02]|DA40|DA20|M20[A-Z]|PC12|TBM[789]|RV[4-9]|RV1[024]|EXTRA|CAP10|DR40|AA5|P28A|C172|C182|PIPER|CESSNA|CIRRUS|MOONEY|BEECH)(\b|_|-|$)/i.test(rawUpper)
    ) {
        return {
            icao: cleanIcao || 'C172',
            name: `Light GA (${cleanIcao || 'Cessna'})`,
            category: 'SINGLE_PROP',
            label: `🛩️ Light GA (${cleanIcao})`,
            size: 22,
            haloSize: 26
        };
    }

    // 8. Military Fighters
    if (
        /(^|\b|_|-)(F1[4-8]|F22|F35|EF20|TYPH|EUFI|M200|SU[23][0-9]|MIG[23][0-9]|AV8B|A10|T38|HAWK|GRIPEN|RAFALE)(\b|_|-|$)/i.test(rawUpper)
    ) {
        return {
            icao: cleanIcao || 'F18',
            name: `Fighter Jet (${cleanIcao || 'Military'})`,
            category: 'MILITARY',
            label: `🚀 Fighter (${cleanIcao})`,
            size: 28,
            haloSize: 32
        };
    }

    // Fallback: Narrowbody Twin Jet (A320 / B738)
    return {
        icao: cleanIcao || '',
        name: cleanIcao ? `${cleanIcao}` : '',
        category: 'NARROWBODY_TWIN',
        label: cleanIcao ? `✈️ ${cleanIcao}` : '',
        size: 32,
        haloSize: 36
    };
}

function getAircraftSvgContent(category, color) {
    switch (category) {
        case 'HELICOPTER':
            return `
                <svg viewBox="0 0 32 32" width="100%" height="100%">
                    <g transform="rotate(30, 16, 12)">
                        <line x1="2" y1="12" x2="30" y2="12" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
                        <line x1="16" y1="-2" x2="16" y2="26" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
                        <circle cx="16" cy="12" r="2.2" fill="#ffffff"/>
                    </g>
                    <path d="M16 2.5 C13.5 2.5 12.2 5.5 12.2 10 C12.2 14.5 13.8 17.5 14.8 20.5 L15.2 27.5 L16.8 27.5 L17.2 20.5 C18.2 17.5 19.8 14.5 19.8 10 C19.8 5.5 18.5 2.5 16 2.5 Z" fill="${color}"/>
                    <path d="M14.6 4.5 C15.2 3.8 16.8 3.8 17.4 4.5 C17.9 5.8 17.7 7.2 16 7.2 C14.3 7.2 14.1 5.8 14.6 4.5 Z" fill="#ffffff" opacity="0.85"/>
                    <rect x="8.5" y="7.5" width="2" height="9.5" rx="1" fill="${color}"/>
                    <rect x="21.5" y="7.5" width="2" height="9.5" rx="1" fill="${color}"/>
                    <line x1="9" y1="10.5" x2="12.5" y2="10.5" stroke="${color}" stroke-width="1.6"/>
                    <line x1="19.5" y1="10.5" x2="23" y2="10.5" stroke="${color}" stroke-width="1.6"/>
                    <line x1="9" y1="14" x2="13.5" y2="14" stroke="${color}" stroke-width="1.6"/>
                    <line x1="18.5" y1="14" x2="23" y2="14" stroke="${color}" stroke-width="1.6"/>
                    <rect x="11.5" y="24" width="9" height="1.8" rx="0.9" fill="${color}"/>
                    <rect x="17.2" y="25.5" width="4.5" height="1.6" rx="0.8" fill="#ffffff"/>
                    <rect x="17.2" y="23" width="1.6" height="6.6" rx="0.8" fill="${color}"/>
                </svg>
            `;

        case 'HEAVY_4_JET':
            return `
                <svg viewBox="0 0 64 64" width="100%" height="100%">
                    <path d="m 30.764,3.957 c -1.030,1.995 -1.438,5.650 -1.600,7.687 -0.248,3.120 -0.114,5.478 -0.156,7.568 -0.016,0.798 -0.737,1.483 -1.435,2.163 l -4.630,4.207 c 0.136,-0.609 0.313,-2.735 0.011,-3.413 l -2.147,-0.067 c -0.337,0.636 -0.227,2.516 -0.102,3.486 l 0.414,0.033 0.179,1.447 -5.794,5.342 c 0.077,-0.914 0.114,-2.161 -0.105,-2.633 l -2.172,-0.078 c -0.367,0.716 -0.185,2.323 -0.053,3.475 h 0.394 l 0.138,0.949 -7.991,6.563 C 5.411,40.937 5.586,41.437 5.564,41.830 l -0.694,2.353 0.005,0.991 0.715,-1.236 10.464,-6.218 c 0.012,0.663 0.110,1.051 0.231,1.010 0.135,-0.045 0.328,-0.852 0.361,-1.290 l 2.274,-1.389 c -0.003,0.493 0.054,1.174 0.196,1.088 0.126,-0.076 0.384,-0.807 0.362,-1.370 l 1.528,-0.943 2.988,-1.018 c 0.073,0.381 0.122,0.929 0.292,0.896 0.159,-0.031 0.257,-0.491 0.355,-1.065 l 1.704,-0.597 c 0.025,0.437 0.163,0.976 0.297,0.914 0.149,-0.070 0.339,-0.647 0.356,-1.118 l 1.935,-0.666 0.054,10.106 c 0.183,3.800 0.173,5.797 0.919,9.127 -0.072,0.573 -0.374,0.766 -0.640,1.020 l -6.724,6.317 -0.007,2.046 8.553,-2.312 c 0.019,0.586 0.061,1.045 0.432,1.368 l 0.146,1.817 0.146,-1.817 c 0.371,-0.323 0.413,-0.782 0.432,-1.368 l 8.553,2.312 -0.007,-2.046 -6.724,-6.317 c -0.266,-0.253 -0.569,-0.446 -0.640,-1.020 0.747,-3.331 0.736,-5.327 0.919,-9.127 l 0.054,-10.106 1.935,0.666 c 0.017,0.470 0.207,1.048 0.356,1.118 0.134,0.062 0.272,-0.477 0.297,-0.914 l 1.704,0.597 c 0.098,0.574 0.196,1.034 0.355,1.065 0.170,0.033 0.219,-0.515 0.292,-0.896 l 2.988,1.018 1.528,0.943 c -0.021,0.563 0.237,1.294 0.362,1.370 0.141,0.086 0.198,-0.595 0.196,-1.088 l 2.274,1.389 c 0.033,0.439 0.227,1.245 0.361,1.290 0.121,0.041 0.219,-0.347 0.231,-1.010 l 10.464,6.218 0.715,1.236 0.005,-0.991 -0.694,-2.353 c -0.021,-0.393 0.153,-0.893 -0.151,-1.143 l -7.991,-6.563 0.138,-0.949 h 0.394 c 0.132,-1.152 0.314,-2.760 -0.053,-3.475 l -2.172,0.078 c -0.218,0.472 -0.182,1.719 -0.105,2.633 l -5.794,-5.342 0.179,-1.447 0.414,-0.033 c 0.125,-0.970 0.236,-2.850 -0.102,-3.486 l -2.147,0.067 c -0.302,0.678 -0.125,2.804 0.011,3.413 l -4.630,-4.207 c -0.698,-0.680 -1.419,-1.365 -1.435,-2.163 -0.042,-2.090 0.092,-4.448 -0.156,-7.568 -0.162,-2.037 -0.600,-5.677 -1.600,-7.687 -0.592,-1.190 -1.211,-1.157 -1.809,0 z" fill="${color}"/>
                </svg>
            `;

        case 'WIDEBODY_TWIN':
            return `
                <svg viewBox="0 -3.2 64.2 64.2" width="100%" height="100%">
                    <path d="m 31.414,2.728 c -0.314,0.712 -1.296,2.377 -1.534,6.133 l -0.086,13.379 c 0.006,0.400 -0.380,0.888 -0.945,1.252 l -2.631,1.729 c 0.157,-0.904 0.237,-3.403 -0.162,-3.850 l -2.686,0.006 c -0.336,1.065 -0.358,2.518 -0.109,4.088 h 0.434 L 24.057,26.689 8.611,36.852 7.418,38.432 7.381,39.027 8.875,38.166 l 8.295,-2.771 0.072,0.730 0.156,-0.004 0.150,-0.859 3.799,-1.234 0.074,0.727 0.119,0.004 0.117,-0.832 2.182,-0.730 h 1.670 l 0.061,0.822 h 0.176 l 0.062,-0.822 4.018,-0.002 v 13.602 c 0.051,1.559 0.465,3.272 0.826,4.963 l -6.836,5.426 c -0.097,0.802 -0.003,1.372 0.049,1.885 l 7.734,-2.795 0.477,1.973 h 0.232 l 0.477,-1.973 7.736,2.795 c 0.052,-0.513 0.146,-1.083 0.049,-1.885 l -6.836,-5.426 c 0.361,-1.691 0.775,-3.404 0.826,-4.963 V 33.193 l 4.016,0.002 0.062,0.822 h 0.178 L 38.875,33.195 h 1.672 l 2.182,0.730 0.117,0.832 0.119,-0.004 0.072,-0.727 3.799,1.234 0.152,0.859 0.154,0.004 0.072,-0.730 8.297,2.771 1.492,0.861 -0.037,-0.596 -1.191,-1.580 -15.447,-10.162 0.363,-1.225 H 41.125 c 0.248,-1.569 0.225,-3.023 -0.111,-4.088 l -2.686,-0.006 c -0.399,0.447 -0.317,2.945 -0.160,3.850 L 35.535,23.492 C 34.970,23.128 34.584,22.640 34.590,22.240 L 34.504,8.910 C 34.193,4.926 33.369,3.602 32.934,2.722 32.442,1.732 31.894,1.828 31.414,2.728 Z" fill="${color}"/>
                </svg>
            `;

        case 'REAR_ENGINE_JET':
        case 'BIZJET':
            return `
                <svg viewBox="-1 -1 20 26" width="100%" height="100%">
                    <path d="M9.44,23c-.1.6-.35.6-.44.6s-.34,0-.44-.6l-3,.67V22.6A.54.54,0,0,1,6,22.05l2.38-1.12L8,19.33H6.69l0-.2a8.23,8.23,0,0,1-.14-3.85l.06-.18H7.73V13.19h-2L.26,14.29v-.93c0-.28.07-.46.22-.53l7.25-3.6V3.85A4.47,4.47,0,0,1,8.83.49L9,.34l.17.15a4.47,4.47,0,0,1,1.1,3.36V9.23l7.25,3.6c.14.07.22.25.22.53v.93l-5.51-1.1h-2V15.1h1.17l.06.18a8.24,8.24,0,0,1-.15,3.84l0,.2H10l-.36,1.6,2.43,1.14a.52.52,0,0,1,.35.53v1.08Z" fill="${color}"/>
                </svg>
            `;

        case 'TURBOPROP':
            return `
                <svg viewBox="-2 -3 25 25" width="100%" height="100%">
                    <path d="M10.1,18.34H7l0-.21c-.08-.54,0-.87.11-1L7.19,17l.2,0,2.35-.33c-.16-.82-.42-2.9-.42-3.14s0-2.71,0-3.51H8c-.12,1.34-.41,1.36-.55,1.37h0c-.19,0-.46,0-.6-1.55L.27,9.52l0-.25c.06-.73.31-.9.45-.93l6-.48a3.65,3.65,0,0,1,.3-2,.45.45,0,0,1,.32-.16h0a.39.39,0,0,1,.3.12A3.67,3.67,0,0,1,8,7.77l1.26-.07c0-.71,0-2.92,0-4.48A3.84,3.84,0,0,1,10.1.4a.4.4,0,0,1,.28-.16h.23A.4.4,0,0,1,10.9.4a3.84,3.84,0,0,1,.87,2.81c0,1.55,0,3.77,0,4.48L13,7.77a3.67,3.67,0,0,1,.29-1.94.38.38,0,0,1,.28-.12.46.46,0,0,1,.34.16,3.66,3.66,0,0,1,.3,2l6,.48c.18,0,.43.21.49.94l0,.25-6.53.3c-.14,1.55-.42,1.55-.59,1.55s-.45,0-.57-1.37H11.74c0,.8,0,3.27,0,3.51s-.26,2.32-.42,3.14l2.38.34h.11l.13.13c.15.18.19.51.11,1l0,.21H10.9l-.4,1Z" fill="${color}"/>
                </svg>
            `;

        case 'SINGLE_PROP':
            return `
                <svg viewBox="0 -1 32 31" width="100%" height="100%">
                    <path d="M16.36 20.96l2.57.27s.44.05.4.54l-.02.63s-.03.47-.45.54l-2.31.34-.44-.74-.22 1.63-.25-1.62-.38.73-2.35-.35s-.44-.1-.43-.6l-.02-.6s0-.5.48-.5l2.5-.27-.56-5.4-3.64-.1-5.83-1.02h-.45v-2.06s-.07-.37.46-.34l5.8-.17 3.55.12s-.1-2.52.52-2.82l-1.68-.04s-.1-.06 0-.14l1.94-.03s.35-1.18.7 0l1.91.04s.11.05 0 .14l-1.7.02s.62-.09.56 2.82l3.54-.1 5.81.17s.51-.04.48.35l-.01 2.06h-.47l-5.8 1-3.67.11z" fill="${color}"/>
                </svg>
            `;

        case 'MILITARY':
            return `
                <svg viewBox="-7.8 0 80 80" width="100%" height="100%">
                    <path d="M 30.82,61.32 29.19,54.84 29.06,60.19 27.70,60.70 22.27,60.63 21.68,59.60 l -0.01,-2.71 6.26,-5.52 -0.03,-3.99 -13.35,-0.01 -3e-6,1.15 -1.94,0.00 -0.01,-1.31 0.68,-0.65 L 13.30,37.20 c -0.01,-0.71 0.57,-0.77 0.60,0 l 0.05,1.57 0.28,0.23 0.26,4.09 L 19.90,38.48 c 0,0 -0.04,-1.26 0.20,-1.28 0.16,-0.02 0.20,0.98 0.20,0.98 l 4.40,-3.70 c 0,0 0.02,-1.28 0.20,-1.28 0.14,-0.00 0.20,0.98 0.20,0.98 l 1.80,-1.54 C 27.02,28.77 28.82,25.58 29,21.20 c 0.06,-1.41 0.23,-3.34 0.86,-3.85 0.21,-4.40 1.32,-11.03 2.39,-11.03 1.07,0 2.17,6.64 2.39,11.03 0.63,0.51 0.80,2.45 0.86,3.85 0.18,4.38 1.98,7.57 2.10,11.44 l 1.80,1.54 c 0,0 0.06,-0.99 0.20,-0.98 0.18,0.01 0.20,1.28 0.20,1.28 l 4.40,3.70 c 0,0 0.04,-1.00 0.20,-0.98 0.24,0.03 0.20,1.28 0.20,1.28 l 5.41,4.60 0.26,-4.09 0.28,-0.23 L 50.59,37.20 c 0.03,-0.77 0.61,-0.71 0.60,0 l 0.02,9.37 0.68,0.65 -0.01,1.31 -1.94,-0.00 -3e-6,-1.15 -13.35,0.01 -0.03,3.99 6.26,5.52 L 42.81,59.60 42.22,60.63 36.79,60.70 35.43,60.19 35.30,54.84 33.67,61.32 Z" fill="${color}"/>
                </svg>
            `;

        case 'NARROWBODY_TWIN':
        default:
            return `
                <svg viewBox="-1 -2 34 34" width="100%" height="100%">
                    <path d="M16 1c-.17 0-.67.58-.9 1.03-.6 1.21-.6 1.15-.65 5.2-.04 2.97-.08 3.77-.18 3.9-.15.17-1.82 1.1-1.98 1.1-.08 0-.1-.25-.05-.83.03-.5.01-.92-.05-1.08-.1-.25-.13-.26-.71-.26-.82 0-.86.07-.78 1.5.03.6.08 1.17.11 1.25.05.12-.02.2-.25.33l-8 4.2c-.2.2-.18.1-.19 1.29 3.9-1.2 3.71-1.21 3.93-1.21.06 0 .1 0 .13.14.08.3.28.3.28-.04 0-.25.03-.27 1.16-.6.65-.2 1.22-.35 1.28-.35.05 0 .12.04.15.17.07.3.27.27.27-.08 0-.25.01-.27.7-.47.68-.1.98-.09 1.47-.1.18 0 .22 0 .26.18.06.34.22.35.27-.01.04-.2.1-.17 1.06-.14l1.07.02.05 4.2c.05 3.84.07 4.28.26 5.09.11.49.2.99.2 1.11 0 .19-.31.43-1.93 1.5l-1.93 1.26v1.02l4.13-.95.63 1.54c.05.07.12.09.19.09s.14-.02.19-.09l.63-1.54 4.13.95V29.3l-1.93-1.27c-1.62-1.06-1.93-1.3-1.93-1.49 0-.12.09-.62.2-1.11.19-.81.2-1.25.26-5.09l.05-4.2 1.07-.02c.96-.03 1.02-.05 1.06.14.05.36.21.35.27 0 .04-.17.08-.16.26-.16.49 0 .8-.02 1.48.1.68.2.69.21.69.46 0 .35.2.38.27.08.03-.13.1-.17.15-.17.06 0 .63.15 1.28.34 1.13.34 1.16.36 1.16.61 0 .35.2.34.28.04.03-.13.07-.14.13-.14.22 0 .03 0 3.93 1.2-.01-1.18.02-1.07-.19-1.27l-8-4.21c-.23-.12-.3-.21-.25-.33.03-.08.08-.65.11-1.25.08-1.43.04-1.5-.78-1.5-.58 0-.61.01-.71.26-.06.16-.08.58-.05 1.08.04.58.03.83-.05.83-.16 0-1.83-.93-1.98-1.1-.1-.13-.14-.93-.18-3.9-.05-4.05-.05-3.99-.65-5.2C16.67 1.58 16.17 1 16 1z" fill="${color}"/>
                </svg>
            `;
    }
}

function getAircraftMarkerHtml(aircraftStr, heading, color, isSelected = false, haloColor = '#38bdf8', routeStr = '') {
    const info = classifyAircraftType(aircraftStr, routeStr);
    const svgInner = getAircraftSvgContent(info.category, color);
    const size = info.size;
    const haloSize = info.haloSize;

    return `
        <div class="aircraft-marker-container" style="width: ${size}px; height: ${size}px;">
            <div class="aircraft-halo" style="border-color: ${haloColor}; width: ${haloSize}px; height: ${haloSize}px;"></div>
            <div class="aircraft-icon-svg-wrapper" style="transform: rotate(${heading}deg); width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center;">
                ${svgInner}
            </div>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ✈️ 60FPS ZERO-JUMP TELEMETRY BUFFER & MOTION SMOOTHER
// ═══════════════════════════════════════════════════════════════════════════════

class AircraftMotionBuffer {
    constructor(id) {
        this.id = id;
        this.snapshots = [];
        this.renderLat = 0;
        this.renderLon = 0;
        this.renderAlt = 0;
        this.renderGs = 0;
        this.renderHeading = 0;
        this.initialized = false;
        this.marker = null;
        this.flightData = null;
        this.lastUpdateTime = 0;
        this.lastSeenTime = Date.now();
    }

    pushTelemetry(telemetry) {
        this.lastSeenTime = Date.now();
        const lat = telemetry.latitude !== undefined ? telemetry.latitude : (telemetry.position?.lat !== undefined ? telemetry.position.lat : null);
        const lon = telemetry.longitude !== undefined ? telemetry.longitude : (telemetry.position?.lng !== undefined ? telemetry.position.lng : (telemetry.position?.lon !== undefined ? telemetry.position.lon : null));
        const hdg = telemetry.heading_deg !== undefined ? telemetry.heading_deg : (telemetry.position?.heading !== undefined ? telemetry.position.heading : 0);
        const alt = telemetry.altitude_ft !== undefined ? telemetry.altitude_ft : (telemetry.position?.altitude_ft !== undefined ? telemetry.position.altitude_ft : 0);
        const gs = telemetry.groundspeed_kts !== undefined ? telemetry.groundspeed_kts : (telemetry.position?.speed_tas_kts !== undefined ? telemetry.position.speed_tas_kts : 0);

        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) return;

        this.flightData = telemetry;
        const now = performance.now();

        if (!this.initialized) {
            this.renderLat = lat;
            this.renderLon = lon;
            this.renderAlt = alt;
            this.renderGs = gs;
            this.renderHeading = hdg;
            this.initialized = true;
        }

        this.snapshots.push({
            lat,
            lon,
            alt,
            gs,
            heading: hdg,
            time: now
        });

        if (this.snapshots.length > 5) {
            this.snapshots.shift();
        }
    }

    update(now) {
        if (!this.initialized || this.snapshots.length === 0) return;

        if (this.snapshots.length === 1) {
            const p = this.snapshots[0];
            const smoothFactor = 0.12;
            this.renderLat += (p.lat - this.renderLat) * smoothFactor;
            this.renderLon += (p.lon - this.renderLon) * smoothFactor;
            this.renderAlt += (p.alt - this.renderAlt) * smoothFactor;
            this.renderGs += (p.gs - this.renderGs) * smoothFactor;
            this.renderHeading = lerpAngle(this.renderHeading, p.heading, smoothFactor);
            return;
        }

        const renderDelay = 3200;
        const renderTime = now - renderDelay;

        let p0 = this.snapshots[0];
        let p1 = this.snapshots[this.snapshots.length - 1];

        for (let i = 0; i < this.snapshots.length - 1; i++) {
            if (renderTime >= this.snapshots[i].time && renderTime <= this.snapshots[i + 1].time) {
                p0 = this.snapshots[i];
                p1 = this.snapshots[i + 1];
                break;
            }
        }

        if (renderTime <= p0.time) {
            const smoothFactor = 0.15;
            this.renderLat += (p0.lat - this.renderLat) * smoothFactor;
            this.renderLon += (p0.lon - this.renderLon) * smoothFactor;
            this.renderAlt += (p0.alt - this.renderAlt) * smoothFactor;
            this.renderGs += (p0.gs - this.renderGs) * smoothFactor;
            this.renderHeading = lerpAngle(this.renderHeading, p0.heading, smoothFactor);
        } else if (renderTime >= p1.time) {
            const extraSeconds = (renderTime - p1.time) / 1000;
            const distDeg = (p1.gs * (extraSeconds / 3600)) / 60;
            const rad = (p1.heading * Math.PI) / 180;
            const targetLat = p1.lat + distDeg * Math.cos(rad);
            const targetLon = p1.lon + (distDeg * Math.sin(rad)) / Math.cos((p1.lat * Math.PI) / 180);

            const smoothFactor = 0.12;
            this.renderLat += (targetLat - this.renderLat) * smoothFactor;
            this.renderLon += (targetLon - this.renderLon) * smoothFactor;
            this.renderAlt += (p1.alt - this.renderAlt) * smoothFactor;
            this.renderGs += (p1.gs - this.renderGs) * smoothFactor;
            this.renderHeading = lerpAngle(this.renderHeading, p1.heading, smoothFactor);
        } else {
            const segDuration = p1.time - p0.time;
            const t = segDuration > 0 ? (renderTime - p0.time) / segDuration : 1;
            const smoothT = t * t * (3 - 2 * t);

            const targetLat = p0.lat + (p1.lat - p0.lat) * smoothT;
            const targetLon = p0.lon + (p1.lon - p0.lon) * smoothT;
            const targetAlt = p0.alt + (p1.alt - p0.alt) * smoothT;
            const targetGs = p0.gs + (p1.gs - p0.gs) * smoothT;
            const targetHdg = lerpAngle(p0.heading, p1.heading, smoothT);

            const smoothFactor = 0.2;
            this.renderLat += (targetLat - this.renderLat) * smoothFactor;
            this.renderLon += (targetLon - this.renderLon) * smoothFactor;
            this.renderAlt += (targetAlt - this.renderAlt) * smoothFactor;
            this.renderGs += (targetGs - this.renderGs) * smoothFactor;
            this.renderHeading = lerpAngle(this.renderHeading, targetHdg, smoothFactor);
        }
    }
}

function lerpAngle(a, b, t) {
    const diff = ((((b - a) % 360) + 540) % 360) - 180;
    return (a + diff * t + 360) % 360;
}

function normalizeLonDelta(targetLon, refLon) {
    let diff = (targetLon - refLon) % 360;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return refLon + diff;
}

function unwrapLatLngs(coords) {
    if (!coords || coords.length === 0) return [];
    const unwrapped = [];
    let prevLon = null;

    for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        const lat = Array.isArray(c) ? c[0] : c.lat;
        let lon = Array.isArray(c) ? c[1] : (c.lng !== undefined ? c.lng : c.lon);

        if (prevLon !== null) {
            lon = normalizeLonDelta(lon, prevLon);
        }

        prevLon = lon;
        unwrapped.push([lat, lon]);
    }
    return unwrapped;
}

function getRouteWorldShift(coords, mapCenterLng) {
    if (!coords || coords.length === 0) return 0;
    const avgLon = coords.reduce((acc, c) => acc + (Array.isArray(c) ? c[1] : (c.lng ?? c.lon)), 0) / coords.length;
    let bestOffset = 0;
    let minDiff = Infinity;
    for (let k = -4; k <= 4; k++) {
        const offset = k * 360;
        const diff = Math.abs(avgLon + offset - mapCenterLng);
        if (diff < minDiff) {
            minDiff = diff;
            bestOffset = offset;
        }
    }
    return bestOffset;
}

function getVisibleLongitude(rawLon, mapInstance) {
    if (!mapInstance) return rawLon;
    const centerLon = mapInstance.getCenter().lng;
    let bestLon = rawLon;
    let minDiff = Infinity;

    for (let offset = -1080; offset <= 1080; offset += 360) {
        const testLon = rawLon + offset;
        const diff = Math.abs(testLon - centerLon);
        if (diff < minDiff) {
            minDiff = diff;
            bestLon = testLon;
        }
    }
    return bestLon;
}

function initMap() {
    map = L.map('embedMap', {
        center: [39.8283, -98.5795],
        zoom: 4,
        zoomControl: false,
        attributionControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    tileLayer = L.tileLayer(TILE_STYLES.dark, {
        maxZoom: 19,
        tileSize: 512,
        zoomOffset: -1,
        attribution: '© Mapbox © OpenStreetMap'
    }).addTo(map);

    // Clicking out on map deselects pilot, hides popup and clears route
    map.on('click', () => {
        deselectPilot();
    });

    const popupEl = document.getElementById('fshubLivePopup');
    if (popupEl) {
        L.DomEvent.disableClickPropagation(popupEl);
    }

    startMotionLoop();
    startDataPolling();
}

function deselectPilot() {
    selectedPilotId = null;
    selectedPilotData = null;
    currentCardStyle = defaultCardStyle;
    const card = document.getElementById('fshubLivePopup');
    if (card) card.classList.add('hidden');

    if (activeRouteLayer && map.hasLayer(activeRouteLayer)) {
        map.removeLayer(activeRouteLayer);
        activeRouteLayer = null;
    }
    if (activeWaypointsLayerGroup) {
        activeWaypointsLayerGroup.clearLayers();
    }
}

function startMotionLoop() {
    function step() {
        const now = performance.now();

        fleetBuffers.forEach((buf, id) => {
            buf.update(now);

            const visLon = getVisibleLongitude(buf.renderLon, map);
            buf.marker.setLatLng([buf.renderLat, visLon]);

            const markerEl = buf.marker.getElement();
            if (markerEl) {
                const rotEl = markerEl.querySelector('.aircraft-icon-svg-wrapper');
                if (rotEl) {
                    rotEl.style.transform = `rotate(${buf.renderHeading}deg)`;
                }
            }

            // If this aircraft is the selected active flight, update Inspector Card
            if (selectedPilotId === id && buf.flightData) {
                const liveTelem = {
                    ...buf.flightData,
                    latitude: buf.renderLat,
                    longitude: buf.renderLon,
                    heading_deg: Math.round(buf.renderHeading),
                    altitude_ft: Math.round(buf.renderAlt),
                    groundspeed_kts: Math.round(buf.renderGs)
                };
                updateLiveInspectorMetrics(liveTelem);
            }
        });

        motionAnimId = requestAnimationFrame(step);
    }

    motionAnimId = requestAnimationFrame(step);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📡 DATA POLLING & MULTI-TARGET FETCHING
// ═══════════════════════════════════════════════════════════════════════════════

async function loadSttApiConfigFile() {
    if (config.apiKey && (config.fshubToken || config.vatsim)) return;

    const possiblePaths = ['/STTAPI.txt', '/sttapi.txt', 'STTAPI.txt'];
    for (const p of possiblePaths) {
        try {
            const res = await fetch(p);
            if (res.ok) {
                const text = await res.text();
                const lines = text.split(/\r?\n/);
                for (const line of lines) {
                    const clean = line.trim();
                    if (!clean || clean.startsWith('#') || clean.startsWith('//') || clean.startsWith(';')) continue;
                    const eq = clean.indexOf('=');
                    if (eq !== -1) {
                        const k = clean.substring(0, eq).trim().toUpperCase();
                        let v = clean.substring(eq + 1).trim();
                        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                            v = v.slice(1, -1);
                        }
                        if (!config.apiKey && (k === 'AERONAV_API_KEY' || k === 'API_KEY' || k === 'AERONAV_KEY')) config.apiKey = v;
                        if (!config.fshubToken && (k === 'FSHUB_TOKEN' || k === 'FSHUB_KEY')) config.fshubToken = v;
                        if (!config.vatsimCid && (k === 'VATSIM_CID' || k === 'VATSIM_ID')) config.vatsimCid = v;
                        if (!config.ivao && (k === 'IVAO_TOKEN' || k === 'IVAO_KEY')) config.ivao = v;
                    }
                }
                console.log('📄 [EmbedRadar] Loaded integration credentials from STTAPI.txt');
                break;
            }
        } catch (e) {
            // ignore 404
        }
    }
}

async function startDataPolling() {
    await loadSttApiConfigFile();
    await fetchLiveFleet();
    pollTimerId = setInterval(fetchLiveFleet, config.pollIntervalMs);
}

async function fetchLiveFleet() {
    try {
        const payload = {
            targets: []
        };

        if (config.fshubToken) {
            payload.targets.push({ network: 'FSHUB', token: config.fshubToken });
        }
        if (config.fshub) {
            config.fshub.split(',').forEach(id => {
                const clean = id.trim();
                if (clean) payload.targets.push({ network: 'FSHUB', id: clean });
            });
        }
        if (config.vatsimCid) {
            payload.targets.push({ network: 'VATSIM', cid: config.vatsimCid.trim() });
        }
        if (config.vatsim) {
            config.vatsim.split(',').forEach(id => {
                const clean = id.trim();
                if (clean) payload.targets.push({ network: 'VATSIM', id: clean });
            });
        }
        if (config.ivao) {
            config.ivao.split(',').forEach(id => {
                const clean = id.trim();
                if (clean) payload.targets.push({ network: 'IVAO', id: clean });
            });
        }

        if (payload.targets.length === 0) {
            return;
        }

        const headers = { 'Content-Type': 'application/json' };
        if (config.apiKey) headers['X-API-Key'] = config.apiKey;

        const res = await fetch(config.apiKey ? `/api/v1/live/multi?api_key=${encodeURIComponent(config.apiKey)}` : '/api/v1/live/multi', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!res.ok) return;
        const data = await res.json();

        if (data && data.success && Array.isArray(data.flights)) {
            renderFleetOnMap(data.flights);
            updateFleetStatsSummary(data.flights);
        }
    } catch (err) {
        console.error('[EmbedRadar] Error polling multi-target fleet:', err);
    }
}

function isFlightAirborne(f) {
    if (!f) return false;
    const gs = Math.round(f.groundspeed_kts !== undefined ? f.groundspeed_kts : (f.position?.speed_tas_kts || f.speed || 0));
    const rawPhase = (f.phase || f.flight_phase || '').toUpperCase().replace(/_/g, ' ').trim();
    
    // Explicit ground phases
    const groundKeywords = ['TAXI', 'PARK', 'STANDBY', 'GATE', 'RAMP', 'GROUND', 'BOARD', 'DEBOARD', 'PREFLIGHT', 'PUSHBACK', 'HOLD'];
    if (groundKeywords.some(kw => rawPhase.includes(kw))) {
        return gs > 50; // Only airborne if actually moving at high speed
    }

    // If speed is slow (< 35 kts), pilot is on the ground regardless of airport elevation
    if (gs < 35) {
        return false;
    }

    return true;
}

function resolveFlightPhase(pilot, gs) {
    const rawPhase = (pilot.phase || pilot.flight_phase || '').replace(/_/g, ' ').toUpperCase().trim();
    if (gs < 35) {
        if (!rawPhase || ['ENROUTE', 'CRUISE', 'LEVEL FLIGHT', 'AIRBORNE', 'UNKNOWN'].includes(rawPhase)) {
            return gs < 5 ? 'PARKED' : 'TAXIING';
        }
    }
    return rawPhase || (gs > 35 ? 'AIRBORNE' : 'TAXIING');
}

function updateFleetStatsSummary(flights) {
    const list = Array.isArray(flights) ? flights : [];
    const active = list.length;
    const airborne = list.filter(f => isFlightAirborne(f)).length;
    const ground = Math.max(0, active - airborne);
    const vatsim = list.filter(f => (f.vatsim && f.vatsim.is_online) || (f.network && f.network.toUpperCase() === 'VATSIM')).length;

    const elActive = document.getElementById('statsActivePilots');
    if (elActive) elActive.textContent = active;
    const elAirborne = document.getElementById('statsAirbornePilots');
    if (elAirborne) elAirborne.textContent = airborne;
    const elGround = document.getElementById('statsGroundPilots');
    if (elGround) elGround.textContent = ground;
    const elVatsim = document.getElementById('statsVatsimPilots');
    if (elVatsim) elVatsim.textContent = vatsim;
}

function renderFleetOnMap(flights) {
    const currentFlightIds = new Set();
    const bounds = [];

    flights.forEach((f, idx) => {
        const id = f.id || f.callsign;
        currentFlightIds.add(id);

        let buf = fleetBuffers.get(id);
        if (!buf) {
            buf = new AircraftMotionBuffer(id);
            fleetBuffers.set(id, buf);
        }

        buf.pushTelemetry(f);

        const isVat = (f.vatsim && f.vatsim.is_online) || (f.network && f.network.toUpperCase() === 'VATSIM');
        const isSelected = selectedPilotId === id;
        const isVa = f.airline && f.airline.is_va;
        const iconColor = isSelected ? '#38bdf8' : (isVat ? '#00ff88' : (isVa ? '#c084fc' : '#38bdf8'));
        const haloColor = isSelected ? '#38bdf8' : (isVat ? '#00ff88' : (isVa ? '#a855f7' : '#38bdf8'));

        const info = classifyAircraftType(f.aircraft, f.route);
        const planeHtml = getAircraftMarkerHtml(f.aircraft, buf.renderHeading || f.heading_deg || 0, iconColor, isSelected, haloColor, f.route);

        const customIcon = L.divIcon({
            html: planeHtml,
            className: 'aircraft-div-icon',
            iconSize: [info.size, info.size],
            iconAnchor: [Math.round(info.size / 2), Math.round(info.size / 2)]
        });

        if (!buf.marker) {
            buf.marker = L.marker([buf.renderLat, buf.renderLon], { icon: customIcon, zIndexOffset: isSelected ? 1100 : 900 }).addTo(map);

            buf.marker.bindTooltip(`<strong>${f.callsign}</strong>${isVat ? ' <span style="color:#00ff88;">[VATSIM]</span>' : ''}`, {
                permanent: false,
                direction: 'top',
                className: 'plane-leaflet-tooltip'
            });

            buf.marker.on('click', (e) => {
                if (e && e.originalEvent) {
                    e.originalEvent.stopPropagation();
                }
                L.DomEvent.stopPropagation(e);
                selectPilot(id, f);
            });
        } else {
            buf.marker.setIcon(customIcon);
            buf.marker.setZIndexOffset(isSelected ? 1100 : 900);
        }

        const visLon = getVisibleLongitude(buf.renderLon, map);
        bounds.push([buf.renderLat, visLon]);
    });

    // Auto-focus on active fleet on initial load
    if (!initialBoundsFitted && bounds.length > 0) {
        if (bounds.length === 1) {
            map.setView(bounds[0], 6);
        } else {
            map.fitBounds(bounds, { padding: [80, 80] });
        }
        initialBoundsFitted = true;
    }

    // Remove inactive flights with 20s anti-flicker grace period
    const nowTime = Date.now();
    fleetBuffers.forEach((buf, id) => {
        if (!currentFlightIds.has(id)) {
            if (nowTime - buf.lastSeenTime > 20000) {
                if (buf.marker) map.removeLayer(buf.marker);
                fleetBuffers.delete(id);
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🛩️ PILOT INSPECTOR & FLIGHT CORRIDOR SELECTION (IDENTICAL TO API STYLE)
// ═══════════════════════════════════════════════════════════════════════════════

async function selectPilot(id, pilotData) {
    selectedPilotId = id;
    currentCardStyle = defaultCardStyle;
    renderSelectedPilotPopup(pilotData);

    const routeStr = pilotData.route || pilotData.flight_plan?.route;
    const dep = pilotData.departure || pilotData.flight_plan?.departure;
    const arr = pilotData.arrival || pilotData.flight_plan?.arrival;

    if (routeStr || (dep && arr && arr !== 'STANDBY')) {
        await loadAndTraceRoute(routeStr || `${dep} ${arr}`, dep, arr);
    }
}

const clientEmbedRouteCache = new Map();

function renderTracedRouteOnMap(routeData) {
    activeRouteData = routeData;

    if (activeRouteLayer && map.hasLayer(activeRouteLayer)) {
        map.removeLayer(activeRouteLayer);
    }
    if (!activeWaypointsLayerGroup) {
        activeWaypointsLayerGroup = L.layerGroup().addTo(map);
    }
    activeWaypointsLayerGroup.clearLayers();

    if (!routeData) return;

    // Use high-density smoothed route coordinates if available, otherwise fallback to waypoints
    const rawCoords = (routeData.route_coordinates && routeData.route_coordinates.length > 0)
        ? routeData.route_coordinates.map(c => [c[1], c[0]])
        : (routeData.waypoints ? routeData.waypoints.map(w => [w.latitude, w.longitude]) : []);

    if (rawCoords.length < 2) return;

    const baseLatLngs = unwrapLatLngs(rawCoords);
    const mapCenterLng = map ? map.getCenter().lng : -96.0;
    const worldShift = getRouteWorldShift(baseLatLngs, mapCenterLng);
    const latLngs = baseLatLngs.map(([lat, lon]) => [lat, lon + worldShift]);

    // 1. Neon Green Glow Underlay
    L.polyline(latLngs, {
        color: '#00ff88',
        weight: 6,
        opacity: 0.25,
        lineCap: 'round'
    }).addTo(activeWaypointsLayerGroup);

    // 2. Primary Neon Green Dashed Flight Corridor
    activeRouteLayer = L.polyline(latLngs, {
        color: '#00ff88',
        weight: 3,
        opacity: 0.9,
        dashArray: '8, 4',
        lineCap: 'round'
    }).addTo(activeWaypointsLayerGroup);

    // 3. Color-Coded Waypoint Fixes & Rectangular Pill Labels
    if (routeData.waypoints && routeData.waypoints.length > 0) {
        let runningWpLon = routeData.waypoints[0].unwrapped_longitude !== undefined 
            ? routeData.waypoints[0].unwrapped_longitude 
            : routeData.waypoints[0].longitude;

        routeData.waypoints.forEach((wp, idx) => {
            const isVor = (wp.type || '').includes('VOR') || (wp.type || '').includes('TACAN') || (wp.type || '').includes('NDB');
            const isApt = wp.type === 'AIRPORT';
            const isFix = wp.type === 'TERMINAL_WAYPOINT' || wp.type === 'INTERSECTION' || wp.type === 'FIX';

            let wpLon = wp.unwrapped_longitude !== undefined ? wp.unwrapped_longitude : wp.longitude;
            if (idx > 0) {
                wpLon = normalizeLonDelta(wpLon, runningWpLon);
            }
            runningWpLon = wpLon;
            const shiftedWpLon = wpLon + worldShift;

            let markerColor = '#f43f5e'; // Waypoint Rose
            let radius = 4;
            let labelClass = 'map-wp-label wp-waypoint';

            if (isApt) {
                markerColor = '#fbbf24'; // Airport Amber
                radius = 6;
                labelClass = 'map-wp-label wp-apt';
            } else if (isVor) {
                markerColor = '#00ff88'; // VOR Green
                radius = 5;
                labelClass = 'map-wp-label wp-vor';
            } else if (isFix) {
                markerColor = '#38bdf8'; // Fix / Terminal Cyan
                radius = 4.5;
                labelClass = 'map-wp-label wp-fix';
            }

            const marker = L.circleMarker([wp.latitude, shiftedWpLon], {
                radius: radius,
                fillColor: markerColor,
                color: '#fff',
                weight: 1.5,
                opacity: 1,
                fillOpacity: 0.95
            }).addTo(activeWaypointsLayerGroup);

            marker.bindTooltip(wp.ident, {
                permanent: true,
                direction: 'top',
                offset: [0, -6],
                className: labelClass
            });
        });
    }

    map.fitBounds(activeRouteLayer.getBounds(), { padding: [50, 50] });
}

async function loadAndTraceRoute(routeStr, dep, arr) {
    const cacheKey = `${dep || ''}:${arr || ''}:${routeStr || ''}`;
    if (clientEmbedRouteCache.has(cacheKey)) {
        renderTracedRouteOnMap(clientEmbedRouteCache.get(cacheKey));
        return;
    }

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (config.apiKey) headers['X-API-Key'] = config.apiKey;

        const res = await fetch(config.apiKey ? `/api/v1/route/trace?api_key=${encodeURIComponent(config.apiKey)}` : '/api/v1/route/trace', {
            method: 'POST',
            headers,
            body: JSON.stringify({ departure: dep, arrival: arr, route: routeStr, include_labels: true })
        });

        if (!res.ok) return;
        const routeData = await res.json();
        
        if (clientEmbedRouteCache.size >= 500) {
            const firstKey = clientEmbedRouteCache.keys().next().value;
            clientEmbedRouteCache.delete(firstKey);
        }
        clientEmbedRouteCache.set(cacheKey, routeData);

        renderTracedRouteOnMap(routeData);
    } catch (err) {
        console.error('[EmbedRadar] Error tracing route corridor:', err);
    }
}

const defaultCardStyle = urlParams.get('popup_style') || urlParams.get('card_style') || urlParams.get('variant') || urlParams.get('popup') || 'auto';
let currentCardStyle = defaultCardStyle;
let selectedPilotData = null;

// 📊 Optional Fleet Summary Stats Card (Invoked via &stats=true or API call)
const showStatsParam = urlParams.get('stats') || urlParams.get('show_stats') || urlParams.get('fleet_stats') || urlParams.get('summary');
const isStatsEnabled = showStatsParam === '1' || showStatsParam === 'true';
const statsEl = document.getElementById('fleetSummaryStatsCard');
if (statsEl) {
    if (isStatsEnabled) statsEl.classList.remove('hidden');
    else statsEl.classList.add('hidden');
}

window.setFleetStatsVisible = function(show) {
    const card = document.getElementById('fleetSummaryStatsCard');
    if (!card) return;
    if (show) card.classList.remove('hidden');
    else card.classList.add('hidden');
};

window.toggleFleetStats = function() {
    const card = document.getElementById('fleetSummaryStatsCard');
    if (!card) return;
    card.classList.toggle('hidden');
};

window.toggleInspectorCardStyle = function(e) {
    if (e) e.stopPropagation();
    if (currentCardStyle === 'mini') {
        currentCardStyle = 'compact';
    } else if (currentCardStyle === 'compact') {
        currentCardStyle = 'mini';
    } else if (currentCardStyle === 'full') {
        currentCardStyle = 'mini';
    } else {
        currentCardStyle = 'compact';
    }
    if (selectedPilotData) {
        renderSelectedPilotPopup(selectedPilotData);
    }
};

function renderSelectedPilotPopup(pilot) {
    const card = document.getElementById('fshubLivePopup');
    const content = document.getElementById('inspectorContent');
    if (!card || !content || !pilot) return;
    selectedPilotData = pilot;

    // Determine effective style (Auto switches to compact for small maps)
    let effectiveStyle = currentCardStyle;
    if (effectiveStyle === 'auto' || !effectiveStyle) {
        const mapEl = document.getElementById('embedMap') || document.body;
        const w = mapEl.clientWidth || window.innerWidth;
        const h = mapEl.clientHeight || window.innerHeight;
        effectiveStyle = (w < 720 || h < 560) ? 'compact' : 'full';
    }

    card.classList.remove('style-full', 'style-compact', 'style-mini');
    if (effectiveStyle === 'compact') {
        card.classList.add('style-compact');
    } else if (effectiveStyle === 'mini') {
        card.classList.add('style-mini');
    } else {
        card.classList.add('style-full');
    }

    const alt = Math.round(pilot.altitude_ft || pilot.position?.altitude_ft || 0);
    const gs = Math.round(pilot.groundspeed_kts || pilot.position?.speed_tas_kts || 0);
    const hdg = Math.round(pilot.heading_deg || pilot.position?.heading || 0);
    const dep = pilot.departure || pilot.flight_plan?.departure || '???';
    const arr = pilot.arrival || pilot.flight_plan?.arrival || '???';
    const routeStr = pilot.route || pilot.flight_plan?.route || null;
    const rawAc = pilot.aircraft || pilot.flight_plan?.aircraft || '';
    const acInfo = classifyAircraftType(rawAc, routeStr);
    const aircraftDisplay = acInfo && acInfo.label ? acInfo.label : (acInfo && acInfo.icao ? `✈️ ${acInfo.icao}` : '');
    const phase = resolveFlightPhase(pilot, gs);
    const airlineInfo = resolveAirlineInfo(pilot.callsign, pilot);
    const displayName = pilot.pilot_name || pilot.name || pilot.user?.name || pilot.callsign || 'Pilot';
    const filedCallsign = pilot.flight_plan?.callsign || pilot.plan?.callsign;
    const tailNumber = pilot.registration || pilot.tail || pilot.tail_number || pilot.aircraft?.registration || pilot.flight_plan?.registration;

    // Check if pilot.callsign is literally the pilot's username
    const isCallsignUsername = pilot.callsign && displayName && (
        pilot.callsign.trim().toLowerCase() === displayName.trim().toLowerCase() ||
        pilot.callsign.replace(/[\s_-]+/g, '').toLowerCase() === displayName.replace(/[\s_-]+/g, '').toLowerCase()
    );

    // Strict Rule: ONLY callsign, or tail number if no callsign. NEVER username. Otherwise empty.
    let callsignOrTail = '';
    if (filedCallsign && filedCallsign !== '---') {
        callsignOrTail = filedCallsign;
    } else if (pilot.callsign && !isCallsignUsername && pilot.callsign !== '---') {
        callsignOrTail = pilot.callsign;
    } else if (tailNumber && tailNumber !== '---' && tailNumber.toLowerCase() !== displayName.toLowerCase()) {
        callsignOrTail = tailNumber;
    } else {
        callsignOrTail = ''; // LEAVE EMPTY
    }

    // Check if flight callsign is from another company (e.g. FDX -> FedEx Express, SWA -> Southwest) operated by the VA
    const vaAbbr = (airlineInfo?.abbr || pilot.airline?.abbr || pilot.airline?.code || '').toUpperCase();
    const csUpper = String(callsignOrTail || '').toUpperCase().trim();
    const csPrefix = csUpper.match(/^([A-Z]{3})/)?.[1] || '';
    const isDifferentCompany = vaAbbr && csPrefix && csPrefix !== vaAbbr;
    const commercialAirline = (isDifferentCompany && AIRLINE_ICAO_DATABASE[csPrefix]) ? AIRLINE_ICAO_DATABASE[csPrefix] : null;

    let leftCallsignHtml = '';
    if (callsignOrTail) {
        leftCallsignHtml = `<span style="color: #f1f5f9; font-family: 'JetBrains Mono', monospace; font-size: 0.80rem; font-weight: 700; letter-spacing: 0.5px;">${callsignOrTail}</span>`;
        if (commercialAirline) {
            leftCallsignHtml += ` <span style="color: #94a3b8; font-family: 'Inter', sans-serif; font-weight: 500; font-size: 0.74rem;">• ${commercialAirline.name}</span>`;
        }
    }

    let rightOperatorHtml = '';
    if (airlineInfo) {
        const opPrefix = isDifferentCompany ? 'Op by ' : '';
        rightOperatorHtml = `<span style="color: #38bdf8; font-weight: 600;">🏢 ${opPrefix}${airlineInfo.badge}</span>`;
    }

    window.currentSelectedPilot = pilot;

    if (effectiveStyle === 'mini') {
        content.innerHTML = `
            <div class="inspector-header">
                <div class="inspector-pilot-identity">
                    <img src="${pilot.pilot_avatar || '/assets/default-pilot-avatar.png'}" onerror="this.src='/assets/default-pilot-avatar.png'" class="inspector-avatar" alt="${displayName}">
                    <div style="min-width: 0; overflow: hidden;">
                        <div class="inspector-callsign" title="${displayName}">${displayName}</div>
                    </div>
                </div>
                <div class="inspector-header-right">
                    <button class="toggle-card-style-btn" title="Expand to Compact Card" onclick="window.toggleInspectorCardStyle(event)" style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; border-radius: 6px; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; font-size: 11px; transition: all 0.2s; flex-shrink: 0;">⤢</button>
                    <button class="report-route-btn" id="btnReportRouteMini" title="Report Route to Discord" onclick="window.reportCurrentPilotRoute(this, event)" style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 6px; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; font-size: 12px; transition: all 0.2s; flex-shrink: 0;">🚩</button>
                </div>
            </div>
            <div class="inspector-flight-plan-box">
                <div class="inspector-route-header">
                    <span class="origin-arr">${dep === '???' ? 'ENROUTE' : dep}</span>
                    <span style="color: #38bdf8;">➔</span>
                    <span class="origin-arr">${arr === '???' ? 'DIRECT' : arr}</span>
                    <span class="fl-tag" id="inspectorFlTag">FL${Math.round(alt / 100)}</span>
                </div>
            </div>
            <div class="inspector-telemetry-grid">
                <div class="inspector-telem-item">
                    <span>ALT</span>
                    <span id="inspectorAlt" style="color: #00ff88;">${alt.toLocaleString()}</span>
                </div>
                <div class="inspector-telem-item">
                    <span>SPD</span>
                    <span id="inspectorSpeed" style="color: #38bdf8;">${gs}kt</span>
                </div>
                <div class="inspector-telem-item">
                    <span>HDG</span>
                    <span id="inspectorHdg" style="color: #fbbf24;">${String(hdg % 360).padStart(3, '0')}°</span>
                </div>
                <div class="inspector-telem-item">
                    <span>SQK</span>
                    <span id="inspectorSquawk" style="color: #ffffff;">${pilot.squawk || '1200'}</span>
                </div>
            </div>
        `;
    } else {
        content.innerHTML = `
            <!-- Top Header -->
            <div class="inspector-header">
                <div class="inspector-pilot-identity">
                    <img src="${pilot.pilot_avatar || '/assets/default-pilot-avatar.png'}" onerror="this.src='/assets/default-pilot-avatar.png'" class="inspector-avatar" alt="${displayName}">
                    <div style="min-width: 0; overflow: hidden;">
                        <div class="inspector-callsign" title="${displayName}">${displayName}</div>
                        ${aircraftDisplay ? `<div class="inspector-pilot-name" style="color: #38bdf8; font-weight: 500;" title="${aircraftDisplay.replace(/<[^>]+>/g, '')}">${aircraftDisplay}</div>` : ''}
                    </div>
                </div>
                <div class="inspector-header-right">
                    <button class="toggle-card-style-btn" title="Collapse to Mini Card" onclick="window.toggleInspectorCardStyle(event)" style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; border-radius: 6px; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; font-size: 12px; transition: all 0.2s; flex-shrink: 0;">⤡</button>
                    <button class="report-route-btn" id="btnReportRoute" title="Report Route to Discord" onclick="window.reportCurrentPilotRoute(this, event)" style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 6px; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; font-size: 13px; transition: all 0.2s; flex-shrink: 0;">🚩</button>
                    <span class="live-phase-pill" id="inspectorPhasePill">${phase}</span>
                </div>
            </div>

            <!-- Flight Plan Corridor Box -->
            <div class="inspector-flight-plan-box">
                <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 4px; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 0.72rem;">
                    <div>${leftCallsignHtml}</div>
                    ${rightOperatorHtml}
                </div>
                ${(dep === '???' || dep === 'ENROUTE' || arr === '???' || arr === 'DIRECT') ? `
                    <div class="inspector-route-header">
                        <span class="origin-arr" style="color: #38bdf8; font-size: 0.95rem;">🛰️ ${dep !== '???' ? dep : 'ENROUTE'}</span>
                        <span style="color: #38bdf8; font-size: 1.15rem;">➔</span>
                        <span class="origin-arr" style="color: #00ff88; font-size: 0.95rem;">DIRECT TRACK</span>
                        <span class="fl-tag" id="inspectorFlTag">FL${Math.round(alt / 100)}</span>
                    </div>
                    <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 4px;">
                        <strong style="color: #38bdf8;">RADAR TRACK:</strong> Live Telemetry Stream • Free Flight / Direct Track
                    </div>
                ` : (arr === 'STANDBY' ? `
                    <div class="inspector-route-header">
                        <span class="origin-arr">${dep}</span>
                        <span style="color: #94a3b8; font-size: 1.15rem;">➔</span>
                        <span class="origin-arr" style="color: #94a3b8; font-size: 0.9rem;">STANDBY</span>
                        <span class="fl-tag" id="inspectorFlTag">RAMP</span>
                    </div>
                    <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 4px;">
                        <strong style="color: #f59e0b;">STATUS:</strong> Aircraft on Ground • Awaiting Flight Plan
                    </div>
                ` : `
                    <div class="inspector-route-header">
                        <span class="origin-arr">${dep}</span>
                        <span style="color: #38bdf8; font-size: 1.15rem;">➔</span>
                        <span class="origin-arr">${arr}</span>
                        <span class="fl-tag" id="inspectorFlTag">FL${Math.round(alt / 100)}</span>
                    </div>
                    ${routeStr ? `
                        <div class="inspector-route-string">
                            <strong style="color: #38bdf8;">FILED ROUTE:</strong> ${routeStr}
                        </div>
                    ` : `
                        <div style="font-size: 0.7rem; color: #94a3b8; font-style: italic;">
                            Direct Great-Circle Flight Path (${dep} ➔ ${arr})
                        </div>
                    `}
                `)}
            </div>

            <!-- Telemetry Matrix -->
            <div class="inspector-telemetry-grid">
                <div class="inspector-telem-item">
                    <span>ALTITUDE</span>
                    <span id="inspectorAlt" style="color: #00ff88;">${alt.toLocaleString()} ft</span>
                </div>
                <div class="inspector-telem-item">
                    <span>SPEED</span>
                    <span id="inspectorSpeed" style="color: #38bdf8;">${gs} kts</span>
                </div>
                <div class="inspector-telem-item">
                    <span>HEADING</span>
                    <span id="inspectorHdg" style="color: #fbbf24;">${String(hdg % 360).padStart(3, '0')}°</span>
                </div>
                <div class="inspector-telem-item">
                    <span>SQUAWK</span>
                    <span id="inspectorSquawk" style="color: #ffffff;">${pilot.squawk || '1200'}</span>
                </div>
            </div>

            <!-- VATSIM Network Badge -->
            <div class="fshub-vatsim-card">
                <div class="fshub-vatsim-header">
                    <div class="vatsim-brand-badge">
                        <span>🌐 VATSIM:</span>
                        <strong>${pilot.vatsim?.cid || 'Not Linked'}</strong>
                    </div>
                    <span class="vatsim-status-pill ${pilot.vatsim?.is_online ? 'online' : 'offline'}">
                        ${pilot.vatsim?.is_online ? '🟢 ONLINE' : '⚪ OFFLINE'}
                    </span>
                </div>
            </div>
        `;
    }

    card.classList.remove('hidden');
}

function updateLiveInspectorMetrics(t) {
    if (!t) return;
    const card = document.getElementById('fshubLivePopup');
    if (!card || card.classList.contains('hidden')) return;

    const alt = Math.round(t.altitude_ft || 0);
    const gs = Math.round(t.groundspeed_kts || 0);
    const hdg = Math.round(t.heading_deg || 0) % 360;
    const phase = (t.phase || (gs > 30 ? 'CRUISE' : 'TAXIING')).replace('_', ' ').toUpperCase();

    const elAlt = document.getElementById('inspectorAlt');
    if (elAlt) elAlt.textContent = card.classList.contains('style-mini') ? `${alt.toLocaleString()}` : `${alt.toLocaleString()} ft`;

    const elSpeed = document.getElementById('inspectorSpeed');
    if (elSpeed) elSpeed.textContent = card.classList.contains('style-mini') ? `${gs}kt` : `${gs} kts`;

    const elHdg = document.getElementById('inspectorHdg');
    if (elHdg) elHdg.textContent = `${String(hdg).padStart(3, '0')}°`;

    const elFl = document.getElementById('inspectorFlTag');
    if (elFl) elFl.textContent = `FL${Math.round(alt / 100)}`;

    const elPhase = document.getElementById('inspectorPhasePill');
    if (elPhase) elPhase.textContent = phase;
}

window.reportCurrentPilotRoute = async function(btnElement, evt) {
    if (evt) evt.stopPropagation();
    const pilot = window.currentSelectedPilot;
    if (!pilot) return;

    const btn = btnElement || document.getElementById('btnReportRoute') || document.getElementById('btnReportRouteMini');
    if (btn) {
        btn.innerHTML = '⏳';
        btn.disabled = true;
    }

    try {
        const dep = pilot.departure || pilot.flight_plan?.departure || '???';
        const arr = pilot.arrival || pilot.flight_plan?.arrival || '???';
        const routeStr = pilot.route || pilot.flight_plan?.route || `${dep} ➔ ${arr}`;

        const headers = { 'Content-Type': 'application/json' };
        if (config.apiKey) headers['X-API-Key'] = config.apiKey;

        const targetUrl = config.apiKey ? `/api/v1/report/discord?api_key=${encodeURIComponent(config.apiKey)}` : '/api/v1/report/discord';

        const res = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                pilot_name: pilot.pilot_name || pilot.callsign || 'Pilot',
                callsign: pilot.callsign,
                network: pilot.airline ? `${pilot.airline.abbr} • ${pilot.airline.name}` : (pilot.network || 'FSHub'),
                route: routeStr,
                departure: dep,
                arrival: arr,
                aircraft: pilot.aircraft || pilot.flight_plan?.aircraft || 'N/A',
                altitude_ft: Math.round(pilot.altitude_ft || pilot.position?.altitude_ft || 0),
                groundspeed_kts: Math.round(pilot.groundspeed_kts || pilot.position?.speed_tas_kts || 0),
                discord_webhook: config.discordWebhook || undefined
            })
        });

        const data = await res.json().catch(() => null);

        // If backend did not deliver to Discord but webhook is provided in client config, dispatch directly
        if (config.discordWebhook && (!data || !data.delivered_to_discord)) {
            try {
                const nowFormatted = new Date().toUTCString();
                const directPayload = {
                    username: 'AeroNav Route Monitor',
                    avatar_url: 'https://g.fshubcdn.com/avatars/va_5169_icon.png',
                    embeds: [
                        {
                            title: '🚩 Waypoint / Route Issue Reported',
                            description: 'A pilot has flagged a flight plan route for review or waypoint fixing:',
                            color: 16734296,
                            fields: [
                                { name: '👤 Pilot', value: `**${pilot.pilot_name || pilot.callsign || 'Pilot'}** (${pilot.callsign || 'N/A'})`, inline: true },
                                { name: '🏢 Airline / Network', value: `${pilot.airline ? `${pilot.airline.abbr} • ${pilot.airline.name}` : (pilot.network || 'FSHub')}`, inline: true },
                                { name: '📅 Date Submitted', value: `${nowFormatted}`, inline: true },
                                { name: '🛫 Departure', value: `\`${dep}\``, inline: true },
                                { name: '🛬 Arrival', value: `\`${arr}\``, inline: true },
                                { name: '✈️ Aircraft', value: `\`${pilot.aircraft || pilot.flight_plan?.aircraft || 'N/A'}\``, inline: true },
                                { name: '🌐 Corridor / Route', value: `\`\`\`\n${routeStr}\n\`\`\``, inline: false },
                                { name: '🛰️ Telemetry', value: `Altitude: **${Math.round(pilot.altitude_ft || 0).toLocaleString()} ft** | Groundspeed: **${Math.round(pilot.groundspeed_kts || 0)} kts**`, inline: false }
                            ],
                            footer: { text: 'AeroNav Live Fleet Operations • SimTechTracker' }
                        }
                    ]
                };
                await fetch(config.discordWebhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(directPayload)
                });
            } catch (err) {
                console.warn('[EmbedRadar] Direct Discord dispatch error:', err);
            }
        }

        if (btn) {
            btn.innerHTML = '✅';
            btn.style.background = 'rgba(16, 185, 129, 0.25)';
            btn.style.borderColor = 'rgba(16, 185, 129, 0.5)';
            btn.title = 'Route report sent to Discord!';
            setTimeout(() => {
                btn.innerHTML = '🚩';
                btn.disabled = false;
                btn.style.background = 'rgba(239, 68, 68, 0.12)';
                btn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            }, 3500);
        }
    } catch (e) {
        if (btn) {
            btn.innerHTML = '❌';
            setTimeout(() => {
                btn.innerHTML = '🚩';
                btn.disabled = false;
            }, 2000);
        }
    }
};

function reportCurrentPilotRoute(btn, e) {
    return window.reportCurrentPilotRoute(btn, e);
}

function initDevVariantSwitcher() {
    const isDev = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' || 
                  urlParams.get('dev') === 'true' || 
                  urlParams.get('switcher') === 'true';
    
    if (!isDev) return;

    const switcher = document.createElement('div');
    switcher.className = 'dev-variant-switcher';
    switcher.innerHTML = `
        <span>🎛️ Card Style:</span>
        <button class="dev-variant-btn ${currentCardStyle === 'auto' ? 'active' : ''}" onclick="window.setDevCardStyle('auto', this)">Auto</button>
        <button class="dev-variant-btn ${currentCardStyle === 'full' ? 'active' : ''}" onclick="window.setDevCardStyle('full', this)">Full</button>
        <button class="dev-variant-btn ${currentCardStyle === 'compact' ? 'active' : ''}" onclick="window.setDevCardStyle('compact', this)">Compact</button>
        <button class="dev-variant-btn ${currentCardStyle === 'mini' ? 'active' : ''}" onclick="window.setDevCardStyle('mini', this)">Mini</button>
    `;
    document.body.appendChild(switcher);

    window.setDevCardStyle = function(style, btn) {
        currentCardStyle = style;
        document.querySelectorAll('.dev-variant-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        if (selectedPilotData) {
            renderSelectedPilotPopup(selectedPilotData);
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎛️ UI CONTROLS
// ═══════════════════════════════════════════════════════════════════════════════

function recenterFleet() {
    if (!map) return;
    const latlngs = [];
    fleetBuffers.forEach(buf => {
        if (buf.initialized) latlngs.push([buf.renderLat, buf.renderLon]);
    });
    if (latlngs.length > 0) {
        map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50], maxZoom: 10 });
    }
}

function toggleLayerStyle() {
    if (!map || !tileLayer) return;
    const styles = ['dark', 'satellite', 'voyager'];
    const nextIdx = (styles.indexOf(currentTileStyle) + 1) % styles.length;
    currentTileStyle = styles[nextIdx];
    map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(TILE_STYLES[currentTileStyle], { maxZoom: 19 }).addTo(map);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🚀 BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initDevVariantSwitcher();
});
