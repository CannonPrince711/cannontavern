#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  DND Tavern release for Linux: builds the AppImage and .deb and publishes
#  them to GitHub Releases, so AppImage copies can update themselves.
#
#  Usage:  ./release.sh [version] [--dry]
#    version   e.g. 0.2.1 (asked for when left out; Enter keeps the current one)
#    --dry     build everything but don't publish
#
#  For one release with both Windows and Linux builds, run release.bat on
#  Windows and this script (on Linux or in WSL) for the same version, within
#  two hours of each other: both upload to the same GitHub release.
#
#  The GitHub token comes from GH_TOKEN, else the GitHub CLI's login
#  ("gh auth login"), else a hidden prompt. It is never saved.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

fail() {
  echo
  echo " Release failed${1:+: $1}"
  exit 1
}

command -v node >/dev/null || fail "Node.js was not found. Install Node.js 22 or newer."
command -v npm >/dev/null || fail "npm was not found. Install Node.js 22 or newer."
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm ci || fail
fi

DRY=""
NEWVER=""
for arg in "$@"; do
  if [ "$arg" = "--dry" ]; then DRY=1; else NEWVER="$arg"; fi
done

CURVER=$(node -p "require('./package.json').version")
echo
echo " DND Tavern release (Linux)"
echo " Current version: $CURVER"
[ -n "$DRY" ] && echo " Dry run: nothing will be published."
echo

if [ -z "$NEWVER" ]; then read -r -p "New version (Enter keeps $CURVER): " NEWVER || true; fi
BUMPED=""
if [ -n "$NEWVER" ] && [ "$NEWVER" != "$CURVER" ]; then
  npm version "$NEWVER" --no-git-tag-version >/dev/null || fail "\"$NEWVER\" is not a valid version, e.g. 0.2.1"
  BUMPED=1
fi
VERSION=$(node -p "require('./package.json').version")

if [ -z "$DRY" ]; then
  # GitHub token: GH_TOKEN, else the GitHub CLI, else ask (input hidden).
  if [ -z "${GH_TOKEN:-}" ] && command -v gh >/dev/null; then GH_TOKEN=$(gh auth token 2>/dev/null || true); fi
  if [ -z "${GH_TOKEN:-}" ]; then
    read -r -s -p "GitHub token (needs repo access): " GH_TOKEN || true
    echo
  fi
  [ -n "${GH_TOKEN:-}" ] || fail "No GitHub token, so nothing can be published."
  export GH_TOKEN
  echo "Publishing DND Tavern v$VERSION (Linux) to GitHub Releases..."
  echo
  npm run release:linux || fail
else
  npm run dist:linux || fail
fi

echo
if [ -n "$DRY" ]; then
  echo " Built v$VERSION in the dist folder. Nothing was published."
else
  echo " Published v$VERSION:"
  echo "   https://github.com/CannonPrince711/cannontavern/releases"
  echo
  echo " AppImage copies find it with Settings > General > Updates > Check now."
  echo " The repository is private: make its releases public, or updates can't download."
fi

if [ -n "$BUMPED" ] && [ -z "$DRY" ]; then
  echo
  read -r -p "Commit and push the version bump to v$VERSION? [y/N] " yn || true
  case "$yn" in
    [Yy]*) git add package.json package-lock.json && git commit -m "Release v$VERSION" && git push ;;
  esac
fi
