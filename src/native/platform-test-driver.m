// Compile the production implementation in this translation unit so the tests
// use its actual private rule source and asynchronous installation state. No
// alternate production code paths or test-only runtime flags are introduced.
#import "../../src-tauri/native/platform.m"
#include <stdio.h>

static void check(BOOL condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "not ok - %s\n", message);
        exit(1);
    }
}

static BOOL waitFor(BOOL (^condition)(void)) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:15];
    while (!condition() && deadline.timeIntervalSinceNow > 0) {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.02, true);
    }
    return condition();
}

static int shutdownCalls;
static BOOL approveShutdown;
static void platformEvent(int event, const char *identifier) {
    if (event != TimiShutdown) return;
    shutdownCalls += 1;
    // Simulate a second native quit arriving while Rust's modal save-error
    // dialog is open. It must return immediately rather than re-enter Rust.
    check([NSApp.delegate applicationShouldTerminate:NSApp] == NSTerminateCancel,
          "nested native termination stays cancelled");
    if (approveShutdown) timi_platform_allow_termination();
}

@interface TimiTestDelegate : NSObject <NSApplicationDelegate>
@end
@implementation TimiTestDelegate
- (BOOL)applicationSupportsSecureRestorableState:(NSApplication *)application { return YES; }
@end

static void testTerminationGuard(void) {
    TimiTestDelegate *delegate = [TimiTestDelegate new];
    NSApp.delegate = delegate;
    check(timi_platform_install(platformEvent), "native observers and termination guard install on main thread");
    check([delegate applicationSupportsSecureRestorableState:NSApp], "unrelated original delegate methods remain intact");
    check([delegate applicationShouldTerminate:NSApp] == NSTerminateCancel, "failed quit vetoes native app termination");
    check(shutdownCalls == 1, "reentrant native quit does not duplicate shutdown callbacks");
    check([delegate applicationShouldTerminate:NSApp] == NSTerminateCancel, "failed quit remains retryable");
    check(shutdownCalls == 2, "later native quit retries after a cancelled attempt");
    approveShutdown = YES;
    check([delegate applicationShouldTerminate:NSApp] == NSTerminateNow, "durable quit approval permits native termination");
    check(shutdownCalls == 3, "successful attempt invokes one shutdown callback");
    check([delegate applicationShouldTerminate:NSApp] == NSTerminateNow, "approved termination never starts another save");
    check(shutdownCalls == 3, "approved termination does not duplicate shutdown callbacks");
    // Keep the test delegate alive for the remaining process lifetime, just as
    // Tao owns its delegate for the production application's whole lifetime.
    static TimiTestDelegate *retainedDelegate;
    retainedDelegate = delegate;
    (void)retainedDelegate;
    puts("ok - native OS quit cancels failed saves, permits retry, suppresses reentry, and exits only after approval");
}

@interface TimiTestMessages : NSObject <WKScriptMessageHandler>
@property NSMutableDictionary<NSString *, NSNumber *> *results;
@end
@implementation TimiTestMessages
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
    NSDictionary *value = message.body;
    if ([value isKindOfClass:NSDictionary.class] && [value[@"name"] isKindOfClass:NSString.class]
        && [value[@"ok"] isKindOfClass:NSNumber.class]) self.results[value[@"name"]] = value[@"ok"];
}
@end

static WKWebView *testWebview(TimiTestMessages *messages) {
    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    configuration.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
    configuration.preferences.fraudulentWebsiteWarningEnabled = NO;
    [configuration.userContentController addScriptMessageHandler:messages name:@"test"];
    return [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 440, 570) configuration:configuration];
}

static void testRulesCompile(NSString *directory) {
    WKContentRuleListStore *store = [WKContentRuleListStore storeWithURL:[NSURL fileURLWithPath:directory]];
    __block BOOL completed = NO;
    __block BOOL succeeded = NO;
    [store compileContentRuleListForIdentifier:@"production-offline-rules"
                        encodedContentRuleList:networkRuleSource()
                             completionHandler:^(WKContentRuleList *list, NSError *error) {
        succeeded = list != nil && error == nil;
        completed = YES;
    }];
    check(waitFor(^{ return completed; }), "native WebKit rule compiler completed");
    check(succeeded, "actual production rules compile in WebKit's restricted regex engine");
    puts("ok - actual production offline rules compile with WKContentRuleListStore");
}

static void testEntryPosition(void) {
    NSSize size = NSMakeSize(440, 570);
    check(NSEqualPoints(entryOrigin(NSMakeRect(1000, 875, 90, 25), NSMakeRect(0, 38, 1440, 837), size),
                        NSMakePoint(825, 299)), "entry is centered beneath its menu-bar button with a six-point gap");
    check(NSEqualPoints(entryOrigin(NSMakeRect(1390, 875, 50, 25), NSMakeRect(0, 38, 1440, 837), size),
                        NSMakePoint(1000, 299)), "entry stays inside the right screen edge");
    check(NSEqualPoints(entryOrigin(NSMakeRect(-1910, 1055, 90, 25), NSMakeRect(-1920, 0, 1920, 1055), size),
                        NSMakePoint(-1920, 479)), "entry stays inside a display left of the primary screen");
    check(NSEqualPoints(entryOrigin(NSMakeRect(1000, 1775, 90, 25), NSMakeRect(0, 938, 1440, 837), size),
                        NSMakePoint(825, 1199)), "entry follows a menu bar above the primary display");
    check(NSEqualPoints(entryOrigin(NSMakeRect(1700, -25, 90, 25), NSMakeRect(0, -1042, 1920, 1017), size),
                        NSMakePoint(1480, -601)), "entry follows a menu bar below the primary display");
    puts("ok - entry positioning follows the menu bar across screen edges and display arrangements");
}

static void testWindowsAndActivity(void) {
    uint64_t idle = 0;
    int locked = 0, isSleeping = 0;
    check(timi_platform_activity(&idle, &locked, &isSleeping), "native activity can be sampled");
    check(idle <= 9007199254740991ULL, "native idle remains a safe JavaScript millisecond count");
    check((locked == 0 || locked == 1) && (isSleeping == 0 || isSleeping == 1), "presence values are booleans");
    check(!timi_platform_is_packaged() && timi_platform_login_status() == 3, "unbundled test process has no login service");
    check(!timi_platform_set_login(1) && !timi_platform_set_login(0), "unbundled process cannot modify login registration");
    check(!timi_platform_notify("test", "test", "test"), "unbundled process cannot issue notifications");

    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 440, 570)
                    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskResizable
                      backing:NSBackingStoreBuffered defer:NO];
    timi_platform_configure_window((__bridge void *)window, 0);
    check(window.collectionBehavior & NSWindowCollectionBehaviorFullScreenNone, "normal windows cannot enter fullscreen");
    check(window.collectionBehavior & NSWindowCollectionBehaviorFullScreenDisallowsTiling, "normal windows cannot tile fullscreen");
    check(window.tabbingMode == NSWindowTabbingModeDisallowed, "native tabs stay disabled");
    timi_platform_configure_window((__bridge void *)window, 1);
    check(window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllSpaces, "clarification joins all spaces");
    check(window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllApplications, "clarification joins fullscreen applications");
    check(window.collectionBehavior & NSWindowCollectionBehaviorFullScreenAuxiliary, "clarification remains fullscreen auxiliary");
    check(window.level == NSFloatingWindowLevel, "clarification stays at floating level");
    check(![window standardWindowButton:NSWindowZoomButton].enabled, "clarification cannot maximize");
    check(!window.isVisible, "configuration does not reveal hidden windows");

    NSWindow *entry = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 440, 570)
                    styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    WKWebView *content = [[WKWebView alloc] initWithFrame:entry.contentView.bounds];
    entry.contentView = content;
    timi_platform_configure_window((__bridge void *)entry, 0);
    check(!entry.isOpaque && entry.backgroundColor.alphaComponent == 0, "entry corners have no opaque native background");
    check(content.layer.cornerRadius == 18 && content.layer.masksToBounds, "entry clips the real WebView to rounded corners");
    check(entry.hasShadow, "entry retains its native shadow");
    check(NSEqualSizes(entry.frame.size, NSMakeSize(440, 570)), "rounding preserves the entry dimensions");
    check(!entry.isVisible, "entry configuration stays hidden until explicitly opened");
    puts("ok - native activity, unbundled service guards, hidden window configuration");
}

static void testNetworkBlocking(int port) {
    TimiTestMessages *messages = [TimiTestMessages new];
    messages.results = [NSMutableDictionary new];
    WKWebView *webview = testWebview(messages);
    NSString *origin = [NSString stringWithFormat:@"http://127.0.0.1:%d", port];
    NSString *control = [NSString stringWithFormat:
        @"<script>fetch('%@/control').then(r=>r.text()).then(t=>window.webkit.messageHandlers.test.postMessage({name:'control',ok:t==='local-control'})).catch(()=>window.webkit.messageHandlers.test.postMessage({name:'control',ok:false}));</script>", origin];
    [webview loadHTMLString:control baseURL:nil];
    check(waitFor(^BOOL{ return messages.results[@"control"] != nil; }), "unfiltered WebKit control request completes");
    check(messages.results[@"control"].boolValue, "unfiltered WebKit reaches the local test server");

    webview.allowsLinkPreview = YES;
    webview.configuration.preferences.javaScriptCanOpenWindowsAutomatically = YES;
    webview.configuration.preferences.fraudulentWebsiteWarningEnabled = YES;
    timi_platform_harden_webview((__bridge void *)webview);
    check(!webview.allowsLinkPreview, "native link preview disabled");
    check(!webview.configuration.preferences.javaScriptCanOpenWindowsAutomatically, "automatic JavaScript windows disabled");
    check(!webview.configuration.preferences.fraudulentWebsiteWarningEnabled, "remote fraud lookups disabled");
    check(waitFor(^BOOL{ return networkRules != nil && !compilingNetworkRules; }), "production hardening installs compiled network rules");

    NSString *blocked = [NSString stringWithFormat:
        @"<script>const p=(name,ok)=>window.webkit.messageHandlers.test.postMessage({name,ok});"
         "fetch('%@/blocked-fetch').then(()=>p('fetch',false)).catch(()=>p('fetch',true));"
         "const image=new Image();image.onload=()=>p('image',false);image.onerror=()=>p('image',true);image.src='%@/blocked-image';"
         "const socket=new WebSocket('ws://127.0.0.1:%d/blocked-websocket');socket.onopen=()=>{p('socket',false);socket.close();};socket.onerror=()=>p('socket',true);</script>", origin, origin, port];
    [webview loadHTMLString:blocked baseURL:nil];
    check(waitFor(^BOOL{ return messages.results[@"fetch"] && messages.results[@"image"] && messages.results[@"socket"]; }), "blocked fetch, image, and WebSocket finish");
    check(messages.results[@"fetch"].boolValue, "native rules reject fetch without relying on CSP");
    check(messages.results[@"image"].boolValue, "native rules reject image loads without relying on CSP");
    check(messages.results[@"socket"].boolValue, "native rules reject WebSocket without relying on CSP");

    // Exercise the cached-rule path for subsequently created application windows.
    WKWebView *second = testWebview(messages);
    timi_platform_harden_webview((__bridge void *)second);
    NSString *cached = [NSString stringWithFormat:@"<script>fetch('%@/blocked-second-window').then(()=>window.webkit.messageHandlers.test.postMessage({name:'second',ok:false})).catch(()=>window.webkit.messageHandlers.test.postMessage({name:'second',ok:true}));</script>", origin];
    [second loadHTMLString:cached baseURL:nil];
    check(waitFor(^BOOL{ return messages.results[@"second"] != nil; }), "cached rules protect subsequent WebViews");
    check(messages.results[@"second"].boolValue, "cached rules reject a subsequent window's fetch");
    [webview.configuration.userContentController removeScriptMessageHandlerForName:@"test"];
    [second.configuration.userContentController removeScriptMessageHandlerForName:@"test"];
    puts("ok - real WKWebView fetch, image, WebSocket, and subsequent-window traffic blocked");
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        check(argc == 3, "driver requires temporary rule directory and local server port");
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
        testEntryPosition();
        testRulesCompile([NSString stringWithUTF8String:argv[1]]);
        testTerminationGuard();
        CFDictionaryRef session = CGSessionCopyCurrentDictionary();
        if (!session) {
            puts("skip - native activity/window and live WebView checks require an accessible macOS login session (sandbox/headless host)");
            return 0;
        }
        CFRelease(session);
        testWindowsAndActivity();
        int port = atoi(argv[2]);
        if (port > 0) testNetworkBlocking(port);
        else puts("skip - live WKWebView blocking check requires permission to bind a local loopback test server");
    }
    return 0;
}
