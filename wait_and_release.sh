#!/bin/bash
set -e
PROJ=$1
VERSION=$2
cd $PROJ
echo "Waiting to merge PR..."
while true; do
  if gh pr merge --squash --admin; then
    echo "PR merged via admin."
    break
  fi
  sleep 5
done
git checkout master
git pull origin master
gh release create v$VERSION -t "Release $VERSION" -n "Added KNOWN_ISSUES.md"
