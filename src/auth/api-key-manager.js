const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const KEYS_DIR = process.env.KEYS_DIR || path.join(DATA_DIR, 'keys');
if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });

const KEYS_FILE = path.join(KEYS_DIR, 'api-keys.json');
const LEGACY_KEYS_FILE = path.join(DATA_DIR, 'api-keys.json');

// Auto-migrate legacy keys file if present
if (fs.existsSync(LEGACY_KEYS_FILE) && !fs.existsSync(KEYS_FILE)) {
    try {
        fs.copyFileSync(LEGACY_KEYS_FILE, KEYS_FILE);
    } catch (e) {}
}

function loadKeys() {
    try {
        if (fs.existsSync(KEYS_FILE)) {
            return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading api-keys.json:', e);
    }
    return [];
}

function saveKeys(keys) {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf8');
}

// Ensure at least one master/dev key exists
function initializeKeys() {
    const keys = loadKeys();
    if (keys.length === 0) {
        const defaultMasterKey = {
            id: 'key_' + crypto.randomBytes(6).toString('hex'),
            name: 'Master Developer Key',
            key: 'aeronav_live_' + crypto.randomBytes(20).toString('hex'),
            created_at: new Date().toISOString(),
            last_used_at: null,
            request_count: 0,
            status: 'active'
        };
        keys.push(defaultMasterKey);
        saveKeys(keys);
        console.log(`🔑 Generated initial Master API Key: ${defaultMasterKey.key}`);
    }
}

function generateApiKey(name = 'API Client', expiresInDays = null) {
    const keys = loadKeys();
    const rawKey = 'aeronav_live_' + crypto.randomBytes(20).toString('hex');
    const newKey = {
        id: 'key_' + crypto.randomBytes(6).toString('hex'),
        name: name.trim(),
        key: rawKey,
        created_at: new Date().toISOString(),
        expires_at: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000).toISOString() : null,
        last_used_at: null,
        request_count: 0,
        status: 'active'
    };

    keys.push(newKey);
    saveKeys(keys);
    return newKey;
}

function revokeApiKey(idOrKey) {
    const keys = loadKeys();
    const keyObj = keys.find(k => k.id === idOrKey || k.key === idOrKey);
    if (!keyObj) return false;

    keyObj.status = 'revoked';
    keyObj.revoked_at = new Date().toISOString();
    saveKeys(keys);
    return true;
}

function validateApiKey(providedKey) {
    if (!providedKey) return null;
    const keys = loadKeys();
    const found = keys.find(k => k.key === providedKey.trim() && k.status === 'active');
    if (!found) return null;

    // Check expiration
    if (found.expires_at && new Date(found.expires_at) < new Date()) {
        found.status = 'expired';
        saveKeys(keys);
        return null;
    }

    // Update usage stats asynchronously
    found.last_used_at = new Date().toISOString();
    found.request_count = (found.request_count || 0) + 1;
    saveKeys(keys);

    return found;
}

/**
 * Express Middleware for API Key Authentication
 */
function requireApiKey(req, res, next) {
    // Check header 'X-API-Key' or query parameter '?api_key='
    const apiKey = req.headers['x-api-key'] || req.query.api_key || req.query.apiKey;

    // In local dev mode (if requested), allow direct web UI map access without key, but enforce on external API calls
    if (req.path === '/health' || req.path === '/' || req.path.startsWith('/style.css') || req.path.startsWith('/app.js')) {
        return next();
    }

    if (!apiKey) {
        // If in local development, permit request with warning or require key
        if (process.env.NODE_ENV !== 'production' && !req.headers['x-enforce-auth']) {
            return next();
        }
        return res.status(401).json({
            error: 'Unauthorized: Missing API Key. Provide key via X-API-Key header or ?api_key= query parameter.',
            docs: '/api/v1/auth/keys'
        });
    }

    const keyObj = validateApiKey(apiKey);
    if (!keyObj) {
        return res.status(403).json({
            error: 'Forbidden: Invalid or expired API Key.'
        });
    }

    req.apiKey = keyObj;
    next();
}


function isLocalOrPrivateIp(req) {
    if (process.env.PUBLIC_MODE === 'true') return false;

    const rawIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                  req.socket?.remoteAddress || 
                  req.ip || '';
    
    const ip = rawIp.replace(/^::ffff:/, '');

    // Local loopback
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;

    // Private Local Area Networks (LAN)
    if (/^10\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;

    // Optional Admin secret header
    if (process.env.ADMIN_KEY && req.headers['x-admin-key'] === process.env.ADMIN_KEY) return true;

    return false;
}

function requireLocalOrAdmin(req, res, next) {
    if (isLocalOrPrivateIp(req)) {
        return next();
    }
    return res.status(403).json({
        error: 'Forbidden: API Key management and administrative docs are restricted to local/private network access.'
    });
}

module.exports = {
    isLocalOrPrivateIp,
    requireLocalOrAdmin,
    initializeKeys,
    loadKeys,
    generateApiKey,
    revokeApiKey,
    validateApiKey,
    requireApiKey
};
