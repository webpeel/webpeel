#!/usr/bin/env bash
# postversion.sh — Post-version hook
# Since Dockerfile.api now builds from source (COPY dist/), no version pin needed.
# Kept for future hooks.
set -e
echo "✅ Version bumped to $(node -e "console.log(require('./package.json').version)")"
