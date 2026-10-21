#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod platform;
#[cfg(test)]
mod tests;

use engine::Engine;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{NewWindowResponse, PermissionResponse},
    Emitter, Manager, WebviewUrl, WebviewWindow,
};

type App = tauri::AppHandle;
type Shared = Mutex<Desktop>;
struct TrayMenu {
    menu: Menu<tauri::Wry>,
    stop: MenuItem<tauri::Wry>,
}

struct Desktop {
    engine: Engine,
    messages: Value,
    locale: String,
    workspace: String,
    ready: HashSet<String>,
    reveal: HashSet<String>,
    sticky: Option<Value>,
    presented: Option<String>,
    reminder: bool,
    quitting: bool,
    ticks: u64,
    notices: HashMap<String, Value>,
    receipts: HashMap<String, Value>,
    retry: HashMap<String, Instant>,
    receipt_retry: Instant,
}

fn failure(code: &str) -> Value {
    json!({"code": code})
}
fn ok(value: Value) -> Value {
    json!({"ok":true,"value":value})
}
fn err(value: Value) -> Value {
    json!({"ok":false,"error":value})
}
fn duration(ms: f64) -> String {
    let minutes = (ms / 60_000.0).floor() as u64;
    format!("{}:{:02}", minutes / 60, minutes % 60)
}

impl Desktop {
    fn call(&mut self, method: &str, args: Value) -> Result<Value, Value> {
        let reply = self
            .engine
            .call(method, args)
            .map_err(|_| failure("STORAGE_ERROR"))?;
        if reply["ok"] == true {
            Ok(reply["value"].clone())
        } else {
            Err(reply
                .get("error")
                .cloned()
                .unwrap_or_else(|| failure("STORAGE_ERROR")))
        }
    }
    fn msg(&self, key: &str) -> &str {
        self.messages[key].as_str().unwrap_or("timi")
    }
    fn error_text(&self, problem: &Value) -> &str {
        self.msg(match problem["code"].as_str() {
            Some("CLOCK_INVALID") => "clock",
            Some("ACTIVITY_ERROR") => "activity",
            _ => "save",
        })
    }
    fn report(&mut self, app: &App, problem: Value) {
        eprintln!(
            "[timi] {}",
            problem["code"].as_str().unwrap_or("STORAGE_ERROR")
        );
        if self.sticky.as_ref().map(|v| &v["code"]) != Some(&problem["code"]) {
            let _ = app.emit("timi:error", &problem);
        }
        self.sticky = Some(problem);
    }
    fn sample(&mut self) -> Result<(), Value> {
        let activity = platform::activity().map_err(failure)?;
        self.call("sample", json!({"idleMs":activity.idle_ms,"locked":activity.locked,"sleeping":activity.sleeping}))?;
        Ok(())
    }
    fn can_show(&self) -> bool {
        !self.quitting
            && platform::activity()
                .map(|v| !v.locked && !v.sleeping)
                .unwrap_or(false)
    }
    fn hide(&self, app: &App, kind: &str) {
        if let Some(window) = app.get_webview_window(kind) {
            let _ = window.hide();
        }
    }
    fn foreground(&mut self, app: &App, kind: &str) {
        if !self.can_show() {
            return;
        }
        if !self.ready.contains(kind) {
            self.reveal.insert(kind.into());
            return;
        }
        if kind != "entry" {
            self.hide(app, "entry");
        }
        if let Some(window) = app.get_webview_window(kind) {
            if kind == "entry" {
                if let Some(tray) = app.tray_by_id("timi") {
                    let entry_window = window.clone();
                    let _ = tray.with_inner_tray_icon(move |inner| {
                        if let (Some(item), Ok(native)) =
                            (inner.ns_status_item(), entry_window.ns_window())
                        {
                            unsafe {
                                platform::position_entry(
                                    native,
                                    (&*item as *const _ as *mut std::ffi::c_void).cast(),
                                );
                            }
                        }
                    });
                }
            }
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("timi:focus", ());
        }
    }
    fn workspace(&mut self, app: &App, view: &str) {
        self.workspace = view.into();
        if let Some(window) = app.get_webview_window("overview") {
            let _ = window.emit("timi:navigate", view);
        }
        self.foreground(app, "overview");
    }
    fn entry(&mut self, app: &App) {
        if !self.can_show() {
            return;
        }
        if let Ok(state) = self.call("snapshot", json!(0)) {
            if !state["pending"].is_null() {
                self.clarification(app, &state, true);
                return;
            }
        }
        self.foreground(app, "entry");
    }
    fn clarification(&mut self, app: &App, state: &Value, explicit: bool) {
        let Some(id) = state["pending"]["id"].as_str() else {
            return;
        };
        if state["canPresent"] != true || !self.can_show() {
            return;
        }
        if !self.ready.contains("clarification") {
            return;
        }
        if explicit || self.presented.as_deref() != Some(id) {
            self.presented = Some(id.into());
            self.foreground(app, "clarification");
        } else if let Some(window) = app.get_webview_window("clarification") {
            if !window.is_visible().unwrap_or(false) {
                if let Ok(native) = window.ns_window() {
                    unsafe {
                        platform::show_inactive(native);
                    }
                }
            }
        }
    }
    fn refresh(&mut self, app: &App) {
        if self.quitting {
            return;
        }
        let state = match self.call("snapshot", json!(0)) {
            Ok(state) => state,
            Err(problem) => {
                self.report(app, problem);
                return;
            }
        };
        if let Ok(presentation) = self.call("presentation", json!(self.locale)) {
            let display = &presentation["display"];
            let text = display["text"].as_str().unwrap_or("0:00");
            let pending = !state["pending"].is_null();
            let mode = state["mode"].as_str().unwrap_or("untracked");
            let prefix = if self.sticky.is_some() || pending {
                "! "
            } else if mode == "break" {
                "Ⅱ "
            } else if mode == "untracked" {
                "■ "
            } else {
                ""
            };
            let status = if let Some(problem) = &self.sticky {
                self.error_text(problem)
            } else {
                self.msg(if pending {
                    "pending"
                } else {
                    match mode {
                        "break" => "break",
                        "work" => "work",
                        _ => "stopped",
                    }
                })
            };
            let remainder = if display["remaining"] == true {
                format!("{}: {text}\n", self.msg("remainingToday"))
            } else {
                String::new()
            };
            if let Some(tray) = app.tray_by_id("timi") {
                let _ = tray.set_title(Some(format!("{prefix}{text}")));
                let _ = tray.set_tooltip(Some(format!(
                    "timi · {remainder}{}: {}\n{status}",
                    self.msg("today"),
                    duration(state["todayMs"].as_f64().unwrap_or(0.0))
                )));
            }
        }
        let _ = app.emit("timi:changed", ());
        if let Some(menu) = app.try_state::<TrayMenu>() {
            let has_stop = menu
                .menu
                .items()
                .unwrap_or_default()
                .iter()
                .any(|item| item.id().as_ref() == "stop");
            if state["mode"] == "untracked" && has_stop {
                let _ = menu.menu.remove(&menu.stop);
            } else if state["mode"] != "untracked" && !has_stop {
                let _ = menu.menu.insert(&menu.stop, 1);
            }
        }
        if state["pending"].is_null() {
            self.hide(app, "clarification");
            self.presented = None;
        } else if state["canPresent"] != true || !self.can_show() {
            self.hide(app, "clarification");
        } else {
            self.clarification(app, &state, false);
        }
        if state["reminderDue"] == true
            && state["canPresent"] == true
            && state["pending"].is_null()
            && !self.reminder
            && self.can_show()
        {
            self.reminder = true;
            self.entry(app);
        }
        self.goal_notifications(app, &state);
    }
    fn goal_notifications(&mut self, app: &App, state: &Value) {
        if Instant::now() >= self.receipt_retry {
            let receipts: Vec<_> = self
                .receipts
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            for (key, notice) in receipts {
                if let Err(problem) = self.call("acknowledge", notice) {
                    self.receipt_retry = Instant::now() + Duration::from_secs(60);
                    self.report(app, problem);
                    break;
                }
                self.receipts.remove(&key);
            }
        }
        if self.sticky.is_some()
            || state["canPresent"] != true
            || !self.can_show()
            || !platform::is_packaged()
        {
            return;
        }
        let notices = match self.call("notices", Value::Null) {
            Ok(notices) => notices,
            Err(problem) => {
                self.report(app, problem);
                return;
            }
        };
        for notice in notices.as_array().into_iter().flatten() {
            let kind = notice["kind"].as_str().unwrap_or("day");
            let key = format!("{}:{}", kind, notice["period"].as_str().unwrap_or(""));
            if self.notices.contains_key(&key)
                || self.receipts.contains_key(&key)
                || self.retry.get(&key).is_some_and(|at| *at > Instant::now())
            {
                continue;
            }
            let title = self.msg(if kind == "day" {
                "dailyGoalTitle"
            } else {
                "weeklyGoalTitle"
            });
            let body = self
                .msg(if kind == "day" {
                    "dailyGoalBody"
                } else {
                    "weeklyGoalBody"
                })
                .replace(
                    "{time}",
                    &duration(notice["targetMs"].as_f64().unwrap_or(0.0)),
                );
            let result = platform::notify(&key, title, &body);
            if result.is_ok() {
                self.notices.insert(key, notice.clone());
            } else {
                self.retry
                    .insert(key, Instant::now() + Duration::from_secs(60));
            }
        }
    }
    fn execute(&mut self, app: &App, value: Value) -> Result<Value, Value> {
        self.call("validateCommand", value.clone())?;
        self.sample()?;
        let state = self.call("command", value.clone())?;
        if ["start", "pause", "resume", "stop", "later", "resolve"]
            .contains(&value["type"].as_str().unwrap_or(""))
            || (value["type"] == "settings" && state["reminderDue"] != true)
        {
            self.reminder = false;
        }
        self.sticky = None;
        self.refresh(app);
        Ok(state)
    }
    fn quit(&mut self, app: &App) -> Result<Value, Value> {
        if !self.quitting {
            self.sample()?;
            self.call("quit", Value::Null)?;
            platform::allow_termination();
            self.quitting = true;
            app.exit(0);
        }
        Ok(Value::Null)
    }
    fn action(
        &mut self,
        app: &App,
        kind: &str,
        action: &str,
        value: Value,
    ) -> Result<Value, Value> {
        match action {
            "snapshot" => self.call("snapshot", value),
            "command" => self.execute(app, value),
            "environment" => Ok(
                json!({"locale":self.locale,"version":app.package_info().version.to_string(),"packaged":platform::is_packaged(),"loginAvailable":platform::is_packaged(),"launchAtLogin":platform::login_status()=="enabled","launchAtLoginStatus":platform::login_status()}),
            ),
            "login" => {
                let enabled = value.as_bool().ok_or_else(|| failure("INVALID_COMMAND"))?;
                if !platform::is_packaged() {
                    return Err(failure("INVALID_COMMAND"));
                }
                platform::set_login(enabled)
                    .map(|v| json!(v))
                    .map_err(failure)
            }
            "open" => {
                let view = value
                    .as_str()
                    .filter(|v| ["overview", "settings"].contains(v))
                    .ok_or_else(|| failure("INVALID_COMMAND"))?;
                self.workspace(app, view);
                Ok(Value::Null)
            }
            "workspace-view" => Ok(json!(self.workspace)),
            "close" => {
                if kind != "clarification" {
                    self.hide(app, kind);
                }
                Ok(Value::Null)
            }
            "quit" => self.quit(app),
            "ready" => {
                self.ready.insert(kind.into());
                if kind == "overview" {
                    if let Some(window) = app.get_webview_window(kind) {
                        let _ = window.emit("timi:navigate", &self.workspace);
                    }
                }
                if let Some(problem) = &self.sticky {
                    if let Some(window) = app.get_webview_window(kind) {
                        let _ = window.emit("timi:error", problem);
                    }
                }
                if self.reveal.remove(kind) {
                    self.foreground(app, kind);
                }
                self.refresh(app);
                Ok(Value::Null)
            }
            _ => Err(failure("INVALID_COMMAND")),
        }
    }
}

// No renderer receives filesystem, SQL, shell, process or window-management permissions.
#[tauri::command]
fn desktop(app: App, window: WebviewWindow, action: String, value: Value) -> Value {
    let label = window.label();
    let expected = format!("tauri://localhost/index.html?window={label}");
    if !["entry", "overview", "clarification"].contains(&label)
        || window
            .url()
            .map(|url| url.as_str() != expected)
            .unwrap_or(true)
    {
        return err(failure("INVALID_COMMAND"));
    }
    let state = app.state::<Shared>();
    let mut state = state.lock().unwrap();
    match state.action(&app, label, &action, value) {
        Ok(value) => ok(value),
        Err(problem) => {
            if ["STORAGE_ERROR", "CLOCK_INVALID", "ACTIVITY_ERROR"]
                .contains(&problem["code"].as_str().unwrap_or(""))
            {
                state.report(&app, problem.clone());
            }
            if problem["code"] == "PENDING_REQUIRED" {
                if let Ok(snapshot) = state.call("snapshot", json!(0)) {
                    state.clarification(&app, &snapshot, true);
                }
            }
            state.refresh(&app);
            err(problem)
        }
    }
}

fn native_quit(app: &App) {
    loop {
        let dialog = {
            let state = app.state::<Shared>();
            let mut state = state.lock().unwrap();
            match state.quit(app) {
                Ok(_) => return,
                Err(problem) => {
                    state.report(app, problem.clone());
                    state.refresh(app);
                    (
                        state.error_text(&problem).to_owned(),
                        state.msg("retry").to_owned(),
                        state.msg("stayOpen").to_owned(),
                    )
                }
            }
        };
        if !platform::error_dialog(&dialog.0, &dialog.1, &dialog.2) {
            return;
        }
    }
}

fn menu_action(app: &App, id: &str) {
    if id == "quit" {
        native_quit(app);
        return;
    }
    let shared = app.state::<Shared>();
    let mut state = shared.lock().unwrap();
    match id {
        "entry" => state.entry(app),
        "overview" | "settings" => state.workspace(app, id),
        "stop" => {
            if let Err(problem) = state.execute(app, json!({"type":"stop"})) {
                state.report(app, problem);
                state.refresh(app);
            }
        }
        _ => (),
    }
}

fn make_window(app: &App, kind: &str) -> tauri::Result<()> {
    let (width, height) = match kind {
        "overview" => (1120.0, 780.0),
        "clarification" => (580.0, 570.0),
        _ => (440.0, 570.0),
    };
    let expected = format!("tauri://localhost/index.html?window={kind}");
    let window = tauri::WebviewWindowBuilder::new(
        app,
        kind,
        WebviewUrl::App(format!("index.html?window={kind}").into()),
    )
    .title("timi")
    .inner_size(width, height)
    .min_inner_size(
        if kind == "overview" { 900.0 } else { width },
        if kind == "overview" { 640.0 } else { height },
    )
    .center()
    .visible(false)
    .focused(false)
    .decorations(kind != "entry")
    .resizable(kind == "overview")
    .minimizable(kind != "clarification")
    .maximizable(kind == "overview")
    .skip_taskbar(true)
    .always_on_top(kind == "clarification")
    .visible_on_all_workspaces(kind == "clarification")
    .background_color(tauri::window::Color(245, 244, 239, 255))
    .devtools(cfg!(debug_assertions))
    .disable_drag_drop_handler()
    .on_navigation(move |url| url.as_str() == expected)
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .on_download(|_, _| false)
    .on_permission_request(|_, _| PermissionResponse::Deny)
    .on_document_title_changed(|window, title| {
        let _ = window.set_title(&title);
    })
    .build()?;
    unsafe {
        platform::configure_window(window.ns_window()?, kind == "clarification");
    }
    window.with_webview(|webview| unsafe {
        platform::harden_webview(webview.inner());
    })?;
    // Electron's dimensions included the title bar; Tauri's builder uses content dimensions.
    let scale = window.scale_factor()?;
    let frame_height =
        (window.outer_size()?.height as f64 - window.inner_size()?.height as f64) / scale;
    window.set_min_size(Some(tauri::LogicalSize::new(
        if kind == "overview" { 900.0 } else { width },
        (if kind == "overview" { 640.0 } else { height }) - frame_height,
    )))?;
    window.set_size(tauri::LogicalSize::new(width, height - frame_height))?;
    let handle = app.clone();
    let label = kind.to_owned();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if label != "clarification" {
                if let Some(window) = handle.get_webview_window(&label) {
                    let _ = window.hide();
                }
            }
        }
        tauri::WindowEvent::Focused(focused) => {
            if let Some(window) = handle.get_webview_window(&label) {
                if *focused {
                    let _ = window.emit("timi:focus", ());
                } else if label == "entry" {
                    let _ = window.hide();
                }
            }
        }
        _ => (),
    });
    Ok(())
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    let data = std::env::args()
        .find_map(|arg| arg.strip_prefix("--data-directory=").map(PathBuf::from))
        .unwrap_or_else(|| app.path().data_dir().unwrap().join("timi"));
    std::fs::create_dir_all(&data)?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o700))?;
    let engine = Engine::new(
        data.join("tracking.sqlite")
            .to_str()
            .ok_or("Invalid data path")?,
    )
    .map_err(std::io::Error::other)?;
    let locale = platform::locale().to_owned();
    let mut state = Desktop {
        engine,
        messages: Value::Null,
        locale,
        workspace: "overview".into(),
        ready: HashSet::new(),
        reveal: HashSet::new(),
        sticky: None,
        presented: None,
        reminder: false,
        quitting: false,
        ticks: 0,
        notices: HashMap::new(),
        receipts: HashMap::new(),
        retry: HashMap::new(),
        receipt_retry: Instant::now(),
    };
    state.messages = state
        .call("presentation", json!(state.locale))
        .map_err(|_| "Presentation initialization failed")?["messages"]
        .clone();
    let item = |id: &str| MenuItem::with_id(app, id, state.msg(id), true, None::<&str>);
    let entry = item("entry")?;
    let stop = item("stop")?;
    let overview = item("overview")?;
    let settings = item("settings")?;
    let quit = MenuItem::with_id(app, "quit", state.msg("quit"), true, Some("Cmd+Q"))?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&entry, &stop, &overview, &settings, &separator, &quit],
    )?;
    let main_menu = Menu::with_items(
        app,
        &[
            &Submenu::with_items(app, "timi", true, &[&quit])?,
            &Submenu::with_items(
                app,
                state.msg("edit"),
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some(state.msg("undo")))?,
                    &PredefinedMenuItem::redo(app, Some(state.msg("redo")))?,
                    &separator,
                    &PredefinedMenuItem::cut(app, Some(state.msg("cut")))?,
                    &PredefinedMenuItem::copy(app, Some(state.msg("copy")))?,
                    &PredefinedMenuItem::paste(app, Some(state.msg("paste")))?,
                    &PredefinedMenuItem::select_all(app, Some(state.msg("selectAll")))?,
                ],
            )?,
        ],
    )?;
    app.set_menu(main_menu)?;
    app.manage(TrayMenu {
        menu: menu.clone(),
        stop,
    });
    app.manage(Mutex::new(state));
    let tray = TrayIconBuilder::with_id("timi")
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../../assets/tray.png"
        ))?)
        .icon_as_template(true)
        .title("■ 0:00")
        .tooltip("timi")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let app = tray.app_handle();
                let shared = app.state::<Shared>();
                let mut state = shared.lock().unwrap();
                if app
                    .get_webview_window("entry")
                    .is_some_and(|w| w.is_visible().unwrap_or(false))
                {
                    state.hide(app, "entry");
                } else {
                    state.entry(app);
                }
            }
        })
        .build(app)?;
    tray.with_inner_tray_icon(|inner| {
        if let Some(item) = inner.ns_status_item() {
            unsafe {
                platform::set_tray_font((&*item as *const _ as *mut std::ffi::c_void).cast());
            }
        }
    })?;
    for kind in ["entry", "overview", "clarification"] {
        make_window(app.handle(), kind)?;
    }
    let handle = app.handle().clone();
    platform::install(move |event| {
        if matches!(event, platform::Event::Shutdown) {
            native_quit(&handle);
            return;
        }
        let shared = handle.state::<Shared>();
        let mut state = shared.lock().unwrap();
        match event {
            platform::Event::Presence => {
                if !state.can_show() {
                    state.hide(&handle, "entry");
                    state.hide(&handle, "clarification");
                }
                match state
                    .sample()
                    .and_then(|_| state.call("checkpoint", Value::Null))
                {
                    Ok(_) => state.sticky = None,
                    Err(problem) => state.report(&handle, problem),
                }
            }
            platform::Event::NotificationAccepted(key) => {
                if let Some(notice) = state.notices.remove(&key) {
                    state.receipts.insert(key, notice);
                }
            }
            platform::Event::NotificationFailed(key) => {
                state.notices.remove(&key);
                state
                    .retry
                    .insert(key, Instant::now() + Duration::from_secs(60));
            }
            platform::Event::NotificationClicked => state.workspace(&handle, "overview"),
            _ => (),
        }
        state.refresh(&handle);
    })?;
    let handle = app.handle().clone();
    let tick_pending = Arc::new(AtomicBool::new(false));
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        if tick_pending.swap(true, Ordering::AcqRel) {
            continue;
        }
        let pending = tick_pending.clone();
        let app = handle.clone();
        if handle
            .run_on_main_thread(move || {
                pending.store(false, Ordering::Release);
                let shared = app.state::<Shared>();
                let mut state = shared.lock().unwrap();
                if state.quitting {
                    return;
                }
                state.ticks += 1;
                let result = state.sample().and_then(|_| {
                    if state.ticks % 15 == 0 {
                        state.call("checkpoint", Value::Null).map(|_| ())
                    } else {
                        Ok(())
                    }
                });
                match result {
                    Ok(()) => {
                        if state.ticks % 15 == 0 {
                            state.sticky = None;
                        }
                    }
                    Err(problem) => state.report(&app, problem),
                }
                state.refresh(&app);
            })
            .is_err()
        {
            break;
        }
    });
    {
        let shared = app.state::<Shared>();
        let mut state = shared.lock().unwrap();
        if let Err(problem) = state.sample() {
            state.report(app.handle(), problem);
        }
        state.refresh(app.handle());
    }
    Ok(())
}

fn main() {
    let mut context = tauri::generate_context!();
    // A debugger launch must not be redirected to an already-running release app.
    if cfg!(debug_assertions) {
        context.config_mut().identifier.push_str(".debug");
    }
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            // The macOS plugin invokes this callback on its async listener thread.
            // Never hold tracking state there while window APIs wait for the main thread.
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(shared) = handle.try_state::<Shared>() {
                    shared.lock().unwrap().entry(&handle);
                }
            });
        }))
        .invoke_handler(tauri::generate_handler![desktop])
        .on_menu_event(|app, event| menu_action(app, event.id.as_ref()))
        .setup(|app| match setup(app) {
            Ok(()) => Ok(()),
            Err(error) => {
                eprintln!("[timi startup] STORAGE_ERROR");
                let (message, exit) = if platform::locale() == "de" {
                    ("timi konnte die Zeitdaten nicht öffnen. Deine Daten wurden nicht ersetzt. Prüfe den Zugriff auf den Datenordner und ob eine andere timi-Version läuft. Versuche es dann erneut.", "Schließen")
                } else {
                    ("timi could not open its time records. Your data has not been replaced. Check that the data folder is accessible and that no other timi version is running, then try again.", "Close")
                };
                let path = std::env::args().find_map(|arg| arg.strip_prefix("--data-directory=").map(PathBuf::from))
                    .or_else(|| app.path().data_dir().ok().map(|path| path.join("timi")));
                let message = path.map(|path| format!("{message}\n\n{}", path.display())).unwrap_or_else(|| message.into());
                platform::startup_error(&message, exit);
                Err(error)
            }
        })
        .build(context)
        .expect("Could not initialize timi");
    application.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { api, .. } => {
            let quitting = app
                .try_state::<Shared>()
                .is_none_or(|s| s.lock().unwrap().quitting);
            if !quitting {
                api.prevent_exit();
                native_quit(app);
            }
        }
        tauri::RunEvent::Reopen { .. } => {
            if let Some(shared) = app.try_state::<Shared>() {
                shared.lock().unwrap().entry(app);
            }
        }
        _ => (),
    });
}
