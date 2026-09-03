const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '../../');
const LOG_FILE = path.join(REPO_ROOT, 'data', 'git-push-log.json');

class GitSyncService {
    constructor() {
        this.syncDebounceTimer = null;
    }

    /**
     * Automatically stage repaired waypoint data files to Git
     * @param {Array} fixesRepaired - List of repaired waypoint objects
     */
    async stageWaypointFixes(fixesRepaired = []) {
        if (!Array.isArray(fixesRepaired) || fixesRepaired.length === 0) {
            return { staged: false, reason: 'No fixes to stage' };
        }

        const idents = fixesRepaired.map(f => f.ident || f.name).filter(Boolean);
        const filesToStage = [
            'data/custom-global-waypoints.json',
            'data/custom-global-airways.json',
            'data/dynamic-global-fixes.json',
            'data/airports.json'
        ];

        return new Promise((resolve) => {
            const cmd = `git add ${filesToStage.join(' ')}`;
            exec(cmd, { cwd: REPO_ROOT }, (err, stdout, stderr) => {
                if (err) {
                    console.warn(`[GitSync] Warning: Could not stage files (${err.message})`);
                    return resolve({
                        staged: false,
                        error: err.message,
                        files: filesToStage
                    });
                }

                console.log(`[GitSync] 📦 Staged waypoint fixes [${idents.join(', ')}] in Git index.`);
                resolve({
                    staged: true,
                    files: filesToStage,
                    idents: idents,
                    message: `Staged ${idents.length} waypoint fix(es) for Git sync.`
                });
            });
        });
    }

    /**
     * Automatically commit and push waypoint fixes with persistent push audit logging
     */
    async commitAndPushFixes(fixesRepaired = [], customMessage = null) {
        const idents = fixesRepaired.map(f => f.ident || f.name).filter(Boolean);
        const commitMsg = customMessage || `fix(navdata): auto-calibrate waypoints [${idents.join(', ')}] via Analyze & Auto-Fix`;
        const files = [
            'data/custom-global-waypoints.json',
            'data/custom-global-airways.json',
            'data/dynamic-global-fixes.json',
            'data/airports.json'
        ];

        return new Promise((resolve) => {
            const cmd = `git add ${files.join(' ')} && git commit -m "${commitMsg.replace(/"/g, '\\"')}" && git push origin main`;
            const opts = {
                cwd: REPO_ROOT,
                timeout: 30000, // 30s max — prevents hanging git push from freezing the server
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } // Never prompt for credentials
            };
            exec(cmd, opts, (err, stdout, stderr) => {
                const timestamp = new Date().toISOString();
                const logEntry = {
                    timestamp,
                    commit_message: commitMsg,
                    fixes: fixesRepaired,
                    idents: idents,
                    status: err ? 'ERROR' : 'PUSHED',
                    output: stdout || stderr || null,
                    error: err ? err.message : null
                };

                this._recordLog(logEntry);

                if (err) {
                    console.warn(`[GitSync] Push failed: ${err.message}`);
                    return resolve({ success: false, error: err.message, logEntry });
                }

                console.log(`[GitSync] 🚀 Pushed commit "${commitMsg}" to origin/main`);
                resolve({ success: true, stdout, logEntry });
            });
        });
    }


    /**
     * Retrieve chronological Git commit and push history
     */
    async getGitLog(limit = 25) {
        return new Promise((resolve) => {
            const cmd = `git log --pretty=format:'{"sha":"%h","author":"%an","date":"%ad","relative":"%ar","message":"%s"}' --date=iso-local -n ${limit}`;
            exec(cmd, { cwd: REPO_ROOT }, (err, stdout) => {
                let gitCommits = [];
                if (!err && stdout) {
                    try {
                        const lines = stdout.trim().split('\n').filter(Boolean);
                        gitCommits = lines.map(l => {
                            try { return JSON.parse(l); } catch (e) { return null; }
                        }).filter(Boolean);
                    } catch (e) {}
                }

                let auditLogs = [];
                if (fs.existsSync(LOG_FILE)) {
                    try {
                        auditLogs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
                    } catch (e) {}
                }

                resolve({
                    success: true,
                    total_commits: gitCommits.length,
                    recent_commits: gitCommits,
                    push_audit_log: auditLogs.slice(-limit).reverse()
                });
            });
        });
    }

    _recordLog(entry) {
        try {
            let logs = [];
            if (fs.existsSync(LOG_FILE)) {
                logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
            }
            logs.push(entry);
            if (logs.length > 500) logs = logs.slice(-500);
            fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
        } catch (e) {
            console.warn('[GitSync] Could not write push log:', e.message);
        }
    }
}

module.exports = new GitSyncService();
