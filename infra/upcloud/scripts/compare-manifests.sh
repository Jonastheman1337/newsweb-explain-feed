#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: compare-manifests.sh <source-manifest> <restored-manifest>" >&2
  exit 1
fi

source_manifest=$(readlink -f "$1")
restored_manifest=$(readlink -f "$2")
for manifest in "${source_manifest}" "${restored_manifest}"; do
  [[ -s ${manifest} ]] || { echo "Manifest is missing or empty: ${manifest}" >&2; exit 1; }
done

if ! diff -u "${source_manifest}" "${restored_manifest}"; then
  echo "Database integrity FAIL: row counts or latest timestamps differ." >&2
  exit 1
fi

echo "Database integrity PASS: row counts and latest timestamps match."
