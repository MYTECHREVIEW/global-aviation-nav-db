
let map;
let routeLayerGroup;

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupTabs();
    setupEventListeners();

    const copyComposeBtn = document.getElementById('copyComposeBtn');
    if (copyComposeBtn) {
        copyComposeBtn.addEventListener('click', () => {
            const yamlCode = document.getElementById('composeYamlCode').textContent;
            navigator.clipboard.writeText(yamlCode).then(() => {
                copyComposeBtn.textContent = '✅ Copied YAML!';
                setTimeout(() => { copyComposeBtn.textContent = '📋 Copy YAML'; }, 2000);
            });
        });
    }

    setupSimbrief();
    setupApiKeyAndGitTab();

    // Start with clean map
    document.getElementById('mapBadge').style.display = 'none';
});

function initMap() {
    map = L.map('map', {
        zoomControl: true,
        attributionControl: false
    }).setView([38.5, -96.0], 4);

    // Dark Satellite Basemap
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(map);

    routeLayerGroup = L.layerGroup().addTo(map);
}

function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');
        });
    });
}

function setupEventListeners() {
    document.getElementById('traceBtn').addEventListener('click', traceRoute);
    document.getElementById('searchSubmitBtn').addEventListener('click', performSearch);
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });
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

    const traceBtn = document.getElementById('traceBtn');
    traceBtn.innerHTML = '<span>⏳ Computing Great-Circle Route...</span>';
    traceBtn.disabled = true;

    try {
        const response = await fetch('/api/v1/route/trace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                departure: dep,
                arrival: arr,
                route: route,
                altitude_ft: alt,
                speed_kts: speed
            })
        });

        const data = await response.json();
        traceBtn.innerHTML = '<span>⚡ Trace Flight Path</span>';
        traceBtn.disabled = false;

        if (data.error) {
            alert('Route Error: ' + data.error);
            return;
        }

        renderRouteOnMap(data);
        document.getElementById('mapBadge').style.display = 'flex';
        renderTelemetry(data);
    } catch (err) {
        console.error('Error tracing route:', err);
        traceBtn.innerHTML = '<span>⚡ Trace Flight Path</span>';
        traceBtn.disabled = false;
        alert('Network error while resolving route.');
    }
}

function renderRouteOnMap(data) {
    routeLayerGroup.clearLayers();

    if (!data.route_coordinates || data.route_coordinates.length < 2) return;

    // Convert GeoJSON [lon, lat] to Leaflet [lat, lon]
    const latLngs = data.route_coordinates.map(c => [c[1], c[0]]);

    // Outer Glow Polyline
    const glowLine = L.polyline(latLngs, {
        color: '#00ff88',
        weight: 6,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(routeLayerGroup);

    // Inner Core Polyline
    const coreLine = L.polyline(latLngs, {
        color: '#00ff88',
        weight: 2.5,
        opacity: 0.95,
        dashArray: '8, 6'
    }).addTo(routeLayerGroup);

    // Add Waypoint Markers
    data.waypoints.forEach(w => {
        let markerClass = 'wp-marker';
        let markerSize = [10, 10];

        if (w.type === 'AIRPORT') {
            markerClass = 'apt-marker';
            markerSize = [14, 14];
        } else if (w.type.includes('VOR')) {
            markerClass = 'vor-marker';
            markerSize = [12, 12];
        }

        const icon = L.divIcon({
            className: markerClass,
            iconSize: markerSize,
            iconAnchor: [markerSize[0] / 2, markerSize[1] / 2]
        });

        const popupContent = `
            <div style="font-family: 'Outfit', sans-serif; min-width: 180px; color: #0f172a;">
                <div style="font-weight: 700; font-size: 14px; color: #0284c7; margin-bottom: 2px;">
                    ${w.ident} - ${w.name}
                </div>
                <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; margin-bottom: 6px;">
                    ${w.type} ${w.frequency_mhz ? `• ${w.frequency_mhz} MHz` : ''}
                </div>
                <div style="font-size: 12px; line-height: 1.5;">
                    <strong>Leg:</strong> ${w.segment_distance_nm} NM @ ${w.segment_bearing_deg}°<br/>
                    <strong>Total:</strong> ${w.cumulative_distance_nm} NM (ETE ${w.ete_minutes}m)<br/>
                    <strong>GPS:</strong> ${w.latitude.toFixed(4)}, ${w.longitude.toFixed(4)}
                </div>
            </div>
        `;

        L.marker([w.latitude, w.longitude], { icon })
            .bindPopup(popupContent)
            .bindTooltip(w.ident, { permanent: true, direction: 'top', className: 'wp-tooltip', offset: [0, -8] })
            .addTo(routeLayerGroup);
    });

    // Fit map bounds to route with smooth padding
    map.fitBounds(coreLine.getBounds(), { padding: [60, 60], maxZoom: 10 });
}

function renderTelemetry(data) {
    document.getElementById('telemetryCard').style.display = 'block';
    document.getElementById('waypointLogCard').style.display = 'block';

    document.getElementById('telemDist').textContent = `${data.total_distance_nm} NM`;
    document.getElementById('telemEte').textContent = data.estimated_time_enroute_formatted;
    document.getElementById('telemCount').textContent = data.total_waypoints;
    document.getElementById('telemKm').textContent = `${data.total_distance_km} km`;

    const tbody = document.getElementById('waypointTableBody');
    tbody.innerHTML = '';

    data.waypoints.forEach(w => {
        const tr = document.createElement('tr');
        let badgeType = 'fix';
        if (w.type === 'AIRPORT') badgeType = 'airport';
        else if (w.type.includes('VOR')) badgeType = 'vor';

        tr.innerHTML = `
            <td>${w.sequence}</td>
            <td><strong>${w.ident}</strong></td>
            <td><span class="type-badge ${badgeType}">${w.type}</span></td>
            <td>${w.segment_distance_nm}</td>
            <td>${w.segment_bearing_deg}°</td>
            <td>${w.cumulative_distance_nm}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function performSearch() {
    const q = document.getElementById('searchInput').value.trim();
    if (!q) return;

    const resultsContainer = document.getElementById('searchResults');
    resultsContainer.innerHTML = '<div style="color: #94a3b8; font-size: 0.8rem; padding: 8px;">Searching navigation database...</div>';

    try {
        const res = await fetch(`/api/v1/waypoints/search?q=${encodeURIComponent(q)}&limit=25`);
        const data = await res.json();

        if (!data.results || data.results.length === 0) {
            resultsContainer.innerHTML = '<div style="color: #94a3b8; font-size: 0.8rem; padding: 8px;">No matching waypoints or NavAids found.</div>';
            return;
        }

        resultsContainer.innerHTML = '';
        data.results.forEach(pt => {
            const item = document.createElement('div');
            item.className = 'search-item';
            item.innerHTML = `
                <div class="search-item-header">
                    <span class="search-item-ident">${pt.ident}</span>
                    <span class="type-badge ${pt.type === 'AIRPORT' ? 'airport' : (pt.type.includes('VOR') ? 'vor' : 'fix')}">${pt.type}</span>
                </div>
                <div style="font-size: 0.8rem; font-weight: 500; margin-bottom: 2px;">${pt.name}</div>
                <div class="search-item-coords">${pt.latitude.toFixed(4)}, ${pt.longitude.toFixed(4)} ${pt.frequency_mhz ? `• ${pt.frequency_mhz} MHz` : ''}</div>
            `;

            item.addEventListener('click', () => {
                map.flyTo([pt.latitude, pt.longitude], 12, { duration: 1.5 });
            });

            resultsContainer.appendChild(item);
        });
    } catch (err) {
        resultsContainer.innerHTML = '<div style="color: #ef4444; font-size: 0.8rem; padding: 8px;">Error querying search API.</div>';
    }
}


function setupSimbrief() {
    const savedUser = localStorage.getItem('simbrief_username');
    if (savedUser) {
        document.getElementById('simbriefUser').value = savedUser;
    }

    document.getElementById('simbriefFetchBtn').addEventListener('click', fetchSimbrief);
    document.getElementById('simbriefUser').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') fetchSimbrief();
    });
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

        // Fill form fields
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

        // Automatically trigger route trace
        traceRoute();
    } catch (err) {
        fetchBtn.innerHTML = '<span>📥 Fetch OFP</span>';
        fetchBtn.disabled = false;
        statusBox.style.display = 'block';
        statusBox.className = 'simbrief-status error';
        statusBox.textContent = 'Network error fetching SimBrief OFP.';
    }
}


function setupApiKeyAndGitTab() {
    // Check git status
    checkGitStatus();

    // Push to GitHub button
    document.getElementById('gitPushBtn').addEventListener('click', pushToGithub);
    document.getElementById('gitRefreshBtn').addEventListener('click', checkGitStatus);

    // Generate API Key button
    document.getElementById('generateKeyBtn').addEventListener('click', generateApiKey);

    // Copy key button
    document.getElementById('copyKeyBtn').addEventListener('click', () => {
        const keyVal = document.getElementById('createdKeyVal').textContent;
        navigator.clipboard.writeText(keyVal).then(() => {
            const btn = document.getElementById('copyKeyBtn');
            btn.textContent = '✅ Copied!';
            setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
        });
    });

    // Refresh Keys button
    document.getElementById('refreshKeysBtn').addEventListener('click', loadApiKeys);

    // Load initial keys
    loadApiKeys();
}

async function checkGitStatus() {
    try {
        const res = await fetch('/api/v1/git/status');
        const data = await res.json();
        const dot = document.getElementById('gitStatusDot');
        const text = document.getElementById('gitStatusText');
        const countSpan = document.getElementById('gitFilesCount');
        const listDiv = document.getElementById('gitFilesList');

        if (data.success) {
            countSpan.textContent = data.changed_files_count || 0;

            if (data.has_uncommitted_changes && data.files && data.files.length > 0) {
                dot.className = 'status-indicator-dot pending';
                text.textContent = `${data.changed_files_count} file(s) modified locally (uncommitted)`;

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
            } else {
                dot.className = 'status-indicator-dot';
                text.textContent = `In Sync: ${data.latest_commit}`;
                listDiv.innerHTML = '<div class="git-file-empty">✅ Clean: All files committed & synced to GitHub main</div>';
            }
        }
    } catch (e) {
        console.error('Error checking git status:', e);
    }
}

async function pushToGithub() {
    const btn = document.getElementById('gitPushBtn');
    const resultBox = document.getElementById('gitPushResult');
    const msgInput = document.getElementById('gitCommitMsg');
    const msg = msgInput.value.trim();

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
            msgInput.value = '';
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
                <td><strong>${k.name || 'Unnamed Client'}</strong></td>
                <td><code>${k.masked_key}</code></td>
                <td>${k.request_count || 0}</td>
                <td><span style="color: ${k.status === 'active' ? '#00ff88' : '#ef4444'}; font-weight: 600;">${k.status.toUpperCase()}</span></td>
                <td>
                    ${k.status === 'active' ? `<button class="btn-revoke" onclick="revokeKey('${k.id}')">Revoke</button>` : '<span style="color:#64748b;">Revoked</span>'}
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
    const name = nameInput.value.trim() || 'API Client';
    const expiresInDays = expiresSelect.value ? parseInt(expiresSelect.value, 10) : null;

    const btn = document.getElementById('generateKeyBtn');
    btn.innerHTML = '<span>⏳ Generating...</span>';
    btn.disabled = true;

    try {
        const res = await fetch('/api/v1/auth/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, expires_in_days: expiresInDays })
        });
        const data = await res.json();

        btn.innerHTML = '<span>⚡ Generate API Key</span>';
        btn.disabled = false;

        if (data.success && data.api_key) {
            document.getElementById('createdKeyVal').textContent = data.api_key.key;
            document.getElementById('createdKeyBox').style.display = 'block';
            nameInput.value = '';
            loadApiKeys();
        }
    } catch (err) {
        btn.innerHTML = '<span>⚡ Generate API Key</span>';
        btn.disabled = false;
        alert('Failed to generate API Key: ' + err.message);
    }
}

async function revokeKey(id) {
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
}
