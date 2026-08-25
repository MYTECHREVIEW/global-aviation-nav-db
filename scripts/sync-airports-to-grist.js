/**
 * Batch Sync All 85,917 Airports into Grist 'Airports' Table (doc: wj7bUFrVUiV7)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const gristService = require('../src/services/grist-waypoints-service');

const DATA_DIR = path.join(__dirname, '..', 'data');

async function runAirportSync() {
    console.log('🚀 Starting Full Airport Database Cloud Sync to Grist (doc: wj7bUFrVUiV7)...');
    await gristService.initializeSchema();

    const nowIso = new Date().toISOString();
    const airportsData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'airports.json'), 'utf8'));
    const airportEntries = Object.values(airportsData);

    console.log(`✈️ Loaded ${airportEntries.length} airports from airports.json`);

    const airportRecords = airportEntries.map(apt => ({
        Ident: (apt.icao || apt.ident || '').trim().toUpperCase(),
        Name: apt.name || apt.icao || 'Unknown Airport',
        Type: (apt.type || 'AIRPORT').toUpperCase(),
        Latitude: parseFloat(apt.latitude),
        Longitude: parseFloat(apt.longitude),
        CountryCode: apt.country || null,
        Region: apt.city || apt.country_name || apt.continent || null,
        ElevationFt: apt.elevation_ft !== null && apt.elevation_ft !== undefined ? parseFloat(apt.elevation_ft) : null,
        FrequencyMHz: apt.iata || null,
        Source: apt.source || 'ICAO_AIRPORT_DATABASE',
        DateUploaded: nowIso,
        DateUpdated: nowIso
    })).filter(r => r.Ident && !isNaN(r.Latitude) && !isNaN(r.Longitude));

    console.log(`➡️ Syncing ${airportRecords.length} airports to Grist 'Airports' table (500 records per batch)...`);
    const result = await gristService.batchInsert('Airports', airportRecords, 500);

    console.log('\n🎉 AIRPORT DATABASE SYNC COMPLETE!');
    console.log(`✅ Successfully synced ${result.totalInserted}/${airportRecords.length} airports to Grist.`);
}

runAirportSync().catch(err => {
    console.error('❌ Airport sync failed:', err);
});
