#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Push Local Updates Directly to GitHub for Portainer Rebuild
# ─────────────────────────────────────────────────────────────
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

COMMIT_MSG="${1:-"update: Sync latest aviation navigation database and route engine updates"}"

echo "========================================================"
echo "🚀 AeroNav Global: Pushing updates to GitHub..."
echo "📁 Directory: $REPO_DIR"
echo "📝 Commit Message: $COMMIT_MSG"
echo "========================================================"

# Check if GITHUB_TOKEN is available or use existing remote
if [ -n "$GITHUB_TOKEN" ]; then
    git remote set-url origin "https://${GITHUB_TOKEN}@github.com/MYTECHREVIEW/global-aviation-nav-db.git"
fi

git branch -M main
git add -A

if git diff-index --quiet HEAD --; then
    echo "ℹ️ No changes to commit."
else
    git commit -m "$COMMIT_MSG"
fi

echo "⬆️ Pushing to GitHub (main branch)..."
git push -u origin main

echo ""
echo "========================================================"
echo "✅ GitHub Push Successful!"
echo "🌐 Repo: https://github.com/MYTECHREVIEW/global-aviation-nav-db"
echo "========================================================"
