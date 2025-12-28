#!/bin/sh

# ci_post_clone.sh
# This script runs after Xcode Cloud clones the repository
# It installs Node.js, npm dependencies, and CocoaPods

set -e

echo "📦 Installing Node.js via Homebrew..."
brew install node

echo "📦 Checking Node version..."
node --version
npm --version

echo "📦 Installing npm dependencies..."
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm ci --legacy-peer-deps || npm install

echo "📦 Installing CocoaPods dependencies..."
cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
pod install --repo-update

# Create .xcode.env.local with node path for React Native
echo "export NODE_BINARY=$(which node)" > "$CI_PRIMARY_REPOSITORY_PATH/ios/.xcode.env.local"

echo "✅ CI post-clone setup complete!"
echo "Node binary set to: $(which node)"
