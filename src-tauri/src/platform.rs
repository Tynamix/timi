//! The small, local-only macOS boundary. The Objective-C implementation owns
//! native observers for the process lifetime; Rust owns all tracking state.

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug)]
pub struct Activity {
    pub idle_ms: u64,
    pub locked: bool,
    pub sleeping: bool,
}

#[derive(Clone, Debug)]
pub enum Event {
    /// Runs synchronously before macOS is allowed to sleep. Sample/checkpoint
    /// here, before returning from the callback; do not defer persistence.
    Presence,
    Shutdown,
    NotificationAccepted(String),
    NotificationFailed(String),
    NotificationClicked,
}

type Callback = Box<dyn Fn(Event) + Send + Sync>;
static CALLBACK: OnceLock<Callback> = OnceLock::new();

extern "C" {
    fn timi_platform_install(callback: extern "C" fn(c_int, *const c_char)) -> c_int;
    fn timi_platform_activity(idle_ms: *mut u64, locked: *mut c_int, sleeping: *mut c_int)
        -> c_int;
    fn timi_platform_locale_is_german() -> c_int;
    fn timi_platform_is_packaged() -> c_int;
    fn timi_platform_login_status() -> c_int;
    fn timi_platform_set_login(enabled: c_int) -> c_int;
    fn timi_platform_notify(id: *const c_char, title: *const c_char, body: *const c_char) -> c_int;
    fn timi_platform_error_dialog(
        message: *const c_char,
        retry: *const c_char,
        cancel: *const c_char,
    ) -> c_int;
    fn timi_platform_startup_error(message: *const c_char, close: *const c_char);
    fn timi_platform_allow_termination();
    fn timi_platform_configure_window(window: *mut c_void, clarification: c_int);
    fn timi_platform_set_tray_font(status_item: *mut c_void);
    fn timi_platform_position_entry(window: *mut c_void, status_item: *mut c_void);
    fn timi_platform_harden_webview(webview: *mut c_void);
    fn timi_platform_show_inactive(window: *mut c_void);
}

extern "C" fn receive(event: c_int, identifier: *const c_char) {
    // The pointer is borrowed only for this call. Copy it before crossing back
    // into the application; never let a Rust panic unwind through Cocoa.
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let key = || {
            if identifier.is_null() {
                String::new()
            } else {
                unsafe { CStr::from_ptr(identifier) }
                    .to_string_lossy()
                    .into_owned()
            }
        };
        let event = match event {
            1 => Event::Presence,
            2 => Event::Shutdown,
            3 => Event::NotificationAccepted(key()),
            4 => Event::NotificationFailed(key()),
            5 => Event::NotificationClicked,
            _ => return,
        };
        if let Some(callback) = CALLBACK.get() {
            callback(event);
        }
    }));
}

/// Install once on the main thread, after the tracking application is ready.
pub fn install(callback: impl Fn(Event) + Send + Sync + 'static) -> Result<(), &'static str> {
    CALLBACK
        .set(Box::new(callback))
        .map_err(|_| "ACTIVITY_ERROR")?;
    if unsafe { timi_platform_install(receive) } != 0 {
        Ok(())
    } else {
        Err("ACTIVITY_ERROR")
    }
}

pub fn activity() -> Result<Activity, &'static str> {
    let (mut idle_ms, mut locked, mut sleeping) = (0_u64, 0, 0);
    if unsafe { timi_platform_activity(&mut idle_ms, &mut locked, &mut sleeping) } == 0 {
        return Err("ACTIVITY_ERROR");
    }
    Ok(Activity {
        idle_ms,
        locked: locked != 0,
        sleeping: sleeping != 0,
    })
}

pub fn locale() -> &'static str {
    if unsafe { timi_platform_locale_is_german() } != 0 {
        "de"
    } else {
        "en"
    }
}

pub fn is_packaged() -> bool {
    (unsafe { timi_platform_is_packaged() }) != 0
}

pub fn login_status() -> &'static str {
    match unsafe { timi_platform_login_status() } {
        0 => "not-registered",
        1 => "enabled",
        2 => "requires-approval",
        _ => "not-found",
    }
}

pub fn set_login(enabled: bool) -> Result<bool, &'static str> {
    if unsafe { timi_platform_set_login(i32::from(enabled)) } != 0 {
        Ok(login_status() == "enabled")
    } else {
        Err("LOGIN_ERROR")
    }
}

/// Success means submitted asynchronously. Persist a goal receipt only on the
/// matching NotificationAccepted event; retry on NotificationFailed.
pub fn notify(id: &str, title: &str, body: &str) -> Result<(), &'static str> {
    let id = CString::new(id).map_err(|_| "NOTIFICATION_ERROR")?;
    let title = CString::new(title).map_err(|_| "NOTIFICATION_ERROR")?;
    let body = CString::new(body).map_err(|_| "NOTIFICATION_ERROR")?;
    if unsafe { timi_platform_notify(id.as_ptr(), title.as_ptr(), body.as_ptr()) } != 0 {
        Ok(())
    } else {
        Err("NOTIFICATION_ERROR")
    }
}

/// Main-thread modal dialog. `true` requests another attempt; `false` keeps the
/// app open (or closes after a startup failure, according to the caller).
pub fn error_dialog(message: &str, retry: &str, cancel: &str) -> bool {
    let Ok(message) = CString::new(message) else {
        return false;
    };
    let Ok(retry) = CString::new(retry) else {
        return false;
    };
    let Ok(cancel) = CString::new(cancel) else {
        return false;
    };
    unsafe { timi_platform_error_dialog(message.as_ptr(), retry.as_ptr(), cancel.as_ptr()) != 0 }
}

/// Main-thread startup failure dialog with the original single close button.
pub fn startup_error(message: &str, close: &str) {
    let Ok(message) = CString::new(message) else {
        return;
    };
    let Ok(close) = CString::new(close) else {
        return;
    };
    unsafe {
        timi_platform_startup_error(message.as_ptr(), close.as_ptr());
    }
}

/// Permit an OS termination only after the engine durably completed quit().
pub fn allow_termination() {
    unsafe {
        timi_platform_allow_termination();
    }
}

/// Apply the original native window behavior. Call on the main thread with the
/// NSWindow pointer returned by Tauri, while that window remains alive.
pub unsafe fn configure_window(window: *mut c_void, clarification: bool) {
    timi_platform_configure_window(window, i32::from(clarification));
}

/// Preserve stable-width digits in the menu bar. The pointer must identify a live
/// NSStatusItem; call on the main thread after creating the tray icon.
pub unsafe fn set_tray_font(status_item: *mut c_void) {
    timi_platform_set_tray_font(status_item);
}

/// Anchor the entry to its live menu-bar button using AppKit screen points.
/// Both pointers must remain alive; call on the main thread before showing.
pub unsafe fn position_entry(window: *mut c_void, status_item: *mut c_void) {
    timi_platform_position_entry(window, status_item);
}

/// Main-thread defense in depth for a live WKWebView returned by Tauri. Strict
/// CSP remains necessary from the first document load because rules compile
/// asynchronously. This preserves Wry's navigation and permission delegates.
pub unsafe fn harden_webview(webview: *mut c_void) {
    timi_platform_harden_webview(webview);
}

/// Restore an existing clarification after unlock without taking keyboard focus.
/// Tauri's regular `show()` calls makeKeyAndOrderFront on macOS.
pub unsafe fn show_inactive(window: *mut c_void) {
    timi_platform_show_inactive(window);
}
