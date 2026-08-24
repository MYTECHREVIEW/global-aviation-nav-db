/**
 * STTAPI.txt Config Loader
 * Loads integration keys (FSHub Token, VATSIM CID, IVAO, AeroNav API Key) from user-created STTAPI.txt
 */

const fs = require('fs');
const path = require('path');

function parseSttApiFile(filePath) {
    if (!fs.existsSync(filePath)) return null;

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        // Check if JSON
        const trimmed = raw.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            return JSON.parse(trimmed);
        }

        // Parse key-value / INI lines
        const config = {};
        const lines = raw.split(/\r?\n/);
        for (const line of lines) {
            const cleanLine = line.trim();
            if (!cleanLine || cleanLine.startsWith('#') || cleanLine.startsWith('//') || cleanLine.startsWith(';')) {
                continue;
            }
            const eqIdx = cleanLine.indexOf('=');
            if (eqIdx !== -1) {
                const key = cleanLine.substring(0, eqIdx).trim().toUpperCase();
                let val = cleanLine.substring(eqIdx + 1).trim();
                // Strip surrounding quotes
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                config[key] = val;
            }
        }
        return config;
    } catch (err) {
        console.error(`[STTAPI] Error parsing ${filePath}:`, err.message);
        return null;
    }
}

function loadSttApiConfig(baseDir = process.cwd()) {
    const searchPaths = [
        path.join(baseDir, 'STTAPI.txt'),
        path.join(baseDir, 'sttapi.txt'),
        path.join(baseDir, 'STTAPI.TXT'),
        path.join(baseDir, '..', 'STTAPI.txt')
    ];

    for (const p of searchPaths) {
        const parsed = parseSttApiFile(p);
        if (parsed) {
            console.log(`📄 [STTAPI] Loaded integration keys from ${p}`);
            return {
                apiKey: parsed.AERONAV_API_KEY || parsed.API_KEY || parsed.AERONAV_KEY || parsed.api_key || '',
                fshubToken: parsed.FSHUB_TOKEN || parsed.FSHUB_KEY || parsed.fshub_token || '',
                vatsimCid: parsed.VATSIM_CID || parsed.vatsim_cid || '',
                ivaoToken: parsed.IVAO_TOKEN || parsed.IVAO_KEY || parsed.ivao_token || '',
                discordWebhook: parsed.DISCORD_WEBHOOK_URL || parsed.DISCORD_WEBHOOK || parsed.discord_webhook || process.env.DISCORD_WEBHOOK_URL || '',
                rawConfig: parsed,
                filePath: p
            };
        }
    }

    return {
        apiKey: '',
        fshubToken: '',
        vatsimCid: '',
        ivaoToken: '',
        discordWebhook: process.env.DISCORD_WEBHOOK_URL || '',
        rawConfig: {},
        filePath: null
    };
}

module.exports = {
    parseSttApiFile,
    loadSttApiConfig
};
