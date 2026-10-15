//! AI Nexus development backend. Only this instance's child processes are controlled.
mod config;
mod file_picker;
mod gpu;
mod launch;
mod lifecycle;
mod proc;

use config::{Config, Snapshot, Store};
use proc::Registry;
use std::{sync::Mutex, time::Duration};
use tauri::{Emitter, Manager, State};

#[derive(Clone, serde::Serialize)]
pub struct Active {
    pub id: String,
    pub context: String,
    pub phase: String,
    pub generation: u64,
}
struct Control {
    snapshot: Snapshot,
    active: Option<Active>,
    generation: u64,
    shutting_down: bool,
}
pub struct AppState {
    control: Mutex<Control>,
    store: Store,
    reg: Mutex<Registry>,
    sys: Mutex<sysinfo::System>,
}
#[derive(serde::Serialize)]
struct RuntimeStatus {
    active: Option<Active>,
    services: std::collections::BTreeMap<String, String>,
}

fn publish_config(app: &tauri::AppHandle, snapshot: &Snapshot) {
    let _ = app.emit("config-changed", snapshot);
}
fn publish_runtime(app: &tauri::AppHandle) {
    let _ = app.emit("runtime-changed", ());
}

#[tauri::command]
fn get_config(state: State<AppState>) -> Snapshot {
    state.control.lock().unwrap().snapshot.clone()
}
#[tauri::command]
fn save_config(
    app: tauri::AppHandle,
    state: State<AppState>,
    configuration: Config,
    expected_revision: u64,
) -> Result<Snapshot, String> {
    let mut c = state.control.lock().unwrap();
    if c.shutting_down {
        return Err("Main window is shutting down".into());
    }
    if c.snapshot.revision != expected_revision {
        return Err("Configuration changed in another window. Reload before saving.".into());
    }
    let mut reg = state.reg.lock().unwrap();
    if !reg.alive("llama") {
        c.active = None;
    }
    config::reject_active_removal(&configuration, c.active.as_ref().map(|a| a.id.as_str()))?;
    if c.active.is_some()
        && (configuration.runtime != c.snapshot.configuration.runtime
            || configuration.model(&c.active.as_ref().unwrap().id)
                != c.snapshot
                    .configuration
                    .model(&c.active.as_ref().unwrap().id))
    {
        return Err("Stop the active model before editing its entry or runtime settings".into());
    }
    for (id, old) in &c.snapshot.configuration.services {
        if reg.alive(id) && configuration.services.get(id) != Some(old) {
            return Err(format!("Stop {id} before changing its configuration"));
        }
    }
    let snapshot = state.store.save(&configuration, c.snapshot.revision + 1)?;
    c.snapshot = snapshot.clone();
    drop(reg);
    drop(c);
    publish_config(&app, &snapshot);
    Ok(snapshot)
}
#[tauri::command]
fn recover_config(app: tauri::AppHandle, state: State<AppState>) -> Result<Snapshot, String> {
    let mut c = state.control.lock().unwrap();
    let mut reg = state.reg.lock().unwrap();
    if c.active.is_some() || ["open_web_ui", "tts", "stt"].iter().any(|id| reg.alive(id)) {
        return Err("Stop owned processes before restoring configuration".into());
    }
    let snapshot = state.store.recover(c.snapshot.revision + 1)?;
    c.snapshot = snapshot.clone();
    drop(reg);
    drop(c);
    publish_config(&app, &snapshot);
    Ok(snapshot)
}
#[tauri::command]
fn save_appearance(
    app: tauri::AppHandle,
    state: State<AppState>,
    appearance: config::Appearance,
) -> Result<Snapshot, String> {
    let mut c = state.control.lock().unwrap();
    if c.shutting_down {
        return Err("Main window is shutting down".into());
    }
    if c.snapshot.status == "invalid" {
        return Err(
            "Repair the saved configuration before appearance can be saved automatically".into(),
        );
    }
    let snapshot = state.store.save_appearance(
        &c.snapshot.configuration,
        appearance,
        c.snapshot.revision + 1,
    )?;
    c.snapshot = snapshot.clone();
    drop(c);
    let _ = app.emit("appearance-saved", &snapshot);
    Ok(snapshot)
}
#[tauri::command]
fn open_flag_reference() -> Result<(), String> {
    const URL: &str =
        "https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#usage";
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(URL)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Open flag reference: {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = URL;
        Err("Open the llama.cpp server flag reference in your browser".into())
    }
}
#[tauri::command]
async fn browse_file(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    kind: file_picker::FileKind,
    current_path: String,
) -> Result<Option<String>, String> {
    if window.label() != "settings" {
        return Err("Open Settings to choose a file.".into());
    }
    #[cfg(windows)]
    let owner = window.hwnd().map_err(|_| "Settings window is unavailable".to_string())?.0 as isize;
    #[cfg(not(windows))]
    let owner = 0;
    let client_key = state.store.path.to_string_lossy().into_owned();
    // Keep the dashboard event loop responsive while the Settings-owned dialog is open.
    tauri::async_runtime::spawn_blocking(move || file_picker::pick(owner, kind, &current_path, &client_key))
        .await
        .map_err(|_| "File picker task did not finish".to_string())?
}
#[tauri::command]
fn gpu_poll(state: State<AppState>) -> Result<Vec<gpu::GpuReading>, String> {
    let m = state
        .control
        .lock()
        .unwrap()
        .snapshot
        .configuration
        .monitoring
        .clone();
    match m.backend.as_str() {
        "amd-adlx" if !m.helper.is_empty() => gpu::poll_adlx(&m.helper),
        "nvidia-smi" if !m.nvidia_smi.is_empty() => gpu::poll_nvidia(&m.nvidia_smi),
        _ => Err(
            "GPU monitoring unavailable: no helper/runtime is included in this development copy"
                .into(),
        ),
    }
}
#[tauri::command]
fn system_stats(state: State<AppState>) -> gpu::SystemStats {
    gpu::system_stats(&mut state.sys.lock().unwrap())
}

async fn http_ok(url: &str) -> bool {
    let Ok(client) = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(1200))
        .build()
    else {
        return false;
    };
    matches!(client.get(url).send().await,Ok(r) if r.status().is_success())
}
async fn model_ready(base: &str, expected: &str) -> bool {
    if !http_ok(&format!("{base}/health")).await {
        return false;
    }
    let Ok(client) = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(1200))
        .build()
    else {
        return false;
    };
    let Ok(r) = client.get(format!("{base}/v1/models")).send().await else {
        return false;
    };
    if !r.status().is_success() {
        return false;
    }
    let Ok(v) = r.json::<serde_json::Value>().await else {
        return false;
    };
    v.get("data")
        .and_then(|x| x.as_array())
        .is_some_and(|rows| {
            rows.iter()
                .any(|m| m.get("id").and_then(|x| x.as_str()) == Some(expected))
        })
}
fn fail_start(state: &AppState, generation: u64) -> bool {
    let mut c = state.control.lock().unwrap();
    if !c.shutting_down && c.generation == generation {
        state.reg.lock().unwrap().kill("llama");
        c.active = None;
        return true;
    }
    false
}
#[derive(serde::Serialize)]
struct StartOutcome {
    warning: Option<String>,
}
#[tauri::command]
async fn start_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    model_id: String,
    ctx_mode: Option<String>,
    tensor_split: Option<String>,
) -> Result<StartOutcome, String> {
    let (cfg, profile, base, generation) = {
        let mut c = state.control.lock().unwrap();
        if c.shutting_down || c.snapshot.status == "invalid" {
            return Err("Resolve configuration before starting a model".into());
        }
        let cfg = c.snapshot.configuration.clone();
        let m = cfg.model(&model_id).ok_or("Unknown model entry")?;
        let ctx = ctx_mode.as_deref().unwrap_or(&m.default_context);
        let profile = m
            .contexts
            .iter()
            .find(|p| p.id == ctx)
            .ok_or("Unknown context profile")?
            .clone();
        let args = launch::build_args(&cfg, m, &profile, tensor_split.as_deref())?;
        let mut reg = state.reg.lock().unwrap();
        // A validated explicit start replaces only this instance's previous model.
        // Invalidate its readiness task even if this replacement cannot spawn.
        c.generation += 1;
        let generation = c.generation;
        reg.kill("llama");
        c.active = None;
        launch::port_available(&cfg.runtime.host, cfg.runtime.port)?;
        let mut command = std::process::Command::new(&cfg.runtime.binary);
        command.args(args);
        if let Some(p) = std::path::Path::new(&cfg.runtime.binary).parent() {
            command.current_dir(p);
        }
        let log = state
            .store
            .path
            .parent()
            .unwrap()
            .join("logs/llama-server.log");
        reg.insert("llama", proc::spawn_logged(command, Some(&log))?);
        c.active = Some(Active {
            id: model_id.clone(),
            context: profile.id.clone(),
            phase: "starting".into(),
            generation,
        });
        let base = launch::base_url(&cfg.runtime.host, cfg.runtime.port);
        (cfg, profile, base, generation)
    };
    publish_runtime(&app);
    // Cancellation generation prevents an old readiness task from stopping a newer process.
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    while std::time::Instant::now() < deadline {
        {
            let mut c = state.control.lock().unwrap();
            if c.shutting_down || c.generation != generation {
                return Err("Model start was cancelled".into());
            }
            if !state.reg.lock().unwrap().alive("llama") {
                c.active = None;
                drop(c);
                publish_runtime(&app);
                return Err(
                    "Backend exited before becoming ready. Check the development logs.".into(),
                );
            }
        }
        if model_ready(&base, &model_id).await {
            let mut c = state.control.lock().unwrap();
            if c.shutting_down || c.generation != generation {
                return Err("Model start was cancelled".into());
            }
            if !state.reg.lock().unwrap().alive("llama") {
                c.active = None;
                drop(c);
                publish_runtime(&app);
                return Err("Backend exited at readiness; no running model was reported".into());
            }
            c.active.as_mut().unwrap().phase = "running".into();
            // Synchronization failure is visible and does not misreport running inference as stopped.
            let warning = launch::sync_opencode(&cfg.opencode, &model_id, &profile).err();
            drop(c);
            publish_runtime(&app);
            return Ok(StartOutcome { warning });
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    if !fail_start(&state, generation) {
        return Err("Model start was cancelled".into());
    }
    publish_runtime(&app);
    Err("Backend readiness failed within 120 seconds; the owned backend was stopped".into())
}
#[tauri::command]
fn stop_model(app: tauri::AppHandle, state: State<AppState>) {
    let mut c = state.control.lock().unwrap();
    c.generation += 1;
    state.reg.lock().unwrap().kill("llama");
    c.active = None;
    drop(c);
    publish_runtime(&app);
}
#[tauri::command]
async fn service_start(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    service_id: String,
) -> Result<(), String> {
    let (url, pid) = {
        let c = state.control.lock().unwrap();
        if c.shutting_down {
            return Err("Main window is shutting down".into());
        }
        let s = c
            .snapshot
            .configuration
            .services
            .get(&service_id)
            .ok_or("Unknown optional service")?;
        if !s.enabled {
            return Err("Enable and configure this service in Settings first".into());
        }
        c.snapshot.configuration.validate(true)?;
        let mut reg = state.reg.lock().unwrap();
        if reg.alive(&service_id) {
            return Err("Service is already owned by this instance".into());
        }
        launch::port_available("127.0.0.1", s.port)?;
        let log = state
            .store
            .path
            .parent()
            .unwrap()
            .join("logs")
            .join(format!("{service_id}.log"));
        let m = proc::spawn_logged(
            proc::command_from_spec(s.start_command.as_ref().ok_or("Missing service command")?),
            Some(&log),
        )?;
        let pid = m.child.id();
        reg.insert(&service_id, m);
        (s.health_url.clone(), pid)
    };
    publish_runtime(&app);
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    while std::time::Instant::now() < deadline {
        {
            let mut reg = state.reg.lock().unwrap();
            if reg.pid(&service_id) != Some(pid) || !reg.alive(&service_id) {
                return Err("Service stopped or exited before readiness".into());
            }
        }
        if http_ok(&url).await {
            publish_runtime(&app);
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(750)).await;
    }
    let mut reg = state.reg.lock().unwrap();
    if reg.pid(&service_id) == Some(pid) {
        reg.kill(&service_id);
    }
    drop(reg);
    publish_runtime(&app);
    Err("Service readiness timed out; the owned process was stopped".into())
}
#[tauri::command]
fn service_stop(
    app: tauri::AppHandle,
    state: State<AppState>,
    service_id: String,
) -> Result<(), String> {
    if !matches!(service_id.as_str(), "open_web_ui" | "tts" | "stt") {
        return Err("Unknown optional service".into());
    }
    state.reg.lock().unwrap().kill(&service_id);
    publish_runtime(&app);
    Ok(())
}
#[tauri::command]
async fn runtime_status(state: State<'_, AppState>) -> Result<RuntimeStatus, String> {
    let (mut active, services, base) = {
        let mut c = state.control.lock().unwrap();
        let mut reg = state.reg.lock().unwrap();
        if !reg.alive("llama") {
            c.active = None;
        }
        let services: Vec<_> = c
            .snapshot
            .configuration
            .services
            .iter()
            .map(|(id, s)| (id.clone(), s.clone(), reg.alive(id)))
            .collect();
        (
            c.active.clone(),
            services,
            launch::base_url(
                &c.snapshot.configuration.runtime.host,
                c.snapshot.configuration.runtime.port,
            ),
        )
    };
    if let Some(a) = active.as_mut() {
        if a.phase == "running" && !model_ready(&base, &a.id).await {
            a.phase = "unhealthy".into();
        }
    }
    let mut statuses = std::collections::BTreeMap::new();
    for (id, s, owned) in services {
        let status = if !s.enabled {
            "disabled"
        } else if !owned {
            "stopped"
        } else if http_ok(&s.health_url).await {
            "ready"
        } else {
            "not-ready"
        };
        statuses.insert(id, status.into());
    }
    Ok(RuntimeStatus {
        active,
        services: statuses,
    })
}

#[tauri::command]
async fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        w.unminimize().map_err(|e| e.to_string())?;
        w.show().map_err(|e| e.to_string())?;
        return w.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html?window=settings".into()),
    )
    .data_directory(
        app.state::<AppState>()
            .store
            .path
            .parent()
            .unwrap()
            .join("webview"),
    )
    .title("AI Nexus — Settings")
    .inner_size(900., 760.)
    .min_inner_size(660., 500.)
    .decorations(true)
    .resizable(true)
    .build()
    .map(|_| ())
    .map_err(|e| format!("Open Settings: {e}"))
}
#[tauri::command]
fn win_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}
#[tauri::command]
fn win_compact(window: tauri::WebviewWindow, on: bool) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Compact mode belongs to the main dashboard".into());
    }
    window
        .set_min_size(Some(tauri::LogicalSize::new(
            if on { 700. } else { 980. },
            if on { 88. } else { 640. },
        )))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::LogicalSize::new(
            if on { 860. } else { 1180. },
            if on { 88. } else { 760. },
        ))
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn win_close(window: tauri::WebviewWindow) -> Result<(), String> {
    // Settings already flushes preferences before invoking this command.
    // Destroying that window avoids a second close-request loop; main still
    // follows the explicit owned-process shutdown policy.
    if window.label() == "settings" {
        window.destroy().map_err(|e| e.to_string())
    } else {
        window.close().map_err(|e| e.to_string())
    }
}
fn shutdown(state: &AppState) {
    let mut c = state.control.lock().unwrap();
    c.shutting_down = true;
    c.generation += 1;
    c.active = None;
    state.reg.lock().unwrap().kill_all();
    drop(c);
    gpu::shutdown_monitor();
}
pub fn run() {
    let store = config::development_store()
        .expect("Development configuration location must stay inside the separate project");
    let snapshot = store.load(0);
    let webview_dir = store.path.parent().unwrap().join("webview");
    let mut context = tauri::generate_context!();
    let main_config = context
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .unwrap()
        .clone();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
    }
    tauri::Builder::default()
        .manage(AppState {
            control: Mutex::new(Control {
                snapshot,
                active: None,
                generation: 0,
                shutting_down: false,
            }),
            store,
            reg: Mutex::new(Registry::default()),
            sys: Mutex::new(sysinfo::System::new_all()),
        })
        .setup(move |app| {
            tauri::WebviewWindowBuilder::from_config(app, &main_config)?
                .data_directory(webview_dir.clone())
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            recover_config,
            save_appearance,
            browse_file,
            open_flag_reference,
            gpu_poll,
            system_stats,
            start_model,
            stop_model,
            service_start,
            service_stop,
            runtime_status,
            open_settings,
            win_minimize,
            win_compact,
            win_close
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                lifecycle::on_close(window.label(), || {
                    shutdown(&window.state::<AppState>());
                    window.app_handle().exit(0);
                });
            }
        })
        .build(context)
        .expect("Build AI Nexus development app")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                shutdown(&app.state::<AppState>());
            }
        });
}
