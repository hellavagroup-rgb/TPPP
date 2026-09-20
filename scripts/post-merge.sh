#!/bin/bash
set -e

npm install --legacy-peer-deps
npm run db:push -- --force
