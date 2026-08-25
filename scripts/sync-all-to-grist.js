/**
 * Comprehensive Grist Database Full-Sync Script
 * Syncs the entire global aeronautical database (~70,000 Fixes, ~11,000 Navaids)
 * into type-separated tables in Grist Document wj7bUFrVUiV7
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const gristService = require('../src/services/grist-waypoints-service');

const DATA_DIR = path.join(__dirname, '..', 'data');

async function runFullSync() {
    console.log('🚀 Starting Full Aeronautical Database Cloud Sync to Grist (doc: wj7bUFrVUiV7)...');
    await gristService.initializeSchema();

    const nowIso = new Date().toISOString();

    // 1. Process and categorize NavAids (VORs, NDBs, TACANs, DMEs)
    console.log('\n📡 Loading and categorizing 11,008 NavAids from navaids.json...');
    const navaids = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'navaids.json'), 'utf8'));

    const vors = [];
    const ndbs = [];
    const tacans = [];

    for (const n of navaids) {
        const type = (n.type || 'VOR').toUpperCase();
        const record = {
            Ident: (n.ident || '').trim().toUpperCase(),
            Name: n.name || n.ident,
            Type: n.type || 'VOR',
            Latitude: parseFloat(n.latitude),
            Longitude: parseFloat(n.longitude),
            CountryCode: n.country_code || null,
            Region: n.associated_airport_icao || null,
            ElevationFt: n.elevation_ft !== null && n.elevation_ft !== undefined ? parseFloat(n.elevation_ft) : null,
            FrequencyMHz: n.frequency_mhz !== null && n.frequency_mhz !== undefined ? String(n.frequency_mhz) : (n.frequency_khz ? String(n.frequency_khz) : null),
            Source: 'GLOBAL_NAV_DB',
            DateUploaded: nowIso,
            DateUpdated: nowIso
        };

        if (type.includes('VORTAC') || type.includes('TACAN') || (type.includes('DME') && !type.includes('VOR') && !type.includes('NDB'))) {
            tacans.push(record);
        } else if (type.includes('VOR')) {
            vors.push(record);
        } else if (type.includes('NDB')) {
            ndbs.push(record);
        } else {
            vors.push(record);
        }
    }

    console.log(`➡️ Syncing ${vors.length} VORs to 'VORs' table...`);
    await gristService.batchInsert('VORs', vors, 500);

    console.log(`➡️ Syncing ${ndbs.length} NDBs to 'NDBs' table...`);
    await gristService.batchInsert('NDBs', ndbs, 500);

    console.log(`➡️ Syncing ${tacans.length} TACANs/DMEs to 'VORTACs_TACANs' table...`);
    await gristService.batchInsert('VORTACs_TACANs', tacans, 500);

    // 2. Process Waypoints (70,052 fixes)
    console.log('\n📍 Loading 70,052 Waypoints from waypoints.json...');
    const waypoints = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'waypoints.json'), 'utf8'));

    const fixes = [];
    for (const w of waypoints) {
        fixes.push({
            Ident: (w.ident || '').trim().toUpperCase(),
            Name: w.name || w.ident,
            Type: w.type || 'WAYPOINT',
            Latitude: parseFloat(w.latitude),
            Longitude: parseFloat(w.longitude),
            CountryCode: w.region_code || null,
            Region: w.usage_type || 'Enroute',
            ElevationFt: null,
            FrequencyMHz: null,
            Source: 'GLOBAL_NAV_DB',
            DateUploaded: nowIso,
            DateUpdated: nowIso
        });
    }

    console.log(`➡️ Syncing ${fixes.length} Fixes to 'Fixes' table...`);
    await gristService.batchInsert('Fixes', fixes, 500);

    console.log('\n🎉 FULL DATABASE SYNC COMPLETE!');
    console.log(`✅ Synced: ${vors.length} VORs, ${ndbs.length} NDBs, ${tacans.length} TACANs/DMEs, ${fixes.length} Fixes.`);
}

runFullSync().catch(err => {
    console.error('❌ Full sync failed:', err);
});
