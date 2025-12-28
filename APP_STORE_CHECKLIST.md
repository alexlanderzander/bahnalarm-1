# NeverBeLate - App Store Submission Checklist

## ✅ Code Preparation
- [x] Version updated to 1.0.0
- [x] Production logging (debug logs hidden)
- [x] Error boundaries in place
- [x] Empty states implemented
- [x] TypeScript compiles with no errors

## ✅ iOS Configuration
- [x] Bundle ID: `io.evinsta.neverbelate`
- [x] Display Name: `NeverBeLate`
- [x] Marketing Version: `1.0`
- [x] Build Number: `1`
- [x] App Icon set
- [x] Info.plist configured (permissions, background modes)
- [x] Entitlements for Push Notifications

## 📝 App Store Connect (Manual Steps)

### 1. Create App in App Store Connect
- [ ] Log in to [App Store Connect](https://appstoreconnect.apple.com)
- [ ] Create new iOS app
- [ ] Use Bundle ID: `io.evinsta.neverbelate`
- [ ] Primary Language: English
- [ ] SKU: `neverbelate-001`

### 2. App Information
- [ ] Copy content from `APP_STORE_METADATA.md`
- [ ] App Name: NeverBeLate
- [ ] Subtitle: Smart Alarm for Commuters
- [ ] Privacy Policy URL (host PRIVACY_POLICY.md)
- [ ] Categories: Utilities, Travel

### 3. Pricing & Availability
- [ ] Set price (Free or paid)
- [ ] Select countries/regions

### 4. App Privacy
- [ ] Data Types: None collected
- [ ] Third-party data sharing: No
- [ ] Analytics: No

### 5. Screenshots (Required)
You need screenshots for:
- [ ] iPhone 6.7" Display (1290 x 2796 px)
- [ ] iPhone 6.5" Display (1284 x 2778 px)
- [ ] iPhone 5.5" Display (1242 x 2208 px)

**Recommended screenshots:**
1. Dashboard with alarm time
2. Settings/commute configuration
3. Empty state ("Get started")
4. Status card with train info

### 6. Build & Upload

```bash
# 1. Clean build
cd /Users/alexander.vonhohnhorst/BahnAlarm/ios
rm -rf build DerivedData ~/Library/Developer/Xcode/DerivedData

# 2. Install pods
pod install

# 3. Open in Xcode
open BahnAlarm.xcworkspace

# 4. Set scheme to Release
# Product → Scheme → Edit Scheme → Run → Build Configuration → Release

# 5. Archive
# Product → Archive

# 6. Distribute
# Window → Organizer → Distribute App → App Store Connect
```

### 7. Submit for Review
- [ ] Version information filled
- [ ] Screenshots uploaded
- [ ] Build selected
- [ ] Review notes added:
  ```
  This app uses:
  - Background App Refresh to check for train delays
  - Notifications to wake users
  - AlarmKit (iOS 26+) for silent mode bypass
  - Network access to query public train schedule API

  The app does not require login or collect personal data.
  Test commute: Any two German train stations (e.g., "Bonn Hbf" to "Köln Hbf")
  ```
- [ ] Submit for review

## 🔧 Common Issues & Solutions

### "Missing Compliance"
Add to Info.plist if asked about encryption:
```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```
(Already uses HTTPS, but no custom encryption)

### Archive fails
- Ensure signing certificates are valid
- Check Team in Signing & Capabilities
- Run `pod install` if CocoaPods issues

### App rejected - Background modes
Be prepared to explain background fetch usage for delay checking.

---

## After Approval
- [ ] Announce on social media
- [ ] Monitor crash reports in Xcode Organizer
- [ ] Plan v1.1 features (widgets, Apple Watch, etc.)
