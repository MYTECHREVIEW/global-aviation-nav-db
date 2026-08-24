/**
 * Grist Database Service
 * Handles real-time API Key persistence, retrieval, and Cloudflare Access authentication.
 */

const fs = require('fs');
const path = require('path');

const GRIST_API_URL = process.env.GRIST_API_URL || 'https://grist.rolandonieves.com/api';
const GRIST_DOC_ID = process.env.GRIST_DOC_ID || 'kfUiBsQ14x6i';
const GRIST_API_KEY = process.env.GRIST_API_KEY || '3c64f358e8ff1db27b2c39c12311e9f949406d6d';

const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || '159c2ddb0b8e5cdfab93f42444469597.access';
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '43c04ba43ee2341ceb10572327ce87cff59ed50444c8c01ab943ae3b04d336b8';

function getGristHeaders() {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GRIST_API_KEY || GRIST_API_KEY}`
    };

    const cfClientId = process.env.CF_ACCESS_CLIENT_ID || CF_ACCESS_CLIENT_ID;
    const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET || CF_ACCESS_CLIENT_SECRET;

    if (cfClientId && cfClientSecret) {
        headers['CF-Access-Client-Id'] = cfClientId;
        headers['CF-Access-Client-Secret'] = cfClientSecret;
    }

    return headers;
}

/**
 * Fetch all registered API keys from the Grist database
 */
async function fetchApiKeysFromGrist() {
    const docId = process.env.GRIST_DOC_ID || GRIST_DOC_ID;
    const apiUrl = process.env.GRIST_API_URL || GRIST_API_URL;
    const url = `${apiUrl}/docs/${docId}/tables/ApiKeys/records`;

    const res = await fetch(url, {
        method: 'GET',
        headers: getGristHeaders()
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Grist API HTTP ${res.status}: ${text}`);
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.records)) {
        return [];
    }

    return data.records.map(r => {
        const f = r.fields || {};
        return {
            grist_record_id: r.id,
            id: f.key_id || `key_${r.id}`,
            name: f.name || 'API Client',
            key: f.api_key,
            status: f.status || 'active',
            created_at: f.created_at || new Date().toISOString(),
            expires_at: f.expires_at || null,
            last_used_at: f.last_used_at || null,
            request_count: Number(f.request_count) || 0,
            va_ident: f.va_ident || '',
            fshub_token: f.fshub_token || '',
            vatsim_cid: f.vatsim_cid || ''
        };
    });
}

/**
 * Save a newly generated API key into Grist
 */
async function saveApiKeyToGrist(keyObj) {
    const docId = process.env.GRIST_DOC_ID || GRIST_DOC_ID;
    const apiUrl = process.env.GRIST_API_URL || GRIST_API_URL;
    const url = `${apiUrl}/docs/${docId}/tables/ApiKeys/records`;

    const payload = {
        records: [
            {
                fields: {
                    key_id: keyObj.id,
                    name: keyObj.name || 'API Client',
                    api_key: keyObj.key,
                    status: keyObj.status || 'active',
                    created_at: keyObj.created_at || new Date().toISOString(),
                    expires_at: keyObj.expires_at || '',
                    last_used_at: keyObj.last_used_at || '',
                    request_count: keyObj.request_count || 0,
                    va_ident: keyObj.va_ident || '',
                    fshub_token: keyObj.fshub_token || '',
                    vatsim_cid: keyObj.vatsim_cid || ''
                }
            }
        ]
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: getGristHeaders(),
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to save key to Grist (HTTP ${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.records?.[0]?.id || null;
}

/**
 * Update an existing API key status or metadata in Grist
 */
async function updateApiKeyInGrist(gristRecordId, updatedFields) {
    if (!gristRecordId) return false;

    const docId = process.env.GRIST_DOC_ID || GRIST_DOC_ID;
    const apiUrl = process.env.GRIST_API_URL || GRIST_API_URL;
    const url = `${apiUrl}/docs/${docId}/tables/ApiKeys/records`;

    const payload = {
        records: [
            {
                id: gristRecordId,
                fields: updatedFields
            }
        ]
    };

    const res = await fetch(url, {
        method: 'PATCH',
        headers: getGristHeaders(),
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const text = await res.text();
        console.error(`[Grist] Failed to patch record ${gristRecordId}: ${text}`);
        return false;
    }

    return true;
}

/**
 * Batch sync usage statistics (last_used_at, request_count) to Grist
 */
async function batchSyncUsageToGrist(usageUpdates) {
    if (!Array.isArray(usageUpdates) || usageUpdates.length === 0) return;

    const docId = process.env.GRIST_DOC_ID || GRIST_DOC_ID;
    const apiUrl = process.env.GRIST_API_URL || GRIST_API_URL;
    const url = `${apiUrl}/docs/${docId}/tables/ApiKeys/records`;

    const records = usageUpdates
        .filter(u => u.grist_record_id)
        .map(u => ({
            id: u.grist_record_id,
            fields: {
                last_used_at: u.last_used_at || new Date().toISOString(),
                request_count: u.request_count || 0,
                status: u.status || 'active'
            }
        }));

    if (records.length === 0) return;

    try {
        await fetch(url, {
            method: 'PATCH',
            headers: getGristHeaders(),
            body: JSON.stringify({ records })
        });
    } catch (err) {
        console.error('[Grist] Error syncing usage stats:', err.message);
    }
}

module.exports = {
    fetchApiKeysFromGrist,
    saveApiKeyToGrist,
    updateApiKeyInGrist,
    batchSyncUsageToGrist
};
