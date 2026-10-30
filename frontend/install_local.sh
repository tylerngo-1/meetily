#!/bin/bash
#
# Build Meetily from your main branch and install it as your daily app.
#
#   ./install_local.sh            # build, back up, install, relaunch
#   ./install_local.sh --any-branch   # allow installing from a branch other than main
#
# Steps: check git state -> build -> quit Meetily -> back up data and the current
# app -> install the new app -> tag the commit -> relaunch.
# See docs/development/local-workflow.md for the full workflow and how to roll back.

set -euo pipefail

APP_NAME="meetily"
INSTALLED_APP="/Applications/${APP_NAME}.app"
DATA_DIR="$HOME/Library/Application Support/com.meetily.ai"
BACKUP_ROOT="$HOME/Library/Application Support/meetily-backups"
KEEP_BACKUPS=5

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
BUILT_APP="$REPO_ROOT/target/release/bundle/macos/${APP_NAME}.app"

ALLOW_ANY_BRANCH=false
for arg in "$@"; do
    case $arg in
        --any-branch) ALLOW_ANY_BRANCH=true ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

if [[ "$(uname)" != "Darwin" ]]; then
    echo "❌ install_local.sh only supports macOS."
    exit 1
fi

cd "$SCRIPT_DIR"

# --- 1. Git checks -----------------------------------------------------------
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" && "$ALLOW_ANY_BRANCH" != true ]]; then
    echo "❌ You are on '$BRANCH'. Install from main, or pass --any-branch."
    exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "❌ You have uncommitted changes. Commit or stash them first,"
    echo "   so the installed app always matches a commit."
    exit 1
fi

COMMIT="$(git rev-parse --short HEAD)"
BASE_VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
BUILD_NUMBER=$(( $(git tag -l "installed/${BASE_VERSION}-local.*" | wc -l) + 1 ))
VERSION="${BASE_VERSION}-local.${BUILD_NUMBER}"

echo "📦 Building Meetily ${VERSION} from ${BRANCH} @ ${COMMIT}"
echo ""

# --- 2. Build (the installed app keeps running meanwhile) --------------------
pnpm install --frozen-lockfile
# beforeBuildCommand in tauri.conf.json builds the Next.js frontend.
pnpm tauri build --bundles app \
    --config src-tauri/tauri.local.conf.json \
    --config "{\"version\": \"${VERSION}\"}"

BUILT_VERSION="$(defaults read "$BUILT_APP/Contents/Info.plist" CFBundleShortVersionString)"
if [[ "$BUILT_VERSION" != "$VERSION" ]]; then
    echo "❌ Built app reports version '$BUILT_VERSION', expected '$VERSION'. Not installing."
    exit 1
fi

# --- 3. Quit Meetily -----------------------------------------------------------
if pgrep -f "${INSTALLED_APP}/Contents/MacOS/" > /dev/null; then
    echo ""
    echo "⚠️  Meetily is running. Make sure you are not recording."
    read -r -p "Quit Meetily and install now? [y/N] " answer
    if [[ ! "$answer" =~ ^[Yy]$ ]]; then
        echo "Cancelled. The build is at: $BUILT_APP"
        exit 1
    fi
    osascript -e "quit app \"${APP_NAME}\"" || true
    for _ in $(seq 1 20); do
        pgrep -f "${INSTALLED_APP}/Contents/MacOS/" > /dev/null || break
        sleep 0.5
    done
    if pgrep -f "${INSTALLED_APP}/Contents/MacOS/" > /dev/null; then
        echo "❌ Meetily did not quit. Quit it manually and run this script again."
        exit 1
    fi
fi

# --- 4. Back up data and the current app --------------------------------------
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
BACKUP_DIR="$BACKUP_ROOT/${TIMESTAMP}_before_${VERSION}"
mkdir -p "$BACKUP_DIR"

if [[ -d "$DATA_DIR" ]]; then
    # Models are large and re-downloadable, so they are not backed up.
    rsync -a --exclude "models/" "$DATA_DIR/" "$BACKUP_DIR/data/"
fi
if [[ -d "$INSTALLED_APP" ]]; then
    ditto "$INSTALLED_APP" "$BACKUP_DIR/${APP_NAME}.app"
fi
echo "💾 Backup saved to: $BACKUP_DIR"

# Keep only the newest backups.
BACKUPS=()
while IFS= read -r dir; do BACKUPS+=("$dir"); done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d | sort)
REMOVE_COUNT=$(( ${#BACKUPS[@]} - KEEP_BACKUPS ))
for (( i = 0; i < REMOVE_COUNT; i++ )); do
    rm -rf "${BACKUPS[$i]}"
done

# --- 5. Install ------------------------------------------------------------------
rm -rf "$INSTALLED_APP"
ditto "$BUILT_APP" "$INSTALLED_APP"

# --- 6. Tag the installed commit (local only, never pushed) ---------------------
git tag "installed/${VERSION}" "$COMMIT"

# --- 7. Relaunch -----------------------------------------------------------------
open "$INSTALLED_APP"

echo ""
echo "✅ Installed Meetily ${VERSION} (${BRANCH} @ ${COMMIT})"
echo "   Tag:    installed/${VERSION}"
echo "   Backup: $BACKUP_DIR"
echo "   If macOS asks again for microphone or screen recording permission, allow it."
