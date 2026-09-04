/**
 * oceanic-tracks-service.js
 * 
 * Manages Oceanic Tracks (North Atlantic Tracks - NAT, and Pacific Oceanic Tracks - PACOTS)
 * Provides:
 * - Parsing and expansion of oceanic shorthand coordinates (e.g. 55/20, 5630/40, 50N040W)
 * - Live synchronization from official NAT feeds (natTrak / FAA)
 * - Local caching & persistent storage in data/oceanic-tracks.json
 * - Expansion of track identifiers (e.g. "NAT A", "NATA") into sequential waypoints
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

class OceanicTracksService {
    constructor(options = {}) {
        this.dataDir = options.dataDir || path.join(__dirname, '../../data');
        this.tracksDbPath = path.join(this.dataDir, 'oceanic-tracks.json');
        this.cacheTtlMs = options.cacheTtlMs || (30 * 60 * 1000); // 30 minutes
        this.lastFetchTime = 0;
        this.tracks = new Map(); // identifier -> track object
        this.customWaypointsDbPath = path.join(this.dataDir, 'custom-global-waypoints.json');
        this.customWaypoints = {};

        this.loadLocalSnapshot();
    }

    /**
     * Parse oceanic coordinate shorthand string into { latitude, longitude, ident }
     * Supports formats:
     * - 55/20 -> 55°N 020°W (lat: 55.0, lon: -20.0)
     * - 5630/40 -> 56°30'N 040°00'W (lat: 56.5, lon: -40.0)
     * - 5330/20 -> 53°30'N 020°00'W (lat: 53.5, lon: -20.0)
     * - 50N040W -> lat: 50.0, lon: -40.0
     * - 5040N -> lat: 50.0, lon: -40.0
     */
    parseOceanicCoordinate(token) {
        if (!token) return null;
        const clean = String(token).trim().toUpperCase();

        // Format 1: Slash notation (e.g. 55/20 or 5630/40 or 42/60)
        // Standard NAT convention: North Atlantic coordinates are North and West.
        const slashMatch = clean.match(/^(\d{2,4})\/(\d{2,3})$/);
        if (slashMatch) {
            const rawLat = slashMatch[1];
            const rawLon = slashMatch[2];

            let lat = 0;
            if (rawLat.length === 2) {
                lat = parseInt(rawLat, 10);
            } else if (rawLat.length === 4) {
                // e.g. 5630 -> 56 deg 30 min
                const deg = parseInt(rawLat.substring(0, 2), 10);
                const min = parseInt(rawLat.substring(2, 4), 10);
                lat = deg + (min / 60);
            }

            const lon = -Math.abs(parseInt(rawLon, 10)); // West longitude in North Atlantic

            const latStr = lat % 1 === 0 ? `${Math.round(lat)}N` : `${Math.floor(lat)}${Math.round((lat % 1) * 60).toString().padStart(2, '0')}N`;
            const lonStr = `${Math.abs(Math.round(lon)).toString().padStart(3, '0')}W`;
            const ident = `${latStr}${lonStr}`;

            return {
                ident: ident,
                name: `${lat.toFixed(2)}°N ${Math.abs(lon).toFixed(2)}°W`,
                type: 'WAYPOINT',
                latitude: Math.round(lat * 1000000) / 1000000,
                longitude: Math.round(lon * 1000000) / 1000000,
                is_oceanic_coord: true
            };
        }

        // Format 2: ICAO Oceanic Coordinate Format (e.g. 55N020W, 5330N02000W)
        const icaoMatch = clean.match(/^(\d{2,4})([NS])(\d{2,5})([EW])$/);
        if (icaoMatch) {
            const rawLat = icaoMatch[1];
            const ns = icaoMatch[2];
            const rawLon = icaoMatch[3];
            const ew = icaoMatch[4];

            let lat = 0;
            if (rawLat.length === 2) {
                lat = parseInt(rawLat, 10);
            } else {
                const deg = parseInt(rawLat.substring(0, 2), 10);
                const min = parseInt(rawLat.substring(2), 10);
                lat = deg + (min / 60);
            }
            if (ns === 'S') lat = -lat;

            let lon = 0;
            if (rawLon.length <= 3) {
                lon = parseInt(rawLon, 10);
            } else {
                const deg = parseInt(rawLon.substring(0, 3), 10);
                const min = parseInt(rawLon.substring(3), 10);
                lon = deg + (min / 60);
            }
            if (ew === 'W') lon = -lon;

            return {
                ident: clean,
                name: `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`,
                type: 'WAYPOINT',
                latitude: Math.round(lat * 1000000) / 1000000,
                longitude: Math.round(lon * 1000000) / 1000000,
                is_oceanic_coord: true
            };
        }

        return null;
    }

    /**
     * Load persistent tracks snapshot from data/oceanic-tracks.json
     */
    loadLocalSnapshot() {
        try {
            if (fs.existsSync(this.customWaypointsDbPath)) {
                this.customWaypoints = JSON.parse(fs.readFileSync(this.customWaypointsDbPath, 'utf8'));
            }
        } catch (_) {}

        try {
            if (fs.existsSync(this.tracksDbPath)) {
                const raw = JSON.parse(fs.readFileSync(this.tracksDbPath, 'utf8'));
                if (Array.isArray(raw)) {
                    this.tracks.clear();
                    for (const track of raw) {
                        this.tracks.set(String(track.identifier).toUpperCase(), track);
                    }
                    console.log(`[OceanicTracks] Loaded ${this.tracks.size} tracks from oceanic-tracks.json`);
                }
            }
        } catch (e) {
            console.warn('[OceanicTracks] Failed to load local oceanic-tracks.json snapshot:', e.message);
        }
    }

    /**
     * Save current tracks to data/oceanic-tracks.json
     */
    saveLocalSnapshot() {
        try {
            const list = Array.from(this.tracks.values());
            fs.writeFileSync(this.tracksDbPath, JSON.stringify(list, null, 2), 'utf8');
            console.log(`[OceanicTracks] Saved ${list.length} tracks to ${this.tracksDbPath}`);
        } catch (e) {
            console.error('[OceanicTracks] Failed to save oceanic-tracks.json:', e.message);
        }
    }

    /**
     * Resolve a named waypoint or oceanic coordinate
     */
    resolveFix(token, resolveFallbackPointFn = null) {
        if (!token) return null;
        const clean = String(token).trim().toUpperCase();

        // 1. Try oceanic coordinate parsing
        const coord = this.parseOceanicCoordinate(clean);
        if (coord) return coord;

        // 2. Try custom waypoints
        if (this.customWaypoints[clean]) {
            const cw = this.customWaypoints[clean];
            return {
                ident: cw.ident,
                name: cw.name || cw.ident,
                type: cw.type || 'WAYPOINT',
                latitude: cw.latitude,
                longitude: cw.longitude,
                country_code: cw.country_code || null
            };
        }

        // 3. Try external resolver fallback
        if (typeof resolveFallbackPointFn === 'function') {
            const resolved = resolveFallbackPointFn(clean);
            if (resolved) {
                return {
                    ident: resolved.ident,
                    name: resolved.name || resolved.ident,
                    type: resolved.type || 'WAYPOINT',
                    latitude: resolved.latitude,
                    longitude: resolved.longitude,
                    country_code: resolved.country_code || null
                };
            }
        }

        return {
            ident: clean,
            name: clean,
            type: 'WAYPOINT',
            latitude: null,
            longitude: null
        };
    }

    /**
     * Expand a raw route string (e.g. "DOGAL 55/20 58/30 59/40 58/50 DORYY") into structured waypoints
     */
    expandRouteString(routeString, resolveFallbackPointFn = null) {
        if (!routeString) return [];
        const tokens = String(routeString).trim().split(/\s+/).filter(Boolean);
        const waypoints = [];

        tokens.forEach((tok, idx) => {
            const fix = this.resolveFix(tok, resolveFallbackPointFn);
            waypoints.push({
                sequence: (idx + 1) * 10,
                ident: fix.ident,
                name: fix.name,
                type: fix.type,
                latitude: fix.latitude,
                longitude: fix.longitude,
                country_code: fix.country_code || null
            });
        });

        return waypoints;
    }

    /**
     * Synchronize / fetch live tracks from official natTrak API
     */
    async fetchLiveNatTracks(resolveFallbackPointFn = null) {
        return new Promise((resolve) => {
            const url = 'https://nattrak.vatsim.net/api/tracks';
            https.get(url, { headers: { 'User-Agent': 'GlobalAviationNavDB/1.0' }, timeout: 8000 }, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    console.warn(`[OceanicTracks] natTrak returned HTTP ${res.statusCode}`);
                    return resolve(false);
                }

                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (!Array.isArray(parsed) || parsed.length === 0) {
                            return resolve(false);
                        }

                        this.tracks.clear();
                        for (const raw of parsed) {
                            const ident = String(raw.identifier || '').toUpperCase();
                            if (!ident) continue;

                            const routeStr = raw.last_routeing || raw.route || '';
                            const waypoints = this.expandRouteString(routeStr, resolveFallbackPointFn);

                            const trackObj = {
                                identifier: ident,
                                system: 'NAT',
                                name: `NAT Track ${ident}`,
                                active: raw.active !== false,
                                direction: (raw.direction || (['A','B','C','D','E','F','G','H','I','J'].includes(ident) ? 'west' : 'east')).toUpperCase(),
                                flight_levels: raw.flight_levels || [],
                                valid_from: raw.valid_from || null,
                                valid_to: raw.valid_to || null,
                                last_active: raw.last_active || null,
                                route_string: routeStr,
                                entry_fix: waypoints.length > 0 ? waypoints[0].ident : null,
                                exit_fix: waypoints.length > 0 ? waypoints[waypoints.length - 1].ident : null,
                                waypoints: waypoints,
                                updated_at: new Date().toISOString()
                            };

                            this.tracks.set(ident, trackObj);
                        }

                        this.lastFetchTime = Date.now();
                        this.saveLocalSnapshot();
                        console.log(`[OceanicTracks] Successfully synced ${this.tracks.size} active NAT tracks from natTrak API`);
                        resolve(true);
                    } catch (err) {
                        console.warn('[OceanicTracks] Failed to parse natTrak JSON response:', err.message);
                        resolve(false);
                    }
                });
            }).on('error', (err) => {
                console.warn('[OceanicTracks] Failed to fetch live NAT tracks:', err.message);
                resolve(false);
            });
        });
    }

    /**
     * Ensure oceanic tracks are loaded (fetches if cache expired or empty)
     */
    async ensureTracksLoaded(resolveFallbackPointFn = null, forceRefresh = false) {
        const isStale = (Date.now() - this.lastFetchTime) > this.cacheTtlMs;
        if (forceRefresh || this.tracks.size === 0 || isStale) {
            const ok = await this.fetchLiveNatTracks(resolveFallbackPointFn);
            if (!ok && this.tracks.size === 0) {
                this.loadLocalSnapshot();
            }
        }
    }

    /**
     * Get all oceanic tracks
     */
    async getAllTracks(resolveFallbackPointFn = null, filter = {}) {
        await this.ensureTracksLoaded(resolveFallbackPointFn);
        let list = Array.from(this.tracks.values());

        if (filter.system) {
            const sys = String(filter.system).toUpperCase();
            list = list.filter(t => t.system === sys);
        }
        if (filter.direction) {
            const dir = String(filter.direction).toUpperCase();
            list = list.filter(t => t.direction === dir);
        }
        if (filter.active !== undefined) {
            const act = filter.active === true || filter.active === 'true';
            list = list.filter(t => t.active === act);
        }

        return list;
    }

    /**
     * Get a specific oceanic track by identifier (e.g. "A", "NAT A", "NATA", "NAT-A")
     */
    async getTrack(identifier, resolveFallbackPointFn = null) {
        if (!identifier) return null;
        await this.ensureTracksLoaded(resolveFallbackPointFn);

        const clean = String(identifier)
            .trim()
            .toUpperCase()
            .replace(/^NAT[-_\s]*/i, '')
            .replace(/^TRACK[-_\s]*/i, '');

        return this.tracks.get(clean) || null;
    }

    /**
     * Synchronous lookup of an oceanic track from memory/snapshot
     */
    getTrackSync(identifier) {
        if (!identifier) return null;
        const clean = String(identifier)
            .trim()
            .toUpperCase()
            .replace(/^NAT[-_\s]*/i, '')
            .replace(/^TRACK[-_\s]*/i, '');

        return this.tracks.get(clean) || null;
    }

    /**
     * Check if a token refers to an oceanic track (e.g. "NATA", "NAT A", "NATB", "TRACK C")
     */
    isOceanicTrackToken(token) {
        if (!token) return false;
        const clean = String(token).trim().toUpperCase();
        return /^NAT[A-Z]$/i.test(clean) || /^NAT-[A-Z]$/i.test(clean) || /^TRACK[A-Z]$/i.test(clean);
    }
}

module.exports = OceanicTracksService;
