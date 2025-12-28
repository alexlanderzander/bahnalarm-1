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

  // Schedule an alarm
  @objc
  func scheduleAlarm(_ alarmId: String, timestamp: Double, title: String, subtitle: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *) {
      Task {
        do {
          let alarmDate = Date(timeIntervalSince1970: timestamp / 1000)

          // Create alarm presentation
          let stopButton = AlarmButton(
            text: LocalizedStringResource(stringLiteral: "Stop"),
            textColor: .white,
            systemImageName: "stop.fill"
          )

          let snoozeButton = AlarmButton(
            text: LocalizedStringResource(stringLiteral: "Snooze"),
            textColor: .white,
            systemImageName: "zzz"
          )

          let alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: title),
            stopButton: stopButton,
            actionButton: snoozeButton
          )

          let presentation = AlarmPresentation(
            primaryLabel: LocalizedStringResource(stringLiteral: title),
            secondaryLabel: LocalizedStringResource(stringLiteral: subtitle),
            alert: alert
          )

          let alarm = Alarm(
            schedule: .fixed(Alarm.Schedule.Fixed(for: alarmDate)),
            presentation: presentation
          )

          let attributes = AlarmAttributes(
            tintColor: .blue,
            userInfo: ["id": alarmId]
          )

          try await AlarmManager.shared.schedule(id: alarmId, configuration: .alarm(alarm, attributes: attributes))

          print("[AlarmKitBridge] Alarm scheduled successfully: \(alarmId) at \(alarmDate)")
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
          try await AlarmManager.shared.cancel(id: alarmId)
          print("[AlarmKitBridge] Alarm cancelled: \(alarmId)")
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
