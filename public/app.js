
let map;
let routeLayerGroup;

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupTabs();
    setupEventListeners();
    setupSimbrief();
    setupApiKeyAndGitTab();
    checkEnvironmentMode();

    const badge = document.getElementById('mapBadge');
    if (badge) badge.style.display = 'none';
});

function initMap() {
    map = L.map('map', {
        zoomControl: true,
        attributionControl: false
    }).setView([38.5, -96.0], 4);

    // Dark Basemap
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd'
    }).addTo(map);

    routeLayerGroup = L.layerGroup().addTo(map);
}

function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const target = btn.getAttribute('data-tab');
            const targetEl = document.getElementById(target);
            if (targetEl) targetEl.classList.add('active');
        });
    });
}

function setupEventListeners() {
    document.getElementById('traceBtn').addEventListener('click', traceRoute);

    const searchBtn = document.getElementById('searchSubmitBtn');
    if (searchBtn) searchBtn.addEventListener('click', executeSearch);

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeSearch();
        });
    }

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
}

async function checkEnvironmentMode() {
    try {
        const res = await fetch('/api/v1/config/env');
        const data = await res.json();

        // In Production Docker Container: hide dev-only tabs
        if (!data.is_dev) {
            document.querySelectorAll('.dev-only-tab').forEach(el => el.remove());
            document.querySelectorAll('.dev-only-content').forEach(el => el.remove());
        }
    } catch (e) {
        console.warn('Could not check environment mode:', e);
    }
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

function renderRouteOnMap(data) {
    routeLayerGroup.clearLayers();

    if (!data.route_coordinates || data.route_coordinates.length === 0) return;

    const latLngs = data.route_coordinates.map(c => [c[1], c[0]]);

    L.polyline(latLngs, {
        color: '#00ff88',
        weight: 6,
        opacity: 0.25,
        lineCap: 'round'
    }).addTo(routeLayerGroup);

    const flightPath = L.polyline(latLngs, {
        color: '#00ff88',
        weight: 3,
        opacity: 0.9,
        dashArray: '8, 4',
        lineCap: 'round'
    }).addTo(routeLayerGroup);

    data.waypoints.forEach((wp, idx) => {
        const isVor = wp.type.includes('VOR') || wp.type.includes('TACAN');
        const isApt = wp.type === 'AIRPORT';

        let markerColor = '#ff1e42';
        let radius = 4;

        if (isApt) {
            markerColor = '#38bdf8';
            radius = 6;
        } else if (isVor) {
            markerColor = '#00ff88';
            radius = 5;
        }

        const marker = L.circleMarker([wp.latitude, wp.longitude], {
            radius: radius,
            fillColor: markerColor,
            color: '#fff',
            weight: 1.5,
            opacity: 1,
            fillOpacity: 0.9
        }).addTo(routeLayerGroup);

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

    map.fitBounds(flightPath.getBounds(), { padding: [50, 50] });
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

function setupApiKeyAndGitTab() {
    const gitPushBtn = document.getElementById('gitPushBtn');
    if (gitPushBtn) gitPushBtn.addEventListener('click', pushToGithub);

    const gitRefreshBtn = document.getElementById('gitRefreshBtn');
    if (gitRefreshBtn) gitRefreshBtn.addEventListener('click', checkGitStatus);

    const genKeyBtn = document.getElementById('generateKeyBtn');
    if (genKeyBtn) genKeyBtn.addEventListener('click', generateApiKey);

    const copyKeyBtn = document.getElementById('copyKeyBtn');
    if (copyKeyBtn) {
        copyKeyBtn.addEventListener('click', () => {
            const keyVal = document.getElementById('createdKeyVal').textContent;
            navigator.clipboard.writeText(keyVal).then(() => {
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
