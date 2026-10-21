//! The unchanged tracking core runs in system JavaScriptCore, with system SQLite.
//! A dedicated thread owns the context and all connections for their whole life.
use serde_json::Value;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_void};
use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};

unsafe extern "C" {
    fn timi_engine_create(
        source: *const c_char,
        path: *const c_char,
        error: *mut *mut c_char,
    ) -> *mut c_void;
    fn timi_engine_call(
        engine: *mut c_void,
        method: *const c_char,
        args: *const c_char,
        error: *mut *mut c_char,
    ) -> *mut c_char;
    fn timi_engine_destroy(engine: *mut c_void);
    fn timi_engine_free_string(value: *mut c_char);
}

enum Request {
    Call {
        method: String,
        args: Value,
        reply: Sender<Result<Value, String>>,
    },
    Shutdown,
}

pub struct Engine {
    sender: Sender<Request>,
    worker: Option<JoinHandle<()>>,
}

fn take_string(pointer: *mut c_char) -> String {
    if pointer.is_null() {
        return "STORAGE_ERROR".into();
    }
    unsafe {
        let value = CStr::from_ptr(pointer).to_string_lossy().into_owned();
        timi_engine_free_string(pointer);
        value
    }
}

impl Engine {
    pub fn new(path: &str) -> Result<Self, String> {
        let path = CString::new(path).map_err(|_| "STORAGE_ERROR".to_owned())?;
        let source = CString::new(include_str!("../../dist-native/backend.js"))
            .map_err(|_| "STORAGE_ERROR".to_owned())?;
        let (sender, receiver) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("timi-tracking".into())
            .spawn(move || {
                let mut error = std::ptr::null_mut();
                let context =
                    unsafe { timi_engine_create(source.as_ptr(), path.as_ptr(), &mut error) };
                if context.is_null() {
                    let _ = ready_tx.send(Err(take_string(error)));
                    return;
                }
                if ready_tx.send(Ok(())).is_err() {
                    unsafe { timi_engine_destroy(context) };
                    return;
                }
                while let Ok(request) = receiver.recv() {
                    match request {
                        Request::Call {
                            method,
                            args,
                            reply,
                        } => {
                            let response = (|| {
                                let method = CString::new(method)
                                    .map_err(|_| "INVALID_COMMAND".to_owned())?;
                                let args = CString::new(args.to_string())
                                    .map_err(|_| "INVALID_COMMAND".to_owned())?;
                                let mut error = std::ptr::null_mut();
                                let output = unsafe {
                                    timi_engine_call(
                                        context,
                                        method.as_ptr(),
                                        args.as_ptr(),
                                        &mut error,
                                    )
                                };
                                if output.is_null() {
                                    return Err(take_string(error));
                                }
                                serde_json::from_str(&take_string(output))
                                    .map_err(|_| "STORAGE_ERROR".to_owned())
                            })();
                            let _ = reply.send(response);
                        }
                        Request::Shutdown => break,
                    }
                }
                // Closing does not invent a clean exit: only an explicit successful
                // quit() checkpoint may mark the session clean in the database.
                unsafe { timi_engine_destroy(context) };
            })
            .map_err(|_| "STORAGE_ERROR".to_owned())?;
        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self {
                sender,
                worker: Some(worker),
            }),
            result => {
                let _ = worker.join();
                Err(match result {
                    Ok(Err(error)) => error,
                    _ => "STORAGE_ERROR".into(),
                })
            }
        }
    }

    pub fn call(&mut self, method: &str, args: Value) -> Result<Value, String> {
        let (reply, receiver) = mpsc::channel();
        self.sender
            .send(Request::Call {
                method: method.into(),
                args,
                reply,
            })
            .map_err(|_| "STORAGE_ERROR".to_owned())?;
        receiver.recv().map_err(|_| "STORAGE_ERROR".to_owned())?
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.sender.send(Request::Shutdown);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
