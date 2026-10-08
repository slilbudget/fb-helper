#!/usr/bin/env bash
# Chrome Web Store build. The repo's extension (fb-helper/) stays "FB Helper" with the original logo; the store
# package is "Ads Helper" with the neutral logo (Meta's brand rules and the store's impersonation policy forbid
# "FB"/"Facebook" in the name and the Facebook "f" in the icon).
# Output (git-ignored): chrome-web-store/release/unpacked/ (the exact ZIP contents) and
# chrome-web-store/release/ads-helper-<version>.zip. RELEASE_DIR=<folder> builds somewhere else (the tests build into a temporary folder).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=fb-helper
NAME="Ads Helper"
VERSION=$(python3 -c 'import json;print(json.load(open("fb-helper/manifest.json"))["version"])')
RELEASE="${RELEASE_DIR:-chrome-web-store/release}"
case "$RELEASE" in /*) ;; *) RELEASE="$PWD/$RELEASE" ;; esac
OUT="$RELEASE/unpacked"
ZIP="$RELEASE/ads-helper-$VERSION.zip"

# Only an earlier build (or nothing) is replaced: RELEASE_DIR pointing at some other folder must not delete it.
if [ -e "$RELEASE" ] && [ ! -d "$RELEASE/unpacked" ] && [ -n "$(ls -A "$RELEASE")" ]; then echo "refusing to replace $RELEASE: it is not an earlier build" >&2; exit 1; fi
rm -rf "$RELEASE"
mkdir -p "$OUT"
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
echo "built $ZIP ($(unzip -l "$ZIP" | tail -1 | awk '{print $2}') files)"
