const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const PROJECT_DIR = '/Volumes/ANTIGRAVITY/global-aviation-nav-db';
const DATA_DIR = path.join(PROJECT_DIR, 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000) {
            console.log(`⚡ Using cached raw file: ${path.basename(destPath)} (${(fs.statSync(destPath).size / 1024 / 1024).toFixed(1)} MB)`);
            return resolve(destPath);
        }

        console.log(`⬇️ Downloading ${url} ...`);
        const fileStream = fs.createWriteStream(destPath);
        const client = url.startsWith('https') ? https : http;

        client.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
            }

            response.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close(() => {
                    console.log(`✅ Download complete: ${path.basename(destPath)} (${(fs.statSync(destPath).size / 1024 / 1024).toFixed(1)} MB)`);
                    resolve(destPath);
                });
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

function parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim().replace(/^"|"$/g, ''));
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current.trim().replace(/^"|"$/g, ''));
    return values;
}

function parseArincLat(str) {
    if (!str || str.length < 8) return null;
    const hemi = str[0];
    if (hemi !== 'N' && hemi !== 'S') return null;
    const deg = parseInt(str.substring(1, 3), 10);
    const min = parseInt(str.substring(3, 5), 10);
    const sec = parseInt(str.substring(5, 7), 10) + (str.length > 7 ? parseInt(str.substring(7, 9), 10) / 100 : 0);
    let dec = deg + min / 60 + sec / 3600;
    if (hemi === 'S') dec = -dec;
    return parseFloat(dec.toFixed(6));
}

function parseArincLon(str) {
    if (!str || str.length < 9) return null;
    const hemi = str[0];
    if (hemi !== 'E' && hemi !== 'W') return null;
    const deg = parseInt(str.substring(1, 4), 10);
    const min = parseInt(str.substring(4, 6), 10);
    const sec = parseInt(str.substring(6, 8), 10) + (str.length > 8 ? parseInt(str.substring(8, 10), 10) / 100 : 0);
    let dec = deg + min / 60 + sec / 3600;
    if (hemi === 'W') dec = -dec;
    return parseFloat(dec.toFixed(6));
}

async function runMasterIngestion() {
    console.log('🚀 Starting Full Master Aeronautical Database Ingestion (including SIDs & STARs)...');

    // 1. Download & Extract FAA CIFP (Global Nav & Waypoints ARINC 424)
    const cifpZip = path.join(RAW_DIR, 'cifp.zip');
    const cifpTxt = path.join(RAW_DIR, 'FAACIFP18');

    if (!fs.existsSync(cifpTxt)) {
        await downloadFile('https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260806.zip', cifpZip);
        console.log('📦 Extracting CIFP ZIP...');
        execSync(`unzip -o "${cifpZip}" -d "${RAW_DIR}"`);
    }

    // 2. Download OurAirports Navaids & Airports
    const navaidsCsv = path.join(RAW_DIR, 'navaids.csv');
    await downloadFile('https://davidmegginson.github.io/ourairports-data/navaids.csv', navaidsCsv);

    const airportsCsv = path.join(RAW_DIR, 'airports.csv');
    await downloadFile('https://davidmegginson.github.io/ourairports-data/airports.csv', airportsCsv);

    // 3. Process Airports
    console.log('📦 Processing Airports database...');
    const airports = {};
    const airportLines = readline.createInterface({ input: fs.createReadStream(airportsCsv), crlfDelay: Infinity });

    let isFirstAirportLine = true;
    for await (const line of airportLines) {
        if (isFirstAirportLine) { isFirstAirportLine = false; continue; }
        const row = parseCsvLine(line);
        const ident = (row[1] || '').toUpperCase();
        const type = row[2];
        const name = row[3];
        const lat = parseFloat(row[4]);
        const lon = parseFloat(row[5]);
        const elev = parseInt(row[6], 10) || 0;
        const country = row[8];
        const municipality = row[10];
        const gpsCode = (row[12] || '').toUpperCase();
        const iataCode = (row[13] || '').toUpperCase();

        const icao = gpsCode || ident;
        if (icao && !isNaN(lat) && !isNaN(lon)) {
            airports[icao] = {
                icao,
                iata: iataCode || null,
                name,
                type,
                latitude: lat,
                longitude: lon,
                elevation_ft: elev,
                country,
                city: municipality || null
            };
        }
    }
    console.log(`  ✅ Processed ${Object.keys(airports).length.toLocaleString()} airports.`);

    // 4. Process Navaids (VOR, VORTAC, VOR-DME, NDB, TACAN, DME)
    console.log('📦 Processing Global NavAids database...');
    const navaids = [];
    const navaidsByIdent = {};
    const navaidLines = readline.createInterface({ input: fs.createReadStream(navaidsCsv), crlfDelay: Infinity });

    let isFirstNavLine = true;
    for await (const line of navaidLines) {
        if (isFirstNavLine) { isFirstNavLine = false; continue; }
        const row = parseCsvLine(line);
        const id = row[0];
        const ident = (row[2] || '').toUpperCase();
        const name = row[3] || ident;
        const type = row[4];
        const freqKhz = parseInt(row[5], 10) || null;
        const lat = parseFloat(row[6]);
        const lon = parseFloat(row[7]);
        const elev = parseInt(row[8], 10) || null;
        const country = row[9];
        const dmeChannel = row[11] || null;
        const magVar = parseFloat(row[16]) || null;
        const usageType = row[17] || 'BOTH';
        const power = row[18] || null;
        const associatedAirport = (row[19] || '').toUpperCase() || null;

        if (ident && !isNaN(lat) && !isNaN(lon)) {
            const navObj = {
                id: `NAV_${id}`,
                ident,
                name,
                type,
                frequency_khz: freqKhz,
                frequency_mhz: freqKhz ? (freqKhz / 1000).toFixed(2) : null,
                latitude: lat,
                longitude: lon,
                elevation_ft: elev,
                country_code: country,
                dme_channel: dmeChannel,
                magnetic_variation_deg: magVar,
                usage_type: usageType,
                power,
                associated_airport_icao: associatedAirport,
                associated_airport_name: associatedAirport && airports[associatedAirport] ? airports[associatedAirport].name : null
            };

            navaids.push(navObj);
            if (!navaidsByIdent[ident]) navaidsByIdent[ident] = [];
            navaidsByIdent[ident].push(navObj);
        }
    }
    console.log(`  ✅ Processed ${navaids.length.toLocaleString()} NavAids.`);

    // 5. Process ARINC 424 Waypoints, Fixes, Airways, SIDs (Departures), and STARs (Arrivals)
    console.log('📦 Processing ARINC 424 Waypoints, Fixes, Airways, SIDs & STARs...');
    const waypoints = [];
    const waypointsByIdent = {};
    const airways = {};
    const sids = {};   // key: "APT_SID" (e.g. "KEYW_BUFTT1", "BUFTT1") -> Array of fixes
    const stars = {};  // key: "APT_STAR" (e.g. "KLGA_PROUD2", "PROUD2") -> Array of fixes

    const cifpStream = fs.createReadStream(cifpTxt);
    const cifpLines = readline.createInterface({ input: cifpStream, crlfDelay: Infinity });

    for await (const line of cifpLines) {
        const sec = line[4];

        // EA = Enroute Waypoint
        if (sec === 'E' && line[5] === 'A') {
            const ident = line.substring(13, 18).trim().toUpperCase();
            const region = line.substring(19, 21).trim();
            const lat = parseArincLat(line.substring(32, 41));
            const lon = parseArincLon(line.substring(41, 51));
            const name = line.substring(98, 123).trim() || ident;

            if (ident && lat !== null && lon !== null) {
                const fixObj = {
                    id: `FIX_${ident}_${region}_${waypoints.length}`,
                    ident,
                    name,
                    type: 'WAYPOINT',
                    latitude: lat,
                    longitude: lon,
                    region_code: region,
                    usage_type: 'ENROUTE'
                };
                waypoints.push(fixObj);
                if (!waypointsByIdent[ident]) waypointsByIdent[ident] = [];
                waypointsByIdent[ident].push(fixObj);
            }
        }
        // PC = Terminal Waypoint (Section P, subsection C)
        else if (sec === 'P' && line[12] === 'C') {
            const aptIcao = line.substring(6, 10).trim().toUpperCase();
            const ident = line.substring(13, 18).trim().toUpperCase();
            const region = line.substring(19, 21).trim();
            const lat = parseArincLat(line.substring(32, 41));
            const lon = parseArincLon(line.substring(41, 51));
            const name = line.substring(98, 123).trim() || ident;

            if (ident && lat !== null && lon !== null) {
                const fixObj = {
                    id: `TERM_${aptIcao}_${ident}_${waypoints.length}`,
                    ident,
                    name,
                    type: 'TERMINAL_WAYPOINT',
                    latitude: lat,
                    longitude: lon,
                    associated_airport_icao: aptIcao,
                    region_code: region,
                    usage_type: 'TERMINAL'
                };
                waypoints.push(fixObj);
                if (!waypointsByIdent[ident]) waypointsByIdent[ident] = [];
                // Avoid duplicating exact coordinate for same ident
                const exists = waypointsByIdent[ident].some(w => Math.abs(w.latitude - lat) < 0.0001 && Math.abs(w.longitude - lon) < 0.0001);
                if (!exists) {
                    waypointsByIdent[ident].push(fixObj);
                }
            }
        }
        // PD = SID (Departure Procedure)
        else if (sec === 'P' && line[12] === 'D') {
            const aptIcao = line.substring(6, 10).trim().toUpperCase();
            const procName = line.substring(13, 19).trim().toUpperCase();
            const fixIdent = line.substring(29, 34).trim().toUpperCase();

            if (procName && fixIdent) {
                // Key with airport prefix
                const aptKey = `${aptIcao}_${procName}`;
                if (!sids[aptKey]) sids[aptKey] = [];
                if (!sids[aptKey].includes(fixIdent)) sids[aptKey].push(fixIdent);

                // Generic procName key
                if (!sids[procName]) sids[procName] = [];
                if (!sids[procName].includes(fixIdent)) sids[procName].push(fixIdent);
            }
        }
        // PE = STAR (Arrival Procedure)
        else if (sec === 'P' && line[12] === 'E') {
            const aptIcao = line.substring(6, 10).trim().toUpperCase();
            const procName = line.substring(13, 19).trim().toUpperCase();
            const fixIdent = line.substring(29, 34).trim().toUpperCase();

            if (procName && fixIdent) {
                // Key with airport prefix
                const aptKey = `${aptIcao}_${procName}`;
                if (!stars[aptKey]) stars[aptKey] = [];
                if (!stars[aptKey].includes(fixIdent)) stars[aptKey].push(fixIdent);

                // Generic procName key
                if (!stars[procName]) stars[procName] = [];
                if (!stars[procName].includes(fixIdent)) stars[procName].push(fixIdent);
            }
        }
        // ER = Enroute Airway
        else if (sec === 'E' && line[5] === 'R') {
            const routeIdent = line.substring(13, 19).trim().toUpperCase();
            const seq = parseInt(line.substring(25, 29), 10) || 0;
            const fixIdent = line.substring(29, 34).trim().toUpperCase();

            if (routeIdent && fixIdent) {
                if (!airways[routeIdent]) airways[routeIdent] = [];
                airways[routeIdent].push({ seq, fixIdent });
            }
        }
    }

    // Sort airway legs by sequence
    for (const route of Object.keys(airways)) {
        airways[route].sort((a, b) => a.seq - b.seq);
    }

    console.log(`  ✅ Processed ${waypoints.length.toLocaleString()} Total Waypoints & Terminal Fixes.`);
    console.log(`  ✅ Processed ${Object.keys(sids).length.toLocaleString()} SID Departure Procedures.`);
    console.log(`  ✅ Processed ${Object.keys(stars).length.toLocaleString()} STAR Arrival Procedures.`);
    console.log(`  ✅ Processed ${Object.keys(airways).length.toLocaleString()} Airways.`);

    // 6. Write Compiled JSON Files
    console.log('💾 Writing compiled JSON datasets to data/...');
    fs.writeFileSync(path.join(DATA_DIR, 'navaids.json'), JSON.stringify(navaids, null, 2), 'utf8');
    fs.writeFileSync(path.join(DATA_DIR, 'navaids-by-ident.json'), JSON.stringify(navaidsByIdent), 'utf8');
    fs.writeFileSync(path.join(DATA_DIR, 'waypoints.json'), JSON.stringify(waypoints), 'utf8');
    fs.writeFileSync(path.join(DATA_DIR, 'waypoints-by-ident.json'), JSON.stringify(waypointsByIdent), 'utf8');
    fs.writeFileSync(path.join(DATA_DIR, 'sids.json'), JSON.stringify(sids, null, 2), 'utf8');
    fs.writeFileSync(path.join(DATA_DIR, 'stars.json'), JSON.stringify(stars, null, 2), 'utf8');
    fs.writeFileSync(path.join(DATA_DIR, 'airways.json'), JSON.stringify(airways, null, 2), 'utf8');
    fs.writeFileSync(path.join(DATA_DIR, 'airports.json'), JSON.stringify(airports), 'utf8');

    // Copy script into src/ingestion/
    const srcDir = path.join(PROJECT_DIR, 'src', 'ingestion');
    if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
    fs.copyFileSync(__filename, path.join(srcDir, 'ingest-global-nav.js'));

    console.log('✨ Master Aeronautical Ingestion Completed!');
}

runMasterIngestion().catch(err => {
    console.error('❌ Master Ingestion Failed:', err);
    process.exit(1);
});
