#!/bin/bash
set -e

EC2_HOST="13.201.79.239"
EC2_USER="ubuntu"
EC2_KEY="/Volumes/CTO/MyPropTech/keys/reffered-sapce.pem"
DEPLOY_DIR="/home/ubuntu/app/deployment"
APP_DIR="/home/ubuntu/app/WA-CRM"

echo "📦 Syncing WA-CRM source to EC2..."
ssh -i "$EC2_KEY" "$EC2_USER@$EC2_HOST" "mkdir -p $APP_DIR"
rsync -az --delete \
  --exclude=node_modules \
  --exclude=.next \
  --exclude=.open-next \
  --exclude=.git \
  --exclude=.env* \
  --exclude=.dev.vars \
  -e "ssh -i $EC2_KEY" \
  ./ "$EC2_USER@$EC2_HOST:$APP_DIR/"

echo "📦 Syncing deployment config to EC2..."
ssh -i "$EC2_KEY" "$EC2_USER@$EC2_HOST" "mkdir -p $DEPLOY_DIR/nginx"
rsync -az -e "ssh -i $EC2_KEY" \
  ../deployment/docker-compose.yml \
  "$EC2_USER@$EC2_HOST:$DEPLOY_DIR/"
rsync -az -e "ssh -i $EC2_KEY" \
  ../deployment/nginx/nginx.conf \
  "$EC2_USER@$EC2_HOST:$DEPLOY_DIR/nginx/"

echo "🔨 Building and starting WA-CRM on EC2..."
ssh -i "$EC2_KEY" "$EC2_USER@$EC2_HOST" "cd $DEPLOY_DIR && docker compose build casasindhu-wa-crm && docker compose up -d casasindhu-wa-crm && docker compose restart proxy"

echo "✅ WA-CRM deployed at https://wa.casasindhu.com"
