//
//  NafDataCollector.m
//  BahnAlarm
//
//  Objective-C bridge for NafDataCollector
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(NafDataCollector, NSObject)

RCT_EXTERN_METHOD(startCollection: (RCTPromiseResolveBlock)resolve
                  reject: (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopCollection: (RCTPromiseResolveBlock)resolve
                  reject: (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(captureSample: (RCTPromiseResolveBlock)resolve
                  reject: (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getSensorState: (RCTPromiseResolveBlock)resolve
                  reject: (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getLastSTFT: (RCTPromiseResolveBlock)resolve
                  reject: (RCTPromiseRejectBlock)reject)

@end
