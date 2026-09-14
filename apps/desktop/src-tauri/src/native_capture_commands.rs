//! The native development backend is gated in Rust as well as in the renderer.
//! Normal builds expose capabilities only and cannot construct an audio worker.
use serde::Serialize;
use serde_json::Value;
use std::sync::OnceLock;
use tauri::{ipc::Response, WebviewWindow};

static STATE: OnceLock<CaptureState> = OnceLock::new();

pub struct CaptureState {
    enabled: bool,
    #[cfg(all(target_os = "linux", feature = "native-capture-dev"))]
    service: Result<Option<crate::native_capture::NativeCaptureService>, String>,
}

pub fn initialize() {
    STATE.get_or_init(|| {
        let enabled = cfg!(all(target_os = "linux", feature = "native-capture-dev"))
            && std::env::var("VOCO_DEV_NATIVE_CAPTURE").as_deref() == Ok("1");
        CaptureState {
            enabled,
            #[cfg(all(target_os = "linux", feature = "native-capture-dev"))]
            service: if enabled {
                crate::native_capture::NativeCaptureService::new().map(Some)
            } else {
                Ok(None)
            },
        }
    });
}

fn state() -> Result<&'static CaptureState, String> {
    STATE
        .get()
        .ok_or_else(|| "Capture backend has not initialized".into())
}

fn trusted_origin(label: &str, url: &tauri::Url) -> bool {
    if label != "main" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if cfg!(feature = "custom-protocol") {
        url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none()
    } else {
        cfg!(debug_assertions)
            && url.scheme() == "http"
            && url.host_str() == Some("localhost")
            && url.port() == Some(5173)
    }
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    if trusted_origin(window.label(), &url) {
        Ok(())
    } else {
        Err("Native capture is restricted to VOCO's main application page".into())
    }
}

#[derive(Serialize)]
pub struct Capabilities {
    enabled: bool,
}

#[tauri::command]
pub fn native_capture_capabilities(window: WebviewWindow) -> Result<Capabilities, String> {
    require_main(&window)?;
    Ok(Capabilities {
        enabled: state()?.enabled,
    })
}

#[tauri::command]
pub fn debug_native_capture_enabled(window: WebviewWindow) -> Result<bool, String> {
    require_main(&window)?;
    #[cfg(all(target_os = "linux", feature = "native-capture-dev"))]
    return Ok(state()?.enabled && crate::native_capture::retained::enabled());
    #[cfg(not(all(target_os = "linux", feature = "native-capture-dev")))]
    Ok(false)
}

#[tauri::command(async)]
pub fn save_debug_native_retained_source(
    window: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<Option<String>, String> {
    require_main(&window)?;
    if !state()?.enabled {
        return Ok(None);
    }
    #[cfg(all(target_os = "linux", feature = "native-capture-dev"))]
    {
        let service = state()?
            .service
            .as_ref()
            .map_err(Clone::clone)?
            .as_ref()
            .ok_or("Native capture backend is disabled")?;
        crate::native_capture::retained::save(request.body(), |identity| {
            service.verify_stopped(identity)
        })
    }
    #[cfg(not(all(target_os = "linux", feature = "native-capture-dev")))]
    {
        let _ = request;
        Ok(None)
    }
}

#[cfg_attr(
    not(all(target_os = "linux", feature = "native-capture-dev")),
    allow(dead_code)
)]
enum Operation {
    List,
    Select(String, bool),
    Begin(Value),
    Drain(Value),
    Stop(Value),
    Cancel(Value),
}

#[cfg(all(target_os = "linux", feature = "native-capture-dev"))]
fn json(value: impl Serialize) -> Result<Response, String> {
    serde_json::to_string(&value)
        .map(Response::new)
        .map_err(|e| e.to_string())
}

async fn perform(window: WebviewWindow, operation: Operation) -> Result<Response, String> {
    require_main(&window)?;
    if !state()?.enabled {
        return Err("Native capture development backend is disabled".into());
    }
    #[cfg(all(target_os = "linux", feature = "native-capture-dev"))]
    {
        let service = state()?
            .service
            .as_ref()
            .map_err(Clone::clone)?
            .as_ref()
            .ok_or("Native capture development backend is disabled")?
            .clone();
        tauri::async_runtime::spawn_blocking(move || {
            let decode_error =
                |e: serde_json::Error| format!("Invalid native capture request: {e}");
            match operation {
                Operation::List => json(service.list_sources()?),
                Operation::Select(token, acknowledged) => {
                    json(service.select_source(token, acknowledged)?)
                }
                Operation::Begin(request) => {
                    json(service.begin(serde_json::from_value(request).map_err(decode_error)?)?)
                }
                Operation::Drain(request) => service
                    .drain(serde_json::from_value(request).map_err(decode_error)?)
                    .map(Response::new),
                Operation::Stop(request) => {
                    json(service.stop(serde_json::from_value(request).map_err(decode_error)?)?)
                }
                Operation::Cancel(request) => {
                    json(service.cancel(serde_json::from_value(request).map_err(decode_error)?)?)
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(all(target_os = "linux", feature = "native-capture-dev")))]
    {
        let _ = operation;
        Err("Native capture development backend is not compiled in".into())
    }
}

#[tauri::command]
pub async fn native_capture_list_sources(window: WebviewWindow) -> Result<Response, String> {
    perform(window, Operation::List).await
}
#[tauri::command]
pub async fn native_capture_select_source(
    window: WebviewWindow,
    selection_token: String,
    acknowledged: bool,
) -> Result<Response, String> {
    perform(window, Operation::Select(selection_token, acknowledged)).await
}
#[tauri::command]
pub async fn native_capture_begin(
    window: WebviewWindow,
    request: Value,
) -> Result<Response, String> {
    perform(window, Operation::Begin(request)).await
}
#[tauri::command]
pub async fn native_capture_drain(
    window: WebviewWindow,
    request: Value,
) -> Result<Response, String> {
    perform(window, Operation::Drain(request)).await
}
#[tauri::command]
pub async fn native_capture_stop(
    window: WebviewWindow,
    request: Value,
) -> Result<Response, String> {
    perform(window, Operation::Stop(request)).await
}
#[tauri::command]
pub async fn native_capture_cancel(
    window: WebviewWindow,
    request: Value,
) -> Result<Response, String> {
    perform(window, Operation::Cancel(request)).await
}

pub fn reset_renderer() {
    #[cfg(all(target_os = "linux", feature = "native-capture-dev"))]
    if let Some(Ok(Some(service))) = STATE.get().map(|s| &s.service) {
        if let Err(error) = service.reset_renderer() {
            log::warn!("Native capture renderer reset failed: {error}");
        }
    }
}

pub fn shutdown() {
    #[cfg(all(target_os = "linux", feature = "native-capture-dev"))]
    if let Some(Ok(Some(service))) = STATE.get().map(|s| &s.service) {
        if let Err(error) = service.shutdown() {
            log::warn!("Native capture shutdown failed: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capture_rejects_other_windows_and_untrusted_origins() {
        for url in [
            "https://example.com",
            "http://localhost:5174",
            "http://127.0.0.1:5173",
            "tauri://evil",
            "tauri://user@localhost",
        ] {
            assert!(!trusted_origin("main", &url.parse().unwrap()), "{url}");
        }
        let url = if cfg!(feature = "custom-protocol") {
            "tauri://localhost"
        } else {
            "http://localhost:5173"
        };
        assert!(trusted_origin("main", &url.parse().unwrap()));
        assert!(!trusted_origin("overlay", &url.parse().unwrap()));
    }
}
