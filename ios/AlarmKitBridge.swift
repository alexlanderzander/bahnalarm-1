import Foundation
import React
import SwiftUI

#if canImport(AlarmKit)
import AlarmKit
#endif

@objc(AlarmKitBridge)
class AlarmKitBridge: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }

  @objc
  static func moduleName() -> String! {
    return "AlarmKitBridge"
  }

  // Check if AlarmKit is available (iOS 26+)
  @objc
  func isAvailable(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 26.0, *) {
      resolve(true)
    } else {
      resolve(false)
    }
  }

  // Request AlarmKit authorization
  @objc
  func requestAuthorization(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *) {
      Task {
        do {
          let state = try await AlarmManager.shared.requestAuthorization()
          resolve(state == .authorized)
        } catch {
          reject("ALARMKIT_ERROR", "Failed to request authorization: \(error.localizedDescription)", error)
        }
      }
    } else {
      reject("ALARMKIT_UNAVAILABLE", "AlarmKit requires iOS 26.0 or later", nil)
    }
    #else
    reject("ALARMKIT_NOT_IMPORTED", "AlarmKit framework not available", nil)
    #endif
  }

  // Schedule an alarm - using correct API from documentation
  @objc
  func scheduleAlarm(_ alarmId: String, timestamp: Double, title: String, subtitle: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *) {
      Task {
        do {
          let alarmDate = Date(timeIntervalSince1970: timestamp / 1000)
          let alarmUUID = UUID(uuidString: alarmId) ?? UUID()

          // Calculate duration from now until alarm time
          let duration = alarmDate.timeIntervalSinceNow

          guard duration > 0 else {
            reject("ALARMKIT_INVALID_TIME", "Alarm time must be in the future", nil)
            return
          }

          // Step 1: Create AlarmButton for stop action
          let stopButton = AlarmButton(
            text: LocalizedStringResource(stringLiteral: "Stop"),
            textColor: .white,
            systemImageName: "stop.fill"
          )

          // Step 2: Create AlarmPresentation.Alert with title and stop button
          let alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: title),
            stopButton: stopButton
          )

          // Step 3: Create AlarmPresentation with just the alert
          let presentation = AlarmPresentation(alert: alert)

          // Step 4: Create AlarmAttributes with presentation and tintColor
          // Using NeverBeLateMetadata as the generic type
          let attributes = AlarmAttributes<NeverBeLateMetadata>(
            presentation: presentation,
            tintColor: .blue
          )

          // Step 5: Create countdown duration (preAlert = time until alarm, postAlert = 5 min snooze)
          let countdownDuration = Alarm.CountdownDuration(preAlert: duration, postAlert: 5 * 60)

          // Step 6: Create AlarmConfiguration with countdownDuration and attributes
          // Note: AlarmConfiguration is under AlarmManager namespace
          let configuration = AlarmManager.AlarmConfiguration(
            countdownDuration: countdownDuration,
            attributes: attributes
          )

          // Step 7: Schedule the alarm
          try await AlarmManager.shared.schedule(id: alarmUUID, configuration: configuration)

          print("[AlarmKitBridge] Alarm scheduled successfully: \(alarmUUID) at \(alarmDate)")
          resolve(true)
        } catch {
          print("[AlarmKitBridge] Error scheduling alarm: \(error)")
          reject("ALARMKIT_SCHEDULE_ERROR", "Failed to schedule alarm: \(error.localizedDescription)", error)
        }
      }
    } else {
      reject("ALARMKIT_UNAVAILABLE", "AlarmKit requires iOS 26.0 or later", nil)
    }
    #else
    reject("ALARMKIT_NOT_IMPORTED", "AlarmKit framework not available", nil)
    #endif
  }

  // Cancel an alarm
  @objc
  func cancelAlarm(_ alarmId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *) {
      Task {
        do {
          let alarmUUID = UUID(uuidString: alarmId) ?? UUID()
          try await AlarmManager.shared.cancel(id: alarmUUID)
          print("[AlarmKitBridge] Alarm cancelled: \(alarmUUID)")
          resolve(true)
        } catch {
          print("[AlarmKitBridge] Error cancelling alarm: \(error)")
          reject("ALARMKIT_CANCEL_ERROR", "Failed to cancel alarm: \(error.localizedDescription)", error)
        }
      }
    } else {
      reject("ALARMKIT_UNAVAILABLE", "AlarmKit requires iOS 26.0 or later", nil)
    }
    #else
    reject("ALARMKIT_NOT_IMPORTED", "AlarmKit framework not available", nil)
    #endif
  }
}

// MARK: - AlarmMetadata for NeverBeLate app
#if canImport(AlarmKit)
@available(iOS 26.0, *)
struct NeverBeLateMetadata: AlarmMetadata {
  // Empty metadata - we don't need custom Live Activity data for now
}
#endif
