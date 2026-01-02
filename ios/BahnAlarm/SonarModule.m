//
//  SonarModule.m
//  BahnAlarm
//
//  Objective-C bridge to expose Swift SonarModule to React Native
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SonarModule, NSObject)

RCT_EXTERN_METHOD(checkPermission:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestPermission:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startSonar:(double)intervalMs resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopSonar:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getLastReading:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isActive:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

@end
