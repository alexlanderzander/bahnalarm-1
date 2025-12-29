# React Native iOS App Template

A production-ready React Native template with:
- ✅ Dark theme UI
- ✅ Xcode Cloud CI/CD
- ✅ Background fetch & notifications
- ✅ Type-safe storage
- ✅ Error boundaries
- ✅ Tab navigation

---

## Quick Start

### 1. Clone and rename

```bash
# Clone this template
git clone <this-repo> my-new-app
cd my-new-app

# Remove git history
rm -rf .git
git init
```

### 2. Update identifiers

Search and replace across the project:

| Find | Replace With |
|------|--------------|
| `BahnAlarm` | `YourAppName` |
| `io.evinsta.neverbelate` | `com.yourcompany.yourapp` |
| `NeverBeLate` | `Your App Name` |

Files to update:
- `package.json` (name, version)
- `app.json` (name, displayName)
- `ios/BahnAlarm.xcodeproj` (rename folder)
- `ios/BahnAlarm/Info.plist` (bundle ID)

### 3. Install dependencies

```bash
npm install
cd ios && pod install && cd ..
```

### 4. Run

```bash
npm start
# In another terminal:
npm run ios
```

---

## Project Structure

```
src/
├── api/
│   └── ApiService.ts       # TODO: Add your API endpoints
├── components/
│   ├── EmptyState.tsx      # Reusable empty state
│   └── ErrorBoundary.tsx   # Crash protection
├── screens/
│   ├── HomeScreen.tsx      # TODO: Your main screen
│   └── SettingsScreen.tsx  # TODO: Your settings
├── services/
│   ├── BackgroundService.ts # Background fetch & notifications
│   └── StorageService.ts    # AsyncStorage wrapper
├── types/
│   └── index.ts            # TODO: Your data types
└── utils/
    ├── colors.ts           # Theme colors
    └── logger.ts           # Production-safe logging
```

---

## TODO Checklist

Search for `TODO:` comments in the code to find customization points.

### Required Changes
- [ ] Update bundle ID and app name
- [ ] Define your data types in `src/types/index.ts`
- [ ] Add your API endpoints in `src/api/ApiService.ts`
- [ ] Customize `HomeScreen.tsx` with your content
- [ ] Update storage keys in `StorageService.ts`

### Optional
- [ ] Modify color theme in `colors.ts`
- [ ] Add more screens to navigation
- [ ] Configure background task logic
- [ ] Set up push notifications

---

## CI/CD (Xcode Cloud)

CI scripts are pre-configured in `ios/ci_scripts/`:
- `ci_post_clone.sh` - Installs Node, npm, CocoaPods
- `ci_pre_xcodebuild.sh` - Verifies environment
- `ci_post_xcodebuild.sh` - Post-build tasks

Just push to `main` and Xcode Cloud builds automatically!

---

## App Store Checklist

See `APP_STORE_CHECKLIST.md` and `APP_STORE_METADATA.md` for release guidance.
