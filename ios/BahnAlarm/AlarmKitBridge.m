//
//  AlarmKitBridge.m
//  BahnAlarm
//
//  Objective-C bridge to expose Swift AlarmKitBridge to React Native
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AlarmKitBridge, NSObject)

RCT_EXTERN_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestAuthorization:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(scheduleAlarm:(NSString *)alarmId timestamp:(double)timestamp title:(NSString *)title subtitle:(NSString *)subtitle resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cancelAlarm:(NSString *)alarmId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

@end
