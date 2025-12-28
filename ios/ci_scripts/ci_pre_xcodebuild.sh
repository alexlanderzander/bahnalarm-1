#!/bin/sh

# ci_pre_xcodebuild.sh
# This script runs before xcodebuild starts
# Sets up environment for React Native bundling in Xcode Cloud

set -e

echo "🔧 Setting up React Native environment..."

# Set NODE_BINARY for React Native scripts
export NODE_BINARY=$(which node)
echo "Node binary: $NODE_BINARY"

# Ensure node_modules exists
if [ ! -d "$CI_PRIMARY_REPOSITORY_PATH/node_modules" ]; then
    echo "❌ node_modules not found! Running npm install..."
    cd "$CI_PRIMARY_REPOSITORY_PATH"
    npm install
fi

# Ensure Pods are installed
if [ ! -d "$CI_PRIMARY_REPOSITORY_PATH/ios/Pods" ]; then
    echo "❌ Pods not found! Running pod install..."
    cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
    pod install
fi

echo "✅ Pre-xcodebuild setup complete!"
