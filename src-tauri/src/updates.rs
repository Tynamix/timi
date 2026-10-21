use serde_json::{json, Value};
use tauri_plugin_updater::Update;

pub fn allowed_release_url(url: &str, version: &str) -> bool {
    url == format!(
        "https://github.com/Tynamix/timi/releases/download/v{version}/timi-mac-universal.app.tar.gz"
    )
}

#[derive(Default)]
pub struct Updates {
    pub phase: &'static str,
    pub release: Option<Update>,
    pub installed: bool,
    pub error: Option<Value>,
}

impl Updates {
    pub fn new(enabled: bool) -> Self {
        Self {
            phase: if enabled { "idle" } else { "disabled" },
            ..Self::default()
        }
    }
    pub fn busy(&self) -> bool {
        matches!(self.phase, "checking" | "downloading" | "installing")
    }
    pub fn view(&self) -> Value {
        json!({"phase": self.phase, "version": self.release.as_ref().map(|v| &v.version), "error": self.error})
    }
    pub fn failed(&mut self, error: Value) {
        self.phase = if self.installed { "restart" } else { "error" };
        self.error = Some(error);
    }
}

/// Persistence gates replacement and restart independently. If the final save
/// fails, keep the running application open and retry only the clean shutdown.
pub trait UpdateLifecycle {
    fn checkpoint(&mut self) -> Result<(), Value>;
    fn shutdown(&mut self) -> Result<(), Value>;
}

pub fn finish_update(
    lifecycle: &mut impl UpdateLifecycle,
    installed: &mut bool,
    install: impl FnOnce() -> Result<(), Value>,
) -> Result<(), Value> {
    lifecycle.checkpoint()?;
    if !*installed {
        install()?;
        *installed = true;
    }
    lifecycle.shutdown()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, rc::Rc};

    #[test]
    fn downloads_are_confined_to_the_versioned_repository_asset() {
        let valid = "https://github.com/Tynamix/timi/releases/download/v1.2.3/timi-mac-universal.app.tar.gz";
        assert!(allowed_release_url(valid, "1.2.3"));
        for url in [
            valid.replace("https:", "http:"),
            valid.replace("github.com", "github.com.example.org"),
            valid.replace("Tynamix/timi", "someone/timi"),
            valid.replace("v1.2.3", "v1.2.2"),
            format!("{valid}?redirect=https://example.org"),
        ] {
            assert!(!allowed_release_url(&url, "1.2.3"));
        }
    }

    struct Session {
        calls: Rc<RefCell<Vec<&'static str>>>,
        fail: &'static str,
    }
    impl UpdateLifecycle for Session {
        fn checkpoint(&mut self) -> Result<(), Value> {
            self.calls.borrow_mut().push("checkpoint");
            if self.fail == "checkpoint" {
                Err(json!("save failed"))
            } else {
                Ok(())
            }
        }
        fn shutdown(&mut self) -> Result<(), Value> {
            self.calls.borrow_mut().push("shutdown");
            if self.fail == "shutdown" {
                Err(json!("save failed"))
            } else {
                Ok(())
            }
        }
    }
    #[test]
    fn persistence_and_install_failures_gate_restart_and_allow_retry() {
        for failure in ["checkpoint", "install", "shutdown", ""] {
            let calls = Rc::new(RefCell::new(vec![]));
            let mut session = Session {
                calls: calls.clone(),
                fail: failure,
            };
            let mut installed = false;
            let result = finish_update(&mut session, &mut installed, || {
                calls.borrow_mut().push("install");
                if failure == "install" {
                    Err(json!("install failed"))
                } else {
                    Ok(())
                }
            });
            assert_eq!(result.is_ok(), failure.is_empty());
            assert_eq!(installed, matches!(failure, "shutdown" | ""));
            assert_eq!(
                *calls.borrow(),
                match failure {
                    "checkpoint" => vec!["checkpoint"],
                    "install" => vec!["checkpoint", "install"],
                    _ => vec!["checkpoint", "install", "shutdown"],
                }
            );
            session.fail = "";
            calls.borrow_mut().clear();
            let was_installed = installed;
            finish_update(&mut session, &mut installed, || {
                calls.borrow_mut().push("install");
                Ok(())
            })
            .unwrap();
            assert_eq!(
                *calls.borrow(),
                if was_installed {
                    vec!["checkpoint", "shutdown"]
                } else {
                    vec!["checkpoint", "install", "shutdown"]
                }
            );
        }
    }
}
