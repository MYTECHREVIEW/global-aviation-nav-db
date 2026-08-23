
let map;
let routeLayerGroup;

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupTabs();
    setupEventListeners();
    setupSimbrief();

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
