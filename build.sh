#!/usr/bin/env bash
# Both archives from the working tree, one command: bash build.sh (or npm run build).
#   release/fb-helper-<version>.zip    FB Helper, the repo's extension as it is (GitHub release)
#   release/ads-helper-<version>.zip   Ads Helper, the Chrome Web Store package; release/ads-helper/ is its exact contents (Load unpacked)
# The store build differs only in the name and the logo (Meta's brand rules and the store's impersonation policy forbid
# "FB"/"Facebook" in the name and the Facebook "f" in the icon). The version is read from fb-helper/manifest.json, the one place it is written.
# RELEASE_DIR=<folder> builds somewhere else (the tests build into a temporary folder).
set -euo pipefail
cd "$(dirname "$0")"

SRC=fb-helper
NAME="Ads Helper"
VERSION=$(python3 -c 'import json;print(json.load(open("fb-helper/manifest.json"))["version"])')
RELEASE="${RELEASE_DIR:-release}"
case "$RELEASE" in /*) ;; *) RELEASE="$PWD/$RELEASE" ;; esac
OUT="$RELEASE/ads-helper"
ZIP="$RELEASE/ads-helper-$VERSION.zip"
DEV_ZIP="$RELEASE/fb-helper-$VERSION.zip"

# Only an earlier build (or nothing) is replaced: RELEASE_DIR pointing at some other folder must not delete it.
if [ -e "$RELEASE" ] && [ ! -d "$OUT" ] && [ -n "$(ls -A "$RELEASE")" ]; then echo "refusing to replace $RELEASE: it is not an earlier build" >&2; exit 1; fi
rm -rf "$RELEASE"
mkdir -p "$OUT"

# FB Helper: the extension's files and the license, nothing else lying in fb-helper/
( cd "$SRC" && zip -qrX "$DEV_ZIP" manifest.json popup.html css js fonts images -x '*.DS_Store' ) && zip -qjX "$DEV_ZIP" LICENSE

cp -R "$SRC"/manifest.json "$SRC"/popup.html "$SRC"/css "$SRC"/js "$SRC"/fonts "$SRC"/images LICENSE "$OUT/"
find "$OUT" -name '.DS_Store' -delete

# store icons and header logo
I=chrome-web-store/icons
cp "$I"/icon_128.png "$I"/icon_48.png "$I"/toolbar_32.png "$I"/toolbar_16.png "$I"/logo.webp "$OUT/images/"

# name: manifest (name, toolbar tooltip), popup title and header (the h1), comment in popup.js
perl -pi -e 's/"name": "FB Helper"/"name": "'"$NAME"'"/; s/"default_title": "FB Helper"/"default_title": "'"$NAME"'"/' "$OUT/manifest.json"
perl -pi -e 's/<title>FB Helper<\/title>/<title>'"$NAME"'<\/title>/; s/>FB Helper<\/h1>/>'"$NAME"'<\/h1>/' "$OUT/popup.html"
perl -pi -e 's/^\/\/ FB Helper/\/\/ '"$NAME"'/ if $. == 1' "$OUT/js/popup.js"

if grep -rIn -i 'fb helper' "$OUT"; then echo "old name left in the package" >&2; exit 1; fi

( cd "$OUT" && zip -qrX "$ZIP" . -x '*.DS_Store' )
echo "built $DEV_ZIP ($(unzip -l "$DEV_ZIP" | tail -1 | awk '{print $2}') files)"
echo "built $ZIP ($(unzip -l "$ZIP" | tail -1 | awk '{print $2}') files)"
