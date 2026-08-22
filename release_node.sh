#!/bin/bash
set -ex
PROJ=$1
VERSION=$2
cd $PROJ

sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" nodejs/package.json

TMP=$(mktemp)
echo "## [$VERSION] - $(date +%Y-%m-%d)" > $TMP
echo "- Added docs/KNOWN_ISSUES.md for multi-site known limits and tradeoffs." >> $TMP
echo "" >> $TMP
cat CHANGELOG.md >> $TMP
mv $TMP CHANGELOG.md

git checkout -b release-$VERSION
git add .
git commit -m "Release $VERSION"
git push origin release-$VERSION
gh pr create --title "Release $VERSION" --body "Bump version and add known issues doc." --head release-$VERSION --base master
