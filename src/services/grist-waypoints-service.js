const https = require('https');
const http = require('http');

class GristWaypointsService {
    constructor() {
        this.apiUrl = process.env.GRIST_API_URL || 'https://grist.rolandonieves.com/api';
        this.apiKey = process.env.GRIST_API_KEY || '3c64f358e8ff1db27b2c39c12311e9f949406d6d';
        this.docId = process.env.GRIST_WAYPOINTS_DOC_ID || 'wj7bUFrVUiV7';
        this.cfClientId = process.env.CF_ACCESS_CLIENT_ID || '159c2ddb0b8e5cdfab93f42444469597.access';
        this.cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET || '43c04ba43ee2341ceb10572327ce87cff59ed50444c8c01ab943ae3b04d336b8';
        this.initialized = false;
    }

    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'CF-Access-Client-Id': this.cfClientId,
            'CF-Access-Client-Secret': this.cfClientSecret
        };
    }

    request(endpoint, method = 'GET', body = null) {
        return new Promise((resolve, reject) => {
            const fullUrl = `${this.apiUrl}/docs/${this.docId}${endpoint}`;
            const urlObj = new URL(fullUrl);
            const client = urlObj.protocol === 'https:' ? https : http;

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + (urlObj.search || ''),
                method,
                headers: this.getHeaders(),
                timeout: 8000
            };

            const req = client.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = data ? JSON.parse(data) : {};
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(parsed);
                        } else {
                            resolve({ error: parsed.error || `HTTP ${res.statusCode}`, statusCode: res.statusCode });
                        }
                    } catch (e) {
                        resolve({ error: e.message, raw: data });
                    }
                });
            });

            req.on('error', err => resolve({ error: err.message }));
            req.on('timeout', () => {
                req.destroy();
                resolve({ error: 'Request timeout' });
            });

            if (body) {
                req.write(typeof body === 'string' ? body : JSON.stringify(body));
            }
            req.end();
        });
    }

    /**
     * Map a raw waypoint type to its dedicated Grist table
     */
    getTargetTable(type = 'WAYPOINT') {
        const t = (type || 'WAYPOINT').toUpperCase();
        if (t.includes('VORTAC') || t.includes('TACAN') || t.includes('DME') && !t.includes('VOR')) {
            return 'VORTACs_TACANs';
        }
        if (t.includes('VOR')) {
            return 'VORs';
        }
        if (t.includes('NDB')) {
            return 'NDBs';
        }
        if (t === 'AIRPORT' || t === 'AERODROME') {
            return 'Airports';
        }
        return 'Fixes';
    }

    /**
     * Initialize Grist Tables with Complete Aeronautical Metadata Schema
     */
    async initializeSchema() {
        try {
            const tablesRes = await this.request('/tables');
            const existingTableIds = (tablesRes.tables || []).map(t => t.id);

            const standardColumns = [
                { id: 'Ident', fields: { label: 'Ident', type: 'Text' } },
                { id: 'Name', fields: { label: 'Name', type: 'Text' } },
                { id: 'Type', fields: { label: 'Type', type: 'Text' } },
                { id: 'Latitude', fields: { label: 'Latitude', type: 'Numeric' } },
                { id: 'Longitude', fields: { label: 'Longitude', type: 'Numeric' } },
                { id: 'CountryCode', fields: { label: 'CountryCode', type: 'Text' } },
                { id: 'Region', fields: { label: 'Region', type: 'Text' } },
                { id: 'ElevationFt', fields: { label: 'ElevationFt', type: 'Numeric' } },
                { id: 'FrequencyMHz', fields: { label: 'FrequencyMHz', type: 'Text' } },
                { id: 'Source', fields: { label: 'Source', type: 'Text' } },
                { id: 'DateUploaded', fields: { label: 'DateUploaded', type: 'DateTime' } },
                { id: 'DateUpdated', fields: { label: 'DateUpdated', type: 'DateTime' } }
            ];

            const requiredTables = ['Fixes', 'VORs', 'VORTACs_TACANs', 'NDBs', 'Airports'];
            const tablesToCreate = [];

            for (const tableId of requiredTables) {
                if (!existingTableIds.includes(tableId)) {
                    tablesToCreate.push({
                        id: tableId,
                        columns: standardColumns
                    });
                }
            }

            if (tablesToCreate.length > 0) {
                console.log(`[GristWaypoints] Creating ${tablesToCreate.length} missing tables in doc ${this.docId}...`);
                await this.request('/tables', 'POST', { tables: tablesToCreate });
            }

            this.initialized = true;
            console.log(`[GristWaypoints] ✅ Grist redundancy tables initialized for doc ${this.docId}`);
            return { success: true, tables: requiredTables };
        } catch (err) {
            console.warn('[GristWaypoints] Schema initialization warning:', err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * Upsert a Waypoint / NavAid / Airport into its type-separated Grist Table
     */
    async upsertWaypoint(waypointData) {
        if (!waypointData || !waypointData.ident) return { success: false, error: 'Invalid waypoint data' };

        if (!this.initialized) {
            await this.initializeSchema();
        }

        const table = this.getTargetTable(waypointData.type);
        const ident = waypointData.ident.trim().toUpperCase();
        const nowIso = new Date().toISOString();

        const fields = {
            Ident: ident,
            Name: waypointData.name || ident,
            Type: waypointData.type || 'WAYPOINT',
            Latitude: parseFloat(waypointData.latitude),
            Longitude: parseFloat(waypointData.longitude),
            CountryCode: waypointData.country_code || waypointData.country || null,
            Region: waypointData.region || null,
            ElevationFt: waypointData.elevation_ft !== null && waypointData.elevation_ft !== undefined ? parseFloat(waypointData.elevation_ft) : null,
            FrequencyMHz: waypointData.frequency_mhz !== null && waypointData.frequency_mhz !== undefined ? String(waypointData.frequency_mhz) : null,
            Source: waypointData.source || 'AERONAV_AUTO_FIX',
            DateUpdated: nowIso
        };

        try {
            // Check if record already exists in table
            const filterQuery = encodeURIComponent(JSON.stringify({ Ident: [ident] }));
            const existing = await this.request(`/tables/${table}/records?filter=${filterQuery}`);

            if (existing && Array.isArray(existing.records) && existing.records.length > 0) {
                const recId = existing.records[0].id;
                await this.request(`/tables/${table}/records`, 'PATCH', {
                    records: [{ id: recId, fields }]
                });
                console.log(`[GristWaypoints] 🔄 Updated ${table} [${ident}] in Grist (ID: ${recId})`);
                return { success: true, action: 'updated', table, id: recId, ident };
            } else {
                fields.DateUploaded = nowIso;
                const created = await this.request(`/tables/${table}/records`, 'POST', {
                    records: [{ fields }]
                });
                const newId = created.records?.[0]?.id || null;
                console.log(`[GristWaypoints] ➕ Inserted new ${table} [${ident}] in Grist (ID: ${newId})`);
                return { success: true, action: 'created', table, id: newId, ident };
            }
        } catch (err) {
            console.warn(`[GristWaypoints] Error upserting ${ident} to ${table}:`, err.message);
            return { success: false, error: err.message, table, ident };
        }
    }

    /**
     * Batch insert records into a specific table (chunks of chunkSize)
     */
    async batchInsert(table, recordsArray, chunkSize = 500) {
        if (!this.initialized) await this.initializeSchema();
        let totalInserted = 0;
        const total = recordsArray.length;

        for (let i = 0; i < total; i += chunkSize) {
            const chunk = recordsArray.slice(i, i + chunkSize);
            const payload = {
                records: chunk.map(r => ({ fields: r }))
            };
            try {
                const res = await this.request(`/tables/${table}/records`, 'POST', payload);
                if (res.records && Array.isArray(res.records)) {
                    totalInserted += res.records.length;
                } else if (res.error) {
                    console.warn(`[GristWaypoints] Batch insert error on ${table} [${i}..${i+chunk.length}]:`, res.error);
                }
            } catch (e) {
                console.warn(`[GristWaypoints] Batch request exception on ${table}:`, e.message);
            }
            console.log(`[GristWaypoints] 📊 ${table}: ${Math.min(i + chunkSize, total)}/${total} records synced (${Math.round((Math.min(i + chunkSize, total) / total) * 100)}%)`);
            // Brief pause to avoid flooding
            await new Promise(r => setTimeout(r, 100));
        }
        return { success: true, table, totalInserted, total };
    }

    /**
     * Batch sync all curated custom waypoints to Grist
     */
    async syncAllCuratedWaypoints(waypointsObj) {
        if (!this.initialized) {
            await this.initializeSchema();
        }

        const entries = Object.values(waypointsObj || {});
        console.log(`[GristWaypoints] 🚀 Starting bulk sync of ${entries.length} waypoints to Grist...`);
        let syncedCount = 0;

        for (const wp of entries) {
            const res = await this.upsertWaypoint(wp);
            if (res.success) syncedCount++;
        }

        console.log(`[GristWaypoints] 🎉 Bulk sync completed: ${syncedCount}/${entries.length} waypoints synced to Grist.`);
        return { success: true, total: entries.length, synced: syncedCount };
    }
}

module.exports = new GristWaypointsService();
