#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

set -a
. ./.env
set +a

version=$(jq -r .version extension/manifest.json)
echo "submitting $version to the listed channel"
npx --yes web-ext sign --channel=listed --source-dir=extension --artifacts-dir=signed \
  --amo-metadata=amo-metadata.json --approval-timeout=0
