# App Store Release Workflow

> Reusable workflow for publishing React Native iOS apps to App Store

## Pre-Release Checklist

### 1. Code Ready
```bash
# Ensure TypeScript compiles
npx tsc --noEmit

# Run tests
npm test

# Update version in package.json
npm version patch  # or minor/major
```

### 2. Update Xcode Version
```bash
# In Xcode: General → Identity → Version and Build
# Or via agvtool:
cd ios && agvtool new-marketing-version 1.0.1
cd ios && agvtool new-version -all 2
```

### 3. Local Release Build Test
```bash
cd ios
xcodebuild -workspace *.xcworkspace -scheme BahnAlarm \
  -configuration Release -destination 'generic/platform=iOS' build
```

### 4. Commit and Push
```bash
git add .
git commit -m "Release v1.0.1"
git push origin main
```

---

## Xcode Cloud Auto-Build

The CI scripts handle everything automatically:

| Script | Purpose |
|--------|---------|
| `ci_post_clone.sh` | Installs Node, npm deps, CocoaPods |
| `ci_pre_xcodebuild.sh` | Verifies environment |
| `ci_post_xcodebuild.sh` | Optional cleanup |

### To Add TestFlight Distribution:
1. Open Xcode → Product → Xcode Cloud → Manage Workflows
2. Edit workflow → Add Post-Action
3. Select "TestFlight (Internal Testing)" or "App Store Connect"

---

## App Store Connect Checklist

// turbo-all
### Required Fields:
- [ ] App Name & Subtitle
- [ ] Promotional Text (170 chars)
- [ ] Description
- [ ] Keywords (100 chars)
- [ ] Screenshots (1284×2778px or 1242×2688px)
- [ ] Primary Category
- [ ] Age Rating (fill questionnaire)
- [ ] Support URL
- [ ] Privacy Policy URL
- [ ] App Privacy (data collection declaration)

### Review Notes Template:
```
This app uses:
- Background App Refresh to check for train delays
- Notifications to wake users
- AlarmKit (iOS 17+) for silent mode bypass
- Network access to query public train schedule API

The app does not require login or collect personal data.
```

---

## Screenshot Resizing Command
```bash
# Resize to 6.5" display (1284×2778)
mkdir screenshots_resized
for img in *.PNG; do
  sips -z 2778 1284 "$img" --out "screenshots_resized/$img"
done
```

---

## Common CI Issues & Fixes

| Issue | Fix |
|-------|-----|
| `nvm: command not found` | Remove NVM from scheme pre-actions |
| `.xcode.env.local` path error | Add to `.gitignore` |
| `node: command not found` | Check `.xcode.env` fallback paths |
| Exit code 65 | Build error - check Xcode logs |
| Exit code 75 | Run script failed - check bundle script |
