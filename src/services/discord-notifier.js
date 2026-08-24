const fs = require('fs');
const path = require('path');
const https = require('https');
const { loadSttApiConfig } = require('../config/stt-config');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const REPORTS_FILE = path.join(DATA_DIR, 'route-reports.json');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getStoredReports() {
    try {
        if (fs.existsSync(REPORTS_FILE)) {
            return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[DiscordNotifier] Error reading reports file:', e);
    }
    return [];
}

function saveReportLocally(report) {
    try {
        const reports = getStoredReports();
        reports.unshift(report);
        // Keep last 500 reports
        if (reports.length > 500) reports.length = 500;
        fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2), 'utf8');
    } catch (e) {
        console.error('[DiscordNotifier] Error persisting report locally:', e);
    }
}

/**
 * Send Discord Notification for a Route Issue
 */
async function sendRouteIssueReport(reportData) {
    const config = loadSttApiConfig();
    const webhookUrl = config.discordWebhook || process.env.DISCORD_WEBHOOK_URL || null;

    const submittedDate = new Date();
    const formattedDate = submittedDate.toUTCString();

    const reportId = `REP-${Date.now().toString(36).toUpperCase()}`;
    const reportRecord = {
        id: reportId,
        pilot: reportData.pilot_name || reportData.pilot || 'Unknown Pilot',
        callsign: reportData.callsign || 'N/A',
        network: reportData.network || reportData.airline || 'Sim Flight',
        route: reportData.route || 'DIRECT / UNFILED',
        departure: reportData.departure || '???',
        arrival: reportData.arrival || '???',
        aircraft: reportData.aircraft || 'N/A',
        altitude_ft: reportData.altitude_ft || null,
        groundspeed_kts: reportData.groundspeed_kts || null,
        submitted_at: submittedDate.toISOString(),
        submitted_at_formatted: formattedDate,
        delivered_to_discord: false
    };

    if (!webhookUrl) {
        console.log(`[DiscordNotifier] Route issue logged (${reportId}) for pilot ${reportRecord.pilot}. (No DISCORD_WEBHOOK_URL set in STTAPI.txt)`);
        saveReportLocally(reportRecord);
        return {
            success: true,
            delivered_to_discord: false,
            message: 'Report saved to local database! Add DISCORD_WEBHOOK_URL to STTAPI.txt to send live Discord notifications.',
            report: reportRecord
        };
    }

    // Build rich Discord Embed
    const discordPayload = {
        username: 'AeroNav Route Monitor',
        avatar_url: 'https://g.fshubcdn.com/avatars/va_5169_icon.png',
        embeds: [
            {
                title: '🚩 Waypoint / Route Issue Reported',
                description: `A pilot has flagged a flight plan route for review or waypoint fixing:`,
                color: 16734296, // Vibrant Amber/Red #ff5758
                fields: [
                    {
                        name: '👤 Pilot',
                        value: `**${reportRecord.pilot}** (${reportRecord.callsign})`,
                        inline: true
                    },
                    {
                        name: '🏢 Airline / Network',
                        value: `${reportRecord.network}`,
                        inline: true
                    },
                    {
                        name: '📅 Date Submitted',
                        value: `${formattedDate}`,
                        inline: true
                    },
                    {
                        name: '🛫 Corridor',
                        value: `**${reportRecord.departure}** ➔ **${reportRecord.arrival}**`,
                        inline: true
                    },
                    {
                        name: '✈️ Aircraft',
                        value: `${reportRecord.aircraft}`,
                        inline: true
                    },
                    {
                        name: '🆔 Report ID',
                        value: `\`${reportId}\``,
                        inline: true
                    },
                    {
                        name: '🗺️ Flight Plan Route String',
                        value: `\`\`\`\n${reportRecord.route}\n\`\`\``,
                        inline: false
                    }
                ],
                footer: {
                    text: 'AeroNav Global Navigation DB • Use Route Debugger to auto-fix'
                },
                timestamp: submittedDate.toISOString()
            }
        ]
    };

    return new Promise((resolve) => {
        try {
            const urlObj = new URL(webhookUrl);
            const dataString = JSON.stringify(discordPayload);

            const options = {
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(dataString)
                }
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    const isSuccess = res.statusCode >= 200 && res.statusCode < 300;
                    reportRecord.delivered_to_discord = isSuccess;
                    saveReportLocally(reportRecord);

                    if (isSuccess) {
                        console.log(`[DiscordNotifier] ✅ Successfully dispatched Discord notification for report ${reportId}`);
                        resolve({
                            success: true,
                            delivered_to_discord: true,
                            message: 'Discord notification dispatched successfully!',
                            report: reportRecord
                        });
                    } else {
                        console.warn(`[DiscordNotifier] Discord webhook returned status ${res.statusCode}:`, body);
                        resolve({
                            success: true,
                            delivered_to_discord: false,
                            message: `Discord webhook returned HTTP ${res.statusCode}`,
                            report: reportRecord
                        });
                    }
                });
            });

            req.on('error', (err) => {
                console.error('[DiscordNotifier] Failed to deliver Discord webhook:', err.message);
                reportRecord.delivered_to_discord = false;
                saveReportLocally(reportRecord);
                resolve({
                    success: true,
                    delivered_to_discord: false,
                    message: `Webhook connection error: ${err.message}`,
                    report: reportRecord
                });
            });

            req.write(dataString);
            req.end();
        } catch (err) {
            console.error('[DiscordNotifier] Unexpected error dispatching webhook:', err.message);
            reportRecord.delivered_to_discord = false;
            saveReportLocally(reportRecord);
            resolve({
                success: true,
                delivered_to_discord: false,
                message: err.message,
                report: reportRecord
            });
        }
    });
}

module.exports = {
    sendRouteIssueReport,
    getStoredReports
};
