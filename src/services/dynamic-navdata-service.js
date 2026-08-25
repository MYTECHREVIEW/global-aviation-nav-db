const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DYNAMIC_DB_PATH = path.join(__dirname, '../../data/dynamic-global-fixes.json');

class DynamicNavDataService {
    constructor() {
        this.cache = {};
        this.saveTimer = null;
        this.loadDynamicDatabase();
    }

    loadDynamicDatabase() {
        try {
            if (fs.existsSync(DYNAMIC_DB_PATH)) {
                const raw = fs.readFileSync(DYNAMIC_DB_PATH, 'utf8');
                this.cache = JSON.parse(raw);
                console.log(`[DynamicNavData] Loaded ${Object.keys(this.cache).length} cached dynamic international fixes.`);
            } else {
                this.cache = {};
                this.scheduleSave();
            }
        } catch (e) {
            console.error('[DynamicNavData] Error loading dynamic fixes DB:', e.message);
            this.cache = {};
        }
    }

    scheduleSave() {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(async () => {
            this.saveTimer = null;
            try {
                await fs.promises.writeFile(DYNAMIC_DB_PATH, JSON.stringify(this.cache, null, 2), 'utf8');
            } catch (e) {
                console.error('[DynamicNavData] Async save error:', e.message);
            }
        }, 1500);
    }

    saveFix(fix) {
        if (!fix || !fix.ident) return;
        const clean = fix.ident.trim().toUpperCase();
        this.cache[clean] = {
            id: fix.id || `DYNAMIC_${clean}`,
            ident: clean,
            name: fix.name || clean,
            type: fix.type || 'WAYPOINT',
            latitude: parseFloat(fix.latitude),
            longitude: parseFloat(fix.longitude),
            elevation_ft: fix.elevation_ft || null,
            country_code: fix.country_code || null,
            frequency_mhz: fix.frequency_mhz || null,
            source: fix.source || 'DYNAMIC_ONLINE_RESOLVER',
            updated_at: new Date().toISOString()
        };
        this.scheduleSave();
    }

    fetchHttp(url, options = {}) {
        return new Promise((resolve) => {
            const client = url.startsWith('https') ? https : http;
            const req = client.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
                    'Accept': 'text/html,application/json,*/*',
                    ...options.headers
                },
                timeout: options.timeout || 1200
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        });
    }

    postHttp(url, postData, options = {}) {
        return new Promise((resolve) => {
            const parsed = new URL(url);
            const client = url.startsWith('https') ? https : http;
            const req = client.request({
                hostname: parsed.hostname,
                port: parsed.port || (url.startsWith('https') ? 443 : 80),
                path: parsed.pathname + (parsed.search || ''),
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData),
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
                    ...options.headers
                },
                timeout: options.timeout || 1200
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
            req.write(postData);
            req.end();
        });
    }

    getFix(ident, refLat = null, refLon = null) {
        if (!ident) return null;
        const clean = ident.trim().toUpperCase();
        const fix = this.cache[clean];
        if (!fix) return null;
        if (refLat !== null && refLon !== null) {
            const distNm = Math.hypot(fix.latitude - refLat, fix.longitude - refLon) * 60;
            if (distNm > 700) return null;
        }
        return fix;
    }

    async resolveOnline(ident, prevLat = null, prevLon = null, nextLat = null, nextLon = null, fraction = 0.5) {
        if (!ident) return null;
        const clean = ident.trim().toUpperCase();

        // 1. Check local dynamic cache first (Instant <0.1ms lookup)
        if (this.cache[clean]) {
            const cached = this.cache[clean];
            if (prevLat !== null && prevLon !== null) {
                const distNm = Math.hypot(cached.latitude - prevLat, cached.longitude - prevLon) * 60;
                if (distNm <= 700) {
                    return cached;
                }
            } else {
                return cached;
            }
        }

        // 2. Ultra-Fast Parallel Search on OpenNav (Max 1.2s timeout)
        try {
            const searchRes = await this.postHttp('https://opennav.com/search', `q=${encodeURIComponent(clean)}`, { timeout: 1000 });
            if (searchRes && searchRes.data) {
                const links = [];
                const matches = searchRes.data.matchAll(/\/(waypoint|navaid)\/([A-Z0-9]+)\/([A-Z0-9]+)/gi);
                for (const m of matches) {
                    if (m[3].toUpperCase() === clean && !links.includes(m[0])) {
                        links.push(m[0]);
                    }
                    if (links.length >= 4) break; // Limit to top 4 candidates for maximum concurrency speed
                }

                if (links.length > 0) {
                    // Fetch all candidate pages in PARALLEL
                    const pageResponses = await Promise.all(links.map(link => this.fetchHttp(`https://opennav.com${link}`, { timeout: 1000 })));
                    
                    let bestFix = null;
                    let minDistance = Infinity;

                    pageResponses.forEach((pageRes, idx) => {
                        if (pageRes && pageRes.data) {
                            const latMatch = pageRes.data.match(/itemprop=\"latitude\"\s+content=\"([^\"]+)\"/i);
                            const lonMatch = pageRes.data.match(/itemprop=\"longitude\"\s+content=\"([^\"]+)\"/i);
                            const nameMatch = pageRes.data.match(/itemprop=\"name\"\s+content=\"([^\"]+)\"/i);

                            if (latMatch && lonMatch) {
                                const lat = parseFloat(latMatch[1]);
                                const lon = parseFloat(lonMatch[1]);
                                if (!isNaN(lat) && !isNaN(lon)) {
                                    let dist = 0;
                                    if (prevLat !== null && prevLon !== null) {
                                        dist = Math.hypot(lat - prevLat, lon - prevLon);
                                    }
                                    if (dist < minDistance) {
                                        minDistance = dist;
                                        bestFix = {
                                            id: `ONLINE_${clean}`,
                                            ident: clean,
                                            name: nameMatch ? nameMatch[1] : clean,
                                            type: links[idx].includes('navaid') ? 'VOR' : 'WAYPOINT',
                                            latitude: lat,
                                            longitude: lon,
                                            source: 'OPENNAV_ONLINE'
                                        };
                                    }
                                }
                            }
                        }
                    });

                    if (bestFix) {
                        // Proximity Sanity Check: If candidate is > 800 NM from previous fix, reject foreign continent matches
                        if (prevLat !== null && prevLon !== null) {
                            const distNm = Math.hypot(bestFix.latitude - prevLat, bestFix.longitude - prevLon) * 60;
                            if (distNm > 800) {
                                bestFix = null;
                            }
                        }
                    }

                    if (bestFix) {
                        this.saveFix(bestFix);
                        console.log(`[DynamicNavData] Successfully resolved & saved online fix: ${clean} (${bestFix.latitude.toFixed(4)}, ${bestFix.longitude.toFixed(4)})`);
                        return bestFix;
                    }
                }
            }
        } catch (err) {
            // Non-blocking fallback
        }

        // 3. Instant Geodesic Interpolation Fallback (Guarantees <1ms return if online lookup misses)
        if (prevLat !== null && prevLon !== null && nextLat !== null && nextLon !== null) {
            const safeFraction = Math.max(0.05, Math.min(0.95, fraction || 0.5));
            const midLat = prevLat + (nextLat - prevLat) * safeFraction;
            let pLon = prevLon;
            let nLon = nextLon;
            while (nLon - pLon > 180) nLon -= 360;
            while (nLon - pLon < -180) nLon += 360;
            const midLon = pLon + (nLon - pLon) * safeFraction;

            const interpolated = {
                id: `INTERP_${clean}`,
                ident: clean,
                name: `${clean} (Enroute Fix)`,
                type: 'WAYPOINT',
                latitude: parseFloat(midLat.toFixed(6)),
                longitude: parseFloat(midLon.toFixed(6)),
                source: 'GEODESIC_INTERPOLATION'
            };
            this.saveFix(interpolated);
            console.log(`[DynamicNavData] Geodesic interpolated missing fix: ${clean} (${midLat.toFixed(4)}, ${midLon.toFixed(4)}) [fraction: ${safeFraction.toFixed(2)}]`);
            return interpolated;
        }

        return null;
    }
}

module.exports = new DynamicNavDataService();
