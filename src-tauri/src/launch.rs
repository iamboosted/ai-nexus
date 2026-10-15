use crate::config::{Config, ContextProfile, Model, OpenCode};
use std::{fs, net::TcpListener, path::Path};
pub fn base_url(host: &str, port: u16) -> String {
    format!(
        "http://{}:{port}",
        if host == "::1" { "[::1]" } else { host }
    )
}
pub fn port_available(host: &str, port: u16) -> Result<(), String> {
    // Check both loopback address families: never attach to or terminate another listener.
    for ip in ["127.0.0.1", "::1"] {
        if let Err(e) = TcpListener::bind((ip, port)) {
            if e.kind() == std::io::ErrorKind::AddrInUse || ip == host {
                return Err(format!(
                    "Port {port} is occupied or unavailable; no external process was stopped"
                ));
            }
        }
    }
    Ok(())
}
pub fn build_args(
    cfg: &Config,
    m: &Model,
    p: &ContextProfile,
    split: Option<&str>,
) -> Result<Vec<String>, String> {
    cfg.validate(false)?;
    if cfg.runtime.binary.is_empty()
        || !Path::new(&cfg.runtime.binary).is_file()
        || cfg.runtime.backend.is_none()
    {
        return Err("Select an existing llama.cpp executable and backend in Settings".into());
    }
    for (label, path, required) in [
        ("model", m.file.as_str(), true),
        ("projector", m.mmproj.as_str(), false),
        ("draft", m.draft_file.as_str(), false),
    ] {
        if (required || !path.is_empty())
            && (!Path::new(path).is_absolute() || !Path::new(path).is_file())
        {
            return Err(format!("Selected {label} file is unavailable"));
        }
    }
    let chosen = split.unwrap_or(&p.tensor_split);
    crate::config::validate_split(chosen, cfg.runtime.devices.len())?;
    let mut a = vec![
        "--model".into(),
        m.file.clone(),
        "--alias".into(),
        m.id.clone(),
        "--host".into(),
        cfg.runtime.host.clone(),
        "--port".into(),
        cfg.runtime.port.to_string(),
        "--ctx-size".into(),
        p.ctx_size.to_string(),
    ];
    if !cfg.runtime.devices.is_empty() {
        a.extend(["--device".into(), cfg.runtime.devices.join(",")]);
    }
    if let Some(i) = cfg.runtime.main_gpu {
        a.extend(["--main-gpu".into(), i.to_string()]);
    }
    if !chosen.trim().is_empty() {
        a.extend(["--tensor-split".into(), chosen.trim().into()]);
    }
    if !m.mmproj.is_empty() {
        a.extend(["--mmproj".into(), m.mmproj.clone()]);
    }
    if !m.draft_file.is_empty() {
        a.extend(["--model-draft".into(), m.draft_file.clone()]);
    }
    for (flag, value) in [
        ("--cache-type-k", &p.cache_type_k),
        ("--cache-type-v", &p.cache_type_v),
    ] {
        if let Some(v) = value {
            a.extend([flag.into(), v.clone()]);
        }
    }
    a.extend([
        "--temp".into(),
        m.sampling.temp.to_string(),
        "--top-p".into(),
        m.sampling.top_p.to_string(),
        "--top-k".into(),
        m.sampling.top_k.to_string(),
    ]);
    a.extend(m.flags.iter().cloned());
    a.extend(cfg.runtime.extra_args.iter().cloned());
    Ok(a)
}
pub fn sync_opencode(cfg: &OpenCode, id: &str, p: &ContextProfile) -> Result<(), String> {
    if !cfg.enabled {
        return Ok(());
    }
    let Some(target) = cfg.model_ids.get(id) else {
        return Ok(());
    };
    let path = Path::new(&cfg.config_path);
    let bytes = fs::read(path).map_err(|e| {
        format!("Inference is ready, but OpenCode sync could not read its configuration: {e}")
    })?;
    let mut root: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Inference is ready, but OpenCode sync needs a valid JSON configuration")?;
    let model = root
        .get_mut("provider")
        .and_then(|v| v.get_mut(&cfg.provider_id))
        .and_then(|v| v.get_mut("models"))
        .and_then(|v| v.get_mut(target))
        .and_then(|v| v.as_object_mut())
        .ok_or("Inference is ready, but the configured OpenCode model mapping is missing")?;
    let limit = model
        .entry("limit")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("Inference is ready, but OpenCode limit is not an object")?;
    limit.insert("context".into(), p.ctx_size.into());
    if let Some(n) = p.output_limit {
        limit.insert("output".into(), n.into());
    }
    root.as_object_mut()
        .ok_or("OpenCode root must be an object")?
        .insert(
            "model".into(),
            format!("{}/{}", cfg.provider_id, target).into(),
        );
    let backup = path.with_file_name(format!(
        "{}.ai-nexus.previous",
        path.file_name()
            .ok_or("OpenCode filename missing")?
            .to_string_lossy()
    ));
    crate::config::atomic_write(&backup, &bytes)
        .map_err(|e| format!("Inference is ready, but OpenCode backup failed: {e}"))?;
    crate::config::atomic_write(
        path,
        &serde_json::to_vec_pretty(&root).map_err(|_| "OpenCode serialization failed")?,
    )
    .map_err(|e| format!("Inference is ready, but OpenCode sync failed: {e}"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn occupied_port_is_rejected_without_touching_listener() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(port_available("127.0.0.1", port).is_err());
        assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_ok());
    }
    #[test]
    fn disabled_sync_never_reads_a_file() {
        sync_opencode(&OpenCode::default(), "fixture", &ContextProfile::default()).unwrap();
    }
    #[test]
    fn ipv6_url_is_bracketed() {
        assert_eq!(base_url("::1", 8080), "http://[::1]:8080");
    }
}

#[cfg(test)]
mod fixture_tests {
    use super::*;
    use crate::config::{ContextProfile, Model, Runtime};
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join(".test-fixtures")
                .join(format!(
                    "launch-{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                ));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let root = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join(".test-fixtures");
            assert!(self.0.starts_with(root));
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn launch_plan_uses_supplied_paths_context_devices_and_split() {
        let f = Fixture::new();
        for name in ["backend.exe", "model.gguf", "projector.gguf", "draft.gguf"] {
            fs::write(f.0.join(name), b"fixture only").unwrap();
        }
        let p = ContextProfile {
            id: "16K".into(),
            ctx_size: 16384,
            tensor_split: "25,75".into(),
            ..ContextProfile::default()
        };
        let m = Model {
            id: "fixture".into(),
            name: "Fixture".into(),
            file: f.0.join("model.gguf").to_string_lossy().into(),
            mmproj: f.0.join("projector.gguf").to_string_lossy().into(),
            draft_file: f.0.join("draft.gguf").to_string_lossy().into(),
            contexts: vec![p.clone()],
            default_context: p.id.clone(),
            ..Model::default()
        };
        let cfg = Config {
            models: vec![m.clone()],
            runtime: Runtime {
                binary: f.0.join("backend.exe").to_string_lossy().into(),
                backend: Some("vulkan".into()),
                devices: vec!["fixture0".into(), "fixture1".into()],
                main_gpu: Some(0),
                port: 18080,
                ..Runtime::default()
            },
            ..Config::default()
        };
        let a = build_args(&cfg, &m, &p, Some("40,60")).unwrap();
        let value = |flag: &str| a.windows(2).find(|pair| pair[0] == flag).unwrap()[1].clone();
        assert_eq!(value("--tensor-split"), "40,60");
        assert_eq!(value("--device"), "fixture0,fixture1");
        assert_eq!(value("--ctx-size"), "16384");
        assert_eq!(value("--port"), "18080");
        assert_eq!(value("--model"), m.file);
        assert_eq!(value("--mmproj"), m.mmproj);
        assert_eq!(value("--model-draft"), m.draft_file);
        assert!(build_args(&cfg, &m, &p, Some("NaN,1")).is_err());
        fs::remove_file(&m.mmproj).unwrap();
        assert!(build_args(&cfg, &m, &p, None).is_err());
    }
    #[test]
    fn missing_opencode_mapping_is_an_error_without_a_partial_write() {
        let f = Fixture::new();
        let path = f.0.join("opencode.json");
        let bytes = br#"{"provider":{},"model":"previous"}"#;
        fs::write(&path, bytes).unwrap();
        let cfg = OpenCode {
            enabled: true,
            config_path: path.to_string_lossy().into(),
            provider_id: "fixture".into(),
            model_ids: std::collections::BTreeMap::from([("local".into(), "mapped".into())]),
        };
        let e = sync_opencode(&cfg, "local", &ContextProfile::default()).unwrap_err();
        assert!(e.contains("Inference is ready"));
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    #[test]
    fn opencode_mapping_has_an_atomic_recoverable_backup() {
        let f = Fixture::new();
        let path = f.0.join("opencode.json");
        let bytes = br#"{"provider":{"fixture":{"models":{"mapped":{}}}},"model":"previous"}"#;
        fs::write(&path, bytes).unwrap();
        let cfg = OpenCode {
            enabled: true,
            config_path: path.to_string_lossy().into(),
            provider_id: "fixture".into(),
            model_ids: std::collections::BTreeMap::from([("local".into(), "mapped".into())]),
        };
        sync_opencode(&cfg, "local", &ContextProfile::default()).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(v["model"], "fixture/mapped");
        assert_eq!(
            v["provider"]["fixture"]["models"]["mapped"]["limit"]["context"],
            8192
        );
        assert_eq!(
            fs::read(f.0.join("opencode.json.ai-nexus.previous")).unwrap(),
            bytes
        );
    }
}
