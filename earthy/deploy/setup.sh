#!/usr/bin/env bash
# One-time provisioning for the earthy-api Cloud Run deployment.
#
#   PROJECT_ID=my-proj GITHUB_OWNER=me GITHUB_REPO=earthy ./deploy/setup.sh
#
# Idempotent: every step tolerates the resource already existing, so it is safe
# to re-run after changing a variable. It creates the secrets EMPTY — add the
# real values with `gcloud secrets versions add` afterwards (printed at the
# end) so no credential ever passes through this file or your shell history.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-earthy-api}"
REPO="${REPO:-earthy}"
RUNTIME_SA="${SERVICE}-run"
GITHUB_OWNER="${GITHUB_OWNER:-}"
GITHUB_REPO="${GITHUB_REPO:-}"
BRANCH="${BRANCH:-^main$}"

g() { gcloud --project="$PROJECT_ID" "$@"; }

echo "==> Enabling APIs"
g services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

echo "==> Artifact Registry"
g artifacts repositories create "$REPO" \
  --repository-format=docker --location="$REGION" \
  --description="earthy container images" 2>/dev/null || echo "    exists"

echo "==> Runtime service account"
# A dedicated identity rather than the default compute SA, which is broadly
# privileged by default. This one only ever gets secret access.
g iam service-accounts create "$RUNTIME_SA" \
  --display-name="Cloud Run runtime for $SERVICE" 2>/dev/null || echo "    exists"
SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

SECRETS=(
  earthy-database-url
  earthy-google-oauth-client-id
  earthy-google-oauth-client-secret
  earthy-gmail-token-key
)

echo "==> Secrets"
for s in "${SECRETS[@]}"; do
  g secrets create "$s" --replication-policy=automatic 2>/dev/null \
    && echo "    created $s (empty)" || echo "    exists $s"
  g secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role=roles/secretmanager.secretAccessor >/dev/null
done

echo "==> Cloud Build permissions"
PROJECT_NUMBER="$(g projects describe "$PROJECT_ID" --format='value(projectNumber)')"
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
for role in roles/run.admin roles/artifactregistry.writer; do
  g projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${CB_SA}" --role="$role" >/dev/null
done
# Needed for Cloud Build to deploy a revision that runs AS the runtime SA.
g iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="serviceAccount:${CB_SA}" \
  --role=roles/iam.serviceAccountUser >/dev/null

if [[ -n "$GITHUB_OWNER" && -n "$GITHUB_REPO" ]]; then
  echo "==> Push trigger on ${GITHUB_OWNER}/${GITHUB_REPO} ${BRANCH}"
  IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"
  # included-files scopes the trigger to this service: a commit touching only
  # apps/web should not rebuild and redeploy the API.
  g builds triggers create github \
    --name="${SERVICE}-deploy" \
    --region="$REGION" \
    --repo-owner="$GITHUB_OWNER" --repo-name="$GITHUB_REPO" \
    --branch-pattern="$BRANCH" \
    --build-config="earthy/deploy/cloudbuild.yaml" \
    --included-files="earthy/apps/api/**,earthy/packages/db/**,earthy/pnpm-lock.yaml,earthy/deploy/**" \
    --substitutions="_IMAGE=${IMAGE},_SERVICE=${SERVICE},_REGION=${REGION},_TAG=\$SHORT_SHA" \
    2>/dev/null || echo "    exists (delete and re-run to change it)"
else
  echo "==> Skipping trigger (set GITHUB_OWNER and GITHUB_REPO to create one)"
fi

cat <<NEXT

Done. Remaining manual steps:

1. Fill the secrets (values never touch this script):
$(for s in "${SECRETS[@]}"; do echo "     printf %s \"\$VALUE\" | gcloud secrets versions add $s --data-file=- --project=$PROJECT_ID"; done)

2. Edit deploy/service.yaml — set the real WEB_ORIGINS, SUPABASE_URL and the
   three OAuth URLs — then create the service:
     sed "s#^          image: IMAGE#          image: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:latest#" \\
       deploy/service.yaml > /tmp/service.yaml
     gcloud run services replace /tmp/service.yaml --region=$REGION --project=$PROJECT_ID
     gcloud run services update $SERVICE --service-account=$SA_EMAIL --region=$REGION --project=$PROJECT_ID

3. First image build:
     PROJECT_ID=$PROJECT_ID REGION=$REGION ./deploy/deploy.sh

4. Register the deployed callback URL on the Google OAuth client, character
   for character, and set GOOGLE_OAUTH_REDIRECT_URI to the same string.
NEXT
