/**
 * AeroNav Global Embeddable Radar Engine
 * Clean, lightweight, standalone 60FPS telemetry glide & multi-target tracking SDK
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ⚙️ INITIALIZATION & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const urlParams = new URLSearchParams(window.location.search);
const config = {
    apiKey: urlParams.get('api_key') || urlParams.get('key') || '',
    vatsim: urlParams.get('vatsim') || '',
    fshubToken: urlParams.get('fshub_token') || urlParams.get('token') || '',
    fshub: urlParams.get('fshub') || '',
    ivao: urlParams.get('ivao') || '',
    route: urlParams.get('route') || '',
    showHud: urlParams.get('hud') !== 'false',
    pollIntervalMs: parseInt(urlParams.get('interval') || '4000', 10),
    style: urlParams.get('style') || 'dark'
};

let map = null;
let tileLayer = null;
let currentTileStyle = 'dark';
let activeRouteLayer = null;
let activeRouteData = null;
let selectedPilotId = null;
let isHudVisible = config.showHud;

// Aircraft tracking buffers
const fleetBuffers = new Map();
let motionAnimId = null;
let pollTimerId = null;

// Tile Layer URLs
const TILE_STYLES = {
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    voyager: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
};

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
        this.haloLayer = null;
        this.flightData = null;
        this.lastUpdateTime = 0;
    }

    pushTelemetry(telemetry) {
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

        const renderDelay = 3200; // Delay playhead by ~3.2s to interpolate smoothly between 3-4s polls
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
            // Dead-reckoning extrapolation
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
            // Smooth Hermite / Linear interpolation
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

// ═══════════════════════════════════════════════════════════════════════════════
// 🗺️ MAP INITIALIZATION & MOTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

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
        subdomains: 'abcd'
    }).addTo(map);

    startMotionLoop();
    startDataPolling();
}

function startMotionLoop() {
    function step() {
        const now = performance.now();

        fleetBuffers.forEach((buf, id) => {
            if (!buf.marker || !map.hasLayer(buf.marker)) return;
            buf.update(now);

            buf.marker.setLatLng([buf.renderLat, buf.renderLon]);

            if (buf.haloLayer && map.hasLayer(buf.haloLayer)) {
                buf.haloLayer.setLatLng([buf.renderLat, buf.renderLon]);
            }

            const markerEl = buf.marker.getElement();
            if (markerEl) {
                const rotEl = markerEl.querySelector('.aircraft-icon-svg-wrapper');
                if (rotEl) {
                    rotEl.style.transform = `rotate(${buf.renderHeading}deg)`;
                }
            }

            // If this aircraft is the selected active flight, update Live HUD & Inspector Card
            if (selectedPilotId === id && buf.flightData) {
                const liveTelem = {
                    ...buf.flightData,
                    latitude: buf.renderLat,
                    longitude: buf.renderLon,
                    heading_deg: Math.round(buf.renderHeading),
                    altitude_ft: Math.round(buf.renderAlt),
                    groundspeed_kts: Math.round(buf.renderGs)
                };
                updateLiveHud(liveTelem);
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

async function startDataPolling() {
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

        // If no targets provided, do not poll
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
        }
    } catch (err) {
        console.error('[EmbedRadar] Error polling multi-target fleet:', err);
    }
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

        if (!buf.marker) {
            const isVa = f.airline && f.airline.is_va;
            const isVatsim = f.network === 'VATSIM' || (f.vatsim && f.vatsim.is_online);

            const iconHtml = `
                <div class="aircraft-marker-container">
                    <div class="aircraft-pulse-ring ${isVa ? 'va-pulse' : (isVatsim ? 'vatsim-pulse' : '')}"></div>
                    <div class="aircraft-icon-svg-wrapper">
                        <svg class="aircraft-svg ${isVa ? 'va-color' : ''}" viewBox="0 0 24 24" width="34" height="34">
                            <path fill="${isVa ? '#c084fc' : '#38bdf8'}" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
                        </svg>
                    </div>
                    <div class="aircraft-radar-label">
                        <span class="callsign">${f.callsign}</span>
                        <span class="alt-spd">FL${Math.round(buf.renderAlt / 100)} • ${Math.round(buf.renderGs)}kt</span>
                    </div>
                </div>
            `;

            const icon = L.divIcon({
                className: 'custom-aircraft-radar-icon',
                html: iconHtml,
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });

            buf.marker = L.marker([buf.renderLat, buf.renderLon], { icon, zIndexOffset: 1000 }).addTo(map);

            buf.haloLayer = L.circleMarker([buf.renderLat, buf.renderLon], {
                radius: 18,
                color: isVa ? '#c084fc' : '#38bdf8',
                weight: 1.5,
                opacity: 0.8,
                fillColor: isVa ? '#c084fc' : '#38bdf8',
                fillOpacity: 0.12
            }).addTo(map);

            buf.marker.on('click', () => {
                selectPilot(id, f);
            });
        }

        bounds.push([buf.renderLat, buf.renderLon]);

        // Auto-select first flight if none selected
        if (!selectedPilotId && idx === 0) {
            selectPilot(id, f);
        }
    });

    // Remove inactive flights
    fleetBuffers.forEach((buf, id) => {
        if (!currentFlightIds.has(id)) {
            if (buf.marker) map.removeLayer(buf.marker);
            if (buf.haloLayer) map.removeLayer(buf.haloLayer);
            fleetBuffers.delete(id);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🛩️ PILOT INSPECTOR & FLIGHT CORRIDOR SELECTION
// ═══════════════════════════════════════════════════════════════════════════════

async function selectPilot(id, pilotData) {
    selectedPilotId = id;
    renderSelectedPilotPopup(pilotData);

    const routeStr = pilotData.route || pilotData.flight_plan?.route;
    const dep = pilotData.departure || pilotData.flight_plan?.departure;
    const arr = pilotData.arrival || pilotData.flight_plan?.arrival;

    if (routeStr || (dep && arr && arr !== 'STANDBY')) {
        await loadAndTraceRoute(routeStr || `${dep} ${arr}`, dep, arr);
    }
}

async function loadAndTraceRoute(routeStr, dep, arr) {
    try {
        const res = await fetch('/api/v1/route/trace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ route: routeStr, depIcao: dep, arrIcao: arr })
        });

        if (!res.ok) return;
        const routeData = await res.json();
        activeRouteData = routeData;

        if (activeRouteLayer) map.removeLayer(activeRouteLayer);

        if (routeData.waypoints && routeData.waypoints.length > 1) {
            const latlngs = routeData.waypoints.map(w => [w.latitude, w.longitude]);
            
            activeRouteLayer = L.polyline(latlngs, {
                color: '#38bdf8',
                weight: 3,
                opacity: 0.85,
                dashArray: '6, 6'
            }).addTo(map);

            map.fitBounds(activeRouteLayer.getBounds(), { padding: [50, 50] });
        }
    } catch (err) {
        console.error('[EmbedRadar] Error tracing route corridor:', err);
    }
}

function renderSelectedPilotPopup(pilot) {
    const card = document.getElementById('fshubLivePopup');
    const content = document.getElementById('inspectorContent');
    if (!card || !content || !pilot) return;

    const alt = Math.round(pilot.altitude_ft || pilot.position?.altitude_ft || 0);
    const gs = Math.round(pilot.groundspeed_kts || pilot.position?.speed_tas_kts || 0);
    const hdg = Math.round(pilot.heading_deg || pilot.position?.heading || 0);
    const dep = pilot.departure || pilot.flight_plan?.departure || '???';
    const arr = pilot.arrival || pilot.flight_plan?.arrival || '???';
    const routeStr = pilot.route || pilot.flight_plan?.route || null;
    const rawAc = pilot.aircraft || pilot.flight_plan?.aircraft || '';
    const phase = (pilot.phase || (gs > 30 ? 'AIRBORNE' : 'TAXIING')).replace('_', ' ').toUpperCase();
    const isVa = pilot.airline && pilot.airline.is_va;

    content.innerHTML = `
        <!-- Top Header -->
        <div class="inspector-header">
            <div class="inspector-pilot-identity">
                <img src="${pilot.pilot_avatar || '/assets/default-pilot-avatar.png'}" onerror="this.src='/assets/default-pilot-avatar.png'" class="inspector-avatar" alt="${pilot.pilot_name}">
                <div>
                    <div class="inspector-callsign">${pilot.callsign}</div>
                    <div class="inspector-pilot-name">👤 ${pilot.pilot_name || 'Pilot'}${isVa ? ` • <span style="color: #c084fc; font-weight: 600;">${pilot.airline.abbr} • ${pilot.airline.name} VA</span>` : ''}${rawAc ? ` • <span style="color: #38bdf8; font-weight: 500;">✈️ ${rawAc}</span>` : ''}</div>
                </div>
            </div>
            <span class="live-phase-pill" id="inspectorPhasePill">${phase}</span>
        </div>

        <!-- Flight Plan Corridor Box -->
        <div class="inspector-flight-plan-box">
            ${isVa ? `
                <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 6px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 0.74rem;">
                    <span style="color: #94a3b8; font-weight: 500;">OPERATOR</span>
                    <span style="color: #38bdf8; font-weight: 600;">🏢 ${pilot.airline.abbr} • ${pilot.airline.name} VA</span>
                </div>
            ` : ''}
            <div class="inspector-route-header">
                <span class="origin-arr">${dep}</span>
                <span style="color: #38bdf8; font-size: 1.15rem;">➔</span>
                <span class="origin-arr" style="${arr === 'STANDBY' ? 'color: #94a3b8; font-size: 0.9rem;' : ''}">${arr || 'STANDBY'}</span>
                <span class="fl-tag" id="inspectorFlTag">FL${Math.round(alt / 100)}</span>
            </div>
            ${routeStr ? `
                <div class="inspector-route-string">
                    <strong style="color: #38bdf8;">FILED ROUTE:</strong> ${routeStr}
                </div>
            ` : `
                <div style="font-size: 0.72rem; color: #94a3b8; font-style: italic;">
                    Direct Great-Circle Flight Path (${dep} ➔ ${arr})
                </div>
            `}
        </div>

        <!-- Telemetry Matrix with Matched Live Colors -->
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
                    <span>🌐 VATSIM CID:</span>
                    <strong>${pilot.vatsim?.cid || 'Not Linked'}</strong>
                </div>
                <span class="vatsim-status-pill ${pilot.vatsim?.is_online ? 'online' : 'offline'}">
                    ${pilot.vatsim?.is_online ? '🟢 ONLINE ON VATSIM' : '⚪ VATSIM OFFLINE'}
                </span>
            </div>
        </div>
    `;

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
    if (elAlt) elAlt.textContent = `${alt.toLocaleString()} ft`;

    const elSpeed = document.getElementById('inspectorSpeed');
    if (elSpeed) elSpeed.textContent = `${gs} kts`;

    const elHdg = document.getElementById('inspectorHdg');
    if (elHdg) elHdg.textContent = `${String(hdg).padStart(3, '0')}°`;

    const elFl = document.getElementById('inspectorFlTag');
    if (elFl) elFl.textContent = `FL${Math.round(alt / 100)}`;

    const elPhase = document.getElementById('inspectorPhasePill');
    if (elPhase) elPhase.textContent = phase;
}

function updateLiveHud(data) {
    const hud = document.getElementById('liveHudCard');
    if (!hud || !data || !isHudVisible) {
        if (hud) hud.style.display = 'none';
        return;
    }

    hud.style.display = 'block';
    document.getElementById('hudCallsign').textContent = data.callsign;
    document.getElementById('hudAircraft').textContent = `${data.airline ? data.airline.name + ' • ' : ''}${data.aircraft || ''}`;
    document.getElementById('hudPhase').textContent = (data.phase || 'CRUISE').replace('_', ' ');
    document.getElementById('hudAlt').textContent = `${Math.round(data.altitude_ft || 0).toLocaleString()} ft`;
    document.getElementById('hudGs').textContent = `${Math.round(data.groundspeed_kts || 0)} kts`;
    document.getElementById('hudHdg').textContent = `${String(Math.round(data.heading_deg || 0) % 360).padStart(3, '0')}°`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎛️ UI CONTROLS
// ═══════════════════════════════════════════════════════════════════════════════

function closeInspectorCard() {
    const card = document.getElementById('fshubLivePopup');
    if (card) card.classList.add('hidden');
    selectedPilotId = null;
}

function toggleHud() {
    isHudVisible = !isHudVisible;
    const hud = document.getElementById('liveHudCard');
    const btn = document.getElementById('toggleHudBtn');
    if (hud) hud.style.display = isHudVisible ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', isHudVisible);
}

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
});
