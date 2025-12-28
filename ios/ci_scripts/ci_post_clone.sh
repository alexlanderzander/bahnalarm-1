#!/bin/sh

# ci_post_clone.sh
# This script runs after Xcode Cloud clones the repository
# It installs Node.js, npm dependencies, and CocoaPods

set -e

echo "📦 Installing Node.js..."
brew install node

echo "📦 Installing npm dependencies..."
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm install

echo "📦 Installing CocoaPods dependencies..."
cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
pod install

echo "✅ CI setup complete!"
