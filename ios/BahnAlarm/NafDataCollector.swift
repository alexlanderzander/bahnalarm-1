//
//  NafDataCollector.swift
//  BahnAlarm
//
//  Collects training data for Neural Acoustic Fields (NAF)
//  Captures STFT spectrograms, device orientation, and position
//

import Foundation
import AVFoundation
import React
import Accelerate
import CoreMotion
import CoreLocation

@objc(NafDataCollector)
class NafDataCollector: NSObject, CLLocationManagerDelegate {

  // MARK: - Constants
  private let sampleRate: Double = 44100.0
  private let fftSize: Int = 512           // ~12ms window at 44.1kHz
  private let hopSize: Int = 256           // 50% overlap
  private let chirpFrequency: Double = 20000.0
  private let chirpDuration: Double = 0.05   // 50ms
  private let captureWindow: Double = 0.2    // 200ms capture

  // MARK: - FFT Setup
  private var fftSetup: vDSP_DFT_Setup?
  private var window: [Float] = []

  // MARK: - Audio
  private var audioEngine: AVAudioEngine?
  private var playerNode: AVAudioPlayerNode?
  private var capturedSamples: [Float] = []
  private var chirpReference: [Float] = []
  private var isCapturing = false

  // MARK: - Motion
  private let motionManager = CMMotionManager()
  private let altimeter = CMAltimeter()
  private var currentOrientation: (theta: Double, phi: Double) = (0, 0)
  private var relativeAltitude: Double = 0.0  // Barometric altitude change in meters
  private var referenceAltitudeSet = false

  // MARK: - Location
  private let locationManager = CLLocationManager()
  private var currentPosition: (x: Double, y: Double, z: Double) = (0, 0, 0)
  private var referenceLocation: CLLocation?

  // MARK: - Data Collection
  private var collectedSamples: [[String: Any]] = []
  private var isCollecting = false

  // MARK: - Live STFT for Streaming
  private var lastSTFTMagnitude: [[Float]] = []
  private var lastSTFTTimestamp: Double = 0

  // MARK: - React Native Setup
  @objc static func requiresMainQueueSetup() -> Bool { true }
  @objc static func moduleName() -> String! { "NafDataCollector" }

  override init() {
    super.init()
    setupFFT()
    setupMotion()
    setupAltimeter()
    setupLocation()
  }

  deinit {
    if let setup = fftSetup {
      vDSP_DFT_DestroySetup(setup)
    }
    altimeter.stopRelativeAltitudeUpdates()
  }

  // MARK: - Setup

  private func setupFFT() {
    // Create DFT setup for STFT
    fftSetup = vDSP_DFT_zop_CreateSetup(
      nil,
      vDSP_Length(fftSize),
      vDSP_DFT_Direction.FORWARD
    )

    // Create Hann window
    window = [Float](repeating: 0, count: fftSize)
    vDSP_hann_window(&window, vDSP_Length(fftSize), Int32(vDSP_HANN_NORM))

    print("[NafDataCollector] FFT setup complete: \(fftSize) bins")
  }

  private func setupMotion() {
    guard motionManager.isDeviceMotionAvailable else {
      print("[NafDataCollector] Device motion not available")
      return
    }

    motionManager.deviceMotionUpdateInterval = 0.05  // 20Hz
    motionManager.startDeviceMotionUpdates(to: .main) { [weak self] motion, error in
      guard let motion = motion else { return }

      // Extract orientation (yaw = azimuth, pitch = elevation)
      self?.currentOrientation = (
        theta: motion.attitude.yaw,
        phi: motion.attitude.pitch
      )
    }

    print("[NafDataCollector] CoreMotion started")
  }

  private func setupAltimeter() {
    guard CMAltimeter.isRelativeAltitudeAvailable() else {
      print("[NafDataCollector] Barometer not available")
      return
    }

    altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, error in
      guard let data = data else { return }

      // relativeAltitude is the change in meters since we started updates
      self?.relativeAltitude = data.relativeAltitude.doubleValue

      if !(self?.referenceAltitudeSet ?? false) {
        self?.referenceAltitudeSet = true
        print("[NafDataCollector] Barometer started, reference altitude set")
      }
    }

    print("[NafDataCollector] Altimeter setup initiated")
  }

  private func setupLocation() {
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.requestWhenInUseAuthorization()
    locationManager.startUpdatingLocation()

    print("[NafDataCollector] Location manager started")
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }

    // Set reference on first reading
    if referenceLocation == nil {
      referenceLocation = location
      print("[NafDataCollector] Reference location set: \(location.coordinate)")
    }

    // Convert to local XY coordinates (meters from reference)
    if let ref = referenceLocation {
      let latDiff = location.coordinate.latitude - ref.coordinate.latitude
      let lonDiff = location.coordinate.longitude - ref.coordinate.longitude

      // Approximate meters (1 degree ≈ 111km at equator)
      let metersPerDegLat = 111320.0
      let metersPerDegLon = 111320.0 * cos(ref.coordinate.latitude * .pi / 180)

      // Use barometric altitude for Z (much more accurate than GPS altitude)
      // relativeAltitude is the change in meters since app started
      currentPosition = (
        x: lonDiff * metersPerDegLon,
        y: latDiff * metersPerDegLat,
        z: relativeAltitude  // Barometer-based height change
      )
    }
  }

  // MARK: - Public Methods

  /// Start collecting NAF training data
  @objc func startCollection(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard !isCollecting else {
      reject("ALREADY_COLLECTING", "Already collecting data", nil)
      return
    }

    do {
      try setupAudioSession()
      try setupAudioEngine()
      generateChirpReference()

      audioEngine?.prepare()
      try audioEngine?.start()

      collectedSamples.removeAll()
      isCollecting = true

      print("[NafDataCollector] Collection started")
      resolve(true)
    } catch {
      reject("START_ERROR", error.localizedDescription, error)
    }
  }

  /// Stop collecting and return collected samples
  @objc func stopCollection(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    audioEngine?.stop()
    audioEngine = nil
    isCollecting = false

    let samples = collectedSamples
    collectedSamples.removeAll()

    print("[NafDataCollector] Collection stopped: \(samples.count) samples")
    resolve(samples)
  }

  /// Capture a single training sample (chirp + echo STFT)
  @objc func captureSample(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard isCollecting, let engine = audioEngine, let player = playerNode else {
      reject("NOT_COLLECTING", "Not currently collecting", nil)
      return
    }

    // Clear capture buffer
    capturedSamples.removeAll()
    isCapturing = true

    // Play chirp
    playChirp(player: player)

    // After capture window, compute STFT and save
    DispatchQueue.main.asyncAfter(deadline: .now() + captureWindow) { [weak self] in
      guard let self = self else { return }
      self.isCapturing = false

      // Compute STFT
      let stft = self.computeSTFT(samples: self.capturedSamples)

      // Store for live streaming access
      self.lastSTFTMagnitude = stft.magnitude
      self.lastSTFTTimestamp = Date().timeIntervalSince1970 * 1000

      // Create sample
      let sample: [String: Any] = [
        "timestamp": Date().timeIntervalSince1970 * 1000,
        "listener_pos": [self.currentPosition.x, self.currentPosition.y, self.currentPosition.z],
        "emitter_pos": [self.currentPosition.x, self.currentPosition.y, self.currentPosition.z],  // Same for phone
        "orientation": [self.currentOrientation.theta, self.currentOrientation.phi],
        "channel": 0,  // Mono
        "stft_mag": stft.magnitude,
        "stft_phase": stft.phase,
        "num_time_bins": stft.timeBins,
        "num_freq_bins": stft.freqBins
      ]

      self.collectedSamples.append(sample)

      print("[NafDataCollector] Sample captured: \(stft.timeBins)x\(stft.freqBins) STFT, pos=(\(String(format: "%.2f", self.currentPosition.x)), \(String(format: "%.2f", self.currentPosition.y)))")

      resolve(sample)
    }
  }

  /// Get current sensor state
  @objc func getSensorState(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    resolve([
      "position": [currentPosition.x, currentPosition.y, currentPosition.z],
      "orientation": [currentOrientation.theta, currentOrientation.phi],
      "isCollecting": isCollecting,
      "samplesCollected": collectedSamples.count
    ])
  }

  /// Get the most recent STFT magnitude for live streaming
  @objc func getLastSTFT(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    // If no recent STFT or too old (>1 second), return null
    let now = Date().timeIntervalSince1970 * 1000
    if lastSTFTMagnitude.isEmpty || (now - lastSTFTTimestamp) > 1000 {
      resolve(nil)
      return
    }

    // Flatten the 2D magnitude array for transmission
    // Also downsample to reduce bandwidth: take every 2nd time bin and every 4th freq bin
    var flatMagnitude: [Float] = []
    for (frameIdx, frame) in lastSTFTMagnitude.enumerated() {
      if frameIdx % 2 == 0 {  // Every 2nd time bin
        for (binIdx, value) in frame.enumerated() {
          if binIdx % 4 == 0 {  // Every 4th freq bin
            flatMagnitude.append(value)
          }
        }
      }
    }

    resolve([
      "magnitude": flatMagnitude,
      "timeBins": lastSTFTMagnitude.count / 2,
      "freqBins": (lastSTFTMagnitude.first?.count ?? 0) / 4,
      "timestamp": lastSTFTTimestamp
    ])
  }

  // MARK: - STFT Computation

  private func computeSTFT(samples: [Float]) -> (magnitude: [[Float]], phase: [[Float]], timeBins: Int, freqBins: Int) {
    guard samples.count >= fftSize else {
      return ([], [], 0, fftSize / 2)
    }

    let numFrames = (samples.count - fftSize) / hopSize + 1
    let freqBins = fftSize / 2  // Only positive frequencies

    var magnitudeFrames: [[Float]] = []
    var phaseFrames: [[Float]] = []

    // Allocate FFT buffers
    var realInput = [Float](repeating: 0, count: fftSize)
    var imagInput = [Float](repeating: 0, count: fftSize)
    var realOutput = [Float](repeating: 0, count: fftSize)
    var imagOutput = [Float](repeating: 0, count: fftSize)

    for frame in 0..<numFrames {
      let startIdx = frame * hopSize

      // Apply window
      for i in 0..<fftSize {
        if startIdx + i < samples.count {
          realInput[i] = samples[startIdx + i] * window[i]
        } else {
          realInput[i] = 0
        }
        imagInput[i] = 0
      }

      // Compute DFT
      vDSP_DFT_Execute(fftSetup!, &realInput, &imagInput, &realOutput, &imagOutput)

      // Compute magnitude and phase for positive frequencies
      var frameMag = [Float](repeating: 0, count: freqBins)
      var framePhase = [Float](repeating: 0, count: freqBins)

      for k in 0..<freqBins {
        let re = realOutput[k]
        let im = imagOutput[k]

        // Magnitude in dB (log scale for NAF)
        let mag = sqrt(re * re + im * im)
        frameMag[k] = log(max(mag, 1e-10))

        // Phase (instantaneous frequency approximation)
        framePhase[k] = atan2(im, re)
      }

      magnitudeFrames.append(frameMag)
      phaseFrames.append(framePhase)
    }

    return (magnitudeFrames, phaseFrames, numFrames, freqBins)
  }

  // MARK: - Audio Helpers

  private func setupAudioSession() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker])
    try session.setActive(true)
  }

  private func setupAudioEngine() throws {
    audioEngine = AVAudioEngine()
    playerNode = AVAudioPlayerNode()

    guard let engine = audioEngine, let player = playerNode else {
      throw NSError(domain: "NafDataCollector", code: 1, userInfo: nil)
    }

    engine.attach(player)

    let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
    engine.connect(player, to: engine.mainMixerNode, format: format)

    // Input tap for recording
    let inputFormat = engine.inputNode.outputFormat(forBus: 0)
    engine.inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
      guard let self = self, self.isCapturing else { return }

      let frameLength = Int(buffer.frameLength)
      guard let channelData = buffer.floatChannelData?[0] else { return }

      for i in 0..<frameLength {
        self.capturedSamples.append(channelData[i])
      }
    }
  }

  private func generateChirpReference() {
    let sampleCount = Int(chirpDuration * sampleRate)
    chirpReference = [Float](repeating: 0, count: sampleCount)

    for i in 0..<sampleCount {
      let t = Double(i) / sampleRate
      let windowVal = 0.5 * (1 - cos(2 * .pi * Double(i) / Double(sampleCount - 1)))
      chirpReference[i] = Float(sin(2 * .pi * chirpFrequency * t) * windowVal * 0.8)
    }
  }

  private func playChirp(player: AVAudioPlayerNode) {
    let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
    let frameCount = AVAudioFrameCount(chirpReference.count)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return }

    buffer.frameLength = frameCount
    let channelData = buffer.floatChannelData![0]
    for i in 0..<Int(frameCount) {
      channelData[i] = chirpReference[i]
    }

    player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
    player.play()
  }
}
