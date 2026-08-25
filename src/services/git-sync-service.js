const { exec } = require('child_process');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../../');

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
            'data/dynamic-global-fixes.json'
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
}

module.exports = new GitSyncService();
