//! Development configuration. No personal launcher configuration is read.
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Runtime {
    pub binary: String,
    pub backend: Option<String>,
    pub host: String,
    pub port: u16,
    pub devices: Vec<String>,
    pub main_gpu: Option<u32>,
    pub extra_args: Vec<String>,
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            binary: String::new(),
            backend: None,
            host: "127.0.0.1".into(),
            port: 8080,
            devices: vec![],
            main_gpu: None,
            extra_args: vec![],
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct ContextProfile {
    pub id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub name: String,
    pub ctx_size: u32,
    pub tensor_split: String,
    pub output_limit: Option<u32>,
    pub cache_type_k: Option<String>,
    pub cache_type_v: Option<String>,
}
impl Default for ContextProfile {
    fn default() -> Self {
        Self {
            id: "8K".into(),
            name: String::new(),
            ctx_size: 8192,
            tensor_split: String::new(),
            output_limit: None,
            cache_type_k: None,
            cache_type_v: None,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Sampling {
    pub temp: f64,
    pub top_p: f64,
    pub top_k: u32,
}
impl Default for Sampling {
    fn default() -> Self {
        Self {
            temp: 0.7,
            top_p: 0.95,
            top_k: 40,
        }
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tier: String,
    pub quant: String,
    pub primary: bool,
    pub weights_gb: Option<f64>,
    pub file: String,
    pub mmproj: String,
    pub draft_file: String,
    pub contexts: Vec<ContextProfile>,
    pub default_context: String,
    pub flags: Vec<String>,
    pub sampling: Sampling,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct ProcSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Service {
    pub enabled: bool,
    pub port: u16,
    pub health_url: String,
    pub start_command: Option<ProcSpec>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct OpenCode {
    pub enabled: bool,
    pub config_path: String,
    pub provider_id: String,
    pub model_ids: BTreeMap<String, String>,
}
impl Default for OpenCode {
    fn default() -> Self {
        Self {
            enabled: false,
            config_path: String::new(),
            provider_id: "local".into(),
            model_ids: BTreeMap::new(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Monitoring {
    pub backend: String,
    pub helper: String,
    pub nvidia_smi: String,
    pub poll_interval_ms: u64,
}
impl Default for Monitoring {
    fn default() -> Self {
        Self {
            backend: "unavailable".into(),
            helper: String::new(),
            nvidia_smi: String::new(),
            poll_interval_ms: 2000,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Appearance {
    pub accent_color: String,
    pub ink: String,
    pub motion: String,
    pub backdrop: String,
    pub density: String,
    pub font: String,
    pub card_style: String,
    pub form: String,
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            accent_color: "#E87D2F".into(),
            ink: "black".into(),
            motion: "live".into(),
            backdrop: "ember".into(),
            density: "comfortable".into(),
            font: "grotesk".into(),
            card_style: "glow".into(),
            form: "standard".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub schema_version: u32,
    pub runtime: Runtime,
    pub models: Vec<Model>,
    pub monitoring: Monitoring,
    pub appearance: Appearance,
    pub services: BTreeMap<String, Service>,
    pub opencode: OpenCode,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            schema_version: 1,
            runtime: Runtime::default(),
            models: vec![],
            monitoring: Monitoring::default(),
            appearance: Appearance::default(),
            opencode: OpenCode::default(),
            services: [("open_web_ui", 8008), ("tts", 8880), ("stt", 8890)]
                .into_iter()
                .map(|(id, port)| {
                    (
                        id.into(),
                        Service {
                            port,
                            health_url: format!("http://127.0.0.1:{port}/health"),
                            ..Service::default()
                        },
                    )
                })
                .collect(),
        }
    }
}
fn id_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b))
}
fn file(value: &str, field: &str, required: bool) -> Result<(), String> {
    if value.is_empty() && !required {
        return Ok(());
    }
    let p = Path::new(value);
    if !p.is_absolute() || !p.is_file() {
        return Err(format!("{field}: choose an existing absolute file path"));
    }
    Ok(())
}
pub fn validate_split(split: &str, devices: usize) -> Result<(), String> {
    if split.trim().is_empty() {
        return Ok(());
    }
    let parts: Vec<f64> = split
        .split(',')
        .map(|x| x.trim().parse::<f64>())
        .collect::<Result<_, _>>()
        .map_err(|_| "Split must contain comma-separated numbers")?;
    let sum: f64 = parts.iter().sum();
    if parts.iter().any(|x| !x.is_finite() || *x < 0.0) || !sum.is_finite() || sum <= 0.0 {
        return Err("Split values must be finite, nonnegative, and have a positive total".into());
    }
    if devices > 0 && parts.len() != devices {
        return Err("Split count must match the explicitly selected device count".into());
    }
    Ok(())
}
fn flags(args: &[String]) -> Result<(), String> {
    const MANAGED: &[&str] = &[
        "--model",
        "-m",
        "--mmproj",
        "-md",
        "--model-draft",
        "--alias",
        "--port",
        "--host",
        "--ctx-size",
        "-c",
        "--tensor-split",
        "-ts",
        "--device",
        "--main-gpu",
        "-mg",
        "--temp",
        "--top-p",
        "--top-k",
        "-ctk",
        "-ctv",
        "--cache-type-k",
        "--cache-type-v",
    ];
    if args
        .iter()
        .any(|a| a.contains('\0') || MANAGED.contains(&a.split('=').next().unwrap_or(a)))
    {
        return Err(
            "Extra flags contain a setting managed by configuration, or a NUL character".into(),
        );
    }
    Ok(())
}
impl Config {
    pub fn model(&self, id: &str) -> Option<&Model> {
        self.models.iter().find(|m| m.id == id)
    }
    /// Structural validation is separate from availability of user-supplied files.
    pub fn validate(&self, check_paths: bool) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("Unsupported configuration schema_version (expected 1)".into());
        }
        if !matches!(
            self.runtime.host.as_str(),
            "127.0.0.1" | "localhost" | "::1"
        ) || self.runtime.port == 0
        {
            return Err("Runtime needs a loopback host and a nonzero port".into());
        }
        if self
            .runtime
            .backend
            .as_deref()
            .is_some_and(|b| !matches!(b, "cuda" | "hip" | "vulkan"))
        {
            return Err("Select the llama.cpp CUDA, HIP, or Vulkan build".into());
        }
        if !self.runtime.binary.is_empty() && self.runtime.backend.is_none() {
            return Err("Choose a backend for the supplied executable".into());
        }
        let mut devices = BTreeSet::new();
        for d in &self.runtime.devices {
            if d.trim().is_empty() || d.contains([',', '\0']) || !devices.insert(d) {
                return Err("Device identifiers must be nonempty, unique, and comma-free".into());
            }
        }
        if self
            .runtime
            .main_gpu
            .is_some_and(|i| i as usize >= self.runtime.devices.len())
        {
            return Err("Main GPU index must refer to the selected device list".into());
        }
        flags(&self.runtime.extra_args)?;
        if check_paths {
            file(&self.runtime.binary, "Runtime executable", false)?;
        }
        let mut ids = BTreeSet::new();
        for m in &self.models {
            if !id_ok(&m.id) || !ids.insert(&m.id) {
                return Err("Model IDs must be unique and use letters, numbers, underscores, dots or hyphens".into());
            }
            if m.name.trim().is_empty() || m.contexts.is_empty() {
                return Err(format!(
                    "Model {} needs a display name and at least one context",
                    m.id
                ));
            }
            if m.weights_gb.is_some_and(|n| !n.is_finite() || n < 0.0) {
                return Err("Weight size must be finite and nonnegative".into());
            }
            if !m.sampling.temp.is_finite()
                || m.sampling.temp < 0.0
                || !m.sampling.top_p.is_finite()
                || !(0.0..=1.0).contains(&m.sampling.top_p)
            {
                return Err("Invalid sampling temperature or top-p".into());
            }
            flags(&m.flags)?;
            let mut contexts = BTreeSet::new();
            for c in &m.contexts {
                if c.name.chars().count() > 160 || c.name.chars().any(char::is_control) {
                    return Err("Profile names must be at most 160 characters, without control characters".into());
                }
                if !id_ok(&c.id) || !contexts.insert(&c.id) || c.ctx_size == 0 {
                    return Err(format!(
                        "Model {} has invalid or duplicate context IDs/sizes",
                        m.id
                    ));
                }
                if c.output_limit.is_some_and(|n| n == 0 || n > c.ctx_size) {
                    return Err(
                        "Output limit must be positive and no greater than context size".into(),
                    );
                }
                validate_split(&c.tensor_split, self.runtime.devices.len())?;
                for cache in [&c.cache_type_k, &c.cache_type_v].into_iter().flatten() {
                    if !matches!(
                        cache.as_str(),
                        "f16" | "bf16" | "q8_0" | "q4_0" | "q4_1" | "q5_0" | "q5_1" | "iq4_nl"
                    ) {
                        return Err("Unsupported cache type in context".into());
                    }
                }
            }
            if !contexts.contains(&m.default_context) {
                return Err(format!("Model {} default context does not exist", m.id));
            }
            if check_paths {
                file(&m.file, "Model file", true)?;
                file(&m.mmproj, "Projector file", false)?;
                file(&m.draft_file, "Draft file", false)?;
            }
        }
        let a = &self.appearance;
        if a.accent_color.len() != 7
            || !a.accent_color.starts_with('#')
            || !a.accent_color[1..].bytes().all(|x| x.is_ascii_hexdigit())
        {
            return Err("Accent must be a six-digit hex color".into());
        }
        for (field, value, allowed) in [
            ("ink", a.ink.as_str(), &["black", "white"][..]),
            ("motion", a.motion.as_str(), &["live", "static"][..]),
            (
                "backdrop",
                a.backdrop.as_str(),
                &["ember", "mesh", "topo", "grid", "scan", "void"][..],
            ),
            (
                "density",
                a.density.as_str(),
                &["comfortable", "compact"][..],
            ),
            ("font", a.font.as_str(), &["grotesk", "geist", "mono"][..]),
            (
                "card_style",
                a.card_style.as_str(),
                &["flat", "outlined", "glow"][..],
            ),
            ("form", a.form.as_str(), &["standard", "panel", "bar"][..]),
        ] {
            if !allowed.contains(&value) {
                return Err(format!("Invalid appearance {field}"));
            }
        }
        if !matches!(
            self.monitoring.backend.as_str(),
            "unavailable" | "amd-adlx" | "nvidia-smi"
        ) || !(250..=60000).contains(&self.monitoring.poll_interval_ms)
        {
            return Err("Invalid monitoring backend or polling interval".into());
        }
        if check_paths {
            if self.monitoring.backend == "amd-adlx" {
                file(&self.monitoring.helper, "Monitoring helper", true)?;
            }
            if self.monitoring.backend == "nvidia-smi" {
                file(&self.monitoring.nvidia_smi, "nvidia-smi executable", true)?;
            }
        }
        let mut ports = BTreeSet::from([self.runtime.port]);
        for (id, s) in &self.services {
            if !matches!(id.as_str(), "open_web_ui" | "tts" | "stt") {
                return Err("Unknown optional service ID".into());
            }
            if !s.enabled {
                continue;
            }
            if s.port == 0 || !ports.insert(s.port) {
                return Err("Enabled services and inference need distinct nonzero ports".into());
            }
            let authority = s
                .health_url
                .strip_prefix("http://")
                .or_else(|| s.health_url.strip_prefix("https://"))
                .map(|s| s.split(['/', '?', '#']).next().unwrap_or(""));
            if !["localhost", "127.0.0.1", "[::1]"]
                .iter()
                .any(|h| authority == Some(format!("{h}:{}", s.port).as_str()))
            {
                return Err(
                    "Service health URL must use its configured loopback port without credentials"
                        .into(),
                );
            }
            let spec = s
                .start_command
                .as_ref()
                .ok_or("Enabled service needs a start command")?;
            if spec.program.is_empty() {
                return Err("Service program is empty".into());
            }
            if check_paths {
                file(&spec.program, "Service executable", true)?;
                if let Some(p) = &spec.cwd {
                    if !Path::new(p).is_absolute() || !Path::new(p).is_dir() {
                        return Err("Service working directory is missing or relative".into());
                    }
                }
            }
        }
        if self.opencode.model_ids.keys().any(|id| !ids.contains(id))
            || self.opencode.model_ids.values().any(|id| !id_ok(id))
        {
            return Err(
                "OpenCode mappings must refer to configured entries and valid target IDs".into(),
            );
        }
        if self.opencode.enabled {
            if !id_ok(&self.opencode.provider_id) {
                return Err("Invalid OpenCode provider ID".into());
            }
            if check_paths {
                file(&self.opencode.config_path, "OpenCode config", true)?;
            }
        }
        Ok(())
    }
}
pub fn reject_active_removal(next: &Config, active: Option<&str>) -> Result<(), String> {
    if active.is_some_and(|id| next.model(id).is_none()) {
        return Err("Stop the active model before removing or renaming its entry".into());
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
pub struct Snapshot {
    pub configuration: Config,
    pub revision: u64,
    pub status: String,
    pub error: Option<String>,
    pub config_path: String,
    pub previous_available: bool,
}
#[derive(Clone)]
pub struct Store {
    pub path: PathBuf,
}
impl Store {
    pub fn previous_path(&self) -> PathBuf {
        self.path.with_file_name("launcher.config.previous.json")
    }
    pub fn load(&self, revision: u64) -> Snapshot {
        let result = fs::read(&self.path)
            .map_err(|e| format!("Configuration could not be read: {e}"))
            .and_then(|b| {
                serde_json::from_slice::<Config>(&b).map_err(|e| {
                    format!(
                        "Invalid configuration JSON at line {}, column {}",
                        e.line(),
                        e.column()
                    )
                })
            })
            .and_then(|c| {
                c.validate(false)?;
                Ok(c)
            });
        let (configuration,status,error) = match result {
            Ok(c) => (c,"ready".into(),None),
            Err(_) if !self.path.exists() => (Config::default(),"missing".into(),Some("No development configuration exists. Add your runtime and model entries in Settings, then save.".into())),
            Err(e) => (Config::default(),"invalid".into(),Some(e)),
        };
        Snapshot {
            configuration,
            revision,
            status,
            error,
            config_path: self.path.to_string_lossy().into(),
            previous_available: self.previous_path().is_file(),
        }
    }
    pub fn save(&self, cfg: &Config, revision: u64) -> Result<Snapshot, String> {
        self.save_validated(cfg, revision, true)
    }
    /// Appearance-only changes use the saved configuration, never an editor draft.
    /// Unavailable model/service files must not prevent a theme preference save.
    pub fn save_appearance(
        &self,
        saved: &Config,
        appearance: Appearance,
        revision: u64,
    ) -> Result<Snapshot, String> {
        let mut next = saved.clone();
        next.appearance = appearance;
        self.save_validated(&next, revision, false)
    }
    fn save_validated(
        &self,
        cfg: &Config,
        revision: u64,
        check_paths: bool,
    ) -> Result<Snapshot, String> {
        cfg.validate(check_paths)?;
        fs::create_dir_all(self.path.parent().ok_or("Configuration has no parent")?)
            .map_err(|e| format!("Create configuration folder: {e}"))?;
        match fs::read(&self.path) {
            Ok(old) => {
                let valid =
                    serde_json::from_slice::<Config>(&old).is_ok_and(|c| c.validate(false).is_ok());
                let backup = if valid {
                    self.previous_path()
                } else {
                    self.path.with_file_name("launcher.config.invalid.json")
                };
                atomic_write(&backup, &old)
                    .map_err(|e| format!("Preserve previous configuration: {e}"))?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Read current configuration before saving: {e}")),
        }
        atomic_write(
            &self.path,
            &serde_json::to_vec_pretty(cfg).map_err(|_| "Serialize configuration")?,
        )
        .map_err(|e| format!("Save configuration: {e}"))?;
        Ok(self.load(revision))
    }
    pub fn recover(&self, revision: u64) -> Result<Snapshot, String> {
        let bytes = fs::read(self.previous_path())
            .map_err(|e| format!("Read previous configuration: {e}"))?;
        let cfg: Config =
            serde_json::from_slice(&bytes).map_err(|_| "Previous configuration is invalid JSON")?;
        cfg.validate(false)?;
        if self.path.is_file() {
            atomic_write(
                &self
                    .path
                    .with_file_name("launcher.config.before-recovery.json"),
                &fs::read(&self.path).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }
        atomic_write(&self.path, &bytes).map_err(|e| format!("Recover configuration: {e}"))?;
        Ok(self.load(revision))
    }
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_file_name(format!(
        ".nexus-save-{}-{}.tmp",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        replace_file(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let a: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let b: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), 1 | 8) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}
pub fn development_store() -> Result<Store, String> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("Development root missing")?;
    let data = std::env::var_os("AI_NEXUS_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join(".ai-nexus-data"));
    if !data.is_absolute()
        || !data.starts_with(root)
        || data
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(
            "AI_NEXUS_DATA_DIR must be an absolute path inside this separate development project"
                .into(),
        );
    }
    // Reject junction/symlink escapes, including pre-existing ancestors.
    let mut ancestor = data.as_path();
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or("Data directory has no existing ancestor")?;
    }
    let real_root = root
        .canonicalize()
        .map_err(|e| format!("Resolve development root: {e}"))?;
    if !ancestor
        .canonicalize()
        .map_err(|e| format!("Resolve data directory: {e}"))?
        .starts_with(&real_root)
    {
        return Err("Data directory resolves outside the development project".into());
    }
    Ok(Store {
        path: data.join("launcher.config.json"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let p = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join(".test-fixtures")
                .join(format!(
                    "config-{}-{}",
                    std::process::id(),
                    SEQUENCE.fetch_add(1, Ordering::Relaxed)
                ));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn store(&self) -> Store {
            Store {
                path: self.0.join("launcher.config.json"),
            }
        }
        fn config(&self) -> Config {
            let path = self.0.join("fixture.gguf");
            fs::write(&path, b"fixture only - not a model").unwrap();
            Config {
                models: vec![Model {
                    id: "fixture".into(),
                    name: "Fixture".into(),
                    file: path.to_string_lossy().into(),
                    contexts: vec![ContextProfile::default()],
                    default_context: "8K".into(),
                    ..Model::default()
                }],
                ..Config::default()
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let base = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join(".test-fixtures");
            assert!(self.0.starts_with(base));
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn missing_invalid_and_unreadable_are_explicit() {
        let f = Fixture::new();
        let s = f.store();
        assert_eq!(s.load(0).status, "missing");
        fs::write(&s.path, b"{invalid").unwrap();
        assert_eq!(s.load(0).status, "invalid");
        assert!(s.load(0).configuration.models.is_empty());
        fs::remove_file(&s.path).unwrap();
        fs::create_dir(&s.path).unwrap();
        assert_eq!(s.load(0).status, "invalid");
        assert!(s.save(&Config::default(), 1).is_err());
    }
    #[test]
    fn save_roundtrip_and_previous_recovery() {
        let f = Fixture::new();
        let s = f.store();
        let a = f.config();
        s.save(&a, 1).unwrap();
        let mut b = a.clone();
        b.appearance.motion = "static".into();
        assert_eq!(s.save(&b, 2).unwrap().configuration, b);
        fs::write(&s.path, b"broken").unwrap();
        assert_eq!(s.recover(3).unwrap().configuration, a);
    }
    #[test]
    fn legacy_profiles_load_and_names_roundtrip_without_changing_default_ids() {
        let legacy: ContextProfile = serde_json::from_str(r#"{"id":"8K","ctx_size":8192}"#).unwrap();
        assert!(legacy.name.is_empty());
        let f = Fixture::new();
        let s = f.store();
        let mut cfg = f.config();
        cfg.models[0].contexts[0] = legacy;
        cfg.models[0].contexts[0].name = "Daily chat".into();
        s.save(&cfg, 1).unwrap();
        let loaded = s.load(2).configuration;
        assert_eq!(loaded.models[0].contexts[0].name, "Daily chat");
        assert_eq!(loaded.models[0].contexts[0].id, "8K");
        assert_eq!(loaded.models[0].default_context, "8K");
        cfg.models[0].contexts[0].name = "bad\nname".into();
        assert!(s.save(&cfg, 3).is_err());
        assert_eq!(s.load(4).configuration, loaded);
    }
    #[test]
    fn duplicate_ids_contexts_and_schema_rejected() {
        let f = Fixture::new();
        let mut c = f.config();
        c.models.push(c.models[0].clone());
        assert!(c.validate(false).is_err());
        c.models.pop();
        c.models[0].contexts.push(ContextProfile::default());
        assert!(c.validate(false).is_err());
        c.models[0].contexts.pop();
        c.schema_version = 2;
        assert!(c.validate(false).is_err());
    }
    #[test]
    fn invalid_paths_splits_and_managed_flags_rejected() {
        let f = Fixture::new();
        let mut c = f.config();
        c.models[0].file = f.0.to_string_lossy().into();
        assert!(c.validate(true).is_err());
        for split in ["0,0", "-1,1", "NaN,1", "1,inf", "x,2", "1"] {
            assert!(validate_split(split, 2).is_err(), "accepted {split}");
        }
        assert!(validate_split("35,65", 2).is_ok());
        assert!(validate_split("", 0).is_ok());
        c.runtime.extra_args = vec!["--port=9000".into()];
        assert!(c.validate(false).is_err());
    }
    #[test]
    fn removing_entry_never_deletes_file_and_active_is_protected() {
        let f = Fixture::new();
        let s = f.store();
        let c = f.config();
        s.save(&c, 1).unwrap();
        let path = c.models[0].file.clone();
        let bytes = fs::read(&path).unwrap();
        let mut next = c;
        next.models.clear();
        assert!(reject_active_removal(&next, Some("fixture")).is_err());
        reject_active_removal(&next, None).unwrap();
        s.save(&next, 2).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    #[test]
    fn backup_failure_keeps_current_and_cleans_staging() {
        let f = Fixture::new();
        let s = f.store();
        s.save(&f.config(), 1).unwrap();
        let before = fs::read(&s.path).unwrap();
        fs::create_dir(s.previous_path()).unwrap();
        assert!(s.save(&Config::default(), 2).is_err());
        assert_eq!(before, fs::read(&s.path).unwrap());
        assert!(!fs::read_dir(&f.0).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".nexus-save-")));
    }
    #[test]
    fn invalid_input_is_retained_when_repaired() {
        let f = Fixture::new();
        let s = f.store();
        fs::write(&s.path, b"invalid").unwrap();
        s.save(&Config::default(), 1).unwrap();
        assert_eq!(
            fs::read(s.path.with_file_name("launcher.config.invalid.json")).unwrap(),
            b"invalid"
        );
    }
    #[test]
    fn defaults_have_no_models_runtimes_or_enabled_integrations() {
        let c = Config::default();
        c.validate(true).unwrap();
        assert!(c.models.is_empty());
        assert!(c.runtime.binary.is_empty());
        assert!(!c.opencode.enabled);
        assert!(c.services.values().all(|s| !s.enabled));
        assert_eq!(c.monitoring.backend, "unavailable");
        let mut c = c;
        c.services.get_mut("tts").unwrap().enabled = true;
        assert!(c.validate(true).is_err());
    }

    #[test]
    fn appearance_save_preserves_model_runtime_and_mapping_even_if_files_disappear() {
        let f = Fixture::new();
        let store = f.store();
        let saved = f.config();
        store.save(&saved, 1).unwrap();
        fs::remove_file(&saved.models[0].file).unwrap();
        assert!(store.save(&saved, 2).is_err());
        let a = Appearance {
            motion: "static".into(),
            accent_color: "#23d3c0".into(),
            ..saved.appearance.clone()
        };
        let snapshot = store.save_appearance(&saved, a.clone(), 2).unwrap();
        assert_eq!(snapshot.configuration.appearance, a);
        assert_eq!(snapshot.configuration.models, saved.models);
        assert_eq!(snapshot.configuration.runtime, saved.runtime);
        assert_eq!(snapshot.configuration.opencode, saved.opencode);
        let previous: Config =
            serde_json::from_slice(&fs::read(store.previous_path()).unwrap()).unwrap();
        assert_eq!(previous, saved);
    }
    #[test]
    fn invalid_appearance_and_appearance_write_failure_leave_configuration_unchanged() {
        let f = Fixture::new();
        let store = f.store();
        let saved = f.config();
        store.save(&saved, 1).unwrap();
        let before = fs::read(&store.path).unwrap();
        let bad = Appearance {
            accent_color: "bad".into(),
            ..Appearance::default()
        };
        assert!(store.save_appearance(&saved, bad, 2).is_err());
        assert_eq!(fs::read(&store.path).unwrap(), before);
        fs::create_dir(store.previous_path()).unwrap();
        let changed = Appearance {
            motion: "static".into(),
            ..Appearance::default()
        };
        assert!(store.save_appearance(&saved, changed, 2).is_err());
        assert_eq!(fs::read(&store.path).unwrap(), before);
    }
}
