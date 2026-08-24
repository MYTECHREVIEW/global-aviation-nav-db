const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gristService = require('../services/grist-service');

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

// In-Memory Key Cache for lightning-fast sub-millisecond API request validation
let inMemoryKeys = [];
let pendingUsageUpdates = new Map();
let isSyncingWithGrist = false;

function loadLocalBackup() {
    try {
        if (fs.existsSync(KEYS_FILE)) {
            const data = fs.readFileSync(KEYS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Error loading local api-keys.json backup:', e.message);
    }
    return [];
}

function saveLocalBackup(keys) {
    try {
        fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf8');
    } catch (e) {
        console.error('Error saving local api-keys.json backup:', e.message);
    }
}

/**
 * Fetch latest API keys from Grist database and merge with local memory
 */
async function syncKeysFromGrist() {
    if (isSyncingWithGrist) return;
    isSyncingWithGrist = true;

    try {
        const gristKeys = await gristService.fetchApiKeysFromGrist();
        if (Array.isArray(gristKeys) && gristKeys.length > 0) {
            // Merge in-memory stats into grist keys if newer
            gristKeys.forEach(gk => {
                const local = inMemoryKeys.find(k => k.key === gk.key || k.id === gk.id);
                if (local && (local.request_count || 0) > (gk.request_count || 0)) {
                    gk.request_count = local.request_count;
                    gk.last_used_at = local.last_used_at || gk.last_used_at;
                }
            });

            inMemoryKeys = gristKeys;
            saveLocalBackup(inMemoryKeys);
            console.log(`🔑 [Grist] Synced ${gristKeys.length} API keys from Grist database.`);
        } else if (inMemoryKeys.length === 0) {
            inMemoryKeys = loadLocalBackup();
        }
    } catch (err) {
        console.warn(`⚠️ [Grist] Sync error (${err.message}). Using in-memory / local backup.`);
        if (inMemoryKeys.length === 0) {
            inMemoryKeys = loadLocalBackup();
        }
    } finally {
        isSyncingWithGrist = false;
    }
}

/**
 * Flush pending request counts and timestamps to Grist in background batches
 */
async function flushUsageToGrist() {
    if (pendingUsageUpdates.size === 0) return;

    const updates = Array.from(pendingUsageUpdates.values());
    pendingUsageUpdates.clear();

    try {
        await gristService.batchSyncUsageToGrist(updates);
    } catch (err) {
        console.error('[Grist] Error flushing usage updates:', err.message);
    }
}

/**
 * Initialize API key manager: Load local backup, sync Grist, start background poll & flush timers
 */
function initializeKeys() {
    // 1. Instantly load local backup so the server is immediately functional
    inMemoryKeys = loadLocalBackup();

    // 2. Perform initial async Grist synchronization
    syncKeysFromGrist().then(() => {
        // Ensure at least one master/dev key exists if database is totally empty
        if (inMemoryKeys.length === 0) {
            generateApiKey('Master Developer Key', null, { va_ident: 'ALL' });
        }
    });

    // 3. Periodic Grist background polling every 30s
    setInterval(() => {
        syncKeysFromGrist();
    }, 30000);

    // 4. Periodic usage statistics flush to Grist every 15s
    setInterval(() => {
        flushUsageToGrist();
    }, 15000);
}

function loadKeys() {
    return inMemoryKeys;
}

async function generateApiKey(name = 'API Client', expiresInDays = null, metadata = {}) {
    const rawKey = 'aeronav_live_' + crypto.randomBytes(20).toString('hex');
    const newKey = {
        id: 'key_' + crypto.randomBytes(6).toString('hex'),
        name: name.trim(),
        key: rawKey,
        created_at: new Date().toISOString(),
        expires_at: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000).toISOString() : null,
        last_used_at: null,
        request_count: 0,
        status: 'active',
        va_ident: metadata.va_ident || ''
    };

    inMemoryKeys.push(newKey);
    saveLocalBackup(inMemoryKeys);

    // Asynchronously save to Grist database
    try {
        const gristRecordId = await gristService.saveApiKeyToGrist(newKey);
        if (gristRecordId) {
            newKey.grist_record_id = gristRecordId;
            saveLocalBackup(inMemoryKeys);
            console.log(`✨ [Grist] API Key saved to Grist DB (Record #${gristRecordId}): ${newKey.name} (${newKey.key})`);
        }
    } catch (err) {
        console.error(`⚠️ [Grist] Failed to write key to Grist (${err.message}). Stored locally.`, err);
    }

    return newKey;
}

async function revokeApiKey(idOrKey) {
    const keyObj = inMemoryKeys.find(k => k.id === idOrKey || k.key === idOrKey);
    if (!keyObj) return false;

    keyObj.status = 'revoked';
    keyObj.revoked_at = new Date().toISOString();
    saveLocalBackup(inMemoryKeys);

    // Update status in Grist
    if (keyObj.grist_record_id) {
        gristService.updateApiKeyInGrist(keyObj.grist_record_id, { status: 'revoked' }).catch(err => {
            console.error('[Grist] Error updating revoked status in Grist:', err.message);
        });
    }

    return true;
}

function validateApiKey(providedKey) {
    if (!providedKey) return null;
    const cleanKey = providedKey.trim();

    const found = inMemoryKeys.find(k => k.key === cleanKey && k.status === 'active');
    if (!found) {
        // In case the key was added moments ago in Grist, trigger non-blocking sync
        syncKeysFromGrist().catch(() => {});
        return null;
    }

    // Check expiration
    if (found.expires_at && new Date(found.expires_at) < new Date()) {
        found.status = 'expired';
        saveLocalBackup(inMemoryKeys);
        if (found.grist_record_id) {
            gristService.updateApiKeyInGrist(found.grist_record_id, { status: 'expired' }).catch(() => {});
        }
        return null;
    }

    // Update usage stats in memory
    found.last_used_at = new Date().toISOString();
    found.request_count = (found.request_count || 0) + 1;

    // Queue for batch sync to Grist
    pendingUsageUpdates.set(found.key, {
        grist_record_id: found.grist_record_id,
        key: found.key,
        last_used_at: found.last_used_at,
        request_count: found.request_count,
        status: found.status
    });

    return found;
}

/**
 * Express Middleware for API Key Authentication
 */
function requireApiKey(req, res, next) {
    // Check header 'X-API-Key' or query parameter '?api_key='
    const apiKey = req.headers['x-api-key'] || req.query.api_key || req.query.apiKey;

    // Static assets and public health endpoint do not require keys
    if (req.path === '/health' || req.path === '/' || req.path.startsWith('/style.css') || req.path.startsWith('/app.js') || req.path.startsWith('/embed')) {
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
    syncKeysFromGrist,
    loadKeys,
    generateApiKey,
    revokeApiKey,
    validateApiKey,
    requireApiKey
};
