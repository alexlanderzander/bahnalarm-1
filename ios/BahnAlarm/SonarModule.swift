//
//  SonarModule.swift
//  BahnAlarm
//
//  Acoustic Sonar Module for spatial sensing
//  Emits 20kHz chirps and measures echo delay for distance estimation
//

import Foundation
import AVFoundation
import React
import Accelerate

@objc(SonarModule)
class SonarModule: NSObject {

  // MARK: - Constants
  private let chirpFrequency: Double = 20000.0  // 20kHz - near ultrasonic, inaudible to most adults
  private let chirpDuration: Double = 0.05      // 50ms chirp
  private let sampleRate: Double = 44100.0
  private let captureWindow: Double = 0.15       // 150ms capture window after chirp

  // MARK: - Audio Engine
  private var audioEngine: AVAudioEngine?
  private var playerNode: AVAudioPlayerNode?
  private var inputNode: AVAudioInputNode?

  // MARK: - State
  private var isRunning = false
  private var capturedSamples: [Float] = []
  private var chirpReference: [Float] = []
  private var lastReading: [String: Any] = [:]
  private var sonarTimer: Timer?

  // MARK: - React Native Setup
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }

  @objc
  static func moduleName() -> String! {
    return "SonarModule"
  }

  // MARK: - Public Methods

  /// Check if microphone permission is granted
  @objc
  func checkPermission(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
      resolve("authorized")
    case .denied:
      resolve("denied")
    case .notDetermined:
      resolve("notDetermined")
    case .restricted:
      resolve("restricted")
    @unknown default:
      resolve("unknown")
    }
  }

  /// Request microphone permission
  @objc
  func requestPermission(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    AVCaptureDevice.requestAccess(for: .audio) { granted in
      resolve(granted)
    }
  }

  /// Start the sonar system
  @objc
  func startSonar(_ intervalMs: Double, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard !isRunning else {
      reject("SONAR_ALREADY_RUNNING", "Sonar is already running", nil)
      return
    }

    do {
      try setupAudioSession()
      try setupAudioEngine()
      generateChirpReference()

      audioEngine?.prepare()
      try audioEngine?.start()

      isRunning = true

      // Start periodic chirp emission
      let interval = intervalMs / 1000.0
      DispatchQueue.main.async {
        self.sonarTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
          self?.emitChirpAndCapture()
        }
      }

      print("[SonarModule] Started with interval: \(intervalMs)ms")
      resolve(true)
    } catch {
      reject("SONAR_START_ERROR", "Failed to start sonar: \(error.localizedDescription)", error)
    }
  }

  /// Stop the sonar system
  @objc
  func stopSonar(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    sonarTimer?.invalidate()
    sonarTimer = nil

    audioEngine?.stop()
    playerNode?.stop()
    audioEngine = nil
    playerNode = nil

    isRunning = false

    print("[SonarModule] Stopped")
    resolve(true)
  }

  /// Get the latest sonar reading
  @objc
  func getLastReading(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    resolve(lastReading)
  }

  /// Check if sonar is running
  @objc
  func isActive(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    resolve(isRunning)
  }

  // MARK: - Private Methods

  private func setupAudioSession() throws {
    let session = AVAudioSession.sharedInstance()

    // Use measurement mode for minimal signal processing
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetooth])
    try session.setActive(true)

    print("[SonarModule] Audio session configured")
  }

  private func setupAudioEngine() throws {
    audioEngine = AVAudioEngine()
    playerNode = AVAudioPlayerNode()

    guard let engine = audioEngine, let player = playerNode else {
      throw NSError(domain: "SonarModule", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio engine"])
    }

    engine.attach(player)

    // Connect player to main mixer for output
    let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
    engine.connect(player, to: engine.mainMixerNode, format: format)

    // Set up input tap for microphone capture
    inputNode = engine.inputNode
    let inputFormat = inputNode!.outputFormat(forBus: 0)

    inputNode!.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, time in
      self?.processInputBuffer(buffer)
    }

    print("[SonarModule] Audio engine configured")
  }

  private func generateChirpReference() {
    let sampleCount = Int(chirpDuration * sampleRate)
    chirpReference = [Float](repeating: 0, count: sampleCount)

    for i in 0..<sampleCount {
      let t = Double(i) / sampleRate
      // Generate sine wave at chirp frequency with Hann window for smooth envelope
      let window = 0.5 * (1 - cos(2 * Double.pi * Double(i) / Double(sampleCount - 1)))
      chirpReference[i] = Float(sin(2 * Double.pi * chirpFrequency * t) * window * 0.8)
    }

    print("[SonarModule] Chirp reference generated: \(sampleCount) samples at \(chirpFrequency)Hz")
  }

  private func emitChirpAndCapture() {
    guard isRunning, let engine = audioEngine, let player = playerNode else { return }

    // Clear previous capture
    capturedSamples.removeAll()

    // Create audio buffer from chirp
    let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
    let frameCount = AVAudioFrameCount(chirpReference.count)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return }

    buffer.frameLength = frameCount
    let channelData = buffer.floatChannelData![0]
    for i in 0..<Int(frameCount) {
      channelData[i] = chirpReference[i]
    }

    // Play the chirp
    player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
    player.play()

    // After capture window, analyze echoes
    DispatchQueue.main.asyncAfter(deadline: .now() + captureWindow) { [weak self] in
      self?.analyzeEchoes()
    }
  }

  private func processInputBuffer(_ buffer: AVAudioPCMBuffer) {
    guard isRunning else { return }

    let frameLength = Int(buffer.frameLength)
    guard let channelData = buffer.floatChannelData?[0] else { return }

    // Append samples to capture buffer
    for i in 0..<frameLength {
      capturedSamples.append(channelData[i])
    }

    // Limit buffer size (keep last ~200ms of audio)
    let maxSamples = Int(sampleRate * 0.2)
    if capturedSamples.count > maxSamples {
      capturedSamples = Array(capturedSamples.suffix(maxSamples))
    }
  }

  private func analyzeEchoes() {
    guard capturedSamples.count > chirpReference.count else {
      updateReading(distance: -1, amplitude: 0, peakIndex: -1)
      return
    }

    // Cross-correlation to find echo
    let correlation = crossCorrelate(signal: capturedSamples, template: chirpReference)

    // Calculate noise floor (mean absolute correlation)
    var sumAbs: Float = 0
    for val in correlation { sumAbs += abs(val) }
    let noiseFloor = sumAbs / Float(correlation.count)

    // Find peak in correlation (skip first samples to ignore direct path)
    let skipSamples = Int(sampleRate * 0.015)  // Skip first 15ms (direct speaker->mic + near-field)
    var maxCorr: Float = 0
    var peakIndex = -1

    for i in skipSamples..<correlation.count {
      if abs(correlation[i]) > maxCorr {
        maxCorr = abs(correlation[i])
        peakIndex = i
      }
    }

    // Calculate Signal-to-Noise Ratio
    let snr = noiseFloor > 0 ? maxCorr / noiseFloor : 0

    // Normalize amplitude relative to chirp energy
    let chirpEnergy = chirpReference.reduce(0) { $0 + $1 * $1 }
    let normalizedAmplitude = chirpEnergy > 0 ? maxCorr / chirpEnergy : 0

    // THRESHOLD: Only accept if SNR is high enough (real echo stands out from noise)
    let minSNR: Float = 3.0  // Echo must be at least 3x stronger than average noise

    if snr < minSNR {
      // No valid echo - just noise
      print("[SonarModule] No echo (SNR: \(String(format: "%.2f", snr)) < \(minSNR))")
      updateReading(distance: -1, amplitude: Double(normalizedAmplitude), peakIndex: -1)
      return
    }

    // Calculate distance from delay
    let delaySamples = peakIndex - skipSamples
    let delaySeconds = Double(delaySamples) / sampleRate
    let distance = (delaySeconds * 343.0) / 2.0

    // Valid range check (0.2m to 8m)
    if distance < 0.2 || distance > 8.0 {
      print("[SonarModule] Out of range: \(String(format: "%.2f", distance))m (SNR: \(String(format: "%.1f", snr)))")
      updateReading(distance: -1, amplitude: Double(normalizedAmplitude), peakIndex: peakIndex)
      return
    }

    print("[SonarModule] VALID: \(String(format: "%.2f", distance))m, SNR: \(String(format: "%.1f", snr))")
    updateReading(distance: distance, amplitude: Double(normalizedAmplitude), peakIndex: peakIndex)
  }

  private func crossCorrelate(signal: [Float], template: [Float]) -> [Float] {
    let resultLength = signal.count - template.count + 1
    guard resultLength > 0 else { return [] }

    var result = [Float](repeating: 0, count: resultLength)

    // Use Accelerate framework for fast correlation
    for i in 0..<resultLength {
      var sum: Float = 0
      vDSP_dotpr(Array(signal[i..<(i + template.count)]), 1, template, 1, &sum, vDSP_Length(template.count))
      result[i] = sum
    }

    return result
  }

  private func updateReading(distance: Double, amplitude: Double, peakIndex: Int) {
    let timestamp = Date().timeIntervalSince1970 * 1000

    lastReading = [
      "timestamp": timestamp,
      "distance_m": distance,
      "amplitude": amplitude,
      "peakIndex": peakIndex,
      "isValid": distance > 0 && distance < 10  // Valid range: 0-10 meters
    ]

    if distance > 0 && distance < 10 {
      print("[SonarModule] Echo detected: \(String(format: "%.2f", distance))m, amplitude: \(String(format: "%.4f", amplitude))")
    }
  }
}
