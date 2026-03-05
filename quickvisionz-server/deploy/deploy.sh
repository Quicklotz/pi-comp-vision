#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/quickvisionz-server}"
SERVICE_NAME="${SERVICE_NAME:-quickvisionz-server}"

echo "=== QuickVisionz Server Deployment ==="
echo "App directory: $APP_DIR"
echo "Service name: $SERVICE_NAME"

cd "$APP_DIR"

# Detect package manager
if [ -f "pnpm-lock.yaml" ]; then
  PM="pnpm"
elif [ -f "yarn.lock" ]; then
  PM="yarn"
else
  PM="npm"
fi

echo "Using package manager: $PM"

# Install all dependencies (devDependencies needed for TypeScript build)
echo "Installing dependencies..."
$PM install

# Build TypeScript
if grep -q '"build"' package.json; then
  echo "Building..."
  $PM run build
fi

# Prune dev dependencies after build
echo "Pruning dev dependencies..."
$PM prune --omit=dev 2>/dev/null || true

# Run database migrations
if [ -f "src/db/schema.sql" ] && command -v psql &>/dev/null; then
  echo "Running database migrations..."
  psql "$DATABASE_URL" -f src/db/schema.sql 2>/dev/null || echo "Warning: Migration failed (may already exist)"
fi

# Create upload directories
mkdir -p "$APP_DIR/uploads/detections" "$APP_DIR/uploads/products" "$APP_DIR/uploads/manifests"

# Restart via PM2
if command -v pm2 &>/dev/null; then
  if pm2 describe "$SERVICE_NAME" &>/dev/null; then
    echo "Restarting $SERVICE_NAME..."
    pm2 restart "$SERVICE_NAME"
  else
    echo "Starting $SERVICE_NAME with ecosystem config..."
    pm2 start ecosystem.config.cjs
  fi
  pm2 save
  echo "PM2 status:"
  pm2 status "$SERVICE_NAME"
else
  echo "PM2 not found — starting with node..."
  node dist/index.js &
fi

echo "=== Deployment Complete ==="
