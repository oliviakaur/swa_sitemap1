#!/usr/bin/env bash
# =============================================================================
# deploy-multi-swa-az.sh
# Deploys this exact `public/` + `api/` bundle to multiple Azure Static Web Apps
# in your Azure Subscription. Because `api/src/functions/sitemap.js` inspects
# `x-ms-original-url` and `x-forwarded-host` dynamically, the exact same bundle
# works on every SWA instance (`*.azurestaticapps.net` or custom domains) with
# zero per-site code edits!
# =============================================================================
set -euo pipefail

SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-YOUR_SUBSCRIPTION_ID}"
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-YOUR_RESOURCE_GROUP}"

# List of Azure Static Web App names in your subscription:
SWA_APPS=(
  "swa-tech-site-01"
  "swa-tech-site-02"
  "swa-tech-site-03"
)

echo "==> Installing Managed Functions dependencies in ./api"
(cd api && npm install)

echo "==> Selecting Azure Subscription: ${SUBSCRIPTION_ID}"
az account set --subscription "${SUBSCRIPTION_ID}"

for SWA_NAME in "${SWA_APPS[@]}"; do
  echo "==> Retrieving deployment token for Azure Static Web App: ${SWA_NAME}"
  DEPLOY_TOKEN="$(az staticwebapp secrets list \
    --name "${SWA_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --query "properties.apiKey" -o tsv)"

  echo "==> Deploying static frontend (./public) + Managed XML Sitemap API (./api) to ${SWA_NAME}"
  npx --yes @azure/static-web-apps-cli deploy ./public \
    --api-location ./api \
    --api-language node \
    --api-version 20 \
    --deployment-token "${DEPLOY_TOKEN}" \
    --env production
done

echo "==> All Azure Static Web Apps deployed!"
