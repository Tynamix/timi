#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <IOKit/IOMessage.h>
#import <IOKit/pwr_mgt/IOPMLib.h>
#import <QuartzCore/QuartzCore.h>
#import <ServiceManagement/ServiceManagement.h>
#import <UserNotifications/UserNotifications.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#include <math.h>
#include <stdatomic.h>
#include <stdint.h>

// Only event kind and an opaque goal receipt key cross this boundary. Activity is
// obtained from macOS without recording key presses, applications, or window titles.
typedef void (*TimiEventCallback)(int event, const char *identifier);
enum {
    TimiPresence = 1,
    TimiShutdown = 2,
    TimiNotificationAccepted = 3,
    TimiNotificationFailed = 4,
    TimiNotificationClicked = 5,
};

static TimiEventCallback eventCallback;
static atomic_bool screenLocked;
static atomic_bool sessionInactive;
static atomic_bool sleeping;
static atomic_bool activityInitialized;
static atomic_bool terminationAllowed;
static bool terminationInProgress;
static io_connect_t powerConnection;
static IONotificationPortRef powerPort;
static io_object_t powerNotifier;

static void emitEvent(int event, NSString *identifier) {
    if (eventCallback) eventCallback(event, identifier ? identifier.UTF8String : NULL);
}

static void emitOnMain(int event, NSString *identifier) {
    if (NSThread.isMainThread) emitEvent(event, identifier);
    else dispatch_async(dispatch_get_main_queue(), ^{ emitEvent(event, identifier); });
}

static void requestShutdown(void) {
    if (terminationInProgress || atomic_load(&terminationAllowed)) return;
    // NSAlert runs a nested event loop. A second OS quit request while its retry
    // dialog is open must neither re-enter the Rust mutex nor show another alert.
    terminationInProgress = true;
    emitEvent(TimiShutdown, nil);
    terminationInProgress = false;
}

static NSApplicationTerminateReply shouldTerminate(id delegate, SEL selector, NSApplication *application) {
    requestShutdown();
    return atomic_load(&terminationAllowed) ? NSTerminateNow : NSTerminateCancel;
}

static bool installTerminationGuard(void) {
    id<NSApplicationDelegate> delegate = NSApp.delegate;
    if (!delegate) return false;
    Class delegateClass = object_getClass(delegate);
    SEL selector = @selector(applicationShouldTerminate:);
    // Tao currently does not implement this method. Keep every other delegate
    // method intact and fail safely rather than replacing a future handler.
    if (class_getInstanceMethod(delegateClass, selector)) return false;
    struct objc_method_description description = protocol_getMethodDescription(
        @protocol(NSApplicationDelegate), selector, NO, YES);
    if (!description.types || !class_addMethod(delegateClass, selector, (IMP)shouldTerminate, description.types)) return false;
    // AppKit caches which optional delegate methods exist when assigned.
    NSApp.delegate = nil;
    NSApp.delegate = delegate;
    return true;
}

void timi_platform_allow_termination(void) {
    // Called only after the tracking engine has durably completed quit().
    atomic_store(&terminationAllowed, true);
}

static void setPresence(atomic_bool *flag, bool value) {
    if (atomic_exchange(flag, value) != value) emitEvent(TimiPresence, nil);
}

int timi_platform_is_packaged(void) {
    NSBundle *bundle = NSBundle.mainBundle;
    return [bundle.bundleURL.pathExtension.lowercaseString isEqualToString:@"app"]
        && bundle.bundleIdentifier.length > 0;
}

static bool initializeActivity(void) {
    if (atomic_load(&activityInitialized)) return true;
    CFDictionaryRef session = CGSessionCopyCurrentDictionary();
    if (!session) return false;
    NSDictionary *values = CFBridgingRelease(session);
    atomic_store(&screenLocked, [values[@"CGSSessionScreenIsLocked"] boolValue]);
    NSNumber *onConsole = values[(__bridge NSString *)kCGSessionOnConsoleKey];
    atomic_store(&sessionInactive, onConsole && !onConsole.boolValue);
    atomic_store(&activityInitialized, true);
    return true;
}

int timi_platform_activity(uint64_t *idleMilliseconds, int *locked, int *isSleeping) {
    // A temporarily unavailable WindowServer session must remain retryable.
    if (!initializeActivity()) return 0;
    // Core Graphics provides fractional seconds; keep elapsed milliseconds instead
    // of rounding every sample down to the Electron API's whole-second resolution.
    double milliseconds = CGEventSourceSecondsSinceLastEventType(
        kCGEventSourceStateCombinedSessionState, kCGAnyInputEventType) * 1000.0;
    if (!isfinite(milliseconds) || milliseconds < 0 || milliseconds > 9007199254740991.0) return 0;
    *idleMilliseconds = (uint64_t)floor(milliseconds);
    *locked = atomic_load(&screenLocked) || atomic_load(&sessionInactive);
    *isSleeping = atomic_load(&sleeping);
    return 1;
}

int timi_platform_locale_is_german(void) {
    NSString *language = NSLocale.preferredLanguages.firstObject;
    return [language.lowercaseString hasPrefix:@"de"];
}

@interface TimiPlatformObserver : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation TimiPlatformObserver
- (void)screenDidLock:(NSNotification *)notification {
    setPresence(&screenLocked, true);
}
- (void)screenDidUnlock:(NSNotification *)notification {
    setPresence(&screenLocked, false);
}
- (void)sessionDidResign:(NSNotification *)notification {
    setPresence(&sessionInactive, true);
}
- (void)sessionDidActivate:(NSNotification *)notification {
    setPresence(&sessionInactive, false);
}
- (void)willSleep:(NSNotification *)notification {
    setPresence(&sleeping, true);
}
- (void)didWake:(NSNotification *)notification {
    setPresence(&sleeping, false);
}
- (void)willPowerOff:(NSNotification *)notification {
    requestShutdown();
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
      willPresentNotification:(UNNotification *)notification
        withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler {
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList
                      | UNNotificationPresentationOptionSound);
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
        withCompletionHandler:(void (^)(void))completionHandler {
    if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
        emitOnMain(TimiNotificationClicked, response.notification.request.identifier);
    }
    completionHandler();
}
@end

static TimiPlatformObserver *observer;

static void powerChanged(void *context, io_service_t service, natural_t message, void *argument) {
    switch (message) {
        case kIOMessageCanSystemSleep:
            IOAllowPowerChange(powerConnection, (long)argument);
            break;
        case kIOMessageSystemWillSleep:
            // This callback is synchronous on the main run loop. Rust must sample
            // and commit its checkpoint before returning, not enqueue that work.
            setPresence(&sleeping, true);
            IOAllowPowerChange(powerConnection, (long)argument);
            break;
        case kIOMessageSystemHasPoweredOn:
            setPresence(&sleeping, false);
            break;
        default:
            break;
    }
}

int timi_platform_install(TimiEventCallback callback) {
    if (!NSThread.isMainThread || observer || !callback) return 0;
    if (!installTerminationGuard()) return 0;
    eventCallback = callback;
    observer = [TimiPlatformObserver new];

    // Reading the session once also detects starting while the display is locked
    // or another user owns the console. Subsequent transitions arrive natively.
    initializeActivity();

    NSDistributedNotificationCenter *distributed = NSDistributedNotificationCenter.defaultCenter;
    [distributed addObserver:observer selector:@selector(screenDidLock:)
                        name:@"com.apple.screenIsLocked" object:nil
          suspensionBehavior:NSNotificationSuspensionBehaviorDeliverImmediately];
    [distributed addObserver:observer selector:@selector(screenDidUnlock:)
                        name:@"com.apple.screenIsUnlocked" object:nil
          suspensionBehavior:NSNotificationSuspensionBehaviorDeliverImmediately];

    NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
    [workspace addObserver:observer selector:@selector(sessionDidResign:)
                      name:NSWorkspaceSessionDidResignActiveNotification object:nil];
    [workspace addObserver:observer selector:@selector(sessionDidActivate:)
                      name:NSWorkspaceSessionDidBecomeActiveNotification object:nil];
    [workspace addObserver:observer selector:@selector(willPowerOff:)
                      name:NSWorkspaceWillPowerOffNotification object:nil];

    powerConnection = IORegisterForSystemPower(NULL, &powerPort, powerChanged, &powerNotifier);
    if (powerConnection && powerPort) {
        CFRunLoopAddSource(CFRunLoopGetMain(), IONotificationPortGetRunLoopSource(powerPort),
                           kCFRunLoopCommonModes);
    } else {
        // NSWorkspace still covers sleep when power-management registration is
        // unavailable. The normal IOKit path waits for the durable checkpoint.
        [workspace addObserver:observer selector:@selector(willSleep:)
                          name:NSWorkspaceWillSleepNotification object:nil];
        [workspace addObserver:observer selector:@selector(didWake:)
                          name:NSWorkspaceDidWakeNotification object:nil];
    }

    if (timi_platform_is_packaged()) {
        UNUserNotificationCenter.currentNotificationCenter.delegate = observer;
    }
    return 1;
}

int timi_platform_login_status(void) {
    if (!timi_platform_is_packaged()) return 3;
    switch (SMAppService.mainAppService.status) {
        case SMAppServiceStatusNotRegistered: return 0;
        case SMAppServiceStatusEnabled: return 1;
        case SMAppServiceStatusRequiresApproval: return 2;
        case SMAppServiceStatusNotFound: return 3;
    }
    return 3;
}

int timi_platform_set_login(int enabled) {
    if (!timi_platform_is_packaged()) return 0;
    int status = timi_platform_login_status();
    if ((enabled && status == 1) || (!enabled && (status == 0 || status == 3))) return 1;
    NSError *error = nil;
    BOOL success = enabled ? [SMAppService.mainAppService registerAndReturnError:&error]
                           : [SMAppService.mainAppService unregisterAndReturnError:&error];
    return success && !error && ((timi_platform_login_status() == 1) == (enabled != 0));
}

static void addNotification(UNUserNotificationCenter *center, NSString *identifier,
                            NSString *title, NSString *body) {
    UNMutableNotificationContent *content = [UNMutableNotificationContent new];
    content.title = title;
    content.body = body;
    content.sound = UNNotificationSound.defaultSound;
    UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:identifier
                                                                        content:content trigger:nil];
    [center addNotificationRequest:request withCompletionHandler:^(NSError *error) {
        // A receipt is created only after the OS accepted an authorized request.
        // Merely entering this method, asking permission, or queueing it is not a receipt.
        emitOnMain(error ? TimiNotificationFailed : TimiNotificationAccepted, identifier);
    }];
}

int timi_platform_notify(const char *rawIdentifier, const char *rawTitle, const char *rawBody) {
    if (!timi_platform_is_packaged() || !observer || !rawIdentifier || !rawTitle || !rawBody) return 0;
    NSString *identifier = [NSString stringWithUTF8String:rawIdentifier];
    NSString *title = [NSString stringWithUTF8String:rawTitle];
    NSString *body = [NSString stringWithUTF8String:rawBody];
    if (!identifier.length || !title || !body) return 0;
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
        if (settings.authorizationStatus == UNAuthorizationStatusNotDetermined) {
            [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionSound
                                  completionHandler:^(BOOL granted, NSError *error) {
                if (granted && !error) addNotification(center, identifier, title, body);
                else emitOnMain(TimiNotificationFailed, identifier);
            }];
        } else if ((settings.authorizationStatus == UNAuthorizationStatusAuthorized
                    || settings.authorizationStatus == UNAuthorizationStatusProvisional)
                   && settings.alertSetting == UNNotificationSettingEnabled) {
            addNotification(center, identifier, title, body);
        } else {
            emitOnMain(TimiNotificationFailed, identifier);
        }
    }];
    return 1;
}

int timi_platform_error_dialog(const char *message, const char *retryLabel, const char *cancelLabel) {
    if (!NSThread.isMainThread || !message || !retryLabel || !cancelLabel) return 0;
    NSAlert *alert = [NSAlert new];
    alert.alertStyle = NSAlertStyleCritical;
    alert.messageText = @"timi";
    alert.informativeText = [NSString stringWithUTF8String:message];
    NSButton *retry = [alert addButtonWithTitle:[NSString stringWithUTF8String:retryLabel]];
    NSButton *cancel = [alert addButtonWithTitle:[NSString stringWithUTF8String:cancelLabel]];
    // Return and Escape preserve the running application after a failed save.
    retry.keyEquivalent = @"";
    cancel.keyEquivalent = @"\033";
    alert.window.defaultButtonCell = cancel.cell;
    [NSApp activateIgnoringOtherApps:YES];
    return [alert runModal] == NSAlertFirstButtonReturn;
}

void timi_platform_startup_error(const char *message, const char *closeLabel) {
    if (!NSThread.isMainThread || !message || !closeLabel) return;
    NSAlert *alert = [NSAlert new];
    alert.alertStyle = NSAlertStyleCritical;
    alert.messageText = @"timi";
    alert.informativeText = [NSString stringWithUTF8String:message];
    [alert addButtonWithTitle:[NSString stringWithUTF8String:closeLabel]];
    [NSApp activateIgnoringOtherApps:YES];
    [alert runModal];
}

void timi_platform_configure_window(void *rawWindow, int clarification) {
    if (!NSThread.isMainThread || !rawWindow) return;
    NSWindow *window = (__bridge NSWindow *)rawWindow;
    NSWindowCollectionBehavior behavior = window.collectionBehavior;
    behavior &= ~(NSWindowCollectionBehaviorFullScreenPrimary | NSWindowCollectionBehaviorFullScreenAuxiliary
                  | NSWindowCollectionBehaviorFullScreenNone | NSWindowCollectionBehaviorFullScreenAllowsTiling);
    behavior |= NSWindowCollectionBehaviorFullScreenDisallowsTiling;
    if (clarification) {
        behavior &= ~(NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorPrimary
                      | NSWindowCollectionBehaviorAuxiliary);
        behavior |= NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorCanJoinAllApplications
                  | NSWindowCollectionBehaviorFullScreenAuxiliary;
        window.level = NSFloatingWindowLevel;
        [window standardWindowButton:NSWindowZoomButton].enabled = NO;
    } else {
        behavior |= NSWindowCollectionBehaviorFullScreenNone;
    }
    window.collectionBehavior = behavior;
    window.tabbingMode = NSWindowTabbingModeDisallowed;
    if (!(window.styleMask & NSWindowStyleMaskTitled)) {
        // Borderless Tauri windows do not receive AppKit's rounded frame.
        // Clip the entire content hierarchy, including the opaque WKWebView,
        // and let the native window shadow follow the transparent corners.
        window.opaque = NO;
        window.backgroundColor = NSColor.clearColor;
        window.hasShadow = YES;
        window.contentView.wantsLayer = YES;
        window.contentView.layer.cornerRadius = 18.0;
        window.contentView.layer.masksToBounds = YES;
        [window invalidateShadow];
    }
}

static NSPoint entryOrigin(NSRect anchor, NSRect area, NSSize size) {
    // AppKit uses points with a bottom-left origin on every display, regardless
    // of Retina scaling or how displays are arranged around the primary screen.
    CGFloat x = NSMidX(anchor) - size.width / 2.0;
    CGFloat y = NSMinY(anchor) - 6.0 - size.height;
    return NSMakePoint(round(MAX(NSMinX(area), MIN(x, MAX(NSMinX(area), NSMaxX(area) - size.width)))),
                       round(MAX(NSMinY(area), MIN(y, MAX(NSMinY(area), NSMaxY(area) - size.height)))));
}

void timi_platform_position_entry(void *rawWindow, void *rawStatusItem) {
    if (!NSThread.isMainThread || !rawWindow || !rawStatusItem) return;
    NSWindow *window = (__bridge NSWindow *)rawWindow;
    NSStatusItem *item = (__bridge NSStatusItem *)rawStatusItem;
    NSStatusBarButton *button = item.button;
    NSWindow *anchorWindow = button.window;
    NSScreen *screen = anchorWindow.screen;
    if (!button || !anchorWindow || !screen) return;
    NSRect anchor = [anchorWindow convertRectToScreen:[button convertRect:button.bounds toView:nil]];
    [window setFrameOrigin:entryOrigin(anchor, screen.visibleFrame, window.frame.size)];
}

void timi_platform_set_tray_font(void *rawStatusItem) {
    if (!NSThread.isMainThread || !rawStatusItem) return;
    NSStatusItem *item = (__bridge NSStatusItem *)rawStatusItem;
    item.button.font = [NSFont monospacedDigitSystemFontOfSize:NSFont.systemFontSize weight:NSFontWeightRegular];
}

void timi_platform_show_inactive(void *rawWindow) {
    if (!NSThread.isMainThread || !rawWindow) return;
    NSWindow *window = (__bridge NSWindow *)rawWindow;
    [window orderFrontRegardless];
}

static WKContentRuleList *networkRules;
static NSHashTable<WKWebView *> *pendingWebviews;
static bool compilingNetworkRules;

static NSString *networkRuleSource(void) {
    // WebKit's regex subset rejects alternation, so keep protocols in separate rules.
    return @"[{\"trigger\":{\"url-filter\":\"^https?://\"},\"action\":{\"type\":\"block\"}},"
            "{\"trigger\":{\"url-filter\":\"^wss?://\"},\"action\":{\"type\":\"block\"}},"
            "{\"trigger\":{\"url-filter\":\"^ftp://\"},\"action\":{\"type\":\"block\"}}]";
}

void timi_platform_harden_webview(void *rawWebview) {
    if (!NSThread.isMainThread || !rawWebview) return;
    WKWebView *webview = (__bridge WKWebView *)rawWebview;
    webview.allowsLinkPreview = NO;
    webview.configuration.preferences.javaScriptCanOpenWindowsAutomatically = NO;
    // There are no remote pages to check. Disable WebKit's remote fraud lookup.
    webview.configuration.preferences.fraudulentWebsiteWarningEnabled = NO;
    if (networkRules) {
        [webview.configuration.userContentController addContentRuleList:networkRules];
        return;
    }
    if (!pendingWebviews) pendingWebviews = NSHashTable.weakObjectsHashTable;
    [pendingWebviews addObject:webview];
    if (compilingNetworkRules) return;
    compilingNetworkRules = true;
    // The bundled document's strict CSP and Rust navigation/permission handlers
    // protect the first load. These native rules are an additional network block;
    // asynchronous compilation must never be treated as the initial boundary.
    [WKContentRuleListStore.defaultStore compileContentRuleListForIdentifier:@"timi-offline-v1"
                                                   encodedContentRuleList:networkRuleSource()
                                                        completionHandler:^(WKContentRuleList *list, NSError *error) {
        compilingNetworkRules = false;
        if (!list || error) return;
        networkRules = list;
        for (WKWebView *pending in pendingWebviews) {
            [pending.configuration.userContentController addContentRuleList:list];
        }
        [pendingWebviews removeAllObjects];
    }];
}
