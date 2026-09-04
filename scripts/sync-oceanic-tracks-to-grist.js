/**
 * sync-oceanic-tracks-to-grist.js
 * 
 * Synchronizes Oceanic Tracks (North Atlantic Tracks - NATs) to Grist Document
 * Table: 'Oceanic_Tracks'
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const gristService = require('../src/services/grist-waypoints-service');
const OceanicTracksService = require('../src/services/oceanic-tracks-service');

const DATA_DIR = path.join(__dirname, '..', 'data');
const waypointsByIdent = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'waypoints-by-ident.json'), 'utf8'));

async function syncOceanicTracksToGrist() {
    console.log('🚀 Starting Oceanic Tracks Cloud Sync to Grist (doc: wj7bUFrVUiV7)...');
    await gristService.initializeSchema();

    const oceanicService = new OceanicTracksService({ dataDir: DATA_DIR });
    const resolver = (ident) => {
        if (waypointsByIdent[ident]) return waypointsByIdent[ident][0];
        return null;
    };

    console.log('📡 Fetching / loading latest oceanic tracks...');
    await oceanicService.ensureTracksLoaded(resolver, true);
    const tracks = await oceanicService.getAllTracks(resolver);

    console.log(`✈️ Loaded ${tracks.length} oceanic tracks to sync.`);

    console.log("🧹 Clearing existing records in Grist 'Oceanic_Tracks' table...");
    await gristService.clearTable('Oceanic_Tracks');

    const nowIso = new Date().toISOString();
    const records = tracks.map(t => {
        const flStr = t.flight_levels && t.flight_levels.length > 0 
            ? `FL${Math.min(...t.flight_levels)/100}-FL${Math.max(...t.flight_levels)/100}` 
            : 'ALL';

        return {
            TrackIdent: t.identifier,
            System: t.system || 'NAT',
            Name: t.name || `NAT Track ${t.identifier}`,
            Direction: t.direction || 'WEST',
            RouteString: t.route_string,
            EntryFix: t.entry_fix || '',
            ExitFix: t.exit_fix || '',
            FlightLevels: flStr,
            ValidFrom: t.valid_from || '',
            ValidTo: t.valid_to || '',
            WaypointsCount: t.waypoints ? t.waypoints.length : 0,
            WaypointsJson: JSON.stringify(t.waypoints || []),
            Active: t.active !== false,
            DateUpdated: nowIso
        };
    });

    console.log(`➡️ Syncing ${records.length} tracks to 'Oceanic_Tracks' table...`);
    const result = await gristService.batchInsert('Oceanic_Tracks', records, 50);

    console.log(`🎉 OCEANIC TRACKS SYNC COMPLETE!`);
    console.log(`✅ Successfully synced ${records.length} oceanic tracks into Grist.`);
}

syncOceanicTracksToGrist().catch(err => {
    console.error('❌ Error syncing oceanic tracks to Grist:', err);
    process.exit(1);
});
