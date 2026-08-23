
let map;
let routeLayerGroup;

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupTabs();
    setupEventListeners();
    setupSimbrief();
    setupLiveTracking();

    // Check if we are in Local Dev mode; only inject dev tools if confirmed
    initDevEnvironmentIfLocal();

    const badge = document.getElementById('mapBadge');
    if (badge) badge.style.display = 'none';
});

function initMap() {
    map = L.map('map', {
        zoomControl: true,
        attributionControl: false
    }).setView([38.5, -96.0], 4);

    // Dark Carto Basemap
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(map);

    routeLayerGroup = L.layerGroup().addTo(map);
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
                <p class="help-text">Pass API Key via <code>X-API-Key</code> header or <code>?api_key=</code> parameter.</p>
            </div>

            <div class="control-card">
                <h3>📡 REST API Endpoints</h3>
                <div class="api-doc-item">
                    <div class="api-doc-header"><span class="method post">POST</span> <code>/api/v1/route/trace</code></div>
                    <p class="api-doc-desc">Traces flight plan with SIDs, Airways, and STARs into waypoints and GeoJSON.</p>
                </div>
                <div class="api-doc-item">
                    <div class="api-doc-header"><span class="method post">POST</span> <code>/api/v1/simbrief/trace</code></div>
                    <p class="api-doc-desc">Auto-import and trace SimBrief OFP in 1 step.</p>
                </div>
                <div class="api-doc-item">
                    <div class="api-doc-header"><span class="method get">GET</span> <code>/api/v1/waypoints/search?q=MATLK</code></div>
                    <p class="api-doc-desc">Search airports and navigation fixes.</p>
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

let currentRouteData = null;
let showWaypointLabels = localStorage.getItem('show_wp_labels') !== 'false';

function renderRouteOnMap(data, autoFit = true) {
    currentRouteData = data;
    routeLayerGroup.clearLayers();

    if (!data.route_coordinates || data.route_coordinates.length === 0) return;

    const latLngs = data.route_coordinates.map(c => [c[1], c[0]]);

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

    // Markers for waypoints
    data.waypoints.forEach((wp, idx) => {
        const isVor = wp.type.includes('VOR') || wp.type.includes('TACAN') || wp.type.includes('NDB');
        const isApt = wp.type === 'AIRPORT';
        const isFix = wp.type === 'TERMINAL_WAYPOINT' || wp.type === 'INTERSECTION' || wp.type === 'FIX';

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

        const marker = L.circleMarker([wp.latitude, wp.longitude], {
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

function setupLiveTracking() {
    // Network buttons
    const netBtns = document.querySelectorAll('.network-btn');
    const netLabel = document.getElementById('netIdLabel');
    const inputEl = document.getElementById('liveIdentifier');

    netBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            netBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeLiveNetwork = btn.getAttribute('data-net');

            if (activeLiveNetwork === 'VATSIM') {
                if (netLabel) netLabel.textContent = 'VATSIM Callsign or CID';
                if (inputEl) inputEl.placeholder = 'e.g. UAL2 or CID...';
            } else if (activeLiveNetwork === 'IVAO') {
                if (netLabel) netLabel.textContent = 'IVAO Callsign or VID';
                if (inputEl) inputEl.placeholder = 'e.g. AFR456 or VID...';
            } else if (activeLiveNetwork === 'FSHUB') {
                if (netLabel) netLabel.textContent = 'FSHub User ID or Token';
                if (inputEl) inputEl.placeholder = 'e.g. User ID / Token...';
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
    }, 15000);
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

    if (manualClick && btn) {
        btn.innerHTML = '<span>⏳ Acquiring Radar Lock...</span>';
        btn.disabled = true;
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

        // Render route if returned
        if (data.route) {
            renderRouteOnMap(data.route, manualClick);
            updateTelemetryCard(data.route);
            updateWaypointLog(data.route.waypoints);
        }

        // Update Live HUD
        updateLiveHud(data.telemetry);

        // Update Moving Aircraft Marker
        updateAircraftMarker(data.telemetry, manualClick);

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

function updateLiveHud(t) {
    const hud = document.getElementById('liveHudCard');
    if (!hud) return;

    hud.style.display = 'block';
    document.getElementById('hudCallsign').textContent = t.callsign;
    document.getElementById('hudAircraft').textContent = t.flight_plan?.aircraft 
        ? `${t.flight_plan.aircraft} • ${t.flight_plan.departure || 'DEP'} ➔ ${t.flight_plan.arrival || 'ARR'}` 
        : t.network;
    
    document.getElementById('hudPhase').textContent = (t.flight_phase || 'ENROUTE').replace('_', ' ');
    document.getElementById('hudAlt').textContent = `${(t.altitude_ft || 0).toLocaleString()} ft`;
    document.getElementById('hudGs').textContent = `${t.groundspeed_kts || 0} kts`;
    document.getElementById('hudHdg').textContent = `${String(t.heading_deg || 0).padStart(3, '0')}°`;

    const xtdVal = t.cross_track_deviation_nm || 0;
    const xtdText = Math.abs(xtdVal) < 0.1 ? 'ON TRACK' : `${Math.abs(xtdVal)} NM ${xtdVal < 0 ? 'L' : 'R'}`;
    document.getElementById('hudXtd').textContent = xtdText;

    document.getElementById('hudRemDist').textContent = `${t.distance_remaining_nm || 0} NM`;
    document.getElementById('hudEte').textContent = t.estimated_time_remaining_formatted || '--';

    const prog = t.progress_percent || 0;
    document.getElementById('hudProgressText').textContent = `${prog}%`;
    document.getElementById('hudProgressFill').style.width = `${prog}%`;

    const nextWpEl = document.getElementById('hudNextWp');
    if (t.next_waypoint) {
        nextWpEl.textContent = `${t.next_waypoint.ident} (${t.next_waypoint.distance_to_go_nm} NM @ ${t.next_waypoint.bearing_deg}°)`;
    } else {
        nextWpEl.textContent = 'Destination Final';
    }
}

function updateAircraftMarker(telemetry, panToPlane = false) {
    const lat = telemetry.latitude;
    const lon = telemetry.longitude;
    const hdg = telemetry.heading_deg || 0;

    if (!aircraftTrailLayer) {
        aircraftTrailLayer = L.polyline([], {
            color: '#c084fc',
            weight: 3,
            opacity: 0.8,
            dashArray: '4, 4'
        }).addTo(map);
    }

    aircraftTrailPoints.push([lat, lon]);
    if (aircraftTrailPoints.length > 50) aircraftTrailPoints.shift();
    aircraftTrailLayer.setLatLngs(aircraftTrailPoints);

    // SVG Airplane Icon
    const planeSvg = `
        <div class="aircraft-marker-container">
            <div class="aircraft-halo"></div>
            <svg class="aircraft-icon-svg" style="transform: rotate(${hdg}deg);" viewBox="0 0 24 24" fill="#00ff88">
                <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
            </svg>
        </div>
    `;

    const customIcon = L.divIcon({
        html: planeSvg,
        className: 'aircraft-div-icon',
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });

    if (!aircraftMarker) {
        aircraftMarker = L.marker([lat, lon], { icon: customIcon, zIndexOffset: 1000 }).addTo(map);
    } else {
        aircraftMarker.setLatLng([lat, lon]);
        aircraftMarker.setIcon(customIcon);
    }

    const popupHtml = `
        <div style="font-family: 'Inter', sans-serif; font-size: 12px; color: #fff; min-width: 160px;">
            <div style="font-weight: 800; font-size: 15px; color: #00ff88; margin-bottom: 4px;">
                ✈️ ${telemetry.callsign}
            </div>
            <div style="color: #c084fc; font-weight: 600; font-size: 11px; margin-bottom: 6px;">${telemetry.network} Live Target</div>
            <div>📍 <strong>Altitude:</strong> ${(telemetry.altitude_ft || 0).toLocaleString()} ft</div>
            <div>⚡ <strong>Groundspeed:</strong> ${telemetry.groundspeed_kts || 0} kts</div>
            <div>🧭 <strong>Heading:</strong> ${hdg}°</div>
            ${telemetry.flight_plan?.departure ? `<div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.1); color: #38bdf8;">${telemetry.flight_plan.departure} ➔ ${telemetry.flight_plan.arrival}</div>` : ''}
        </div>
    `;
    aircraftMarker.bindPopup(popupHtml);

    if (panToPlane) {
        map.panTo([lat, lon]);
    }
}
