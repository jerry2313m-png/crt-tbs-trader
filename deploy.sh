#!/usr/bin/env bash
# ============================================================
# One-command deploy to GitHub Pages
# Usage:
#   chmod +x deploy.sh && ./deploy.sh
# ============================================================
set -e

REPO_NAME="crt-tbs-trader"
# Change these to your own:
GITHUB_USER="${GITHUB_USER:-}"
REPO_VISIBILITY="public"   # set to "private" if you don't want it public (Pages still works on paid plans)

echo "=========================================="
echo " CRT+TBS Trader — GitHub Pages Deploy"
echo "=========================================="

# Check prerequisites
command -v git >/dev/null 2>&1    || { echo "ERROR: git not installed"; exit 1; }
command -v gh  >/dev/null 2>&1    || {
  echo ""
  echo "GitHub CLI (gh) not found. Install it first:"
  echo "  macOS:   brew install gh"
  echo "  Linux:   https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
  echo "  Windows: winget install GitHub.cli"
  echo ""
  echo "Then run 'gh auth login' and re-run this script."
  echo ""
  echo "Alternatively you can deploy manually:"
  echo "  1. Create a new repo on GitHub named '$REPO_NAME'"
  echo "  2. Run: git remote add origin https://github.com/YOUR_USER/$REPO_NAME.git"
  echo "  3. Run: git push -u origin main"
  echo "  4. In GitHub repo → Settings → Pages → pick 'main' branch / (root) → Save"
  exit 1
}

# Authenticate if not already
if ! gh auth status >/dev/null 2>&1; then
  echo "Logging into GitHub..."
  gh auth login
fi

if [ -z "$GITHUB_USER" ]; then
  GITHUB_USER=$(gh api user --jq .login)
fi

echo ""
echo "Creating repository '$GITHUB_USER/$REPO_NAME' ($REPO_VISIBILITY)..."
gh repo create "$REPO_NAME" --$REPO_VISIBILITY --source=. --push --description "CRT+TBS Adaptive Multi-Asset Trading App (Forex, Gold, Crypto, Indices)" || {
  echo "Repo may already exist; pushing to existing remote..."
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$GITHUB_USER/$REPO_NAME.git"
  git push -u origin main
}

# Wait a moment then enable Pages
echo ""
echo "Enabling GitHub Pages on main branch..."
sleep 2
gh api -X POST "repos/$GITHUB_USER/$REPO_NAME/pages" \
  -f source.branch=main \
  -f source.path=/ \
  --silent || echo "(Pages API returned a warning — enable it manually in repo Settings → Pages if needed.)"

echo ""
echo "============================================================"
echo " Done! Your app will be live shortly at:"
echo ""
echo "   https://$GITHUB_USER.github.io/$REPO_NAME/"
echo ""
echo " First deploy can take 1-2 minutes to build."
echo "============================================================"
