const https = require('https');

function fetchSimbriefOfp(identifier) {
    return new Promise((resolve, reject) => {
        if (!identifier || !identifier.trim()) {
            return reject(new Error('SimBrief username or Pilot ID is required.'));
        }

        const clean = identifier.trim();
        // If all digits, use userid=, otherwise username=
        const isNumeric = /^\d+$/.test(clean);
        const queryParam = isNumeric ? `userid=${clean}` : `username=${encodeURIComponent(clean)}`;
        const url = `https://www.simbrief.com/api/xml.fetcher.php?${queryParam}&json=1`;

        https.get(url, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);

                    if (data.status === 'error' || (data.fetch && data.fetch.status && data.fetch.status.startsWith('Error'))) {
                        const errMsg = data.error || data.fetch?.status || 'Failed to fetch SimBrief OFP.';
                        return reject(new Error(errMsg));
                    }

                    const origin = data.origin || {};
                    const dest = data.destination || {};
                    const general = data.general || {};
                    const aircraft = data.aircraft || {};
                    const alternate = data.alternate || {};

                    const depIcao = origin.icao_code || '';
                    const depRwy = origin.plan_rwy || '';
                    const arrIcao = dest.icao_code || '';
                    const arrRwy = dest.plan_rwy || '';

                    // Construct formatted route with runways if available
                    let rawRoute = general.route || '';
                    // Clean route if it has DCT or empty spaces
                    const formattedRoute = rawRoute;

                    const ofp = {
                        success: true,
                        simbrief_user: clean,
                        flight_number: `${general.icao_airline || ''}${general.flight_number || ''}`,
                        aircraft_type: aircraft.icaocode || aircraft.name || 'N/A',
                        departure_icao: depIcao,
                        departure_runway: depRwy,
                        departure_name: origin.name || depIcao,
                        arrival_icao: arrIcao,
                        arrival_runway: arrRwy,
                        arrival_name: dest.name || arrIcao,
                        alternate_icao: alternate.icao_code || null,
                        route: formattedRoute,
                        cruise_altitude_ft: parseInt(general.initial_altitude, 10) || 35000,
                        cruise_tas_kts: parseInt(general.cruise_tas, 10) || 450,
                        cost_index: general.costindex || null,
                        flight_duration_minutes: Math.round((parseInt(general.total_burn_time, 10) || 0) / 60) || null,
                        units: data.params?.units || 'LBS',
                        created_at: data.params?.time_generated ? new Date(parseInt(data.params.time_generated, 10) * 1000).toISOString() : new Date().toISOString()
                    };

                    resolve(ofp);
                } catch (e) {
                    reject(new Error('Invalid response received from SimBrief API.'));
                }
            });
        }).on('error', (err) => {
            reject(new Error(`SimBrief network error: ${err.message}`));
        });
    });
}

module.exports = { fetchSimbriefOfp };
