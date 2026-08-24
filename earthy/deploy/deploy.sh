#!/usr/bin/env bash
# One-shot deploy of @earthy/api to Cloud Run from a local checkout.
#
#   PROJECT_ID=my-proj ./deploy/deploy.sh
#
# Builds with Cloud Build (so the image lands in Artifact Registry without a
# local Docker daemon), then updates the service image in place. Env vars and
# secret bindings are NOT touched here — those live in deploy/service.yaml and
# are applied once with `gcloud run services replace`, so a routine code
# deploy cannot silently drop a variable.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-earthy-api}"
REPO="${REPO:-earthy}"

# The build context is the earthy/ workspace root: the Dockerfile needs the
# lockfile and packages/db, both of which live above apps/api.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"
# Tagging by commit rather than :latest makes a rollback a matter of pointing
# at the previous tag instead of rebuilding.
TAG="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo manual)"

echo "Building ${IMAGE}:${TAG}"
gcloud builds submit "$ROOT" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --config="$ROOT/deploy/cloudbuild.yaml" \
  --substitutions="_IMAGE=${IMAGE},_TAG=${TAG},_SERVICE=${SERVICE},_REGION=${REGION}"

echo
gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" --region="$REGION" \
  --format='value(status.url)'
