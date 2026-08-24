
let map;
let routeLayerGroup;
let fleetMarkersLayerGroup = null;

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupTabs();
    setupEventListeners();
    setupSimbrief();
    setupLiveTracking();
    setupFshubLiveHub();

    // Check if we are in Local Dev mode; only inject dev tools if confirmed
    initDevEnvironmentIfLocal();

    const badge = document.getElementById('mapBadge');
    if (badge) badge.style.display = 'none';
});

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

let lastMarkerClickTime = 0;

function initMap() {
    map = L.map('map', {
        zoomControl: true,
        attributionControl: false,
        worldCopyJump: true
    }).setView([38.5, -96.0], 4);

    // Dark Carto Basemap
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(map);

    routeLayerGroup = L.layerGroup().addTo(map);
    fleetMarkersLayerGroup = L.layerGroup().addTo(map);

    // Keep active aircraft marker dynamically synced to currently visible world tile when panning
    map.on('move', () => {
        if (aircraftMarker && latestSinglePilotData && latestSinglePilotData.telemetry) {
            const t = latestSinglePilotData.telemetry;
            const rawLat = t.latitude !== undefined ? t.latitude : (t.position?.lat !== undefined ? t.position.lat : t.lat);
            const rawLon = t.longitude !== undefined ? t.longitude : (t.position?.lng !== undefined ? t.position.lng : t.lng);
            if (typeof rawLat === 'number' && typeof rawLon === 'number') {
                const visLon = getVisibleLongitude(rawLon, map);
                aircraftMarker.setLatLng([rawLat, visLon]);
            }
        }
    });

    // When panning across world copies, re-align flight route polyline to current viewport
    map.on('moveend', () => {
        if (routeVisible && currentRouteData && Array.isArray(currentRouteData.route_coordinates) && currentRouteData.route_coordinates.length > 0) {
            renderRouteOnMap(currentRouteData, false);
        }
    });

    // Click-away listener: unloads the route flight plan only when user clicks on empty map space
    map.on('click', (e) => {
        // If a marker was clicked recently (within 1000ms), do NOT clear
        if (Date.now() - lastMarkerClickTime < 1000) return;
        if (e && e.originalEvent && e.originalEvent._stopped) return;
        const target = e?.originalEvent?.target;
        if (!target) return;

        // If clicked inside any marker, popup, card, hud, or interactive element, do NOT clear
        if (target.closest && target.closest('.fshub-live-card, .floating-hud, .aircraft-marker-container, .aircraft-div-icon, .leaflet-marker-icon, .leaflet-popup, .leaflet-control, .map-wp-label, .plane-leaflet-tooltip, #fshubLivePopup')) {
            return;
        }

        clearRouteFromMap();
    });
}

function setupTabs() {
    const tabNav = document.getElementById('tabNavContainer');
    tabNav.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;

        const allBtns = document.querySelectorAll('.tab-btn');
        const allContents = document.querySelectorAll('.tab-content');

        allBtns.forEach(b => b.classList.remove('active'));
        allContents.forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const target = btn.getAttribute('data-tab');
        const targetEl = document.getElementById(target);
        if (targetEl) targetEl.classList.add('active');
    });
}

function setupEventListeners() {
    document.getElementById('traceBtn').addEventListener('click', traceRoute);

    const labelToggle = document.getElementById('toggleWpLabels');
    if (labelToggle) {
        labelToggle.checked = showWaypointLabels;
        labelToggle.addEventListener('change', (e) => {
            showWaypointLabels = e.target.checked;
            localStorage.setItem('show_wp_labels', showWaypointLabels);
            if (currentRouteData) {
                renderRouteOnMap(currentRouteData, false); // Keep current zoom & pan position
            }
        });
    }


    const searchBtn = document.getElementById('searchSubmitBtn');
    if (searchBtn) searchBtn.addEventListener('click', executeSearch);

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeSearch();
        });
    }
}

async function initDevEnvironmentIfLocal() {
    try {
        const res = await fetch('/api/v1/config/env');
        const data = await res.json();

        // ONLY inject Dev Tabs if confirmed Local Dev environment
        if (data.is_dev) {
            injectDevTabs();
        }
    } catch (e) {}
}

function injectDevTabs() {
    const tabNav = document.getElementById('tabNavContainer');
    const devContainer = document.getElementById('devTabsContainer');

    // Add Tab Buttons
    const docsBtn = document.createElement('button');
    docsBtn.className = 'tab-btn';
    docsBtn.setAttribute('data-tab', 'tab-api');
    docsBtn.textContent = '📡 API Docs';

    const keysBtn = document.createElement('button');
    keysBtn.className = 'tab-btn';
    keysBtn.setAttribute('data-tab', 'tab-keys');
    keysBtn.textContent = '🔑 API Keys & Git';

    tabNav.appendChild(docsBtn);
    tabNav.appendChild(keysBtn);

    // Inject Tab Content
    devContainer.innerHTML = `
        <!-- TAB 3: API DOCS (DEV ONLY) -->
        <div class="tab-content" id="tab-api">
            <div class="control-card compose-card">
                <div class="card-header-flex">
                    <h3>🐳 Docker Compose & Dockage Stack</h3>
                    <button id="copyComposeBtn" class="btn-copy">📋 Copy YAML</button>
                </div>
                <p class="help-text">Copy and paste this configuration directly into <strong>Portainer Web Editor</strong>, <strong>Dockage</strong>, or your server's <code>docker-compose.yml</code>.</p>
                <div class="code-block-wrapper">
                    <pre class="code-pre"><code id="composeYamlCode">version: '3.8'

services:
  global-aviation-nav-db:
    image: ghcr.io/mytechreview/global-aviation-nav-db:latest
    container_name: global-aviation-nav-db
    restart: unless-stopped
    ports:
      - "3510:3510"
    environment:
      - PORT=3510
      - NODE_ENV=production
      - MAPBOX_ACCESS_TOKEN=
    volumes:
      - aeronav_keys:/app/data/keys
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3510/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  aeronav_keys:
    name: aeronav_api_keys</code></pre>
                </div>
            </div>

            <div class="control-card">
                <h3>🔑 Authentication</h3>
                <p class="help-text">Pass API Key via <code>X-API-Key</code> header or <code>?api_key=</code> parameter. Public telemetry endpoints allow direct CORS pass-through.</p>
            </div>

            <!-- MULTI-NETWORK TARGET ARRAY TRACKING -->
            <div class="control-card">
                <h3>🌐 Multi-Network Live Target Array API</h3>
                <div class="api-doc-item">
                    <div class="api-doc-header"><span class="method post">POST</span> <code>/api/v1/live/multi</code></div>
                    <p class="api-doc-desc">Concurrently tracks any combination of VATSIM CIDs/callsigns, FSHub tokens/user IDs/VAs, and IVAO IDs in a single batch request.</p>
                    <pre class="code-pre" style="margin-top: 6px;"><code>// Request Body
{
  "targets": [
    { "network": "VATSIM", "id": "1011180" },
    { "network": "FSHUB", "token": "18bXlTA3OUu6F2ShL0XGuHBtCE1AEWsXef4ISoIs6pPM2XaU6KVgKNuudu6Q" },
    { "network": "FSHUB", "id": "NeightWolf49" }
  ]
}

// Response Schema
{
  "success": true,
  "total_flights": 2,
  "flights": [
    {
      "id": "fshub_va_N121HJ",
      "network": "FSHub",
      "callsign": "N121HJ",
      "pilot_name": "gorillaglue4",
      "airline": { "name": "WolfAir Aviation", "abbr": "WLF", "is_va": true },
      "aircraft": "HDJT",
      "departure": "GMMX",
      "arrival": "LEMD",
      "route": "GMMX OBOGA VALBA TOLSI KORIS VJF HIJ PARKA SOTUK LEMD",
      "latitude": 40.7018,
      "longitude": -3.5758,
      "altitude_ft": 5444,
      "groundspeed_kts": 126,
      "heading_deg": 185,
      "squawk": "2117",
      "phase": "ON APPROACH",
      "vatsim": { "cid": "1011180", "is_online": false }
    }
  ]
}</code></pre>
                </div>
            </div>

            <!-- MODULAR RADAR EMBED & SDK -->
            <div class="control-card">
                <h3>🛩️ Modular Radar Embed SDK</h3>
                <p class="help-text">Embed a standalone, clean 60FPS telemetry radar map with live route corridors and slide-over pilot inspector without any sidebars or management controls:</p>
                <pre class="code-pre"><code>&lt;!-- Clean Responsive Map Embed --&gt;
&lt;iframe 
  src="http://localhost:3510/embed.html?fshub_token=YOUR_TOKEN&vatsim=1011180" 
  width="100%" 
  height="650px" 
  frameborder="0" 
  style="border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);"&gt;
&lt;/iframe&gt;</code></pre>
                <div style="font-size: 0.76rem; color: #94a3b8; margin-top: 8px;">
                    <strong>Embed URL Parameters:</strong><br>
                    • <code>?fshub_token=...</code> : Inspect FSHub pilot & Virtual Airline fleet<br>
                    • <code>?vatsim=...</code> : Track VATSIM CIDs or Callsigns (comma separated)<br>
                    • <code>?fshub=...</code> : Track FSHub pilot usernames or IDs<br>
                    • <code>?hud=false</code> : Hide floating cockpit telemetry HUD<br>
                    • <code>?route=...</code> : Preset custom flight corridor route
                </div>
            </div>

            <!-- CORE DATA PASS-THROUGH ENDPOINTS -->
            <div class="control-card">
                <h3>📡 Data Pass-Through & Flight Planning Endpoints</h3>
                <div class="api-doc-item">
                    <div class="api-doc-header"><span class="method post">POST</span> <code>/api/v1/route/trace</code></div>
                    <p class="api-doc-desc">Traces flight plan with SIDs, Airways, STARs, and international fixes into geodesic coordinates and GeoJSON corridors.</p>
                </div>
                <div class="api-doc-item">
                    <div class="api-doc-header"><span class="method all">POST/GET</span> <code>/api/v1/fshub/inspect</code></div>
                    <p class="api-doc-desc">Pass FSHub Token to fetch user profile, stats, personal flight, and active VA fleet flights.</p>
                </div>
                <div class="api-doc-item">
                    <div class="api-doc-header"><span class="method post">POST</span> <code>/api/v1/simbrief/trace</code></div>
                    <p class="api-doc-desc">Auto-import and trace SimBrief OFP in 1 step.</p>
                </div>
                <div class="api-doc-item">
                    <div class="api-doc-header"><span class="method get">GET</span> <code>/api/v1/waypoints/search?q=MATLK</code></div>
                    <p class="api-doc-desc">Search global navigation fixes, VORs, NDBs, and airports.</p>
                </div>
                <div class="api-doc-item">
                    <div class="api-doc-header"><span class="method all">GET/POST</span> <code>/api/v1/waypoints/custom</code></div>
                    <p class="api-doc-desc">Inspect or add/update custom persistent navigation waypoints in <code>data/custom-global-waypoints.json</code>.</p>
                </div>
            </div>
        </div>

        <!-- TAB 4: API KEYS & GIT (DEV ONLY) -->
        <div class="tab-content" id="tab-keys">
            <div class="control-card git-card">
                <div class="card-header-flex">
                    <h3>🚀 GitHub Cloud Sync</h3>
                    <a href="https://github.com/MYTECHREVIEW/global-aviation-nav-db" target="_blank" class="github-link-btn">View Repo ↗</a>
                </div>
                <p class="help-text">Push changes directly to GitHub so Portainer on TrueNAS can pull and update.</p>
                <div class="git-status-row">
                    <span class="status-indicator-dot" id="gitStatusDot"></span>
                    <span id="gitStatusText">Checking GitHub sync status...</span>
                </div>
                <div id="gitFilesContainer" class="git-files-container">
                    <div class="git-files-header">
                        <span class="git-files-title">📂 Pending Local Changes (<span id="gitFilesCount">0</span>)</span>
                        <button id="gitRefreshBtn" class="btn-refresh-sm">🔄 Refresh</button>
                    </div>
                    <div id="gitFilesList" class="git-files-list">
                        <div class="git-file-empty">Checking working directory...</div>
                    </div>
                </div>
                <div class="input-group">
                    <label>Commit Message (Optional)</label>
                    <input type="text" id="gitCommitMsg" placeholder="e.g. Update route parser and database" />
                </div>
                <button id="gitPushBtn" class="btn-primary btn-git"><span>⬆️ Push Changes to GitHub</span></button>
                <div id="gitPushResult" class="git-push-result" style="display: none;"></div>
            </div>

            <div class="control-card">
                <h3>🔑 Generate API Key</h3>
                <div class="input-grid">
                    <div>
                        <label>Key Name</label>
                        <input type="text" id="newKeyName" placeholder="e.g. Flight Tracker Webhook" />
                    </div>
                    <div>
                        <label>Expiration</label>
                        <select id="newKeyExpires" class="custom-select">
                            <option value="">Never (Permanent)</option>
                            <option value="30">30 Days</option>
                            <option value="90">90 Days</option>
                            <option value="365" selected>1 Year</option>
                        </select>
                    </div>
                </div>
                <button id="generateKeyBtn" class="btn-primary" style="margin-top: 10px;"><span>⚡ Generate API Key</span></button>
                <div id="createdKeyBox" class="created-key-box" style="display: none;">
                    <div class="created-key-header">
                        <span class="badge-success">New API Key Created</span>
                    </div>
                    <div class="key-display-row">
                        <code id="createdKeyVal">aeronav_live_...</code>
                        <button id="copyKeyBtn" class="btn-copy">📋 Copy</button>
                    </div>
                </div>
            </div>

            <div class="control-card">
                <div class="card-header-flex">
                    <h3>Active API Keys</h3>
                    <button id="refreshKeysBtn" class="btn-refresh">🔄 Refresh</button>
                </div>
                <div class="table-scroll">
                    <table class="wp-table keys-table">
                        <thead>
                            <tr>
                                <th>Client Name</th>
                                <th>API Key</th>
                                <th>Reqs</th>
                                <th>Status</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody id="keysTableBody"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    setupDevTabEvents();
}

function setupDevTabEvents() {
    const copyComposeBtn = document.getElementById('copyComposeBtn');
    if (copyComposeBtn) {
        copyComposeBtn.addEventListener('click', () => {
            const yaml = document.getElementById('composeYamlCode').textContent;
            navigator.clipboard.writeText(yaml).then(() => {
                copyComposeBtn.textContent = '✅ Copied!';
                setTimeout(() => { copyComposeBtn.textContent = '📋 Copy YAML'; }, 2000);
            });
        });
    }

    const gitPushBtn = document.getElementById('gitPushBtn');
    if (gitPushBtn) gitPushBtn.addEventListener('click', pushToGithub);

    const gitRefreshBtn = document.getElementById('gitRefreshBtn');
    if (gitRefreshBtn) gitRefreshBtn.addEventListener('click', checkGitStatus);

    const genKeyBtn = document.getElementById('generateKeyBtn');
    if (genKeyBtn) genKeyBtn.addEventListener('click', generateApiKey);

    const copyKeyBtn = document.getElementById('copyKeyBtn');
    if (copyKeyBtn) {
        copyKeyBtn.addEventListener('click', () => {
            const val = document.getElementById('createdKeyVal').textContent;
            navigator.clipboard.writeText(val).then(() => {
                copyKeyBtn.textContent = '✅ Copied!';
                setTimeout(() => { copyKeyBtn.textContent = '📋 Copy'; }, 2000);
            });
        });
    }

    const refreshKeysBtn = document.getElementById('refreshKeysBtn');
    if (refreshKeysBtn) refreshKeysBtn.addEventListener('click', loadApiKeys);

    checkGitStatus();
    loadApiKeys();
}

function setupSimbrief() {
    const savedUser = localStorage.getItem('simbrief_username');
    if (savedUser) {
        const userEl = document.getElementById('simbriefUser');
        if (userEl) userEl.value = savedUser;
    }

    const fetchBtn = document.getElementById('simbriefFetchBtn');
    const userEl = document.getElementById('simbriefUser');
    
    if (fetchBtn) fetchBtn.addEventListener('click', fetchSimbrief);
    if (userEl) {
        userEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') fetchSimbrief();
        });
    }
}

async function fetchSimbrief() {
    const user = document.getElementById('simbriefUser').value.trim();
    const statusBox = document.getElementById('simbriefStatus');
    const fetchBtn = document.getElementById('simbriefFetchBtn');

    if (!user) {
        statusBox.style.display = 'block';
        statusBox.className = 'simbrief-status error';
        statusBox.textContent = 'Please enter a SimBrief Username or Pilot ID.';
        return;
    }

    localStorage.setItem('simbrief_username', user);

    fetchBtn.innerHTML = '<span>⏳ Fetching...</span>';
    fetchBtn.disabled = true;
    statusBox.style.display = 'none';

    try {
        const response = await fetch(`/api/v1/simbrief/fetch?username=${encodeURIComponent(user)}`);
        const ofp = await response.json();

        fetchBtn.innerHTML = '<span>📥 Fetch OFP</span>';
        fetchBtn.disabled = false;

        if (ofp.error || !ofp.success) {
            statusBox.style.display = 'block';
            statusBox.className = 'simbrief-status error';
            statusBox.textContent = `SimBrief Error: ${ofp.error || 'OFP not found'}`;
            return;
        }

        const depStr = ofp.departure_runway ? `${ofp.departure_icao}/${ofp.departure_runway}` : ofp.departure_icao;
        const arrStr = ofp.arrival_runway ? `${ofp.arrival_icao}/${ofp.arrival_runway}` : ofp.arrival_icao;

        document.getElementById('depIcao').value = ofp.departure_icao;
        document.getElementById('arrIcao').value = ofp.arrival_icao;
        document.getElementById('routeInput').value = `${depStr} ${ofp.route} ${arrStr}`;
        document.getElementById('altitudeInput').value = ofp.cruise_altitude_ft;
        document.getElementById('speedInput').value = ofp.cruise_tas_kts;

        statusBox.style.display = 'block';
        statusBox.className = 'simbrief-status success';
        statusBox.innerHTML = `✅ Loaded Flight <strong>${ofp.flight_number || ofp.aircraft_type}</strong> (${depStr} ➔ ${arrStr}) • FL${Math.round(ofp.cruise_altitude_ft / 100)}`;

        traceRoute();
    } catch (err) {
        fetchBtn.innerHTML = '<span>📥 Fetch OFP</span>';
        fetchBtn.disabled = false;
        statusBox.style.display = 'block';
        statusBox.className = 'simbrief-status error';
        statusBox.textContent = 'Network error fetching SimBrief OFP.';
    }
}

async function traceRoute() {
    const dep = document.getElementById('depIcao').value.trim().toUpperCase();
    const arr = document.getElementById('arrIcao').value.trim().toUpperCase();
    const route = document.getElementById('routeInput').value.trim();
    const alt = document.getElementById('altitudeInput').value || 35000;
    const speed = document.getElementById('speedInput').value || 450;

    if (!route && (!dep || !arr)) {
        alert('Please enter a flight plan route string, or both departure and arrival ICAO codes.');
        return;
    }

    const btn = document.getElementById('traceBtn');
    btn.innerHTML = '<span>⏳ Computing Trajectory...</span>';
    btn.disabled = true;

    try {
        const response = await fetch('/api/v1/route/trace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                departure: dep || undefined,
                arrival: arr || undefined,
                route: route || undefined,
                altitude_ft: parseInt(alt, 10),
                airspeed_kts: parseInt(speed, 10)
            })
        });

        const data = await response.json();

        btn.innerHTML = '<span>⚡ Trace Flight Path</span>';
        btn.disabled = false;

        if (data.error) {
            alert('Route Error: ' + data.error);
            return;
        }

        renderRouteOnMap(data);
        const mapBadge = document.getElementById('mapBadge');
        if (mapBadge) mapBadge.style.display = 'flex';
        updateTelemetryCard(data);
        updateWaypointLog(data.waypoints);
    } catch (err) {
        btn.innerHTML = '<span>⚡ Trace Flight Path</span>';
        btn.disabled = false;
        alert('Failed to contact Route Engine API: ' + err.message);
    }
}

async function loadFlightPlanRoute(dep, arr, route, alt = 35000, speed = 450, targetFlight = null) {
    if (!dep && !arr && !route) return;
    routeVisible = true;

    const safeAlt = parseInt(alt, 10) > 1000 ? parseInt(alt, 10) : 35000;
    const safeSpeed = parseInt(speed, 10) > 50 ? parseInt(speed, 10) : 450;

    // Update input boxes in UI tab
    const depEl = document.getElementById('depIcao');
    const arrEl = document.getElementById('arrIcao');
    const routeEl = document.getElementById('routeInput');
    const altEl = document.getElementById('altitudeInput');
    const spdEl = document.getElementById('speedInput');

    if (depEl && dep) depEl.value = dep;
    if (arrEl && arr) arrEl.value = arr;
    if (routeEl) routeEl.value = route || '';
    if (altEl) altEl.value = safeAlt;
    if (spdEl) spdEl.value = safeSpeed;

    try {
        let payload = {
            departure: dep || undefined,
            arrival: arr || undefined,
            route: route || undefined,
            altitude_ft: safeAlt,
            speed_kts: safeSpeed
        };

        let response = await fetch('/api/v1/route/trace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let data = await response.json();

        // If specific route string errored (e.g. unrecognized airway/fix), fall back to direct Great-Circle between airports
        if (data.error && dep && arr) {
            console.warn('[Route] Trace fallback to direct dep/arr due to:', data.error);
            payload = {
                departure: dep,
                arrival: arr,
                altitude_ft: safeAlt,
                speed_kts: safeSpeed
            };
            response = await fetch('/api/v1/route/trace', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            data = await response.json();
        }

        if (data.error) {
            console.error('[Route] Route engine failed:', data.error);
            return;
        }

        renderRouteOnMap(data, false);

        const mapBadge = document.getElementById('mapBadge');
        if (mapBadge) mapBadge.style.display = 'flex';
        updateTelemetryCard(data);
        updateWaypointLog(data.waypoints);

        if (targetFlight) {
            updateLiveHud({
                callsign: targetFlight.callsign,
                identifier: targetFlight.callsign,
                pilot_name: targetFlight.pilot_name,
                network: 'FSHub',
                latitude: targetFlight.position?.lat !== undefined ? targetFlight.position.lat : targetFlight.latitude,
                longitude: targetFlight.position?.lng !== undefined ? targetFlight.position.lng : targetFlight.longitude,
                altitude_ft: targetFlight.position?.altitude_ft || targetFlight.altitude_ft || safeAlt,
                groundspeed_kts: targetFlight.position?.speed_tas_kts || targetFlight.groundspeed_kts || safeSpeed,
                heading_deg: targetFlight.position?.heading || targetFlight.heading_deg || 0,
                flight_plan: {
                    departure: dep,
                    arrival: arr,
                    route: route,
                    aircraft: targetFlight.aircraft || 'Unknown'
                }
            });
        }
    } catch (e) {
        console.error('[Route] Error loading flight plan route:', e);
    }
}

let currentRouteData = null;
let routeVisible = true;
let latestSinglePilotData = null;
let showWaypointLabels = localStorage.getItem('show_wp_labels') !== 'false';

function unwrapLatLngs(coords) {
    if (!coords || coords.length === 0) return [];
    const unwrapped = [];
    let prevLon = null;

    for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        const lat = Array.isArray(c) ? c[0] : c.lat;
        let lon = Array.isArray(c) ? c[1] : (c.lng !== undefined ? c.lng : c.lon);

        if (prevLon !== null) {
            while (lon - prevLon > 180) lon -= 360;
            while (lon - prevLon < -180) lon += 360;
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

function renderRouteOnMap(data, autoFit = true) {
    currentRouteData = data;
    routeLayerGroup.clearLayers();

    if (!data.route_coordinates || data.route_coordinates.length === 0) return;

    const rawLatLngs = data.route_coordinates.map(c => [c[1], c[0]]);
    const baseLatLngs = unwrapLatLngs(rawLatLngs);

    // Shift entire route polyline to match the active viewport world copy
    const mapCenterLng = map ? map.getCenter().lng : -96.0;
    const worldShift = getRouteWorldShift(baseLatLngs, mapCenterLng);
    const latLngs = baseLatLngs.map(([lat, lon]) => [lat, lon + worldShift]);

    // Glow background line
    L.polyline(latLngs, {
        color: '#00ff88',
        weight: 6,
        opacity: 0.25,
        lineCap: 'round'
    }).addTo(routeLayerGroup);

    // Primary flight path polyline
    const flightPath = L.polyline(latLngs, {
        color: '#00ff88',
        weight: 3,
        opacity: 0.9,
        dashArray: '8, 4',
        lineCap: 'round'
    }).addTo(routeLayerGroup);

    let runningWpLon = data.waypoints.length > 0 ? (data.waypoints[0].unwrapped_longitude !== undefined ? data.waypoints[0].unwrapped_longitude : data.waypoints[0].longitude) : 0;

    // Markers for waypoints
    data.waypoints.forEach((wp, idx) => {
        const isVor = wp.type.includes('VOR') || wp.type.includes('TACAN') || wp.type.includes('NDB');
        const isApt = wp.type === 'AIRPORT';
        const isFix = wp.type === 'TERMINAL_WAYPOINT' || wp.type === 'INTERSECTION' || wp.type === 'FIX';

        let wpLon = wp.unwrapped_longitude !== undefined ? wp.unwrapped_longitude : wp.longitude;
        if (idx > 0) {
            while (wpLon - runningWpLon > 180) wpLon -= 360;
            while (wpLon - runningWpLon < -180) wpLon += 360;
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
        }).addTo(routeLayerGroup);

        // Bind Permanent Tooltip (Label) if enabled
        if (showWaypointLabels) {
            marker.bindTooltip(wp.ident, {
                permanent: true,
                direction: 'top',
                offset: [0, -6],
                className: labelClass
            });
        }

        const popupContent = `
            <div style="font-family: 'Inter', sans-serif; font-size: 12px; color: #fff; min-width: 150px;">
                <div style="font-weight: 700; font-size: 14px; color: ${markerColor}; margin-bottom: 4px;">
                    #${wp.sequence} ${wp.ident} ${wp.name && wp.name !== wp.ident ? `(${wp.name})` : ''}
                </div>
                <div style="color: #94a3b8; font-size: 11px; margin-bottom: 6px;">${wp.type} ${wp.via_procedure ? `• ${wp.via_procedure}` : (wp.via_airway ? `• Airway ${wp.via_airway}` : '')}</div>
                <div>📍 <strong>Lat/Lon:</strong> ${wp.latitude.toFixed(4)}, ${wp.longitude.toFixed(4)}</div>
                ${wp.frequency_mhz ? `<div>📻 <strong>Freq:</strong> ${wp.frequency_mhz} MHz</div>` : ''}
                ${wp.elevation_ft ? `<div>⛰️ <strong>Elev:</strong> ${wp.elevation_ft} ft</div>` : ''}
                <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.1); color: #00ff88;">
                    📏 <strong>Leg:</strong> ${wp.segment_distance_nm} NM (${wp.segment_bearing_deg}°) | <strong>Total:</strong> ${wp.cumulative_distance_nm} NM
                </div>
            </div>
        `;
        marker.bindPopup(popupContent);
    });

    if (autoFit) {
        map.fitBounds(flightPath.getBounds(), { padding: [50, 50] });
    }
}

function updateTelemetryCard(data) {
    document.getElementById('telemetryCard').style.display = 'block';
    document.getElementById('telemDist').textContent = `${data.total_distance_nm} NM`;
    document.getElementById('telemEte').textContent = data.estimated_time_enroute_formatted || '--';
    document.getElementById('telemCount').textContent = `${data.total_waypoints} Fixes`;
    document.getElementById('telemKm').textContent = `${data.total_distance_km} km`;
}

function updateWaypointLog(waypoints) {
    document.getElementById('waypointLogCard').style.display = 'block';
    const tbody = document.getElementById('waypointTableBody');
    tbody.innerHTML = '';

    waypoints.forEach(wp => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${wp.sequence}</td>
            <td><strong>${wp.ident}</strong></td>
            <td><span class="type-badge ${wp.type}">${wp.type.replace('_', ' ')}</span></td>
            <td>${wp.segment_distance_nm > 0 ? `${wp.segment_distance_nm} NM` : '-'}</td>
            <td>${wp.segment_bearing_deg > 0 ? `${wp.segment_bearing_deg}°` : '-'}</td>
            <td>${wp.cumulative_distance_nm} NM</td>
        `;

        tr.addEventListener('click', () => {
            map.flyTo([wp.latitude, wp.longitude], 8, { duration: 1.2 });
        });

        tbody.appendChild(tr);
    });
}

async function executeSearch() {
    const q = document.getElementById('searchInput').value.trim();
    if (!q) return;

    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '<div style="color: #94a3b8; font-size: 0.8rem; padding: 10px;">Searching database...</div>';

    try {
        const response = await fetch(`/api/v1/waypoints/search?q=${encodeURIComponent(q)}`);
        const data = await response.json();

        if (!data.results || data.results.length === 0) {
            resultsDiv.innerHTML = '<div style="color: #ef4444; font-size: 0.8rem; padding: 10px;">No fixes or airports found matching query.</div>';
            return;
        }

        resultsDiv.innerHTML = data.results.map(r => `
            <div class="search-item" onclick="zoomToFix(${r.latitude}, ${r.longitude}, '${r.ident}', '${r.type}')">
                <div class="search-item-header">
                    <strong>${r.ident}</strong>
                    <span class="type-badge ${r.type}">${r.type}</span>
                </div>
                <div style="font-size: 0.76rem; color: #94a3b8;">${r.name || r.ident} ${r.country_code ? `(${r.country_code})` : ''}</div>
                <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">📍 ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)} ${r.frequency_mhz ? `• ${r.frequency_mhz} MHz` : ''}</div>
            </div>
        `).join('');
    } catch (e) {
        resultsDiv.innerHTML = '<div style="color: #ef4444; font-size: 0.8rem; padding: 10px;">Search request failed.</div>';
    }
}

window.zoomToFix = function(lat, lon, ident, type) {
    map.flyTo([lat, lon], 9, { duration: 1 });
    L.circleMarker([lat, lon], {
        radius: 7,
        fillColor: '#38bdf8',
        color: '#fff',
        weight: 2,
        fillOpacity: 1
    }).addTo(routeLayerGroup).bindPopup(`<strong>${ident}</strong> (${type})<br>📍 ${lat.toFixed(4)}, ${lon.toFixed(4)}`).openPopup();
};

async function checkGitStatus() {
    const dot = document.getElementById('gitStatusDot');
    const text = document.getElementById('gitStatusText');
    const countSpan = document.getElementById('gitFilesCount');
    const listDiv = document.getElementById('gitFilesList');

    if (!dot || !text) return;

    try {
        const res = await fetch('/api/v1/git/status');
        const data = await res.json();

        if (data.success) {
            if (countSpan) countSpan.textContent = data.changed_files_count || 0;

            if (data.has_uncommitted_changes && data.files && data.files.length > 0) {
                dot.className = 'status-indicator-dot pending';
                text.textContent = `${data.changed_files_count} file(s) modified locally (uncommitted)`;

                if (listDiv) {
                    listDiv.innerHTML = data.files.map(f => {
                        let badgeClass = 'git-badge-m';
                        if (f.status_badge === 'A') badgeClass = 'git-badge-a';
                        else if (f.status_badge === 'D') badgeClass = 'git-badge-d';
                        else if (f.status_badge === '?') badgeClass = 'git-badge-u';

                        return `
                            <div class="git-file-item" title="${f.status_label}: ${f.path}">
                                <span class="git-badge ${badgeClass}">${f.status_label.toUpperCase()}</span>
                                <span class="git-file-path">${f.path}</span>
                            </div>
                        `;
                    }).join('');
                }
            } else {
                dot.className = 'status-indicator-dot';
                text.textContent = `In Sync: ${data.latest_commit}`;
                if (listDiv) listDiv.innerHTML = '<div class="git-file-empty">✅ Clean: All files committed & synced to GitHub main</div>';
            }
        }
    } catch (e) {}
}

async function pushToGithub() {
    const btn = document.getElementById('gitPushBtn');
    const resultBox = document.getElementById('gitPushResult');
    const msgInput = document.getElementById('gitCommitMsg');
    const msg = msgInput ? msgInput.value.trim() : '';

    if (!btn || !resultBox) return;

    btn.innerHTML = '<span>⏳ Pushing to GitHub...</span>';
    btn.disabled = true;
    resultBox.style.display = 'none';

    try {
        const res = await fetch('/api/v1/git/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg || undefined })
        });
        const data = await res.json();

        btn.innerHTML = '<span>⬆️ Push Changes to GitHub</span>';
        btn.disabled = false;
        resultBox.style.display = 'block';

        if (data.success) {
            resultBox.className = 'git-push-result success';
            resultBox.innerHTML = `✅ <strong>Pushed to GitHub successfully!</strong><br><small>TrueNAS / Portainer can now pull the updated stack.</small>`;
            if (msgInput) msgInput.value = '';
            checkGitStatus();
        } else {
            resultBox.className = 'git-push-result error';
            resultBox.textContent = `Push Error: ${data.error || 'Failed to push'}`;
        }
    } catch (err) {
        btn.innerHTML = '<span>⬆️ Push Changes to GitHub</span>';
        btn.disabled = false;
        resultBox.style.display = 'block';
        resultBox.className = 'git-push-result error';
        resultBox.textContent = `Network error: ${err.message}`;
    }
}

async function loadApiKeys() {
    const tbody = document.getElementById('keysTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748b;">Loading keys...</td></tr>';

    try {
        const res = await fetch('/api/v1/auth/keys');
        const data = await res.json();

        if (!data.keys || data.keys.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748b;">No API keys generated yet.</td></tr>';
            return;
        }

        tbody.innerHTML = data.keys.map(k => `
            <tr>
                <td>
                    <div style="font-weight: 700; color: #f8fafc;">${k.name || 'Unnamed Client'}</div>
                    <div style="font-size: 0.7rem; color: #64748b;">${k.created_at ? new Date(k.created_at).toLocaleDateString() : ''} ${k.expires_at ? `• Exp: ${new Date(k.expires_at).toLocaleDateString()}` : '• Permanent'}</div>
                </td>
                <td>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <code style="font-size: 0.72rem; color: #00ff88; background: #000; padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(0,255,136,0.2); max-width: 210px; overflow-x: auto; white-space: nowrap;">${k.key || k.masked_key}</code>
                        <button class="btn-copy" style="padding: 2px 6px; font-size: 0.68rem;" onclick="copyFullKey('${k.key || k.masked_key}', this)">📋 Copy</button>
                    </div>
                </td>
                <td>${k.request_count || 0}</td>
                <td><span style="color: ${k.status === 'active' ? '#00ff88' : '#ef4444'}; font-weight: 600; font-size: 0.75rem;">${k.status.toUpperCase()}</span></td>
                <td>
                    ${k.status === 'active' ? `<button class="btn-revoke" onclick="revokeKey('${k.id}')">Revoke</button>` : '<span style="color:#64748b; font-size: 0.72rem;">Revoked</span>'}
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #ef4444;">Failed to load API keys.</td></tr>';
    }
}

async function generateApiKey() {
    const nameInput = document.getElementById('newKeyName');
    const expiresSelect = document.getElementById('newKeyExpires');
    const name = nameInput ? nameInput.value.trim() || 'API Client' : 'API Client';
    const expiresInDays = expiresSelect && expiresSelect.value ? parseInt(expiresSelect.value, 10) : null;

    const btn = document.getElementById('generateKeyBtn');
    if (btn) {
        btn.innerHTML = '<span>⏳ Generating...</span>';
        btn.disabled = true;
    }

    try {
        const res = await fetch('/api/v1/auth/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, expires_in_days: expiresInDays })
        });
        const data = await res.json();

        if (btn) {
            btn.innerHTML = '<span>⚡ Generate API Key</span>';
            btn.disabled = false;
        }

        if (data.success && data.api_key) {
            document.getElementById('createdKeyVal').textContent = data.api_key.key;
            document.getElementById('createdKeyBox').style.display = 'block';
            if (nameInput) nameInput.value = '';
            loadApiKeys();
        }
    } catch (err) {
        if (btn) {
            btn.innerHTML = '<span>⚡ Generate API Key</span>';
            btn.disabled = false;
        }
        alert('Failed to generate API Key: ' + err.message);
    }
}

window.revokeKey = async function(id) {
    if (!confirm(`Are you sure you want to revoke API Key ${id}?`)) return;

    try {
        const res = await fetch(`/api/v1/auth/keys/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            loadApiKeys();
        } else {
            alert('Error revoking key: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        alert('Network error: ' + e.message);
    }
};

window.copyFullKey = function(keyVal, btnEl) {
    navigator.clipboard.writeText(keyVal).then(() => {
        const orig = btnEl.textContent;
        btnEl.textContent = '✅ Copied!';
        setTimeout(() => { btnEl.textContent = orig; }, 2000);
    });
};


// ═══════════════════════════════════════════════════════════════════════════════
// 📡 LIVE MULTI-NETWORK RADAR TRACKER (VATSIM, IVAO, FSHUB)
// ═══════════════════════════════════════════════════════════════════════════════

let activeLiveNetwork = 'VATSIM';
let liveRadarInterval = null;
let aircraftMarker = null;
let aircraftTrailLayer = null;
let aircraftTrailPoints = [];

function clearAllMapTrackingState() {
    if (liveRadarInterval) {
        clearInterval(liveRadarInterval);
        liveRadarInterval = null;
    }
    if (fshubHubInterval) {
        clearInterval(fshubHubInterval);
        fshubHubInterval = null;
    }

    if (routeLayerGroup) routeLayerGroup.clearLayers();
    if (aircraftTrailLayer && map) {
        map.removeLayer(aircraftTrailLayer);
        aircraftTrailLayer = null;
    }
    aircraftTrailPoints = [];
    if (aircraftMarker && map) {
        map.removeLayer(aircraftMarker);
        aircraftMarker = null;
    }
    if (fleetMarkersLayerGroup) fleetMarkersLayerGroup.clearLayers();
    activeFleetFlights = [];
    activeVaFlightId = null;

    const popup = document.getElementById('fshubLivePopup');
    if (popup) {
        popup.classList.add('hidden');
        popup.innerHTML = '';
    }
    const telemCard = document.getElementById('telemetryCard');
    if (telemCard) telemCard.style.display = 'none';
    const wpCard = document.getElementById('waypointLogCard');
    if (wpCard) wpCard.style.display = 'none';
    const mapBadge = document.getElementById('mapBadge');
    if (mapBadge) mapBadge.style.display = 'none';
    const hud = document.getElementById('liveHudCard');
    if (hud) hud.style.display = 'none';
}

function setupLiveTracking() {
    // Network buttons
    const netBtns = document.querySelectorAll('.network-btn');
    const netLabel = document.getElementById('netIdLabel');
    const inputEl = document.getElementById('liveIdentifier');
    const statusBox = document.getElementById('liveTrackStatus');

    netBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            netBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeLiveNetwork = btn.getAttribute('data-net');

            // Immediately wipe previous flight/fleet when switching networks
            clearAllMapTrackingState();
            if (statusBox) statusBox.style.display = 'none';

            if (activeLiveNetwork === 'VATSIM') {
                if (netLabel) netLabel.textContent = 'VATSIM Callsign or CID';
                if (inputEl) inputEl.placeholder = 'e.g. UAL2 or CID...';
            } else if (activeLiveNetwork === 'IVAO') {
                if (netLabel) netLabel.textContent = 'IVAO Callsign or VID';
                if (inputEl) inputEl.placeholder = 'e.g. AFR456 or VID...';
            } else if (activeLiveNetwork === 'FSHUB') {
                if (netLabel) netLabel.textContent = 'FSHub Callsign, Pilot ID, or Token';
                if (inputEl) inputEl.placeholder = 'e.g. Callsign, Pilot ID, or Token...';
            }
        });
    });

    const trackBtn = document.getElementById('liveTrackBtn');
    if (trackBtn) trackBtn.addEventListener('click', () => executeLiveTrack(true));

    if (inputEl) {
        inputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeLiveTrack(true);
        });
    }

    const autoToggle = document.getElementById('toggleAutoRadar');
    if (autoToggle) {
        autoToggle.addEventListener('change', (e) => {
            if (!e.target.checked && liveRadarInterval) {
                clearInterval(liveRadarInterval);
                liveRadarInterval = null;
            } else if (e.target.checked && document.getElementById('liveIdentifier').value.trim()) {
                startRadarPolling();
            }
        });
    }
}

function startRadarPolling() {
    if (liveRadarInterval) clearInterval(liveRadarInterval);
    liveRadarInterval = setInterval(() => {
        const autoToggle = document.getElementById('toggleAutoRadar');
        if (autoToggle && autoToggle.checked) {
            executeLiveTrack(false);
        }
    }, 3000);
}

async function executeLiveTrack(manualClick = false) {
    const identInput = document.getElementById('liveIdentifier');
    const simbriefInput = document.getElementById('liveSimbriefUser');
    const statusBox = document.getElementById('liveTrackStatus');
    const btn = document.getElementById('liveTrackBtn');

    const identifier = identInput ? identInput.value.trim() : '';
    const simbriefUser = simbriefInput ? simbriefInput.value.trim() : '';

    if (!identifier) {
        if (statusBox) {
            statusBox.style.display = 'block';
            statusBox.className = 'simbrief-status error';
            statusBox.textContent = `Please enter a ${activeLiveNetwork} Callsign, CID, or Token.`;
        }
        return;
    }

    if (manualClick) {
        // Immediately wipe map layers and previous popup when starting a new track query
        clearAllMapTrackingState();
        if (btn) {
            btn.innerHTML = '<span>⏳ Acquiring Radar Lock...</span>';
            btn.disabled = true;
        }
    }

    try {
        const response = await fetch('/api/v1/live/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                network: activeLiveNetwork,
                identifier: identifier,
                simbrief_username: simbriefUser || undefined
            })
        });

        const data = await response.json();

        if (manualClick && btn) {
            btn.innerHTML = '<span>📡 Track Aircraft Live</span>';
            btn.disabled = false;
        }

        if (data.error || !data.success) {
            if (statusBox) {
                statusBox.style.display = 'block';
                statusBox.className = 'simbrief-status error';
                statusBox.textContent = `Radar Error: ${data.error}`;
            }
            return;
        }

        if (statusBox) {
            statusBox.style.display = 'block';
            statusBox.className = 'simbrief-status success';
            statusBox.innerHTML = `🎯 <strong>${data.telemetry.callsign}</strong> locked on ${data.network} • FL${Math.round(data.telemetry.altitude_ft / 100)} @ ${data.telemetry.groundspeed_kts} kts`;
        }

        const isFleet = data.telemetry.fleet && Array.isArray(data.telemetry.fleet) && data.telemetry.fleet.length > 0;

        if (isFleet) {
            // Keep fleet flights registered
            activeFleetFlights = data.telemetry.fleet;
            if (aircraftMarker && map) {
                map.removeLayer(aircraftMarker);
                aircraftMarker = null;
            }

            // If a pilot is currently selected, update HUD with THAT pilot's live telemetry
            if (activeVaFlightId) {
                const sel = data.telemetry.fleet.find(f => (f.id === activeVaFlightId || f.callsign === activeVaFlightId));
                if (sel) {
                    updateLiveHud({
                        callsign: sel.callsign,
                        identifier: sel.callsign,
                        pilot_name: sel.pilot_name,
                        network: 'FSHub',
                        latitude: sel.position?.lat !== undefined ? sel.position.lat : sel.latitude,
                        longitude: sel.position?.lng !== undefined ? sel.position.lng : sel.longitude,
                        altitude_ft: sel.position?.altitude_ft || sel.altitude_ft || 0,
                        groundspeed_kts: sel.position?.speed_tas_kts || sel.groundspeed_kts || 0,
                        heading_deg: sel.position?.heading || sel.heading_deg || 0,
                        flight_plan: {
                            departure: sel.departure || sel.flight_plan?.departure,
                            arrival: sel.arrival || sel.flight_plan?.arrival,
                            route: sel.route || sel.flight_plan?.route,
                            aircraft: sel.aircraft || 'Unknown'
                        }
                    });
                }
            }

            // Render fleet markers (fit bounds only on initial manual click)
            renderFleetMarkersOnMap(data.telemetry.fleet, manualClick);
        } else {
            // Single Pilot Tracking (e.g. VATSIM / IVAO / Single Pilot)
            if (fleetMarkersLayerGroup) fleetMarkersLayerGroup.clearLayers();
            activeFleetFlights = [];
            latestSinglePilotData = data;

            if (manualClick) {
                routeVisible = true;
            }

            // Only render route polyline and waypoint cards if route is visible
            if (data.route && routeVisible) {
                renderRouteOnMap(data.route, manualClick);
                updateTelemetryCard(data.route);
                updateWaypointLog(data.route.waypoints);
            }

            updateLiveHud(data.telemetry);
            // Aircraft marker ALWAYS stays visible and tracks live
            updateAircraftMarker(data.telemetry, manualClick);

            // If user manually tracked this single pilot, display their inspector card
            if (manualClick) {
                activeVaFlightId = data.telemetry.id || data.telemetry.callsign;
                renderSelectedPilotPopup(data.telemetry);
                const popup = document.getElementById('fshubLivePopup');
                if (popup) popup.classList.remove('hidden');
            }
        }

        if (manualClick) {
            startRadarPolling();
        }
    } catch (err) {
        if (manualClick && btn) {
            btn.innerHTML = '<span>📡 Track Aircraft Live</span>';
            btn.disabled = false;
        }
        if (statusBox) {
            statusBox.style.display = 'block';
            statusBox.className = 'simbrief-status error';
            statusBox.textContent = `Connection Error: ${err.message}`;
        }
    }
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

function crossTrackDistanceNm(lat, lon, lat1, lon1, lat2, lon2) {
    const R_NM = 3440.065;
    const d13 = haversineDistanceM(lat1, lon1, lat, lon) / 1852 / R_NM;
    const brg13 = calculateBearingDeg(lat1, lon1, lat, lon) * Math.PI / 180;
    const brg12 = calculateBearingDeg(lat1, lon1, lat2, lon2) * Math.PI / 180;
    const xtd = Math.asin(Math.sin(d13) * Math.sin(brg13 - brg12));
    return xtd * R_NM;
}

function calculateEnrouteProgress(telemetry, routeData) {
    if (!telemetry) return {};
    if (!routeData || !routeData.waypoints || routeData.waypoints.length < 2) {
        const alt = telemetry.altitude_ft || 0;
        const gs = telemetry.groundspeed_kts || 0;
        return {
            flight_phase: alt > 18000 ? 'CRUISE' : (gs > 50 ? 'ENROUTE' : 'TAXI'),
            cross_track_deviation_nm: 0,
            distance_flown_nm: 0,
            distance_remaining_nm: routeData?.total_distance_nm || 0,
            progress_percent: 0,
            estimated_time_remaining_minutes: 0,
            estimated_time_remaining_formatted: '--',
            next_waypoint: null
        };
    }

    const aLat = telemetry.latitude !== undefined ? telemetry.latitude : (telemetry.position?.lat !== undefined ? telemetry.position.lat : telemetry.lat);
    const aLon = telemetry.longitude !== undefined ? telemetry.longitude : (telemetry.position?.lng !== undefined ? telemetry.position.lng : telemetry.lng);
    const gs = telemetry.groundspeed_kts || telemetry.position?.speed_tas_kts || telemetry.speed || 450;
    const alt = telemetry.altitude_ft || telemetry.position?.altitude_ft || 0;

    const waypoints = routeData.waypoints;
    let minDistanceToLeg = Infinity;
    let activeLegIndex = 1;
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

    const totalRouteDistNm = routeData.total_distance_nm || (waypoints[waypoints.length - 1].cumulative_distance_nm || 0);
    const distFromNextToEndNm = Math.max(0, totalRouteDistNm - (nextWp.cumulative_distance_nm || 0));
    const totalRemainingNm = Math.round((distToNextWpNm + distFromNextToEndNm) * 10) / 10;
    const totalFlownNm = Math.max(0, Math.round((totalRouteDistNm - totalRemainingNm) * 10) / 10);
    const progressPercent = totalRouteDistNm > 0 
        ? Math.min(100, Math.max(0, Math.round((totalFlownNm / totalRouteDistNm) * 100))) 
        : 0;

    const effectiveSpeed = gs > 50 ? gs : 400;
    const remainingMinutes = Math.round((totalRemainingNm / effectiveSpeed) * 60);
    const remainingFormatted = `${Math.floor(remainingMinutes / 60)}h ${remainingMinutes % 60}m`;

    let phase = 'ENROUTE';
    if (gs < 35 && alt < 2000 && progressPercent < 5) phase = 'TAXI_OUT';
    else if (gs >= 35 && gs < 200 && alt < 5000 && progressPercent < 15) phase = 'TAKEOFF_CLIMB';
    else if (alt >= 18000 && gs >= 250) phase = 'CRUISE';
    else if (alt < 18000 && alt >= 3000 && progressPercent > 70) phase = 'DESCENT';
    else if (alt < 3000 && gs < 180 && progressPercent > 85) phase = 'APPROACH';
    else if (gs < 35 && progressPercent > 90) phase = 'LANDED_TAXI_IN';

    return {
        flight_phase: phase,
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

// ═══════════════════════════════════════════════════════════════════════════════
// 🏢 COMPREHENSIVE AIRLINE ICAO DATABASE & VIRTUAL AIRLINE RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

const AIRLINE_ICAO_DATABASE = {
    // 🌐 Virtual Airlines
    'WLF': { name: 'Wolfair Aviation', isVa: true, callsign: 'WOLFAIR' },
    'WVA': { name: 'Wolfair Aviation', isVa: true, callsign: 'WOLFAIR' },
    'VAA': { name: 'Virtual Airlines of America', isVa: true, callsign: 'VIRTFLEET' },

    // ✈️ Real-World Major Airlines
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
    'LPE': { name: 'LATAM Peru', country: 'PE', callsign: 'LAN PERU' },
    'TAM': { name: 'LATAM Brasil', country: 'BR', callsign: 'TAM' },
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
    'VOO': { name: 'Volaris', country: 'MX', callsign: 'VOLARIS' },
    'AZU': { name: 'Azul Brazilian Airlines', country: 'BR', callsign: 'AZUL' },
    'GLO': { name: 'GOL Linhas Aéreas', country: 'BR', callsign: 'GOL' },
    'TAP': { name: 'TAP Air Portugal', country: 'PT', callsign: 'AIR PORTUGAL' },
    'SAS': { name: 'Scandinavian Airlines', country: 'SE', callsign: 'SCANDINAVIAN' },
    'FIN': { name: 'Finnair', country: 'FI', callsign: 'FINNAIR' },
    'RYR': { name: 'Ryanair', country: 'IE', callsign: 'RYANAIR' },
    'EZY': { name: 'easyJet', country: 'GB', callsign: 'EASY' },
    'EZS': { name: 'easyJet Switzerland', country: 'CH', callsign: 'TOPSWISS' },
    'WZZ': { name: 'Wizz Air', country: 'HU', callsign: 'WIZZ AIR' },
    'FDX': { name: 'FedEx Express', country: 'US', callsign: 'FEDEX' },
    'UPS': { name: 'UPS Airlines', country: 'US', callsign: 'UPS' },
    'GTI': { name: 'Atlas Air', country: 'US', callsign: 'GIANT' },
    'CLX': { name: 'Cargolux', country: 'LU', callsign: 'CARGOLUX' },
    'BOX': { name: 'AeroLogic', country: 'DE', callsign: 'GERMAN CARGO' },
    'ABX': { name: 'ABX Air', country: 'US', callsign: 'ABEX' },
    'ETD': { name: 'Etihad Airways', country: 'AE', callsign: 'ETIHAD' },
    'GFA': { name: 'Gulf Air', country: 'BH', callsign: 'GULF AIR' },
    'KAC': { name: 'Kuwait Airways', country: 'KW', callsign: 'KUWAITI' },
    'MSR': { name: 'EgyptAir', country: 'EG', callsign: 'EGYPTAIR' },
    'SVA': { name: 'Saudia', country: 'SA', callsign: 'SAUDIA' },
    'RJA': { name: 'Royal Jordanian', country: 'JO', callsign: 'JORDANIAN' },
    'MEA': { name: 'Middle East Airlines', country: 'LB', callsign: 'CEDAR JET' },
    'ELY': { name: 'El Al Israel Airlines', country: 'IL', callsign: 'ELAL' },
    'AIC': { name: 'Air India', country: 'IN', callsign: 'AIRINDIA' },
    'IGO': { name: 'IndiGo', country: 'IN', callsign: 'IFLY' },
    'SEJ': { name: 'SpiceJet', country: 'IN', callsign: 'SPICEJET' },
    'VTI': { name: 'Vistara', country: 'IN', callsign: 'VISTARA' },
    'PIA': { name: 'Pakistan International Airlines', country: 'PK', callsign: 'PAKISTAN' },
    'MAS': { name: 'Malaysia Airlines', country: 'MY', callsign: 'MALAYSIAN' },
    'AXM': { name: 'AirAsia', country: 'MY', callsign: 'RED CAP' },
    'GIA': { name: 'Garuda Indonesia', country: 'ID', callsign: 'INDONESIA' },
    'LNI': { name: 'Lion Air', country: 'ID', callsign: 'LION INTER' },
    'THA': { name: 'Thai Airways', country: 'TH', callsign: 'THAI' },
    'HVN': { name: 'Vietnam Airlines', country: 'VN', callsign: 'VIET NAM AIRLINES' },
    'PAL': { name: 'Philippine Airlines', country: 'PH', callsign: 'PHILIPPINE' },
    'CEB': { name: 'Cebu Pacific', country: 'PH', callsign: 'CEBU' },
    'KAL': { name: 'Korean Air', country: 'KR', callsign: 'KOREANAIR' },
    'AAR': { name: 'Asiana Airlines', country: 'KR', callsign: 'ASIANA' },
    'CCA': { name: 'Air China', country: 'CN', callsign: 'AIR CHINA' },
    'CES': { name: 'China Eastern Airlines', country: 'CN', callsign: 'CHINA EASTERN' },
    'CSN': { name: 'China Southern Airlines', country: 'CN', callsign: 'CHINA SOUTHERN' },
    'CHH': { name: 'Hainan Airlines', country: 'CN', callsign: 'HAINAN' },
    'EVA': { name: 'EVA Air', country: 'TW', callsign: 'EVA' },
    'CAL': { name: 'China Airlines', country: 'TW', callsign: 'DYNASTY' },
    'ANZ': { name: 'Air New Zealand', country: 'NZ', callsign: 'NEW ZEALAND' },
    'VOZ': { name: 'Virgin Australia', country: 'AU', callsign: 'VELOCITY' },
    'FJI': { name: 'Fiji Airways', country: 'FJ', callsign: 'FIJI' },
    'SAA': { name: 'South African Airways', country: 'ZA', callsign: 'SPRINGBOK' },
    'ETH': { name: 'Ethiopian Airlines', country: 'ET', callsign: 'ETHIOPIAN' },
    'KQA': { name: 'Kenya Airways', country: 'KE', callsign: 'KENYA' },
    'RAM': { name: 'Royal Air Maroc', country: 'MA', callsign: 'ROYALAIR MAROC' },
    'ARG': { name: 'Aerolíneas Argentinas', country: 'AR', callsign: 'ARGENTINA' },
    'SKU': { name: 'SKY Airline', country: 'CL', callsign: 'AEROSKY' },
    'JAT': { name: 'JetSMART', country: 'CL', callsign: 'SMART' },
    'AUT': { name: 'Austral Líneas Aéreas', country: 'AR', callsign: 'AUSTRAL' },
    'VVC': { name: 'Viva Air Colombia', country: 'CO', callsign: 'VIVA COLOMBIA' },
    'SAT': { name: 'SATENA', country: 'CO', callsign: 'SATENA' },
    'ARE': { name: 'Aeroregional', country: 'EC', callsign: 'AEROREGIONAL' },
    'TAME': { name: 'TAME', country: 'EC', callsign: 'TAME' },
    'BOV': { name: 'Boliviana de Aviación', country: 'BO', callsign: 'BOLIVIANA' },
    'EDW': { name: 'Edelweiss Air', country: 'CH', callsign: 'EDELWEISS' },
    'SWR': { name: 'Swiss International Air Lines', country: 'CH', callsign: 'SWISS' },
    'AUA': { name: 'Austrian Airlines', country: 'AT', callsign: 'AUSTRIAN' },
    'BEL': { name: 'Brussels Airlines', country: 'BE', callsign: 'BEELINE' },
    'LOT': { name: 'LOT Polish Airlines', country: 'PL', callsign: 'POLLOT' },
    'CSA': { name: 'Czech Airlines', country: 'CZ', callsign: 'CSA' },
    'TAR': { name: 'Tunisair', country: 'TN', callsign: 'TUNAIR' },
    'AHY': { name: 'Azerbaijan Airlines', country: 'AZ', callsign: 'AZAL' },
    'AFL': { name: 'Aeroflot', country: 'RU', callsign: 'AEROFLOT' },
    'SBI': { name: 'S7 Airlines', country: 'RU', callsign: 'SIBERIAN AIRLINES' }
};

function resolveAirlineInfo(callsign, flightData = null) {
    if (!callsign && !flightData) return null;

    const cs = String(callsign || flightData?.callsign || '').toUpperCase().trim();

    // 1. Direct airline object on flightData (from FSHub VA or API)
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

    // 2. Check virtual airlines array in currentFshubData or window
    const vas = currentFshubData?.virtual_airlines || (window && window.currentFshubData?.virtual_airlines);
    if (Array.isArray(vas)) {
        for (const va of vas) {
            const vaAbbr = (va.abbr || va.code || '').toUpperCase();
            if (vaAbbr && (cs.startsWith(vaAbbr) || cs === vaAbbr)) {
                return {
                    name: `${va.name} VA`,
                    abbr: vaAbbr,
                    isVa: true,
                    badge: `${vaAbbr} • ${va.name} VA`
                };
            }
        }
    }

    // 3. Extract 3-letter ICAO Prefix (e.g. WLF1121 -> WLF, UAL213 -> UAL, AAL100 -> AAL, DAL45 -> DAL)
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

function updateLiveInspectorMetrics(t) {
    if (!t) return;
    const card = document.getElementById('fshubLivePopup');
    if (!card || card.classList.contains('hidden')) return;

    const alt = Math.round(t.altitude_ft !== undefined ? t.altitude_ft : (t.position?.altitude_ft || 0));
    const gs = Math.round(t.groundspeed_kts !== undefined ? t.groundspeed_kts : (t.position?.speed_tas_kts || 0));
    const hdg = Math.round(t.heading_deg !== undefined ? t.heading_deg : (t.position?.heading || 0)) % 360;
    const phase = (t.flight_phase || t.phase || (gs > 30 ? 'CRUISE' : 'TAXIING')).replace('_', ' ').toUpperCase();

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

function updateLiveHud(t) {
    const hud = document.getElementById('liveHudCard');
    if (!hud || !t) return;

    // Merge real-time route progress calculation if not already provided
    let data = { ...t };
    if ((!data.distance_remaining_nm || data.distance_remaining_nm === 0) && currentRouteData) {
        const enrouteCalc = calculateEnrouteProgress(data, currentRouteData);
        data = { ...data, ...enrouteCalc };
    }

    const airlineInfo = resolveAirlineInfo(data.callsign, data);
    const rawAc = data.flight_plan?.aircraft || data.aircraft || '';
    const isBlankAc = !rawAc || ['AIRCRAFT', 'UNKNOWN', 'PLANE'].includes(String(rawAc).trim().toUpperCase());
    const acInfo = isBlankAc ? null : classifyAircraftType(rawAc);
    const acName = acInfo && acInfo.label ? acInfo.label : (rawAc && !isBlankAc ? `✈️ ${rawAc}` : '');

    hud.style.display = 'block';
    document.getElementById('hudCallsign').textContent = data.callsign;

    // Subtitle displays Airline (e.g. United Airlines or Wolfair Aviation VA), Aircraft model if known, and Route
    let subParts = [];
    if (airlineInfo) subParts.push(airlineInfo.badge);
    if (acName) subParts.push(acName);
    if (data.flight_plan?.departure || data.flight_plan?.arrival) {
        subParts.push(`${data.flight_plan?.departure || 'DEP'} ➔ ${data.flight_plan?.arrival || 'ARR'}`);
    } else if (data.network) {
        subParts.push(data.network);
    }
    document.getElementById('hudAircraft').innerHTML = subParts.length > 0 ? subParts.join(' • ') : (data.network || 'Radar');
    
    document.getElementById('hudPhase').textContent = (data.flight_phase || 'ENROUTE').replace('_', ' ');
    document.getElementById('hudAlt').textContent = `${Math.round(data.altitude_ft || 0).toLocaleString()} ft`;
    document.getElementById('hudGs').textContent = `${Math.round(data.groundspeed_kts || 0)} kts`;
    document.getElementById('hudHdg').textContent = `${String(Math.round(data.heading_deg || 0) % 360).padStart(3, '0')}°`;

    const xtdVal = data.cross_track_deviation_nm || 0;
    const xtdText = Math.abs(xtdVal) < 0.5 ? 'ON TRACK' : `${Math.round(Math.abs(xtdVal))} NM ${xtdVal < 0 ? 'L' : 'R'}`;
    document.getElementById('hudXtd').textContent = xtdText;

    document.getElementById('hudRemDist').textContent = `${Math.round(data.distance_remaining_nm || 0).toLocaleString()} NM`;
    document.getElementById('hudEte').textContent = data.estimated_time_remaining_formatted || '--';

    const prog = Math.round(data.progress_percent || 0);
    document.getElementById('hudProgressText').textContent = `${prog}%`;
    document.getElementById('hudProgressFill').style.width = `${prog}%`;

    const nextWpEl = document.getElementById('hudNextWp');
    if (data.next_waypoint) {
        nextWpEl.textContent = `${data.next_waypoint.ident} (${Math.round(data.next_waypoint.distance_to_go_nm)} NM @ ${String(Math.round(data.next_waypoint.bearing_deg)).padStart(3, '0')}°)`;
    } else {
        nextWpEl.textContent = 'Destination Final';
    }

    // Synchronize Slide-over Inspector Card live metrics
    updateLiveInspectorMetrics(data);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ✈️ COMPREHENSIVE ICAO AIRCRAFT DATABASE & SILHOUETTE MAPPINGS
// ═══════════════════════════════════════════════════════════════════════════════

const AIRCRAFT_ICAO_DATABASE = {
    // 🚁 Rotorcraft / Helicopters
    'A139': { name: 'AgustaWestland AW139', category: 'HELICOPTER', label: '🚁 AgustaWestland AW139', size: 32 },
    'AW139': { name: 'AgustaWestland AW139', category: 'HELICOPTER', label: '🚁 AgustaWestland AW139', size: 32 },
    'A109': { name: 'AgustaWestland AW109', category: 'HELICOPTER', label: '🚁 AgustaWestland AW109', size: 30 },
    'AW109': { name: 'AgustaWestland AW109', category: 'HELICOPTER', label: '🚁 AgustaWestland AW109', size: 30 },
    'A119': { name: 'AgustaWestland AW119 Koala', category: 'HELICOPTER', label: '🚁 AgustaWestland AW119 Koala', size: 30 },
    'A169': { name: 'AgustaWestland AW169', category: 'HELICOPTER', label: '🚁 AgustaWestland AW169', size: 32 },
    'AW169': { name: 'AgustaWestland AW169', category: 'HELICOPTER', label: '🚁 AgustaWestland AW169', size: 32 },
    'A189': { name: 'AgustaWestland AW189', category: 'HELICOPTER', label: '🚁 AgustaWestland AW189', size: 36 },
    'AW189': { name: 'AgustaWestland AW189', category: 'HELICOPTER', label: '🚁 AgustaWestland AW189', size: 36 },
    'EC45': { name: 'Eurocopter EC145 / Airbus H145', category: 'HELICOPTER', label: '🚁 Eurocopter EC145 / H145', size: 32 },
    'H145': { name: 'Airbus Helicopters H145', category: 'HELICOPTER', label: '🚁 Airbus H145', size: 32 },
    'EC35': { name: 'Eurocopter EC135 / Airbus H135', category: 'HELICOPTER', label: '🚁 Eurocopter EC135 / H135', size: 30 },
    'H135': { name: 'Airbus Helicopters H135', category: 'HELICOPTER', label: '🚁 Airbus H135', size: 30 },
    'EC20': { name: 'Eurocopter EC120 Colibri', category: 'HELICOPTER', label: '🚁 Eurocopter EC120', size: 28 },
    'EC30': { name: 'Eurocopter EC130', category: 'HELICOPTER', label: '🚁 Eurocopter EC130', size: 30 },
    'H160': { name: 'Airbus Helicopters H160', category: 'HELICOPTER', label: '🚁 Airbus H160', size: 34 },
    'H125': { name: 'Airbus Helicopters H125 / AS350', category: 'HELICOPTER', label: '🚁 Airbus H125 Écureuil', size: 28 },
    'H225': { name: 'Airbus Helicopters H225 Super Puma', category: 'HELICOPTER', label: '🚁 Airbus H225 Super Puma', size: 38 },
    'AS50': { name: 'Eurocopter AS350 Écureuil', category: 'HELICOPTER', label: '🚁 AS350 Écureuil', size: 28 },
    'AS55': { name: 'Eurocopter AS355 Twin Squirrel', category: 'HELICOPTER', label: '🚁 AS355 Twin Squirrel', size: 30 },
    'AS32': { name: 'Eurocopter AS332 Super Puma', category: 'HELICOPTER', label: '🚁 AS332 Super Puma', size: 38 },
    'B06': { name: 'Bell 206 JetRanger', category: 'HELICOPTER', label: '🚁 Bell 206 JetRanger', size: 28 },
    'B206': { name: 'Bell 206 JetRanger', category: 'HELICOPTER', label: '🚁 Bell 206 JetRanger', size: 28 },
    'B407': { name: 'Bell 407', category: 'HELICOPTER', label: '🚁 Bell 407', size: 30 },
    'B429': { name: 'Bell 429 GlobalRanger', category: 'HELICOPTER', label: '🚁 Bell 429 GlobalRanger', size: 32 },
    'B412': { name: 'Bell 412', category: 'HELICOPTER', label: '🚁 Bell 412', size: 34 },
    'B212': { name: 'Bell 212 Twin Huey', category: 'HELICOPTER', label: '🚁 Bell 212 Twin Huey', size: 34 },
    'B222': { name: 'Bell 222', category: 'HELICOPTER', label: '🚁 Bell 222', size: 32 },
    'UH1': { name: 'Bell UH-1 Iroquois / Huey', category: 'HELICOPTER', label: '🚁 Bell UH-1 Huey', size: 32 },
    'H60': { name: 'Sikorsky UH-60 Black Hawk', category: 'HELICOPTER', label: '🚁 UH-60 Black Hawk', size: 36 },
    'UH60': { name: 'Sikorsky UH-60 Black Hawk', category: 'HELICOPTER', label: '🚁 UH-60 Black Hawk', size: 36 },
    'S76': { name: 'Sikorsky S-76 Spirit', category: 'HELICOPTER', label: '🚁 Sikorsky S-76', size: 32 },
    'S92': { name: 'Sikorsky S-92 Helibus', category: 'HELICOPTER', label: '🚁 Sikorsky S-92', size: 38 },
    'R22': { name: 'Robinson R22', category: 'HELICOPTER', label: '🚁 Robinson R22', size: 24 },
    'R44': { name: 'Robinson R44 Raven / Clipper', category: 'HELICOPTER', label: '🚁 Robinson R44', size: 26 },
    'R66': { name: 'Robinson R66 Turbine', category: 'HELICOPTER', label: '🚁 Robinson R66', size: 28 },
    'MD50': { name: 'MD Helicopters MD 500', category: 'HELICOPTER', label: '🚁 MD 500 Defender', size: 26 },
    'MD52': { name: 'MD Helicopters MD 520N', category: 'HELICOPTER', label: '🚁 MD 520N', size: 26 },
    'MD60': { name: 'MD Helicopters MD 600N', category: 'HELICOPTER', label: '🚁 MD 600N', size: 28 },
    'MD90': { name: 'MD Helicopters MD 900 Explorer', category: 'HELICOPTER', label: '🚁 MD 900 Explorer', size: 30 },
    'BK117': { name: 'MBB/Kawasaki BK 117', category: 'HELICOPTER', label: '🚁 Kawasaki BK 117', size: 30 },
    'B105': { name: 'MBB Bo 105', category: 'HELICOPTER', label: '🚁 MBB Bo 105', size: 28 },
    'H47': { name: 'Boeing CH-47 Chinook', category: 'HELICOPTER', label: '🚁 CH-47 Chinook', size: 40 },
    'CH47': { name: 'Boeing CH-47 Chinook', category: 'HELICOPTER', label: '🚁 CH-47 Chinook', size: 40 },
    'H64': { name: 'Boeing AH-64 Apache', category: 'HELICOPTER', label: '🚁 AH-64 Apache', size: 34 },
    'G2CA': { name: 'Guimbal Cabri G2', category: 'HELICOPTER', label: '🚁 Guimbal Cabri G2', size: 24 },

    // ✈️ 4-Engine Heavies
    'B744': { name: 'Boeing 747-400', category: 'HEAVY_4_JET', label: '✈️ Boeing 747-400', size: 44 },
    'B748': { name: 'Boeing 747-8', category: 'HEAVY_4_JET', label: '✈️ Boeing 747-8 Intercontinental', size: 46 },
    'B741': { name: 'Boeing 747-100', category: 'HEAVY_4_JET', label: '✈️ Boeing 747-100', size: 44 },
    'B742': { name: 'Boeing 747-200', category: 'HEAVY_4_JET', label: '✈️ Boeing 747-200', size: 44 },
    'B743': { name: 'Boeing 747-300', category: 'HEAVY_4_JET', label: '✈️ Boeing 747-300', size: 44 },
    'B74S': { name: 'Boeing 747SP', category: 'HEAVY_4_JET', label: '✈️ Boeing 747SP', size: 40 },
    'A388': { name: 'Airbus A380-800', category: 'HEAVY_4_JET', label: '✈️ Airbus A380-800', size: 48 },
    'A342': { name: 'Airbus A340-200', category: 'HEAVY_4_JET', label: '✈️ Airbus A340-200', size: 42 },
    'A343': { name: 'Airbus A340-300', category: 'HEAVY_4_JET', label: '✈️ Airbus A340-300', size: 44 },
    'A345': { name: 'Airbus A340-500', category: 'HEAVY_4_JET', label: '✈️ Airbus A340-500', size: 44 },
    'A346': { name: 'Airbus A340-600', category: 'HEAVY_4_JET', label: '✈️ Airbus A340-600', size: 46 },
    'A124': { name: 'Antonov An-124 Ruslan', category: 'HEAVY_4_JET', label: '✈️ Antonov An-124', size: 46 },
    'A225': { name: 'Antonov An-225 Mriya', category: 'HEAVY_4_JET', label: '✈️ Antonov An-225', size: 50 },
    'IL76': { name: 'Ilyushin Il-76', category: 'HEAVY_4_JET', label: '✈️ Ilyushin Il-76', size: 42 },
    'IL96': { name: 'Ilyushin Il-96', category: 'HEAVY_4_JET', label: '✈️ Ilyushin Il-96', size: 44 },
    'B52': { name: 'Boeing B-52 Stratofortress', category: 'HEAVY_4_JET', label: '✈️ B-52 Stratofortress', size: 46 },
    'C5M': { name: 'Lockheed C-5M Super Galaxy', category: 'HEAVY_4_JET', label: '✈️ C-5M Galaxy', size: 48 },
    'C17': { name: 'Boeing C-17 Globemaster III', category: 'HEAVY_4_JET', label: '✈️ C-17 Globemaster', size: 42 },
    'BA46': { name: 'British Aerospace 146', category: 'HEAVY_4_JET', label: '✈️ BAe 146', size: 34 },
    'B461': { name: 'BAe 146-100', category: 'HEAVY_4_JET', label: '✈️ BAe 146-100', size: 32 },
    'B462': { name: 'BAe 146-200', category: 'HEAVY_4_JET', label: '✈️ BAe 146-200', size: 34 },
    'B463': { name: 'BAe 146-300', category: 'HEAVY_4_JET', label: '✈️ BAe 146-300', size: 36 },
    'RJ85': { name: 'Avro RJ85', category: 'HEAVY_4_JET', label: '✈️ Avro RJ85', size: 34 },
    'RJ1H': { name: 'Avro RJ100', category: 'HEAVY_4_JET', label: '✈️ Avro RJ100', size: 34 },
    'RJ70': { name: 'Avro RJ70', category: 'HEAVY_4_JET', label: '✈️ Avro RJ70', size: 32 },

    // ✈️ Widebody Twins
    'B772': { name: 'Boeing 777-200', category: 'WIDEBODY_TWIN', label: '✈️ Boeing 777-200', size: 38 },
    'B773': { name: 'Boeing 777-300', category: 'WIDEBODY_TWIN', label: '✈️ Boeing 777-300', size: 40 },
    'B77W': { name: 'Boeing 777-300ER', category: 'WIDEBODY_TWIN', label: '✈️ Boeing 777-300ER', size: 40 },
    'B77L': { name: 'Boeing 777-200LR / Freighter', category: 'WIDEBODY_TWIN', label: '✈️ Boeing 777-200LR', size: 38 },
    'B788': { name: 'Boeing 787-8 Dreamliner', category: 'WIDEBODY_TWIN', label: '✈️ Boeing 787-8 Dreamliner', size: 36 },
    'B789': { name: 'Boeing 787-9 Dreamliner', category: 'WIDEBODY_TWIN', label: '✈️ Boeing 787-9 Dreamliner', size: 38 },
    'B78X': { name: 'Boeing 787-10 Dreamliner', category: 'WIDEBODY_TWIN', label: '✈️ Boeing 787-10 Dreamliner', size: 40 },
    'A359': { name: 'Airbus A350-900', category: 'WIDEBODY_TWIN', label: '✈️ Airbus A350-900', size: 38 },
    'A35K': { name: 'Airbus A350-1000', category: 'WIDEBODY_TWIN', label: '✈️ Airbus A350-1000', size: 40 },
    'A332': { name: 'Airbus A330-200', category: 'WIDEBODY_TWIN', label: '✈️ Airbus A330-200', size: 38 },
    'A333': { name: 'Airbus A330-300', category: 'WIDEBODY_TWIN', label: '✈️ Airbus A330-300', size: 38 },
    'A338': { name: 'Airbus A330-800neo', category: 'WIDEBODY_TWIN', label: '✈️ Airbus A330-800neo', size: 38 },
    'A339': { name: 'Airbus A330-900neo', category: 'WIDEBODY_TWIN', label: '✈️ Airbus A330-900neo', size: 40 },
    'A306': { name: 'Airbus A300-600', category: 'WIDEBODY_TWIN', label: '✈️ Airbus A300-600', size: 36 },
    'A310': { name: 'Airbus A310', category: 'WIDEBODY_TWIN', label: '✈️ Airbus A310', size: 34 },
    'B762': { name: 'Boeing 767-200', category: 'WIDEBODY_TWIN', label: '✈️ Boeing 767-200', size: 36 },
    'B763': { name: 'Boeing 767-300', category: 'WIDEBODY_TWIN', label: '✈️ Boeing 767-300', size: 36 },
    'B764': { name: 'Boeing 767-400ER', category: 'WIDEBODY_TWIN', label: '✈️ Boeing 767-400ER', size: 38 },
    'DC10': { name: 'McDonnell Douglas DC-10', category: 'WIDEBODY_TWIN', label: '✈️ McDonnell Douglas DC-10', size: 38 },
    'MD11': { name: 'McDonnell Douglas MD-11', category: 'WIDEBODY_TWIN', label: '✈️ McDonnell Douglas MD-11', size: 40 },
    'L101': { name: 'Lockheed L-1011 TriStar', category: 'WIDEBODY_TWIN', label: '✈️ Lockheed L-1011 TriStar', size: 38 },

    // ✈️ Narrowbody Twins
    'A320': { name: 'Airbus A320', category: 'NARROWBODY_TWIN', label: '✈️ Airbus A320', size: 32 },
    'A20N': { name: 'Airbus A320neo', category: 'NARROWBODY_TWIN', label: '✈️ Airbus A320neo', size: 32 },
    'A321': { name: 'Airbus A321', category: 'NARROWBODY_TWIN', label: '✈️ Airbus A321', size: 34 },
    'A21N': { name: 'Airbus A321neo', category: 'NARROWBODY_TWIN', label: '✈️ Airbus A321neo', size: 34 },
    'A319': { name: 'Airbus A319', category: 'NARROWBODY_TWIN', label: '✈️ Airbus A319', size: 30 },
    'A19N': { name: 'Airbus A319neo', category: 'NARROWBODY_TWIN', label: '✈️ Airbus A319neo', size: 30 },
    'A318': { name: 'Airbus A318', category: 'NARROWBODY_TWIN', label: '✈️ Airbus A318', size: 28 },
    'B737': { name: 'Boeing 737-700', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 737-700', size: 30 },
    'B738': { name: 'Boeing 737-800', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 737-800', size: 32 },
    'B739': { name: 'Boeing 737-900', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 737-900', size: 34 },
    'B736': { name: 'Boeing 737-600', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 737-600', size: 28 },
    'B735': { name: 'Boeing 737-500', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 737-500', size: 28 },
    'B734': { name: 'Boeing 737-400', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 737-400', size: 30 },
    'B733': { name: 'Boeing 737-300', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 737-300', size: 30 },
    'B732': { name: 'Boeing 737-200', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 737-200', size: 28 },
    'B38M': { name: 'Boeing 737 MAX 8', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 737 MAX 8', size: 32 },
    'B39M': { name: 'Boeing 737 MAX 9', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 737 MAX 9', size: 34 },
    'B37M': { name: 'Boeing 737 MAX 7', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 737 MAX 7', size: 30 },
    'B752': { name: 'Boeing 757-200', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 757-200', size: 34 },
    'B753': { name: 'Boeing 757-300', category: 'NARROWBODY_TWIN', label: '✈️ Boeing 757-300', size: 36 },
    'BCS1': { name: 'Airbus A220-100', category: 'NARROWBODY_TWIN', label: '✈️ Airbus A220-100', size: 30 },
    'BCS3': { name: 'Airbus A220-300', category: 'NARROWBODY_TWIN', label: '✈️ Airbus A220-300', size: 32 },
    'E190': { name: 'Embraer E190', category: 'NARROWBODY_TWIN', label: '✈️ Embraer E190', size: 30 },
    'E195': { name: 'Embraer E195', category: 'NARROWBODY_TWIN', label: '✈️ Embraer E195', size: 32 },
    'E170': { name: 'Embraer E170', category: 'NARROWBODY_TWIN', label: '✈️ Embraer E170', size: 28 },
    'E175': { name: 'Embraer E175', category: 'NARROWBODY_TWIN', label: '✈️ Embraer E175', size: 28 },
    'E290': { name: 'Embraer E190-E2', category: 'NARROWBODY_TWIN', label: '✈️ Embraer E190-E2', size: 30 },
    'E295': { name: 'Embraer E195-E2', category: 'NARROWBODY_TWIN', label: '✈️ Embraer E195-E2', size: 32 },
    'C919': { name: 'COMAC C919', category: 'NARROWBODY_TWIN', label: '✈️ COMAC C919', size: 32 },
    'SU95': { name: 'Sukhoi Superjet 100', category: 'NARROWBODY_TWIN', label: '✈️ Sukhoi Superjet 100', size: 30 },

    // ✈️ Business Jets & Regional Rear-Jets
    'C680': { name: 'Cessna Citation Sovereign / Latitude', category: 'BIZJET', label: '✈️ Citation Sovereign', size: 26 },
    'C68A': { name: 'Cessna Citation Latitude', category: 'BIZJET', label: '✈️ Citation Latitude', size: 26 },
    'C560': { name: 'Cessna Citation V / Ultra / Encore', category: 'BIZJET', label: '✈️ Citation V', size: 24 },
    'C525': { name: 'Cessna CitationJet / CJ1-CJ4', category: 'BIZJET', label: '✈️ CitationJet', size: 24 },
    'C510': { name: 'Cessna Citation Mustang', category: 'BIZJET', label: '✈️ Citation Mustang', size: 22 },
    'C700': { name: 'Cessna Citation Longitude', category: 'BIZJET', label: '✈️ Citation Longitude', size: 28 },
    'C750': { name: 'Cessna Citation X', category: 'BIZJET', label: '✈️ Citation X', size: 28 },
    'GLF4': { name: 'Gulfstream IV / G400', category: 'BIZJET', label: '✈️ Gulfstream IV', size: 28 },
    'GLF5': { name: 'Gulfstream V / G550', category: 'BIZJET', label: '✈️ Gulfstream G550', size: 30 },
    'GLF6': { name: 'Gulfstream G650 / G700', category: 'BIZJET', label: '✈️ Gulfstream G650', size: 32 },
    'GL7T': { name: 'Gulfstream G700', category: 'BIZJET', label: '✈️ Gulfstream G700', size: 32 },
    'GLEX': { name: 'Bombardier Global Express', category: 'BIZJET', label: '✈️ Global Express', size: 32 },
    'GL5T': { name: 'Bombardier Global 5000 / 5500', category: 'BIZJET', label: '✈️ Global 5000', size: 30 },
    'CL30': { name: 'Bombardier Challenger 300 / 350', category: 'BIZJET', label: '✈️ Challenger 350', size: 28 },
    'CL60': { name: 'Bombardier Challenger 600 / 650', category: 'BIZJET', label: '✈️ Challenger 650', size: 28 },
    'E55P': { name: 'Embraer Phenom 300', category: 'BIZJET', label: '✈️ Phenom 300', size: 24 },
    'E50P': { name: 'Embraer Phenom 100', category: 'BIZJET', label: '✈️ Phenom 100', size: 22 },
    'LJ35': { name: 'Bombardier Learjet 35', category: 'BIZJET', label: '✈️ Learjet 35', size: 24 },
    'LJ45': { name: 'Bombardier Learjet 45', category: 'BIZJET', label: '✈️ Learjet 45', size: 24 },
    'LJ60': { name: 'Bombardier Learjet 60', category: 'BIZJET', label: '✈️ Learjet 60', size: 24 },
    'FA50': { name: 'Dassault Falcon 50', category: 'BIZJET', label: '✈️ Falcon 50', size: 26 },
    'FA7X': { name: 'Dassault Falcon 7X', category: 'BIZJET', label: '✈️ Falcon 7X', size: 30 },
    'FA8X': { name: 'Dassault Falcon 8X', category: 'BIZJET', label: '✈️ Falcon 8X', size: 30 },
    'HA420': { name: 'HondaJet HA-420', category: 'BIZJET', label: '✈️ HondaJet', size: 22 },
    'PC24': { name: 'Pilatus PC-24 Super Versatile Jet', category: 'BIZJET', label: '✈️ Pilatus PC-24', size: 26 },
    'SF50': { name: 'Cirrus Vision SF50 Jet', category: 'BIZJET', label: '✈️ Cirrus Vision Jet', size: 22 },
    'CRJ2': { name: 'Bombardier CRJ-200', category: 'REAR_ENGINE_JET', label: '✈️ CRJ-200', size: 26 },
    'CRJ7': { name: 'Bombardier CRJ-700', category: 'REAR_ENGINE_JET', label: '✈️ CRJ-700', size: 28 },
    'CRJ9': { name: 'Bombardier CRJ-900', category: 'REAR_ENGINE_JET', label: '✈️ CRJ-900', size: 30 },
    'CRJX': { name: 'Bombardier CRJ-1000', category: 'REAR_ENGINE_JET', label: '✈️ CRJ-1000', size: 32 },
    'E145': { name: 'Embraer ERJ-145', category: 'REAR_ENGINE_JET', label: '✈️ ERJ-145', size: 28 },
    'E135': { name: 'Embraer ERJ-135', category: 'REAR_ENGINE_JET', label: '✈️ ERJ-135', size: 26 },
    'MD80': { name: 'McDonnell Douglas MD-80', category: 'REAR_ENGINE_JET', label: '✈️ MD-80', size: 32 },
    'MD82': { name: 'McDonnell Douglas MD-82', category: 'REAR_ENGINE_JET', label: '✈️ MD-82', size: 32 },
    'MD88': { name: 'McDonnell Douglas MD-88', category: 'REAR_ENGINE_JET', label: '✈️ MD-88', size: 32 },
    'B712': { name: 'Boeing 717-200', category: 'REAR_ENGINE_JET', label: '✈️ Boeing 717', size: 30 },
    'F70': { name: 'Fokker 70', category: 'REAR_ENGINE_JET', label: '✈️ Fokker 70', size: 28 },
    'F100': { name: 'Fokker 100', category: 'REAR_ENGINE_JET', label: '✈️ Fokker 100', size: 30 },

    // 🛩️ Turboprops
    'DH8D': { name: 'De Havilland Dash 8-400 (Q400)', category: 'TURBOPROP', label: '🛩️ Dash 8 Q400', size: 32 },
    'DH8C': { name: 'De Havilland Dash 8-300 (Q300)', category: 'TURBOPROP', label: '🛩️ Dash 8 Q300', size: 30 },
    'DH8A': { name: 'De Havilland Dash 8-100', category: 'TURBOPROP', label: '🛩️ Dash 8-100', size: 28 },
    'AT72': { name: 'ATR 72-500 / 600', category: 'TURBOPROP', label: '🛩️ ATR 72', size: 30 },
    'AT76': { name: 'ATR 72-600', category: 'TURBOPROP', label: '🛩️ ATR 72-600', size: 30 },
    'AT45': { name: 'ATR 42-500', category: 'TURBOPROP', label: '🛩️ ATR 42-500', size: 28 },
    'AT46': { name: 'ATR 42-600', category: 'TURBOPROP', label: '🛩️ ATR 42-600', size: 28 },
    'B350': { name: 'Beechcraft King Air 350', category: 'TURBOPROP', label: '🛩️ King Air 350', size: 26 },
    'BE20': { name: 'Beechcraft Super King Air 200', category: 'TURBOPROP', label: '🛩️ King Air 200', size: 26 },
    'BE9L': { name: 'Beechcraft King Air 90', category: 'TURBOPROP', label: '🛩️ King Air 90', size: 24 },
    'B190': { name: 'Beechcraft 1900D', category: 'TURBOPROP', label: '🛩️ Beechcraft 1900D', size: 28 },
    'DHC6': { name: 'De Havilland DHC-6 Twin Otter', category: 'TURBOPROP', label: '🛩️ Twin Otter', size: 26 },
    'C208': { name: 'Cessna 208 Grand Caravan', category: 'TURBOPROP', label: '🛩️ Grand Caravan', size: 24 },
    'PC12': { name: 'Pilatus PC-12', category: 'TURBOPROP', label: '🛩️ Pilatus PC-12', size: 24 },
    'TBM9': { name: 'Daher TBM 900 / 930 / 960', category: 'TURBOPROP', label: '🛩️ Daher TBM 930', size: 24 },
    'TBM8': { name: 'Daher TBM 850', category: 'TURBOPROP', label: '🛩️ Daher TBM 850', size: 24 },
    'SW4': { name: 'Fairchild Swearingen Metroliner', category: 'TURBOPROP', label: '🛩️ Metro III', size: 28 },
    'SF34': { name: 'Saab 340', category: 'TURBOPROP', label: '🛩️ Saab 340', size: 28 },
    'SB20': { name: 'Saab 2000', category: 'TURBOPROP', label: '🛩️ Saab 2000', size: 30 },
    'L410': { name: 'Let L-410 Turbolet', category: 'TURBOPROP', label: '🛩️ Turbolet', size: 26 },
    'BE58': { name: 'Beechcraft Baron 58', category: 'TURBOPROP', label: '🛩️ Baron 58', size: 24 },
    'PA34': { name: 'Piper PA-34 Seneca', category: 'TURBOPROP', label: '🛩️ Seneca V', size: 24 },
    'PA44': { name: 'Piper PA-44 Seminole', category: 'TURBOPROP', label: '🛩️ Seminole', size: 24 },
    'DA62': { name: 'Diamond DA62 Twin', category: 'TURBOPROP', label: '🛩️ Diamond DA62', size: 24 },
    'DA42': { name: 'Diamond DA42 Twin Star', category: 'TURBOPROP', label: '🛩️ Diamond DA42', size: 24 },
    'C130': { name: 'Lockheed C-130 Hercules', category: 'TURBOPROP', label: '🛩️ C-130 Hercules', size: 36 },

    // 🛩️ Single Engine Light GA
    'C172': { name: 'Cessna 172 Skyhawk', category: 'SINGLE_PROP', label: '🛩️ Cessna 172 Skyhawk', size: 22 },
    'C182': { name: 'Cessna 182 Skylane', category: 'SINGLE_PROP', label: '🛩️ Cessna 182 Skylane', size: 22 },
    'C152': { name: 'Cessna 152', category: 'SINGLE_PROP', label: '🛩️ Cessna 152', size: 20 },
    'C206': { name: 'Cessna 206 Stationair', category: 'SINGLE_PROP', label: '🛩️ Stationair 206', size: 22 },
    'P28A': { name: 'Piper PA-28 Cherokee / Archer', category: 'SINGLE_PROP', label: '🛩️ Piper PA-28 Archer', size: 22 },
    'PA28': { name: 'Piper PA-28 Cherokee', category: 'SINGLE_PROP', label: '🛩️ Piper Cherokee', size: 22 },
    'PA32': { name: 'Piper PA-32 Saratoga', category: 'SINGLE_PROP', label: '🛩️ Piper Saratoga', size: 24 },
    'PA46': { name: 'Piper PA-46 Malibu / Meridian', category: 'SINGLE_PROP', label: '🛩️ Piper Malibu', size: 24 },
    'SR22': { name: 'Cirrus SR22 / SR22T', category: 'SINGLE_PROP', label: '🛩️ Cirrus SR22', size: 22 },
    'SR20': { name: 'Cirrus SR20', category: 'SINGLE_PROP', label: '🛩️ Cirrus SR20', size: 22 },
    'DA40': { name: 'Diamond DA40 Star', category: 'SINGLE_PROP', label: '🛩️ Diamond DA40', size: 22 },
    'DA20': { name: 'Diamond DA20 Katana', category: 'SINGLE_PROP', label: '🛩️ Diamond DA20', size: 20 },
    'M20P': { name: 'Mooney M20', category: 'SINGLE_PROP', label: '🛩️ Mooney M20', size: 22 },
    'BE36': { name: 'Beechcraft Bonanza 36', category: 'SINGLE_PROP', label: '🛩️ Bonanza A36', size: 22 },
    'BE35': { name: 'Beechcraft Bonanza 35 V-Tail', category: 'SINGLE_PROP', label: '🛩️ Bonanza V-Tail', size: 22 },
    'RV10': { name: 'Van\'s RV-10', category: 'SINGLE_PROP', label: '🛩️ Van\'s RV-10', size: 20 },
    'RV7': { name: 'Van\'s RV-7', category: 'SINGLE_PROP', label: '🛩️ Van\'s RV-7', size: 20 },
    'RV8': { name: 'Van\'s RV-8', category: 'SINGLE_PROP', label: '🛩️ Van\'s RV-8', size: 20 },
    'DR40': { name: 'Robin DR400', category: 'SINGLE_PROP', label: '🛩️ Robin DR400', size: 20 },
    'VL3': { name: 'JMB VL-3 Evolution', category: 'SINGLE_PROP', label: '🛩️ JMB VL-3', size: 20 },

    // 🚀 Military Fighters
    'F18': { name: 'Boeing F/A-18 Hornet / Super Hornet', category: 'MILITARY', label: '🚀 F/A-18 Hornet', size: 28 },
    'F16': { name: 'Lockheed Martin F-16 Fighting Falcon', category: 'MILITARY', label: '🚀 F-16 Falcon', size: 26 },
    'F15': { name: 'McDonnell Douglas F-15 Eagle', category: 'MILITARY', label: '🚀 F-15 Eagle', size: 30 },
    'F14': { name: 'Grumman F-14 Tomcat', category: 'MILITARY', label: '🚀 F-14 Tomcat', size: 30 },
    'F22': { name: 'Lockheed Martin F-22 Raptor', category: 'MILITARY', label: '🚀 F-22 Raptor', size: 30 },
    'F35': { name: 'Lockheed Martin F-35 Lightning II', category: 'MILITARY', label: '🚀 F-35 Lightning II', size: 28 },
    'EUFI': { name: 'Eurofighter Typhoon', category: 'MILITARY', label: '🚀 Eurofighter Typhoon', size: 28 },
    'RFAL': { name: 'Dassault Rafale', category: 'MILITARY', label: '🚀 Dassault Rafale', size: 28 },
    'SB39': { name: 'Saab JAS 39 Gripen', category: 'MILITARY', label: '🚀 JAS 39 Gripen', size: 26 },
    'A10': { name: 'Fairchild Republic A-10 Thunderbolt II', category: 'MILITARY', label: '🚀 A-10 Warthog', size: 30 }
};

function classifyAircraftType(raw, routeStr = '') {
    if (!raw) {
        return {
            icao: '',
            name: '',
            category: 'NARROWBODY_TWIN',
            label: '',
            size: 32,
            haloSize: 36
        };
    }

    const rawUpper = String(raw).toUpperCase().trim();
    if (!rawUpper || rawUpper === 'AIRCRAFT' || rawUpper === 'UNKNOWN' || rawUpper === 'PLANE') {
        return {
            icao: '',
            name: '',
            category: 'NARROWBODY_TWIN',
            label: '',
            size: 32,
            haloSize: 36
        };
    }

    // Strip equipment suffixes like "/G", "/L", "/M-SDE2...", "H/A139/L"
    const cleanIcao = rawUpper.replace(/^[HML]\//, '').split('/')[0].replace(/[^A-Z0-9]/g, '');
    if (!cleanIcao || cleanIcao === 'AIRCRAFT' || cleanIcao === 'UNKNOWN') {
        return {
            icao: '',
            name: '',
            category: 'NARROWBODY_TWIN',
            label: '',
            size: 32,
            haloSize: 36
        };
    }

    // 1. Direct Lookup in Official ICAO Aircraft Database
    if (AIRCRAFT_ICAO_DATABASE[cleanIcao]) {
        const entry = AIRCRAFT_ICAO_DATABASE[cleanIcao];
        return {
            icao: cleanIcao,
            name: entry.name,
            category: entry.category,
            label: entry.label,
            size: entry.size,
            haloSize: entry.size + 4
        };
    }

    const combinedStr = `${rawUpper} ${String(routeStr).toUpperCase()}`;

    // 2. Intelligent Rotorcraft / Helicopter Detection (including A139, AW139, EC45, HEMS routes)
    if (
        /(^|\b|_|-)(A1[03468]9|AW1[0-9]{2}|EC[0-9]{2,3}|H1[2-7][0-9]|H2[0-9]{2}|R[246][246]|B06|B407|B429|B412|B212|B105|S76|S92|UH60|UH1|CH47|H47|H60|H64|AS50|AS32|BK117|MD5[0-9]|BELL|COPTER|HELI|ROTOR|CABRI|GUIMBAL|AUTOGYRO|GYRO|TRP|SIKORSKY|EUROCOPTER|AGUSTA|HEMS)(\b|_|-|$)/i.test(combinedStr) ||
        cleanIcao.startsWith('EC') || cleanIcao.startsWith('H1') || cleanIcao.startsWith('H2') || cleanIcao.startsWith('TRP') || cleanIcao === 'A139'
    ) {
        return {
            icao: cleanIcao || 'HELI',
            name: cleanIcao ? `Rotorcraft (${cleanIcao})` : 'Helicopter / Rotorcraft',
            category: 'HELICOPTER',
            label: `🚁 ${cleanIcao || 'Rotorcraft'}`,
            size: 32,
            haloSize: 36
        };
    }

    // 3. 4-Engine Heavy Jets (B747, A380, A340, Antonov, C5, B52)
    if (
        /(^|\b|_|-)(B74[1-8]|A34[2-6]|A388|AN22|A124|A225|IL76|IL96|BA46|B46[1-3]|RJ[78][0-9]|RJ100|B52|C5M)(\b|_|-|$)/i.test(rawUpper) ||
        rawUpper.includes('747') || rawUpper.includes('380') || rawUpper.includes('340') || rawUpper.includes('ANTONOV') || rawUpper.includes('GALAXY')
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

    // 4. Widebody Twin Jets (B777, A350, B787, A330, B767, DC10, MD11)
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

    // 5. Regional Rear-Engine Jets (CRJ, ERJ-145, MD-80/90, B717, Fokker)
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

    // 6. Business Jets (Gulfstream, Citation, Learjet, Falcon, Phenom)
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

    // 7. Turboprops (Multi/Regional: Dash 8, ATR 72, King Air)
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

    // 8. Single Engine Light GA (Cessna 172, Cherokee PA28, Cirrus SR22)
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

    // 9. Military Fighters
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

    // Fallback: If cleanIcao exists and isn't generic, show cleanIcao, otherwise empty
    return {
        icao: cleanIcao || '',
        name: cleanIcao ? `${cleanIcao}` : '',
        category: 'NARROWBODY_TWIN',
        label: cleanIcao ? `✈️ ${cleanIcao}` : '',
        size: 32,
        haloSize: 36
    };
}

function getAircraftCategoryLabel(infoOrType) {
    if (typeof infoOrType === 'object' && infoOrType.label) return infoOrType.label;
    const info = classifyAircraftType(infoOrType);
    return info.label;
}

function getAircraftSvgContent(category, color) {
    switch (category) {
        case 'HELICOPTER':
            return `
                <svg viewBox="0 0 32 32" width="100%" height="100%">
                    <!-- 4-Blade Main Rotor angled at 30 deg -->
                    <g transform="rotate(30, 16, 12)">
                        <line x1="2" y1="12" x2="30" y2="12" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
                        <line x1="16" y1="-2" x2="16" y2="26" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
                        <circle cx="16" cy="12" r="2.2" fill="#ffffff"/>
                    </g>
                    <!-- Streamlined Fuselage & Cockpit -->
                    <path d="M16 2.5 C13.5 2.5 12.2 5.5 12.2 10 C12.2 14.5 13.8 17.5 14.8 20.5 L15.2 27.5 L16.8 27.5 L17.2 20.5 C18.2 17.5 19.8 14.5 19.8 10 C19.8 5.5 18.5 2.5 16 2.5 Z" fill="${color}"/>
                    <!-- Cockpit Windshield -->
                    <path d="M14.6 4.5 C15.2 3.8 16.8 3.8 17.4 4.5 C17.9 5.8 17.7 7.2 16 7.2 C14.3 7.2 14.1 5.8 14.6 4.5 Z" fill="#ffffff" opacity="0.85"/>
                    <!-- Landing Skids -->
                    <rect x="8.5" y="7.5" width="2" height="9.5" rx="1" fill="${color}"/>
                    <rect x="21.5" y="7.5" width="2" height="9.5" rx="1" fill="${color}"/>
                    <line x1="9" y1="10.5" x2="12.5" y2="10.5" stroke="${color}" stroke-width="1.6"/>
                    <line x1="19.5" y1="10.5" x2="23" y2="10.5" stroke="${color}" stroke-width="1.6"/>
                    <line x1="9" y1="14" x2="13.5" y2="14" stroke="${color}" stroke-width="1.6"/>
                    <line x1="18.5" y1="14" x2="23" y2="14" stroke="${color}" stroke-width="1.6"/>
                    <!-- Tail Fin & Horizontal Stabilizer -->
                    <rect x="11.5" y="24" width="9" height="1.8" rx="0.9" fill="${color}"/>
                    <!-- Tail Rotor (right side) -->
                    <rect x="17.2" y="25.5" width="4.5" height="1.6" rx="0.8" fill="#ffffff"/>
                    <rect x="17.2" y="23" width="1.6" height="6.6" rx="0.8" fill="${color}"/>
                </svg>
            `;

        case 'HEAVY_4_JET':
            // tar1090 heavy_4e (B747 / A380 with 4 forward-pointing engine nacelles)
            return `
                <svg viewBox="0 0 64 64" width="100%" height="100%">
                    <path d="m 30.764,3.957 c -1.030,1.995 -1.438,5.650 -1.600,7.687 -0.248,3.120 -0.114,5.478 -0.156,7.568 -0.016,0.798 -0.737,1.483 -1.435,2.163 l -4.630,4.207 c 0.136,-0.609 0.313,-2.735 0.011,-3.413 l -2.147,-0.067 c -0.337,0.636 -0.227,2.516 -0.102,3.486 l 0.414,0.033 0.179,1.447 -5.794,5.342 c 0.077,-0.914 0.114,-2.161 -0.105,-2.633 l -2.172,-0.078 c -0.367,0.716 -0.185,2.323 -0.053,3.475 h 0.394 l 0.138,0.949 -7.991,6.563 C 5.411,40.937 5.586,41.437 5.564,41.830 l -0.694,2.353 0.005,0.991 0.715,-1.236 10.464,-6.218 c 0.012,0.663 0.110,1.051 0.231,1.010 0.135,-0.045 0.328,-0.852 0.361,-1.290 l 2.274,-1.389 c -0.003,0.493 0.054,1.174 0.196,1.088 0.126,-0.076 0.384,-0.807 0.362,-1.370 l 1.528,-0.943 2.988,-1.018 c 0.073,0.381 0.122,0.929 0.292,0.896 0.159,-0.031 0.257,-0.491 0.355,-1.065 l 1.704,-0.597 c 0.025,0.437 0.163,0.976 0.297,0.914 0.149,-0.070 0.339,-0.647 0.356,-1.118 l 1.935,-0.666 0.054,10.106 c 0.183,3.800 0.173,5.797 0.919,9.127 -0.072,0.573 -0.374,0.766 -0.640,1.020 l -6.724,6.317 -0.007,2.046 8.553,-2.312 c 0.019,0.586 0.061,1.045 0.432,1.368 l 0.146,1.817 0.146,-1.817 c 0.371,-0.323 0.413,-0.782 0.432,-1.368 l 8.553,2.312 -0.007,-2.046 -6.724,-6.317 c -0.266,-0.253 -0.569,-0.446 -0.640,-1.020 0.747,-3.331 0.736,-5.327 0.919,-9.127 l 0.054,-10.106 1.935,0.666 c 0.017,0.470 0.207,1.048 0.356,1.118 0.134,0.062 0.272,-0.477 0.297,-0.914 l 1.704,0.597 c 0.098,0.574 0.196,1.034 0.355,1.065 0.170,0.033 0.219,-0.515 0.292,-0.896 l 2.988,1.018 1.528,0.943 c -0.021,0.563 0.237,1.294 0.362,1.370 0.141,0.086 0.198,-0.595 0.196,-1.088 l 2.274,1.389 c 0.033,0.439 0.227,1.245 0.361,1.290 0.121,0.041 0.219,-0.347 0.231,-1.010 l 10.464,6.218 0.715,1.236 0.005,-0.991 -0.694,-2.353 c -0.021,-0.393 0.153,-0.893 -0.151,-1.143 l -7.991,-6.563 0.138,-0.949 h 0.394 c 0.132,-1.152 0.314,-2.760 -0.053,-3.475 l -2.172,0.078 c -0.218,0.472 -0.182,1.719 -0.105,2.633 l -5.794,-5.342 0.179,-1.447 0.414,-0.033 c 0.125,-0.970 0.236,-2.850 -0.102,-3.486 l -2.147,0.067 c -0.302,0.678 -0.125,2.804 0.011,3.413 l -4.630,-4.207 c -0.698,-0.680 -1.419,-1.365 -1.435,-2.163 -0.042,-2.090 0.092,-4.448 -0.156,-7.568 -0.162,-2.037 -0.600,-5.677 -1.600,-7.687 -0.592,-1.190 -1.211,-1.157 -1.809,0 z" fill="${color}"/>
                </svg>
            `;

        case 'WIDEBODY_TWIN':
            // tar1090 heavy_2e (B777 / A350 with 2 prominent high-bypass GE90 engines)
            return `
                <svg viewBox="0 -3.2 64.2 64.2" width="100%" height="100%">
                    <path d="m 31.414,2.728 c -0.314,0.712 -1.296,2.377 -1.534,6.133 l -0.086,13.379 c 0.006,0.400 -0.380,0.888 -0.945,1.252 l -2.631,1.729 c 0.157,-0.904 0.237,-3.403 -0.162,-3.850 l -2.686,0.006 c -0.336,1.065 -0.358,2.518 -0.109,4.088 h 0.434 L 24.057,26.689 8.611,36.852 7.418,38.432 7.381,39.027 8.875,38.166 l 8.295,-2.771 0.072,0.730 0.156,-0.004 0.150,-0.859 3.799,-1.234 0.074,0.727 0.119,0.004 0.117,-0.832 2.182,-0.730 h 1.670 l 0.061,0.822 h 0.176 l 0.062,-0.822 4.018,-0.002 v 13.602 c 0.051,1.559 0.465,3.272 0.826,4.963 l -6.836,5.426 c -0.097,0.802 -0.003,1.372 0.049,1.885 l 7.734,-2.795 0.477,1.973 h 0.232 l 0.477,-1.973 7.736,2.795 c 0.052,-0.513 0.146,-1.083 0.049,-1.885 l -6.836,-5.426 c 0.361,-1.691 0.775,-3.404 0.826,-4.963 V 33.193 l 4.016,0.002 0.062,0.822 h 0.178 L 38.875,33.195 h 1.672 l 2.182,0.730 0.117,0.832 0.119,-0.004 0.072,-0.727 3.799,1.234 0.152,0.859 0.154,0.004 0.072,-0.730 8.297,2.771 1.492,0.861 -0.037,-0.596 -1.191,-1.580 -15.447,-10.162 0.363,-1.225 H 41.125 c 0.248,-1.569 0.225,-3.023 -0.111,-4.088 l -2.686,-0.006 c -0.399,0.447 -0.317,2.945 -0.160,3.850 L 35.535,23.492 C 34.970,23.128 34.584,22.640 34.590,22.240 L 34.504,8.910 C 34.193,4.926 33.369,3.602 32.934,2.722 32.442,1.732 31.894,1.828 31.414,2.728 Z" fill="${color}"/>
                </svg>
            `;

        case 'REAR_ENGINE_JET':
        case 'BIZJET':
            // tar1090 jet_swept (Citation / Gulfstream / CRJ with rear fuselage engines)
            return `
                <svg viewBox="-1 -1 20 26" width="100%" height="100%">
                    <path d="M9.44,23c-.1.6-.35.6-.44.6s-.34,0-.44-.6l-3,.67V22.6A.54.54,0,0,1,6,22.05l2.38-1.12L8,19.33H6.69l0-.2a8.23,8.23,0,0,1-.14-3.85l.06-.18H7.73V13.19h-2L.26,14.29v-.93c0-.28.07-.46.22-.53l7.25-3.6V3.85A4.47,4.47,0,0,1,8.83.49L9,.34l.17.15a4.47,4.47,0,0,1,1.1,3.36V9.23l7.25,3.6c.14.07.22.25.22.53v.93l-5.51-1.1h-2V15.1h1.17l.06.18a8.24,8.24,0,0,1-.15,3.84l0,.2H10l-.36,1.6,2.43,1.14a.52.52,0,0,1,.35.53v1.08Z" fill="${color}"/>
                </svg>
            `;

        case 'TURBOPROP':
            // tar1090 twin_large (Dash 8 / ATR 72 / King Air with wing engines)
            return `
                <svg viewBox="-2 -3 25 25" width="100%" height="100%">
                    <path d="M10.1,18.34H7l0-.21c-.08-.54,0-.87.11-1L7.19,17l.2,0,2.35-.33c-.16-.82-.42-2.9-.42-3.14s0-2.71,0-3.51H8c-.12,1.34-.41,1.36-.55,1.37h0c-.19,0-.46,0-.6-1.55L.27,9.52l0-.25c.06-.73.31-.9.45-.93l6-.48a3.65,3.65,0,0,1,.3-2,.45.45,0,0,1,.32-.16h0a.39.39,0,0,1,.3.12A3.67,3.67,0,0,1,8,7.77l1.26-.07c0-.71,0-2.92,0-4.48A3.84,3.84,0,0,1,10.1.4a.4.4,0,0,1,.28-.16h.23A.4.4,0,0,1,10.9.4a3.84,3.84,0,0,1,.87,2.81c0,1.55,0,3.77,0,4.48L13,7.77a3.67,3.67,0,0,1,.29-1.94.38.38,0,0,1,.28-.12.46.46,0,0,1,.34.16,3.66,3.66,0,0,1,.3,2l6,.48c.18,0,.43.21.49.94l0,.25-6.53.3c-.14,1.55-.42,1.55-.59,1.55s-.45,0-.57-1.37H11.74c0,.8,0,3.27,0,3.51s-.26,2.32-.42,3.14l2.38.34h.11l.13.13c.15.18.19.51.11,1l0,.21H10.9l-.4,1Z" fill="${color}"/>
                </svg>
            `;

        case 'SINGLE_PROP':
            // tar1090 cessna (C172 / PA28 / SR22 with single front nose spinner)
            return `
                <svg viewBox="0 -1 32 31" width="100%" height="100%">
                    <path d="M16.36 20.96l2.57.27s.44.05.4.54l-.02.63s-.03.47-.45.54l-2.31.34-.44-.74-.22 1.63-.25-1.62-.38.73-2.35-.35s-.44-.1-.43-.6l-.02-.6s0-.5.48-.5l2.5-.27-.56-5.4-3.64-.1-5.83-1.02h-.45v-2.06s-.07-.37.46-.34l5.8-.17 3.55.12s-.1-2.52.52-2.82l-1.68-.04s-.1-.06 0-.14l1.94-.03s.35-1.18.7 0l1.91.04s.11.05 0 .14l-1.7.02s.62-.09.56 2.82l3.54-.1 5.81.17s.51-.04.48.35l-.01 2.06h-.47l-5.8 1-3.67.11z" fill="${color}"/>
                </svg>
            `;

        case 'MILITARY':
            // tar1090 hi_perf (F-16 / F-18 fighter jet)
            return `
                <svg viewBox="-7.8 0 80 80" width="100%" height="100%">
                    <path d="M 30.82,61.32 29.19,54.84 29.06,60.19 27.70,60.70 22.27,60.63 21.68,59.60 l -0.01,-2.71 6.26,-5.52 -0.03,-3.99 -13.35,-0.01 -3e-6,1.15 -1.94,0.00 -0.01,-1.31 0.68,-0.65 L 13.30,37.20 c -0.01,-0.71 0.57,-0.77 0.60,0 l 0.05,1.57 0.28,0.23 0.26,4.09 L 19.90,38.48 c 0,0 -0.04,-1.26 0.20,-1.28 0.16,-0.02 0.20,0.98 0.20,0.98 l 4.40,-3.70 c 0,0 0.02,-1.28 0.20,-1.28 0.14,-0.00 0.20,0.98 0.20,0.98 l 1.80,-1.54 C 27.02,28.77 28.82,25.58 29,21.20 c 0.06,-1.41 0.23,-3.34 0.86,-3.85 0.21,-4.40 1.32,-11.03 2.39,-11.03 1.07,0 2.17,6.64 2.39,11.03 0.63,0.51 0.80,2.45 0.86,3.85 0.18,4.38 1.98,7.57 2.10,11.44 l 1.80,1.54 c 0,0 0.06,-0.99 0.20,-0.98 0.18,0.01 0.20,1.28 0.20,1.28 l 4.40,3.70 c 0,0 0.04,-1.00 0.20,-0.98 0.24,0.03 0.20,1.28 0.20,1.28 l 5.41,4.60 0.26,-4.09 0.28,-0.23 L 50.59,37.20 c 0.03,-0.77 0.61,-0.71 0.60,0 l 0.02,9.37 0.68,0.65 -0.01,1.31 -1.94,-0.00 -3e-6,-1.15 -13.35,0.01 -0.03,3.99 6.26,5.52 L 42.81,59.60 42.22,60.63 36.79,60.70 35.43,60.19 35.30,54.84 33.67,61.32 Z" fill="${color}"/>
                </svg>
            `;

        case 'NARROWBODY_TWIN':
        default:
            // tar1090 airliner (A320 / B738 with 2 forward-pointing wing engines)
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
// ✈️ 60FPS ZERO-JUMP 2-WAYPOINT SEGMENT GLIDE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

class AircraftTelemetryBuffer {
    constructor() {
        this.startLat = null;
        this.startLon = null;
        this.startHeading = 0;
        this.startAlt = 0;
        this.startGs = 0;

        this.targetLat = null;
        this.targetLon = null;
        this.targetHeading = 0;
        this.targetAlt = 0;
        this.targetGs = 0;

        this.renderLat = null;
        this.renderLon = null;
        this.renderHeading = 0;
        this.renderAlt = 0;
        this.renderGs = 0;

        this.legStartTime = 0;
        this.legDurationMs = 3000;
        this.isInitialized = false;
        this.flightData = null;
        this.marker = null;
        this.lastFrameTime = 0;
    }

    pushTelemetry(packet) {
        if (!packet) return;
        const now = Date.now();
        const lat = packet.latitude !== undefined ? packet.latitude : (packet.position?.lat !== undefined ? packet.position.lat : (packet.lat !== undefined ? packet.lat : null));
        const lon = packet.longitude !== undefined ? packet.longitude : (packet.position?.lng !== undefined ? packet.position.lng : (packet.position?.lon !== undefined ? packet.position.lon : (packet.lng !== undefined ? packet.lng : null)));
        const hdg = packet.heading_deg !== undefined ? packet.heading_deg : (packet.position?.heading !== undefined ? packet.position.heading : (packet.heading || 0));
        const gs = packet.groundspeed_kts || packet.position?.speed_tas_kts || packet.speed || 0;
        const alt = packet.altitude_ft || packet.position?.altitude_ft || 0;

        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) return;

        this.flightData = packet;

        // Ignore identical telemetry packets from repeated polling
        if (this.targetLat !== null && Math.abs(this.targetLat - lat) < 0.00001 && Math.abs(this.targetLon - lon) < 0.00001) {
            return;
        }

        // 1st Waypoint Arrival: place plane at origin, wait for 2nd waypoint
        if (this.renderLat === null) {
            this.renderLat = lat;
            this.renderLon = lon;
            this.renderHeading = hdg;
            this.renderAlt = alt;
            this.renderGs = gs;

            this.targetLat = lat;
            this.targetLon = lon;
            this.targetHeading = hdg;
            this.targetAlt = alt;
            this.targetGs = gs;
            return;
        }

        // 2nd and subsequent Waypoints: seamlessly start leg from EXACT current rendered position
        this.startLat = this.renderLat;
        this.startLon = this.renderLon;
        this.startHeading = this.renderHeading;
        this.startAlt = this.renderAlt;
        this.startGs = this.renderGs;

        this.targetLat = lat;
        this.targetLon = lon;
        this.targetHeading = hdg;
        this.targetAlt = alt;
        this.targetGs = gs;

        this.legStartTime = now;

        // Calculate smooth duration based on distance and speed (or default 12s for FSHub)
        const distM = haversineDistanceM(this.startLat, this.startLon, this.targetLat, this.targetLon);
        const speedMps = Math.max(20, (gs * 1852 / 3600));
        const kinematicDurationMs = (distM / speedMps) * 1000;

        this.legDurationMs = Math.max(3000, Math.min(20000, kinematicDurationMs > 1000 ? kinematicDurationMs : 12000));
        this.isInitialized = true;
    }

    update(now) {
        if (this.renderLat === null) return false;

        const dtSec = this.lastFrameTime > 0 ? Math.min(0.1, (now - this.lastFrameTime) / 1000) : 0.016;
        this.lastFrameTime = now;

        if (!this.isInitialized || this.startLat === null || this.targetLat === null) {
            return true;
        }

        const elapsed = now - this.legStartTime;
        const progress = Math.min(1.0, Math.max(0.0, elapsed / this.legDurationMs));

        if (progress < 1.0) {
            // Smooth progress along segment between start and target
            const smoothT = progress;

            this.renderLat = this.startLat + (this.targetLat - this.startLat) * smoothT;

            let dLon = this.targetLon - this.startLon;
            while (dLon > 180) dLon -= 360;
            while (dLon < -180) dLon += 360;
            this.renderLon = this.startLon + dLon * smoothT;

            let dHdg = this.targetHeading - this.startHeading;
            while (dHdg > 180) dHdg -= 360;
            while (dHdg < -180) dHdg += 360;
            this.renderHeading = (this.startHeading + dHdg * smoothT + 360) % 360;

            this.renderAlt = this.startAlt + (this.targetAlt - this.startAlt) * smoothT;
            this.renderGs = this.startGs + (this.targetGs - this.startGs) * smoothT;
        } else {
            // If the plane reached the target waypoint before the next packet arrives:
            // Continue gliding forward along targetHeading at speed without stopping or snapping!
            const speedKts = this.targetGs || 0;
            if (speedKts > 15) {
                const distM = (speedKts * 1852 / 3600) * dtSec;
                const radHdg = this.targetHeading * Math.PI / 180;
                const dLatDeg = (distM * Math.cos(radHdg)) / 111139;
                const cosLat = Math.cos(this.renderLat * Math.PI / 180) || 1;
                const dLonDeg = (distM * Math.sin(radHdg)) / (111139 * cosLat);

                this.renderLat += dLatDeg;
                this.renderLon += dLonDeg;
            }
            this.renderHeading = this.targetHeading;
            this.renderAlt = this.targetAlt;
            this.renderGs = this.targetGs;
        }

        return true;
    }
}

const singleAircraftBuffer = new AircraftTelemetryBuffer();
const fleetAircraftBuffers = new Map(); // id -> AircraftTelemetryBuffer
let motionLoopAnimId = null;

function startPlaneMotionLoop() {
    if (motionLoopAnimId) return;

    function step() {
        const now = Date.now();

        // 1. Update Single Tracked Radar Aircraft
        if (aircraftMarker && singleAircraftBuffer.renderLat !== null) {
            singleAircraftBuffer.update(now);

            const visibleLon = getVisibleLongitude(singleAircraftBuffer.renderLon, map);
            aircraftMarker.setLatLng([singleAircraftBuffer.renderLat, visibleLon]);

            const markerEl = aircraftMarker.getElement();
            if (markerEl) {
                const rotEl = markerEl.querySelector('.aircraft-icon-svg-wrapper');
                if (rotEl) {
                    rotEl.style.transform = `rotate(${singleAircraftBuffer.renderHeading}deg)`;
                }
            }

            if (aircraftTrailLayer && aircraftTrailPoints.length > 0) {
                let trailCopy = [...aircraftTrailPoints];
                trailCopy[trailCopy.length - 1] = [singleAircraftBuffer.renderLat, visibleLon];
                aircraftTrailLayer.setLatLngs(trailCopy);
            }

            if (singleAircraftBuffer.flightData) {
                const liveTelemetry = {
                    ...singleAircraftBuffer.flightData,
                    latitude: singleAircraftBuffer.renderLat,
                    longitude: singleAircraftBuffer.renderLon,
                    heading_deg: Math.round(singleAircraftBuffer.renderHeading),
                    altitude_ft: singleAircraftBuffer.renderAlt,
                    groundspeed_kts: singleAircraftBuffer.renderGs
                };
                updateLiveHud(liveTelemetry);
                updateLiveInspectorMetrics(liveTelemetry);
            }
        }

        // 2. Update All Virtual Airline / FSHub Fleet Aircraft on Map
        fleetAircraftBuffers.forEach((buf, id) => {
            if (!buf.marker || !map.hasLayer(buf.marker)) return;
            buf.update(now);

            const visibleLon = getVisibleLongitude(buf.renderLon, map);
            buf.marker.setLatLng([buf.renderLat, visibleLon]);

            const markerEl = buf.marker.getElement();
            if (markerEl) {
                const rotEl = markerEl.querySelector('.aircraft-icon-svg-wrapper');
                if (rotEl) {
                    rotEl.style.transform = `rotate(${buf.renderHeading}deg)`;
                }
            }

            // If this fleet plane is the selected inspected flight, update the Live HUD & Inspector Card
            if (activeVaFlightId === id && buf.flightData) {
                const liveTelemetry = {
                    ...buf.flightData,
                    latitude: buf.renderLat,
                    longitude: buf.renderLon,
                    heading_deg: Math.round(buf.renderHeading),
                    altitude_ft: buf.renderAlt,
                    groundspeed_kts: buf.renderGs
                };
                updateLiveHud(liveTelemetry);
                updateLiveInspectorMetrics(liveTelemetry);
            }
        });

        motionLoopAnimId = requestAnimationFrame(step);
    }

    motionLoopAnimId = requestAnimationFrame(step);
}

function updateAircraftMarker(telemetry, panToPlane = false) {
    if (!telemetry) return;
    const lat = telemetry.latitude !== undefined ? telemetry.latitude : (telemetry.position?.lat !== undefined ? telemetry.position.lat : (telemetry.lat !== undefined ? telemetry.lat : null));
    let lon = telemetry.longitude !== undefined ? telemetry.longitude : (telemetry.position?.lng !== undefined ? telemetry.position.lng : (telemetry.position?.lon !== undefined ? telemetry.position.lon : (telemetry.lng !== undefined ? telemetry.lng : null)));
    const hdg = telemetry.heading_deg !== undefined ? telemetry.heading_deg : (telemetry.position?.heading !== undefined ? telemetry.position.heading : (telemetry.heading || 0));
    const aircraft = telemetry.aircraft || telemetry.flight_plan?.aircraft || telemetry.aircraft?.icao || '';
    const routeStr = telemetry.route || telemetry.flight_plan?.route || telemetry.plan?.route || '';

    if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
        console.warn('[Radar] updateAircraftMarker skipped due to invalid coordinates:', { lat, lon, telemetry });
        return;
    }

    // Push into telemetry playhead buffer
    singleAircraftBuffer.pushTelemetry(telemetry);

    // Align aircraft longitude directly to the currently visible world copy in viewport
    const visibleLon = getVisibleLongitude(lon, map);

    if (!aircraftTrailLayer) {
        aircraftTrailLayer = L.polyline([], {
            color: '#c084fc',
            weight: 3,
            opacity: 0.8,
            dashArray: '4, 4'
        }).addTo(map);
    }

    if (aircraftTrailPoints.length > 0) {
        const lastPt = aircraftTrailPoints[aircraftTrailPoints.length - 1];
        let shiftLon = visibleLon;
        while (shiftLon - lastPt[1] > 180) shiftLon -= 360;
        while (shiftLon - lastPt[1] < -180) shiftLon += 360;
        aircraftTrailPoints.push([lat, shiftLon]);
    } else {
        aircraftTrailPoints.push([lat, visibleLon]);
    }

    if (aircraftTrailPoints.length > 100) aircraftTrailPoints.shift();
    aircraftTrailLayer.setLatLngs(aircraftTrailPoints);

    // Dynamic Sizing & Vector SVG Airplane / Helicopter Icon
    const info = classifyAircraftType(aircraft, routeStr);
    const planeHtml = getAircraftMarkerHtml(aircraft, singleAircraftBuffer.renderHeading || hdg, '#00ff88', true, '#38bdf8', routeStr);

    const customIcon = L.divIcon({
        html: planeHtml,
        className: 'aircraft-div-icon',
        iconSize: [info.size, info.size],
        iconAnchor: [Math.round(info.size / 2), Math.round(info.size / 2)]
    });

    if (!aircraftMarker) {
        aircraftMarker = L.marker([lat, visibleLon], { icon: customIcon, zIndexOffset: 1000 }).addTo(map);
    } else {
        aircraftMarker.setIcon(customIcon);
        if (!map.hasLayer(aircraftMarker)) {
            aircraftMarker.addTo(map);
        }
    }

    // Start 60fps smooth real-time animation loop
    startPlaneMotionLoop();

    // Only show clean tooltip with callsign and "Click for info" (No white Leaflet bubble)
    aircraftMarker.unbindPopup();
    aircraftMarker.bindTooltip(`<strong>${telemetry.callsign}</strong> • Click for info`, {
        permanent: false,
        direction: 'top',
        className: 'plane-leaflet-tooltip'
    });

    // Directly attach capture-phase DOM click handler and disable click propagation to Leaflet map
    const markerEl = aircraftMarker.getElement();
    if (markerEl) {
        L.DomEvent.disableClickPropagation(markerEl);
        markerEl.onclick = (e) => {
            if (e) {
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
            lastMarkerClickTime = Date.now();
            routeVisible = true;
            selectVaFlight(telemetry, false);
        };
    }

    // Leaflet marker click handler fallback
    aircraftMarker.off('click').on('click', (e) => {
        lastMarkerClickTime = Date.now();
        if (e && e.originalEvent) {
            e.originalEvent._stopped = true;
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
        }
        routeVisible = true;
        selectVaFlight(telemetry, false);
    });

    if (panToPlane) {
        map.panTo([lat, visibleLon]);
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 📡 FSHUB & VATSIM LIVE HUB SLIDE-OVER OVERLAY PANEL
// ═══════════════════════════════════════════════════════════════════════════════

let fshubHubInterval = null;
let currentFshubData = null;
let activeVaFlightId = null;

function setupFshubLiveHub() {
    const toggleBtn = document.getElementById('fshubPanelToggleBtn');
    const popup = document.getElementById('fshubLivePopup');
    const closeBtn = document.getElementById('fshubCloseBtn');
    const refreshBtn = document.getElementById('fshubRefreshBtn');
    const saveBtn = document.getElementById('fshubTokenSaveBtn');
    const tokenInput = document.getElementById('fshubTokenInput');
    const tabsContainer = document.getElementById('fshubPopupTabs');

    if (!popup) return;

    // Toggle button on right edge of map
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isHidden = popup.classList.contains('hidden');
            if (isHidden) {
                popup.classList.remove('hidden');
                const savedToken = localStorage.getItem('fshub_token') || (tokenInput ? tokenInput.value.trim() : '');
                if (savedToken) {
                    syncFshubHub(savedToken, false);
                }
            } else {
                popup.classList.add('hidden');
            }
        });
    }

    // Close button
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            clearRouteFromMap();
        });
    }

    // Refresh button
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            const token = tokenInput ? tokenInput.value.trim() : (localStorage.getItem('fshub_token') || '');
            if (token) syncFshubHub(token, false);
        });
    }

    // Save/Sync button
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const token = tokenInput ? tokenInput.value.trim() : '';
            if (token) syncFshubHub(token, false);
        });
    }

    if (tokenInput) {
        tokenInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const token = tokenInput.value.trim();
                if (token) syncFshubHub(token, false);
            }
        });
    }

    // Tab switching (Personal Pilot vs Virtual Airline Fleet)
    if (tabsContainer) {
        tabsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.fshub-tab-btn');
            if (!btn) return;

            const allBtns = tabsContainer.querySelectorAll('.fshub-tab-btn');
            allBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const tab = btn.getAttribute('data-fshub-tab');
            const personalView = document.getElementById('fshubPersonalView');
            const vaView = document.getElementById('fshubVaView');

            if (tab === 'personal') {
                if (personalView) personalView.style.display = 'flex';
                if (vaView) vaView.style.display = 'none';
            } else if (tab === 'va') {
                if (personalView) personalView.style.display = 'none';
                if (vaView) vaView.style.display = 'flex';
            }
        });
    }

    // Pre-populate saved token if present
    const saved = localStorage.getItem('fshub_token');
    if (saved && tokenInput) {
        tokenInput.value = saved;
    }
}

async function syncFshubHub(token, silent = false) {
    const loader = document.getElementById('fshubPopupLoader');
    const statusEl = document.getElementById('fshubTokenStatus');
    const tabsContainer = document.getElementById('fshubPopupTabs');
    const headerTitle = document.getElementById('fshubPopupHeaderTitle');

    if (!token) return;

    if (!silent && loader) loader.style.display = 'block';
    if (statusEl) {
        statusEl.className = 'fshub-token-status';
        statusEl.textContent = 'Connecting to FSHub & VATSIM API...';
    }

    try {
        const res = await fetch('/api/v1/fshub/inspect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });

        const data = await res.json();
        if (!silent && loader) loader.style.display = 'none';

        if (!data || data.error || !data.success) {
            if (statusEl) {
                statusEl.className = 'fshub-token-status error';
                statusEl.textContent = `❌ ${data.error || 'Failed to authenticate FSHub token'}`;
            }
            return;
        }

        // Save valid token
        localStorage.setItem('fshub_token', token);
        currentFshubData = data;

        if (statusEl) {
            statusEl.className = 'fshub-token-status success';
            statusEl.textContent = `✓ Synced with FSHub • ${data.user.name}`;
        }

        if (tabsContainer) tabsContainer.style.display = 'flex';
        if (headerTitle) {
            const vaName = data.virtual_airlines?.[0]?.name || 'Fleet Radar';
            headerTitle.textContent = `${data.user.name} • ${vaName}`;
        }

        // Render Views
        renderFshubPersonalView(data.user);
        renderFshubVaView(data.virtual_airlines);

        // Gather all active flights across Virtual Airlines and plot all aircraft simultaneously on the map
        let allFleetFlights = [];
        if (data.virtual_airlines && Array.isArray(data.virtual_airlines)) {
            data.virtual_airlines.forEach(va => {
                if (va.active_flights && Array.isArray(va.active_flights)) {
                    allFleetFlights.push(...va.active_flights);
                }
            });
        }
        if (allFleetFlights.length > 0) {
            renderFleetMarkersOnMap(allFleetFlights, !silent);

            // If a pilot is currently selected and inspected, refresh their card without closing
            if (activeVaFlightId) {
                const refreshed = allFleetFlights.find(f => (f.id || f.callsign) === activeVaFlightId);
                if (refreshed) {
                    renderSelectedPilotPopup(refreshed);
                }
            }
        }

        // Start background polling while open (3s interval)
        if (!fshubHubInterval) {
            fshubHubInterval = setInterval(() => {
                const popup = document.getElementById('fshubLivePopup');
                if (popup && !popup.classList.contains('hidden')) {
                    syncFshubHub(token, true);
                }
            }, 3000);
        }

    } catch (e) {
        if (!silent && loader) loader.style.display = 'none';
        if (statusEl) {
            statusEl.className = 'fshub-token-status error';
            statusEl.textContent = `❌ Connection Error: ${e.message}`;
        }
    }
}

function renderFshubPersonalView(user) {
    const view = document.getElementById('fshubPersonalView');
    if (!view) return;

    const stats = user.stats || {};
    const vat = user.vatsim_live || {};
    const hasVatCid = !!user.vatsim_cid;
    const isVatOnline = !!vat.is_online;

    let vatsimCardHtml = '';
    if (hasVatCid) {
        vatsimCardHtml = `
            <div class="fshub-vatsim-card">
                <div class="fshub-vatsim-header">
                    <div class="vatsim-brand-badge">
                        <span>🌐 VATSIM CID:</span>
                        <strong>${user.vatsim_cid}</strong>
                    </div>
                    <span class="vatsim-status-pill ${isVatOnline ? 'online' : 'offline'}">
                        ${isVatOnline ? '🟢 ONLINE ON VATSIM' : '⚪ VATSIM OFFLINE'}
                    </span>
                </div>
                ${isVatOnline ? `
                    <div class="vatsim-details-row">
                        <span><strong>Callsign:</strong> ${vat.callsign || '--'}</span>
                        <span><strong>Squawk:</strong> ${vat.squawk || '--'}</span>
                    </div>
                    <div class="vatsim-details-row" style="margin-top: 4px;">
                        <span><strong>Route:</strong> ${vat.departure || '--'} ➔ ${vat.arrival || '--'}</span>
                        <span><strong>FL:</strong> ${vat.altitude_ft ? Math.round(vat.altitude_ft / 100) : '--'}</span>
                    </div>
                ` : `
                    <div style="font-size: 0.68rem; color: #94a3b8;">
                        Pilot CID is verified on FSHub. Ready for live VATSIM ATC tracking.
                    </div>
                `}
            </div>
        `;
    } else {
        vatsimCardHtml = `
            <div class="fshub-vatsim-card" style="border-color: rgba(255,255,255,0.1);">
                <div class="fshub-vatsim-header">
                    <div class="vatsim-brand-badge" style="color: #94a3b8;">🌐 VATSIM Link</div>
                    <span class="vatsim-status-pill offline">No CID Linked</span>
                </div>
                <div style="font-size: 0.68rem; color: #64748b;">
                    Add your VATSIM CID to your FSHub pilot profile handles to enable live VATSIM radar correlation.
                </div>
            </div>
        `;
    }

    let activeFlightHtml = '';
    if (user.active_flight) {
        const af = user.active_flight;
        activeFlightHtml = `
            <div class="fshub-active-flight-card">
                <div class="fshub-flight-header">
                    <span class="fshub-flight-callsign">✈️ ${af.callsign}</span>
                    <span class="live-phase-pill">${(af.phase || 'AIRBORNE').replace('_', ' ').toUpperCase()}</span>
                </div>
                ${af.departure || af.arrival ? `
                    <div class="fshub-flight-route-strip">
                        <span>${af.departure || '???'}</span>
                        <span class="arrow">➔</span>
                        <span>${af.arrival || '???'}</span>
                        ${af.aircraft ? `<span style="font-size: 0.72rem; color: #c084fc; margin-left: 6px;">(${af.aircraft})</span>` : ''}
                    </div>
                ` : ''}
                <button class="btn-primary" style="padding: 8px 12px; font-size: 0.76rem; width: 100%;" onclick="focusPersonalPilot()">
                    <span>🎯 Focus Aircraft on Map</span>
                </button>
            </div>
        `;
    } else if (user.gps) {
        activeFlightHtml = `
            <div class="fshub-active-flight-card" style="border-color: rgba(56, 189, 248, 0.35);">
                <div class="fshub-flight-header">
                    <span style="font-size: 0.82rem; font-weight: 700; color: #38bdf8;">📍 Standby / GPS Online</span>
                    <span class="live-phase-pill" style="background: rgba(0,255,136,0.15); color: #00ff88; border-color: rgba(0,255,136,0.3);">CONNECTED</span>
                </div>
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.74rem; color: #94a3b8; margin-bottom: 8px;">
                    Position: ${user.gps.lat.toFixed(4)}, ${user.gps.lng.toFixed(4)}
                </div>
                <button class="btn-primary" style="padding: 8px 12px; font-size: 0.76rem; width: 100%;" onclick="focusPersonalGps(${user.gps.lat}, ${user.gps.lng}, '${user.name}')">
                    <span>📍 Plot GPS Position on Map</span>
                </button>
            </div>
        `;
    }

    view.innerHTML = `
        <div class="fshub-profile-card">
            <div class="fshub-profile-header">
                <img src="https://g.fshubcdn.com/avatars/u_${user.id}_80.png" onerror="this.src='/assets/default-pilot-avatar.png'" class="fshub-avatar-img" alt="${user.name}">
                <div>
                    <div class="fshub-pilot-name">${user.name}</div>
                    <div class="fshub-pilot-id">Pilot ID: #${user.id} • Base: <strong>${user.base || 'KBNA'}</strong></div>
                </div>
            </div>

            ${user.bio ? `<div class="fshub-bio-box">${user.bio}</div>` : ''}

            <div class="fshub-stats-grid">
                <div class="fshub-stat-box">
                    <span class="fshub-stat-title">Flights</span>
                    <span class="fshub-stat-num">${(stats.total_flights || 0).toLocaleString()}</span>
                </div>
                <div class="fshub-stat-box">
                    <span class="fshub-stat-title">Hours</span>
                    <span class="fshub-stat-num">${stats.total_hours ? Math.round(stats.total_hours) : 0}h</span>
                </div>
                <div class="fshub-stat-box">
                    <span class="fshub-stat-title">Dist (NM)</span>
                    <span class="fshub-stat-num">${stats.total_distance ? Math.round(stats.total_distance / 1000) + 'k' : '--'}</span>
                </div>
                <div class="fshub-stat-box">
                    <span class="fshub-stat-title">Avg Landing</span>
                    <span class="fshub-stat-num" style="color: #00ff88;">${stats.average_landing ? Math.abs(Math.round(stats.average_landing)) + ' fpm' : '--'}</span>
                </div>
            </div>

            ${vatsimCardHtml}
        </div>

        ${activeFlightHtml}
    `;
}

function renderFshubVaView(airlines) {
    const view = document.getElementById('fshubVaView');
    const badge = document.getElementById('fshubVaCountBadge');
    if (!view) return;

    if (!airlines || airlines.length === 0) {
        view.innerHTML = `
            <div class="fshub-empty-state">
                <div class="fshub-empty-icon">🏢</div>
                <h4>No Virtual Airlines</h4>
                <p>Your FSHub account is not currently a member or owner of any registered Virtual Airline.</p>
            </div>
        `;
        if (badge) badge.textContent = '0';
        return;
    }

    let totalActiveFlights = 0;
    airlines.forEach(a => { totalActiveFlights += (a.active_flights?.length || 0); });
    if (badge) badge.textContent = totalActiveFlights.toString();

    // Check for selected flight across airlines and activeFleetFlights
    let selectedFlight = null;
    if (activeVaFlightId) {
        for (const va of airlines) {
            const found = va.active_flights?.find(f => (String(f.id) === String(activeVaFlightId) || String(f.callsign) === String(activeVaFlightId)));
            if (found) {
                selectedFlight = found;
                break;
            }
        }
        if (!selectedFlight && Array.isArray(activeFleetFlights) && activeFleetFlights.length > 0) {
            selectedFlight = activeFleetFlights.find(f => (String(f.id) === String(activeVaFlightId) || String(f.callsign) === String(activeVaFlightId)));
        }
    }

    let html = '';

    // If a pilot is selected, render the Selected Pilot & Flight Plan Inspector Card at the top!
    if (selectedFlight) {
        const isVat = selectedFlight.vatsim && selectedFlight.vatsim.is_online;
        const alt = selectedFlight.position?.altitude_ft || selectedFlight.altitude_ft || 0;
        const gs = selectedFlight.position?.speed_tas_kts || selectedFlight.groundspeed_kts || 0;
        const hdg = selectedFlight.position?.heading || selectedFlight.heading_deg || 0;
        const dep = selectedFlight.departure || selectedFlight.flight_plan?.departure || '???';
        const arr = selectedFlight.arrival || selectedFlight.flight_plan?.arrival || '???';
        const routeStr = selectedFlight.route || selectedFlight.flight_plan?.route || null;
        const aircraft = selectedFlight.aircraft || selectedFlight.flight_plan?.aircraft || 'Unknown Aircraft';
        const lat = selectedFlight.position?.lat !== undefined ? selectedFlight.position.lat : selectedFlight.latitude;
        const lon = selectedFlight.position?.lng !== undefined ? selectedFlight.position.lng : selectedFlight.longitude;

        html += `
            <div class="selected-pilot-inspector-card">
                <div class="inspector-header">
                    <div class="inspector-pilot-identity">
                        <img src="${selectedFlight.pilot_avatar || '/assets/default-pilot-avatar.png'}" onerror="this.src='/assets/default-pilot-avatar.png'" class="inspector-avatar" alt="${selectedFlight.pilot_name}">
                        <div>
                            <div class="inspector-callsign">${selectedFlight.callsign}</div>
                            <div class="inspector-pilot-name">👤 ${selectedFlight.pilot_name} • <span style="color: #c084fc;">${aircraft}</span></div>
                        </div>
                    </div>
                    <span class="live-phase-pill">${(selectedFlight.phase || 'AIRBORNE').replace('_', ' ').toUpperCase()}</span>
                </div>

                <div class="inspector-flight-plan-box">
                    <div class="inspector-route-header">
                        <span>${dep}</span>
                        <span style="color: #38bdf8; font-size: 1.1rem;">➔</span>
                        <span>${arr}</span>
                        <span style="color: #fbbf24; font-size: 0.72rem; font-weight: 700;">FL${Math.round(alt / 100)}</span>
                    </div>
                    ${routeStr ? `
                        <div class="inspector-route-string">
                            <strong style="color: #38bdf8;">FILED ROUTE:</strong> ${routeStr}
                        </div>
                    ` : (dep !== '???' && arr !== '???' ? `
                        <div style="font-size: 0.68rem; color: #94a3b8; font-style: italic;">
                            Direct Great-Circle Trajectory (${dep} ➔ ${arr})
                        </div>
                    ` : `
                        <div style="font-size: 0.68rem; color: #94a3b8; font-style: italic;">
                            No Filed Flight Plan • On Ramp / Standby
                        </div>
                    `)}
                </div>

                <div class="inspector-telemetry-grid">
                    <div class="inspector-telem-item">
                        <span>Altitude</span>
                        <span>${Math.round(alt).toLocaleString()} ft</span>
                    </div>
                    <div class="inspector-telem-item">
                        <span>Speed</span>
                        <span>${gs} kts</span>
                    </div>
                    <div class="inspector-telem-item">
                        <span>Heading</span>
                        <span>${hdg}°</span>
                    </div>
                    <div class="inspector-telem-item">
                        <span>Squawk</span>
                        <span>${selectedFlight.position?.squawk || '----'}</span>
                    </div>
                </div>

                ${isVat ? `
                    <div style="font-size: 0.68rem; color: #00ff88; background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.25); border-radius: 6px; padding: 6px 8px; display: flex; align-items: center; justify-content: space-between;">
                        <span>🟢 <strong>VATSIM LIVE:</strong> ${selectedFlight.vatsim.callsign || selectedFlight.callsign}</span>
                        <span>CID: ${selectedFlight.vatsim.cid || 'Connected'}</span>
                    </div>
                ` : ''}

                <div class="inspector-actions-row">
                    <button class="btn-inspector-action btn-inspector-center" onclick="map.panTo([${lat}, ${lon}])">
                        <span>🎯 Center Map</span>
                    </button>
                    <button class="btn-inspector-action btn-inspector-deselect" onclick="clearRouteFromMap()">
                        <span>✕ Deselect / Clear</span>
                    </button>
                </div>
            </div>
        `;
    }

    airlines.forEach(va => {
        const flights = va.active_flights || [];
        html += `
            <div class="va-airline-header-card">
                <div>
                    <div class="va-name-title">${va.name}</div>
                    <div class="va-stats-pill-group">
                        <span>👥 <strong>${va.total_pilots || 0}</strong> Pilots</span>
                        <span>🟢 <strong>${va.online_pilots_count || 0}</strong> Online</span>
                        <span>✈️ <strong>${flights.length}</strong> Flying</span>
                    </div>
                </div>
                <span class="va-icao-tag">${va.abbr || 'VA'}</span>
            </div>

            <div class="va-active-pilots-title">Active Flying Fleet (${flights.length})</div>
        `;

        if (flights.length === 0) {
            html += `
                <div style="text-align: center; padding: 20px 12px; color: #64748b; font-size: 0.76rem; background: rgba(0,0,0,0.2); border-radius: 8px;">
                    No ${va.abbr} pilots currently airborne on radar.
                </div>
            `;
        } else {
            flights.forEach(f => {
                const isSelected = String(activeVaFlightId) === String(f.id) || String(activeVaFlightId) === String(f.callsign);
                const isVatOnline = f.vatsim && f.vatsim.is_online;
                const alt = f.position?.altitude_ft || 0;
                const gs = f.position?.speed_tas_kts || 0;
                const acInfo = classifyAircraftType(f.aircraft, f.route || f.flight_plan?.route);
                const airlineInfo = resolveAirlineInfo(f.callsign, f);

                html += `
                    <div class="va-pilot-item-card ${isSelected ? 'active' : ''}" onclick="selectVaFlight('${f.id || f.callsign}')">
                        <div class="va-pilot-row-top">
                            <div class="va-pilot-identity">
                                <img src="${f.pilot_avatar || '/assets/default-pilot-avatar.png'}" onerror="this.src='/assets/default-pilot-avatar.png'" class="va-pilot-mini-avatar" alt="${f.pilot_name}">
                                <div>
                                    <div class="va-pilot-callsign">${f.callsign}</div>
                                    <div class="va-pilot-name-txt">${f.pilot_name} ${airlineInfo ? `• <span style="color: #c084fc; font-weight: 600;">${airlineInfo.name}</span>` : ''}</div>
                                </div>
                            </div>
                            <span class="live-phase-pill" style="font-size: 0.62rem;">${(f.phase || 'AIRBORNE').replace('_', ' ').toUpperCase()}</span>
                        </div>

                        ${f.departure || f.arrival || (acInfo && acInfo.label) ? `
                            <div class="va-pilot-route-tag">
                                <span>${f.departure || '???'}</span>
                                <span style="color: #38bdf8;">➔</span>
                                <span>${f.arrival || '???'}</span>
                                ${acInfo && acInfo.label ? `<span style="color: #38bdf8; font-size: 0.68rem; margin-left: auto;">${acInfo.label}</span>` : ''}
                            </div>
                        ` : ''}

                        <div class="va-pilot-telemetry-row">
                            <span>FL${Math.round(alt / 100)} (${Math.round(alt).toLocaleString()} ft)</span>
                            <span>${Math.round(gs)} kts</span>
                            <span>HDG ${Math.round(f.position?.heading || 0)}°</span>
                        </div>

                        ${isVatOnline ? `
                            <div style="font-size: 0.64rem; color: #00ff88; display: flex; align-items: center; justify-content: space-between; padding-top: 4px; border-top: 1px solid rgba(0,255,136,0.15);">
                                <span>🟢 VATSIM: <strong>${f.vatsim.callsign}</strong></span>
                                <span>SQ: <strong>${f.vatsim.squawk || '----'}</strong></span>
                            </div>
                        ` : ''}
                    </div>
                `;
            });
        }
    });

    view.innerHTML = html;
}

let activeFleetFlights = [];

function clearRouteFromMap() {
    routeVisible = false;

    if (routeLayerGroup) routeLayerGroup.clearLayers();
    if (aircraftTrailLayer) {
        map.removeLayer(aircraftTrailLayer);
        aircraftTrailLayer = null;
    }
    aircraftTrailPoints = [];

    const telemCard = document.getElementById('telemetryCard');
    if (telemCard) telemCard.style.display = 'none';

    const wpCard = document.getElementById('waypointLogCard');
    if (wpCard) wpCard.style.display = 'none';

    const mapBadge = document.getElementById('mapBadge');
    if (mapBadge) mapBadge.style.display = 'none';

    // Hide right slide-over popup
    const popup = document.getElementById('fshubLivePopup');
    if (popup) popup.classList.add('hidden');

    activeVaFlightId = null;

    // Refresh active halos on fleet markers without removing any aircraft markers
    if (Array.isArray(activeFleetFlights) && activeFleetFlights.length > 0) {
        renderFleetMarkersOnMap(activeFleetFlights, false);
    }
    // Retain single-tracked aircraft marker on map
    if (latestSinglePilotData && latestSinglePilotData.telemetry) {
        updateAircraftMarker(latestSinglePilotData.telemetry, false);
    }
    if (aircraftMarker && map && !map.hasLayer(aircraftMarker)) {
        aircraftMarker.addTo(map);
    }
}

function renderSelectedPilotPopup(pilot) {
    const card = document.getElementById('fshubLivePopup');
    if (!card || !pilot) return;

    const isNativeVatsim = (pilot.network && pilot.network.toUpperCase() === 'VATSIM') || (!pilot.network && !!pilot.cid);
    const isVat = isNativeVatsim || (pilot.vatsim && pilot.vatsim.is_online);
    const vatCid = pilot.vatsim?.cid || pilot.vatsim_cid || pilot.cid || (isNativeVatsim ? (pilot.identifier || pilot.cid) : null);
    const vatCallsign = pilot.vatsim?.callsign || pilot.callsign;
    const vatSquawk = pilot.vatsim?.squawk || pilot.transponder || pilot.position?.squawk || pilot.squawk || '1200';
    const vatAlt = pilot.vatsim?.altitude_ft || (isNativeVatsim ? (pilot.altitude_ft || pilot.position?.altitude_ft) : null);
    const vatGs = pilot.vatsim?.groundspeed_kts || (isNativeVatsim ? (pilot.groundspeed_kts || pilot.position?.speed_tas_kts) : null);

    const alt = pilot.position?.altitude_ft || pilot.altitude_ft || 0;
    const gs = pilot.position?.speed_tas_kts || pilot.groundspeed_kts || 0;
    const hdg = pilot.position?.heading || pilot.heading_deg || 0;
    const dep = pilot.departure || pilot.flight_plan?.departure || pilot.plan?.departure || '???';
    const arr = pilot.arrival || pilot.flight_plan?.arrival || pilot.plan?.arrival || '???';
    const routeStr = pilot.route || pilot.flight_plan?.route || pilot.plan?.route || null;
    const rawAc = pilot.aircraft || pilot.flight_plan?.aircraft || pilot.aircraft?.icao || '';
    const isBlankAc = !rawAc || ['AIRCRAFT', 'UNKNOWN', 'PLANE'].includes(String(rawAc).trim().toUpperCase());
    const lat = pilot.position?.lat !== undefined ? pilot.position.lat : pilot.latitude;
    const lon = pilot.position?.lng !== undefined ? pilot.position.lng : pilot.longitude;
    const phase = (pilot.phase || (gs > 30 ? 'AIRBORNE' : 'TAXIING')).replace('_', ' ').toUpperCase();
    const aircraftType = isBlankAc ? null : classifyAircraftType(rawAc, routeStr);
    const aircraftDisplay = aircraftType && aircraftType.label ? aircraftType.label : (rawAc && !isBlankAc ? `✈️ ${rawAc}` : '');
    const airlineInfo = resolveAirlineInfo(pilot.callsign, pilot);

    card.innerHTML = `
        <!-- Top Header -->
        <div class="inspector-header">
            <div class="inspector-pilot-identity">
                <img src="${pilot.pilot_avatar || '/assets/default-pilot-avatar.png'}" onerror="this.src='/assets/default-pilot-avatar.png'" class="inspector-avatar" alt="${pilot.pilot_name}">
                <div>
                    <div class="inspector-callsign">${pilot.callsign}</div>
                    <div class="inspector-pilot-name">👤 ${pilot.pilot_name || 'Pilot'}${airlineInfo ? ` • <span style="color: #c084fc; font-weight: 600;">${airlineInfo.badge}</span>` : ''}${aircraftDisplay ? ` • <span style="color: #38bdf8; font-weight: 500;">${aircraftDisplay}</span>` : ''}</div>
                </div>
            </div>
            <span class="live-phase-pill" id="inspectorPhasePill">${phase}</span>
        </div>

        <!-- Flight Plan Corridor Box -->
        <div class="inspector-flight-plan-box">
            ${airlineInfo ? `
                <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 6px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.08); font-size: 0.74rem;">
                    <span style="color: #94a3b8; font-weight: 500;">OPERATOR</span>
                    <span style="color: #38bdf8; font-weight: 600;">🏢 ${airlineInfo.badge}</span>
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
            ` : (dep !== '???' && arr !== '???' && arr !== 'STANDBY' ? `
                <div style="font-size: 0.72rem; color: #94a3b8; font-style: italic;">
                    Direct Great-Circle Flight Path (${dep} ➔ ${arr})
                </div>
            ` : (dep !== '???' ? `
                <div style="font-size: 0.72rem; color: #cbd5e1;">
                    <strong style="color: #00ff88;">📍 CURRENT AIRPORT:</strong> ${dep} ${pilot.departure_name ? `(${pilot.departure_name})` : ''}
                    <div style="font-size: 0.68rem; color: #94a3b8; margin-top: 2px;">Aircraft on Ramp / Standby • Awaiting IFR Clearance</div>
                </div>
            ` : `
                <div style="font-size: 0.72rem; color: #94a3b8; font-style: italic;">
                    No Filed Flight Plan • Aircraft on Ramp / Standby
                </div>
            `))}
        </div>

        <!-- Telemetry Matrix -->
        <div class="inspector-telemetry-grid">
            <div class="inspector-telem-item">
                <span>ALTITUDE</span>
                <span id="inspectorAlt" style="color: #00ff88;">${Math.round(alt).toLocaleString()} ft</span>
            </div>
            <div class="inspector-telem-item">
                <span>SPEED</span>
                <span id="inspectorSpeed" style="color: #38bdf8;">${Math.round(gs)} kts</span>
            </div>
            <div class="inspector-telem-item">
                <span>HEADING</span>
                <span id="inspectorHdg" style="color: #fbbf24;">${String(Math.round(hdg) % 360).padStart(3, '0')}°</span>
            </div>
            <div class="inspector-telem-item">
                <span>SQUAWK</span>
                <span id="inspectorSquawk" style="color: #ffffff;">${pilot.position?.squawk || pilot.squawk || pilot.transponder || '1200'}</span>
            </div>
        </div>

        <!-- VATSIM Network & ID Status -->
        <div class="fshub-vatsim-card">
            <div class="fshub-vatsim-header">
                <div class="vatsim-brand-badge">
                    <span>🌐 VATSIM CID:</span>
                    <strong>${vatCid || (isNativeVatsim ? 'Active Connection' : 'Not Linked')}</strong>
                </div>
                <span class="vatsim-status-pill ${isVat ? 'online' : 'offline'}">
                    ${isVat ? '🟢 ONLINE ON VATSIM' : (vatCid ? '⚪ VATSIM OFFLINE' : '⚪ NO CID')}
                </span>
            </div>
            ${isVat ? `
                <div class="vatsim-details-row">
                    <span><strong>VATSIM CS:</strong> ${vatCallsign}</span>
                    <span><strong>Squawk:</strong> ${vatSquawk}</span>
                </div>
                ${vatAlt ? `
                    <div class="vatsim-details-row" style="margin-top: 4px;">
                        <span><strong>Radar Alt:</strong> ${Math.round(vatAlt).toLocaleString()} ft</span>
                        <span><strong>GS:</strong> ${vatGs || '--'} kts</span>
                    </div>
                ` : ''}
            ` : (vatCid ? `
                <div style="font-size: 0.68rem; color: #94a3b8;">
                    Pilot CID <strong>${vatCid}</strong> verified via FSHub handles. Standby for live VATSIM ATC connection.
                </div>
            ` : `
                <div style="font-size: 0.68rem; color: #64748b;">
                    Add your VATSIM CID to FSHub handles for live radar cross-correlation.
                </div>
            `)}
        </div>
    `;
}

window.selectVaFlight = function(flightOrId, shouldPan = false) {
    routeVisible = true;
    lastMarkerClickTime = Date.now();
    let targetFlight = null;

    if (typeof flightOrId === 'object' && flightOrId !== null) {
        targetFlight = flightOrId;
    } else {
        const idStr = String(flightOrId);
        // Search in activeFleetFlights
        if (Array.isArray(activeFleetFlights)) {
            targetFlight = activeFleetFlights.find(f => String(f.id) === idStr || String(f.callsign) === idStr || String(f.pilot_id) === idStr || String(f.pilot_name) === idStr);
        }
        // Search in currentFshubData if not found
        if (!targetFlight && currentFshubData?.virtual_airlines) {
            for (const va of currentFshubData.virtual_airlines) {
                const found = va.active_flights?.find(f => String(f.id) === idStr || String(f.callsign) === idStr || String(f.pilot_id) === idStr || String(f.pilot_name) === idStr);
                if (found) {
                    targetFlight = found;
                    break;
                }
            }
        }
        if (!targetFlight && latestSinglePilotData && latestSinglePilotData.telemetry) {
            if (String(latestSinglePilotData.telemetry.id) === idStr || String(latestSinglePilotData.telemetry.callsign) === idStr || String(latestSinglePilotData.telemetry.identifier) === idStr) {
                targetFlight = latestSinglePilotData.telemetry;
            }
        }
    }

    if (!targetFlight) {
        console.warn('[Radar] Target flight not found for identifier:', flightOrId);
        return;
    }

    activeVaFlightId = targetFlight.id || targetFlight.callsign;

    // Open right-side slide-over popup and render ONLY this pilot's info
    const popup = document.getElementById('fshubLivePopup');
    if (popup) {
        popup.classList.remove('hidden');
    }

    renderSelectedPilotPopup(targetFlight);

    const lat = targetFlight.latitude !== undefined ? targetFlight.latitude : (targetFlight.position?.lat !== undefined ? targetFlight.position.lat : (targetFlight.lat !== undefined ? targetFlight.lat : null));
    const lon = targetFlight.longitude !== undefined ? targetFlight.longitude : (targetFlight.position?.lng !== undefined ? targetFlight.position.lng : (targetFlight.position?.lon !== undefined ? targetFlight.position.lon : (targetFlight.lng !== undefined ? targetFlight.lng : (targetFlight.lon !== undefined ? targetFlight.lon : null))));

    const dep = targetFlight.departure || targetFlight.flight_plan?.departure || targetFlight.plan?.departure || null;
    const arr = targetFlight.arrival || targetFlight.flight_plan?.arrival || targetFlight.plan?.arrival || null;
    const route = targetFlight.route || targetFlight.flight_plan?.route || targetFlight.plan?.route || null;
    const alt = targetFlight.cruise_lvl || targetFlight.flight_plan?.cruising_altitude || targetFlight.flight_plan?.altitude || targetFlight.position?.altitude_ft || targetFlight.altitude_ft || 35000;
    const spd = targetFlight.position?.speed_tas_kts || targetFlight.groundspeed_kts || targetFlight.speed || 450;
    const hdg = targetFlight.position?.heading || targetFlight.heading_deg || targetFlight.heading || 0;
    const aircraft = targetFlight.aircraft || targetFlight.flight_plan?.aircraft || targetFlight.aircraft?.icao || 'Aircraft';

    // Update Live HUD immediately
    updateLiveHud({
        callsign: targetFlight.callsign || 'PILOT',
        identifier: targetFlight.callsign || 'PILOT',
        pilot_name: targetFlight.pilot_name || targetFlight.name || 'Pilot',
        network: targetFlight.network || 'Radar',
        latitude: lat,
        longitude: lon,
        altitude_ft: alt,
        groundspeed_kts: spd,
        heading_deg: hdg,
        flight_plan: {
            departure: dep,
            arrival: arr,
            route: route,
            aircraft: aircraft
        }
    });

    // Re-render markers to highlight active halo for fleet or update single marker
    if (Array.isArray(activeFleetFlights) && activeFleetFlights.length > 0) {
        renderFleetMarkersOnMap(activeFleetFlights, false);
    } else {
        updateAircraftMarker(targetFlight, false);
    }

    // If single-pilot route is cached in memory, render it immediately!
    if (latestSinglePilotData && latestSinglePilotData.route && (String(latestSinglePilotData.telemetry?.callsign) === String(targetFlight.callsign) || String(latestSinglePilotData.telemetry?.id) === String(targetFlight.id) || !activeFleetFlights.length)) {
        renderRouteOnMap(latestSinglePilotData.route, false);
        updateTelemetryCard(latestSinglePilotData.route);
        updateWaypointLog(latestSinglePilotData.route.waypoints);
        const mapBadge = document.getElementById('mapBadge');
        if (mapBadge) mapBadge.style.display = 'flex';
    } else if ((dep && arr) || route) {
        // Otherwise load/trace flight plan for fleet or new pilot
        loadFlightPlanRoute(dep, arr, route, alt, spd, targetFlight);
    } else {
        // Plane is on ground / ramp or has no flight plan: unload any previous route from map
        if (routeLayerGroup) routeLayerGroup.clearLayers();
        if (aircraftTrailLayer) {
            map.removeLayer(aircraftTrailLayer);
            aircraftTrailLayer = null;
        }
        aircraftTrailPoints = [];

        const telemCard = document.getElementById('telemetryCard');
        if (telemCard) telemCard.style.display = 'none';

        const wpCard = document.getElementById('waypointLogCard');
        if (wpCard) wpCard.style.display = 'none';

        const mapBadge = document.getElementById('mapBadge');
        if (mapBadge) mapBadge.style.display = 'none';

        activeVaFlightId = targetFlight.id || targetFlight.callsign;
    }

    // Only pan if explicitly requested (e.g. clicking from sidebar list, NOT clicking the marker itself)
    if (shouldPan && typeof lat === 'number' && typeof lon === 'number' && map) {
        let alignLon = lon;
        if (currentRouteData && Array.isArray(currentRouteData.route_coordinates) && currentRouteData.route_coordinates.length > 0) {
            let minDiff = Infinity;
            for (const pt of currentRouteData.route_coordinates) {
                for (const offset of [-360, 0, 360]) {
                    const testLon = lon + offset;
                    const diff = Math.abs(testLon - pt[0]);
                    if (diff < minDiff) {
                        minDiff = diff;
                        alignLon = testLon;
                    }
                }
            }
        }
        map.panTo([lat, alignLon]);
    }
};

window.focusPersonalPilot = function() {
    if (!currentFshubData || !currentFshubData.user || !currentFshubData.user.active_flight) return;
    const af = currentFshubData.user.active_flight;
    const lat = af.position?.lat || 0;
    const lon = af.position?.lng || 0;
    const hdg = af.position?.heading || 0;

    const telemetry = {
        network: 'FSHub',
        identifier: af.callsign,
        callsign: af.callsign,
        pilot_name: currentFshubData.user.name,
        latitude: lat,
        longitude: lon,
        altitude_ft: af.position?.altitude_ft || 0,
        groundspeed_kts: af.position?.speed_tas_kts || 0,
        heading_deg: hdg,
        flight_plan: {
            departure: af.departure,
            arrival: af.arrival,
            aircraft: af.aircraft,
            route: af.route
        }
    };

    updateAircraftMarker(telemetry, true);

    if (af.departure && af.arrival) {
        loadFlightPlanRoute(af.departure, af.arrival, af.route, af.cruise_lvl, af.position?.speed_tas_kts, telemetry);
    }
};

window.focusPersonalGps = function(lat, lng, name) {
    if (map) {
        map.setView([lat, lng], 12);
        L.popup()
            .setLatLng([lat, lng])
            .setContent(`<strong>📍 ${name} (FSHub GPS)</strong><br>Standby / Ramp Position`)
            .openOn(map);
    }
};

function renderFleetMarkersOnMap(fleetFlights, autoFit = false) {
    if (!map || !fleetMarkersLayerGroup) return;

    if (!fleetFlights || !Array.isArray(fleetFlights) || fleetFlights.length === 0) {
        fleetMarkersLayerGroup.clearLayers();
        fleetAircraftBuffers.clear();
        return;
    }

    activeFleetFlights = fleetFlights;
    const currentFlightIds = new Set();
    const boundsPoints = [];

    fleetFlights.forEach(f => {
        const id = String(f.id || f.callsign || f.pilot_id);
        currentFlightIds.add(id);

        const lat = f.latitude !== undefined ? f.latitude : f.position?.lat;
        const lon = f.longitude !== undefined ? f.longitude : f.position?.lng;
        const hdg = f.heading_deg !== undefined ? f.heading_deg : (f.position?.heading || 0);
        const callsign = f.callsign || f.plan?.callsign || 'VA-PILOT';
        const aircraft = f.aircraft || f.flight_plan?.aircraft || f.aircraft?.icao || '';
        const routeStr = f.route || f.flight_plan?.route || f.plan?.route || '';
        const isVat = f.vatsim && f.vatsim.is_online;
        const isSelected = activeVaFlightId === (f.id || f.callsign);

        if (typeof lat !== 'number' || typeof lon !== 'number' || (lat === 0 && lon === 0)) return;

        boundsPoints.push([lat, lon]);

        const info = classifyAircraftType(aircraft, routeStr);
        const iconColor = isSelected ? '#38bdf8' : (isVat ? '#00ff88' : '#c084fc');
        const haloColor = isSelected ? '#38bdf8' : (isVat ? '#00ff88' : '#a855f7');

        let buf = fleetAircraftBuffers.get(id);
        if (buf) {
            buf.pushTelemetry(f);

            // Update Icon HTML if selection or VATSIM status changed
            const planeHtml = getAircraftMarkerHtml(aircraft, buf.renderHeading || hdg, iconColor, isSelected, haloColor, routeStr);
            const customIcon = L.divIcon({
                html: planeHtml,
                className: 'aircraft-div-icon',
                iconSize: [info.size, info.size],
                iconAnchor: [Math.round(info.size / 2), Math.round(info.size / 2)]
            });
            buf.marker.setIcon(customIcon);
            buf.marker.setZIndexOffset(isSelected ? 950 : 850);
        } else {
            // Instantiate new marker & buffer
            buf = new AircraftTelemetryBuffer();
            buf.pushTelemetry(f);

            const planeHtml = getAircraftMarkerHtml(aircraft, hdg, iconColor, isSelected, haloColor, routeStr);
            const customIcon = L.divIcon({
                html: planeHtml,
                className: 'aircraft-div-icon',
                iconSize: [info.size, info.size],
                iconAnchor: [Math.round(info.size / 2), Math.round(info.size / 2)]
            });

            const visibleLon = getVisibleLongitude(lon, map);
            const marker = L.marker([lat, visibleLon], { icon: customIcon, zIndexOffset: isSelected ? 950 : 850 });

            marker.bindTooltip(`<strong>${callsign}</strong> • Click for info`, {
                permanent: false,
                direction: 'top',
                className: 'plane-leaflet-tooltip'
            });

            const markerEl = marker.getElement();
            if (markerEl) {
                L.DomEvent.disableClickPropagation(markerEl);
                markerEl.onclick = (e) => {
                    if (e) {
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                    }
                    lastMarkerClickTime = Date.now();
                    routeVisible = true;
                    selectVaFlight(f, false);
                };
            }

            marker.on('click', (e) => {
                lastMarkerClickTime = Date.now();
                if (e && e.originalEvent) {
                    e.originalEvent._stopped = true;
                    L.DomEvent.stopPropagation(e);
                }
                routeVisible = true;
                selectVaFlight(f, false);
            });

            fleetMarkersLayerGroup.addLayer(marker);
            buf.marker = marker;
            fleetAircraftBuffers.set(id, buf);
        }
    });

    // Remove fleet aircraft no longer present
    for (const [id, buf] of fleetAircraftBuffers.entries()) {
        if (!currentFlightIds.has(id)) {
            if (buf.marker) fleetMarkersLayerGroup.removeLayer(buf.marker);
            fleetAircraftBuffers.delete(id);
        }
    }

    // Start 60fps playhead motion engine
    startPlaneMotionLoop();

    if (autoFit && boundsPoints.length > 1) {
        map.fitBounds(L.latLngBounds(boundsPoints), { padding: [60, 60], maxZoom: 7 });
    }
}



