use crate::engine::Engine;
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_FILE: AtomicU64 = AtomicU64::new(0);
struct Database(PathBuf);
impl Database {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "timi-rust-{}-{}",
            std::process::id(),
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> String {
        self.0.join("tracking.sqlite").to_str().unwrap().to_owned()
    }
}
impl Drop for Database {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn call(engine: &mut Engine, method: &str, args: Value) -> Value {
    let result = engine.call(method, args).unwrap();
    assert_eq!(result["ok"], true, "{result}");
    result["value"].clone()
}

#[test]
fn worker_preserves_data_and_starts_untracked_after_clean_restart() {
    let database = Database::new();
    let mut engine = Engine::new(&database.path()).unwrap();
    assert_eq!(call(&mut engine, "snapshot", json!(0))["mode"], "untracked");
    let state = call(
        &mut engine,
        "command",
        json!({"type":"start","name":"Prüfung 日本語"}),
    );
    let id = state["active"]["projectId"].clone();
    call(&mut engine, "command", json!({"type":"pause"}));
    call(&mut engine, "quit", Value::Null);
    drop(engine);
    let mut reopened = Engine::new(&database.path()).unwrap();
    let state = call(&mut reopened, "snapshot", json!(0));
    assert_eq!(state["mode"], "untracked");
    assert_eq!(state["projects"][0]["id"], id);
    assert_eq!(state["projects"][0]["name"], "Prüfung 日本語");
    assert!(state["resumeProjectId"].is_null());
    call(&mut reopened, "quit", Value::Null);
}

#[test]
fn malformed_commands_leave_native_worker_state_unchanged_and_retryable() {
    let mut engine = Engine::new(":memory:").unwrap();
    call(
        &mut engine,
        "command",
        json!({"type":"start","name":"First"}),
    );
    let before = call(&mut engine, "snapshot", json!(0));
    for (method, payload) in [
        (
            "command",
            json!({"type":"start","name":"Injected","sql":"DROP TABLE timi_records"}),
        ),
        ("validateCommand", json!({"type":"quit"})),
        ("snapshot", json!(1)),
        (
            "sample",
            json!({"idleMs":-1,"locked":false,"sleeping":false}),
        ),
    ] {
        assert_eq!(engine.call(method, payload).unwrap()["ok"], false);
        let after = call(&mut engine, "snapshot", json!(0));
        assert_eq!(after["active"], before["active"]);
        assert_eq!(after["projects"], before["projects"]);
        assert_eq!(after["records"], before["records"]);
    }
    assert_eq!(
        call(&mut engine, "command", json!({"type":"stop"}))["mode"],
        "untracked"
    );
}

#[test]
fn unreadable_database_is_preserved_on_native_worker_startup_failure() {
    let database = Database::new();
    let bytes = b"This is deliberately not a SQLite database.";
    fs::write(database.path(), bytes).unwrap();
    assert!(Engine::new(&database.path()).is_err());
    assert_eq!(fs::read(database.path()).unwrap(), bytes);
}
