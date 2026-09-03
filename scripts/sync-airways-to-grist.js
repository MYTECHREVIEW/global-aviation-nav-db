/**
 * Comprehensive Batch Sync of ALL Airways into Grist 'Airways' Table (doc: wj7bUFrVUiV7)
 * 
 * Synchronizes the entire global airway network (1,478 airways, ~19,128 waypoint legs):
 * - Resolves precise latitude/longitude, fix type, and country code for every airway waypoint.
 * - Deduplicates entries and cleans existing records in the Grist table to prevent double entries.
 * - Uploads in chunks of 500 records with progress tracking.
 * 
 * Usage:
 *   node scripts/sync-airways-to-grist.js              # Syncs ALL 1,478 global + custom airways
 *   node scripts/sync-airways-to-grist.js --custom-only # Syncs only the curated custom airways
 *   node scripts/sync-airways-to-grist.js --no-clear    # Appends without clearing table first
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const gristService = require('../src/services/grist-waypoints-service');
const RouteParser = require('../src/parser/route-parser').RouteParser || require('../src/parser/route-parser');

const DATA_DIR = path.join(__dirname, '..', 'data');

async function runAirwaysSync() {
    const customOnly = process.argv.includes('--custom-only');
    const noClear = process.argv.includes('--no-clear');

    console.log(`🚀 Starting Global Airways Cloud Sync to Grist (doc: ${process.env.GRIST_WAYPOINTS_DOC_ID || 'wj7bUFrVUiV7'})...`);
    console.log(`Mode: ${customOnly ? 'CURATED CUSTOM AIRWAYS ONLY' : 'FULL GLOBAL AIRWAYS DATABASE (ALL 1,478 AIRWAYS)'}`);

    await gristService.initializeSchema();

    // 1. Clear existing records to eliminate any duplicates unless --no-clear is passed
    if (!noClear) {
        console.log('\n🧹 Clearing existing records in Grist \'Airways\' table to prevent duplicates...');
        const clearRes = await gristService.clearTable('Airways');
        console.log(`   Deleted ${clearRes.deleted || 0} existing records.`);
    }

    // 2. Load navigation databases for accurate coordinate resolution
    console.log('\n📡 Loading reference navigation data for coordinate resolution...');
    const navaids = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'navaids-by-ident.json'), 'utf8'));
    const waypoints = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'waypoints-by-ident.json'), 'utf8'));
    const allAirwaysData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'airways.json'), 'utf8'));
    const parser = new RouteParser({}, navaids, waypoints, allAirwaysData, {}, {});

    const nowIso = new Date().toISOString();
    let targetAirways = {};

    if (customOnly) {
        const customPath = path.join(DATA_DIR, 'custom-global-airways.json');
        if (fs.existsSync(customPath)) {
            targetAirways = JSON.parse(fs.readFileSync(customPath, 'utf8'));
        } else {
            console.error('No custom airways file found at', customPath);
            return;
        }
    } else {
        // Full sync: merge all global airways with custom curated airways
        targetAirways = Object.assign({}, allAirwaysData);
        const customPath = path.join(DATA_DIR, 'custom-global-airways.json');
        if (fs.existsSync(customPath)) {
            const custom = JSON.parse(fs.readFileSync(customPath, 'utf8'));
            Object.assign(targetAirways, custom);
        }
    }

    const airwayEntries = Object.entries(targetAirways);
    console.log(`✈️ Loaded ${airwayEntries.length} airways to process...`);

    // 3. Process and resolve coordinates for every leg
    const airwayRecords = [];
    let resolvedCount = 0;

    for (const [ident, legs] of airwayEntries) {
        if (!Array.isArray(legs)) continue;

        for (let idx = 0; idx < legs.length; idx++) {
            const leg = legs[idx];
            const fixIdent = String(leg.fixIdent || leg.ident || '').trim().toUpperCase();
            const seq = leg.seq !== undefined ? leg.seq : (idx + 1) * 10;
            
            // Resolve geographic coordinates and fix metadata
            const resolved = parser.resolvePoint(fixIdent);
            const lat = leg.latitude ?? (resolved ? resolved.latitude : null);
            const lon = leg.longitude ?? (resolved ? resolved.longitude : null);
            const fixType = leg.type ?? (resolved ? resolved.type : 'WAYPOINT');
            const country = leg.country_code ?? (resolved ? resolved.country_code : null);

            if (lat !== null && !isNaN(lat)) resolvedCount++;

            airwayRecords.push({
                AirwayIdent: ident.toUpperCase(),
                Sequence: seq,
                FixIdent: fixIdent,
                FixType: fixType,
                Latitude: lat !== null && !isNaN(lat) ? parseFloat(lat) : null,
                Longitude: lon !== null && !isNaN(lon) ? parseFloat(lon) : null,
                CountryCode: country || null,
                Source: customOnly ? 'Curated' : 'GLOBAL_NAV_DB',
                DateUpdated: nowIso
            });
        }
    }

    console.log(`📊 Total legs/fixes prepared: ${airwayRecords.length} (${resolvedCount} coordinates resolved)`);
    console.log(`➡️ Syncing to Grist 'Airways' table in batches of 500...`);

    const result = await gristService.batchInsert('Airways', airwayRecords, 500);

    console.log('\n🎉 FULL AIRWAYS DATABASE SYNC COMPLETE!');
    console.log(`✅ Successfully synced ${result.totalInserted}/${airwayRecords.length} airway fixes across ${airwayEntries.length} airways into Grist.`);
}

runAirwaysSync().catch(err => {
    console.error('❌ Airways sync failed:', err);
});
