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

            const airwayColumns = [
                { id: 'AirwayIdent', fields: { label: 'AirwayIdent', type: 'Text' } },
                { id: 'Sequence', fields: { label: 'Sequence', type: 'Numeric' } },
                { id: 'FixIdent', fields: { label: 'FixIdent', type: 'Text' } },
                { id: 'FixType', fields: { label: 'FixType', type: 'Text' } },
                { id: 'Latitude', fields: { label: 'Latitude', type: 'Numeric' } },
                { id: 'Longitude', fields: { label: 'Longitude', type: 'Numeric' } },
                { id: 'CountryCode', fields: { label: 'CountryCode', type: 'Text' } },
                { id: 'Source', fields: { label: 'Source', type: 'Text' } },
                { id: 'DateUpdated', fields: { label: 'DateUpdated', type: 'DateTime' } }
            ];

            const oceanicTrackColumns = [
                { id: 'TrackIdent', fields: { label: 'TrackIdent', type: 'Text' } },
                { id: 'System', fields: { label: 'System', type: 'Text' } },
                { id: 'Name', fields: { label: 'Name', type: 'Text' } },
                { id: 'Direction', fields: { label: 'Direction', type: 'Text' } },
                { id: 'RouteString', fields: { label: 'RouteString', type: 'Text' } },
                { id: 'EntryFix', fields: { label: 'EntryFix', type: 'Text' } },
                { id: 'ExitFix', fields: { label: 'ExitFix', type: 'Text' } },
                { id: 'FlightLevels', fields: { label: 'FlightLevels', type: 'Text' } },
                { id: 'ValidFrom', fields: { label: 'ValidFrom', type: 'Text' } },
                { id: 'ValidTo', fields: { label: 'ValidTo', type: 'Text' } },
                { id: 'WaypointsCount', fields: { label: 'WaypointsCount', type: 'Numeric' } },
                { id: 'WaypointsJson', fields: { label: 'WaypointsJson', type: 'Text' } },
                { id: 'Active', fields: { label: 'Active', type: 'Bool' } },
                { id: 'DateUpdated', fields: { label: 'DateUpdated', type: 'DateTime' } }
            ];

            const requiredTables = ['Fixes', 'VORs', 'VORTACs_TACANs', 'NDBs', 'Airports', 'Airways', 'Oceanic_Tracks'];
            const tablesToCreate = [];

            for (const tableId of requiredTables) {
                if (!existingTableIds.includes(tableId)) {
                    let cols = standardColumns;
                    if (tableId === 'Airways') cols = airwayColumns;
                    if (tableId === 'Oceanic_Tracks') cols = oceanicTrackColumns;

                    tablesToCreate.push({
                        id: tableId,
                        columns: cols
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

    /**
     * Upsert an Airway and its ordered leg waypoints into Grist Airways table
     */
    async upsertAirway(airwayIdent, legs, resolver = null) {
        if (!this.initialized) {
            await this.initializeSchema();
        }

        const ident = String(airwayIdent || '').trim().toUpperCase();
        if (!ident || !Array.isArray(legs) || legs.length === 0) {
            return { success: false, error: 'Invalid airway ident or legs array' };
        }

        try {
            // Find existing records for this airway
            const searchRes = await this.request(`/tables/Airways/records?filter=${encodeURIComponent(JSON.stringify({ AirwayIdent: [ident] }))}`);
            const existingRecords = searchRes?.records || [];
            const existingByFix = {};
            for (const r of existingRecords) {
                if (r.fields?.FixIdent) {
                    existingByFix[r.fields.FixIdent] = r.id;
                }
            }

            const now = new Date().toISOString();
            const recordsToAdd = [];
            const recordsToUpdate = [];

            for (let idx = 0; idx < legs.length; idx++) {
                const leg = legs[idx];
                const fixIdent = String(leg.fixIdent || leg.ident || '').trim().toUpperCase();
                const seq = leg.seq !== undefined ? leg.seq : (idx + 1) * 10;
                let lat = leg.latitude ?? null;
                let lon = leg.longitude ?? null;
                let fixType = leg.type ?? 'WAYPOINT';
                let country = leg.country_code ?? null;

                if ((lat === null || lon === null) && resolver && typeof resolver === 'function') {
                    const resolved = resolver(fixIdent);
                    if (resolved) {
                        lat = resolved.latitude;
                        lon = resolved.longitude;
                        fixType = resolved.type || fixType;
                        country = resolved.country_code || country;
                    }
                }

                const fields = {
                    AirwayIdent: ident,
                    Sequence: seq,
                    FixIdent: fixIdent,
                    FixType: fixType,
                    Latitude: lat,
                    Longitude: lon,
                    CountryCode: country,
                    Source: leg.source || 'Curated',
                    DateUpdated: now
                };

                if (existingByFix[fixIdent]) {
                    recordsToUpdate.push({ id: existingByFix[fixIdent], fields });
                } else {
                    recordsToAdd.push({ fields });
                }
            }

            if (recordsToAdd.length > 0) {
                await this.request('/tables/Airways/records', 'POST', { records: recordsToAdd });
            }
            if (recordsToUpdate.length > 0) {
                await this.request('/tables/Airways/records', 'PATCH', { records: recordsToUpdate });
            }

            console.log(`[GristWaypoints] ✈️ Synced Airway ${ident} to Grist (${recordsToAdd.length} added, ${recordsToUpdate.length} updated).`);
            return {
                success: true,
                ident,
                added: recordsToAdd.length,
                updated: recordsToUpdate.length,
                total: legs.length
            };
        } catch (err) {
            console.warn(`[GristWaypoints] Failed to sync airway ${ident} to Grist:`, err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * Fetch records from Grist Airways table (optionally filtered by AirwayIdent)
     */
    async fetchAirways(airwayIdent = null) {
        try {
            let endpoint = '/tables/Airways/records';
            if (airwayIdent) {
                const filter = encodeURIComponent(JSON.stringify({ AirwayIdent: [airwayIdent.toUpperCase()] }));
                endpoint += `?filter=${filter}`;
            }
            const res = await this.request(endpoint);
            return res?.records || [];
        } catch (err) {
            console.warn('[GristWaypoints] Failed to fetch airways from Grist:', err.message);
            return [];
        }
    }

    /**
     * Delete records by ID from a table
     */
    async deleteRecords(table, ids = []) {
        if (!Array.isArray(ids) || ids.length === 0) return { success: true, deleted: 0 };
        try {
            const chunkSize = 500;
            let deleted = 0;
            for (let i = 0; i < ids.length; i += chunkSize) {
                const chunk = ids.slice(i, i + chunkSize);
                await this.request(`/tables/${table}/data/delete`, 'POST', chunk);
                deleted += chunk.length;
            }
            return { success: true, deleted };
        } catch (err) {
            console.warn(`[GristWaypoints] Failed to delete records from ${table}:`, err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * Clear all records in a table
     */
    async clearTable(table) {
        try {
            const res = await this.request(`/tables/${table}/records`);
            const ids = (res.records || []).map(r => r.id);
            if (ids.length > 0) {
                return await this.deleteRecords(table, ids);
            }
            return { success: true, deleted: 0 };
        } catch (err) {
            console.warn(`[GristWaypoints] Failed to clear table ${table}:`, err.message);
            return { success: false, error: err.message };
        }
    }
}

module.exports = new GristWaypointsService();
