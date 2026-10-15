//! GPU telemetry (AMD ADLX or legacy nvidia-smi) and host CPU/RAM (sysinfo).

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize, Clone, Debug)]
pub struct GpuReading {
    pub index: u32,
    pub name: String,
    pub temp: f64, // edge temperature, C
    #[serde(rename = "hotspotTemp")]
    pub hotspot_temp: f64,
    #[serde(rename = "powerW")]
    pub power_w: f64,
    #[serde(rename = "vramUsedMB")]
    pub vram_used_mb: f64,
    #[serde(rename = "vramTotalMB")]
    pub vram_total_mb: f64,
    #[serde(rename = "utilPct")]
    pub util_pct: f64,
}

/// Query NVIDIA telemetry for rollback/legacy configurations.
pub fn poll_nvidia(nvidia_smi: &str) -> Result<Vec<GpuReading>, String> {
    let mut cmd = Command::new(nvidia_smi);
    cmd.args([
        "--query-gpu=index,name,temperature.gpu,power.draw,memory.used,memory.total,utilization.gpu",
        "--format=csv,noheader,nounits",
    ]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("nvidia-smi is not runnable: {e}"))?;
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(
                    "nvidia-smi failed or timed out; no fresh GPU sample is available".into(),
                );
            }
        }
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("Read nvidia-smi response: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "nvidia-smi exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut rows = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let f: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
        if f.len() < 7 {
            continue;
        }
        let num = |s: &str| -> f64 {
            s.split_whitespace()
                .next()
                .unwrap_or("")
                .parse::<f64>()
                .unwrap_or(-1.0)
        };
        let temp = num(f[2]);
        rows.push(GpuReading {
            index: num(f[0]) as u32,
            name: f[1].to_string(),
            temp,
            hotspot_temp: -1.0, // nvidia-smi does not provide hotspot in this query.
            power_w: num(f[3]),
            vram_used_mb: num(f[4]),
            vram_total_mb: num(f[5]),
            util_pct: num(f[6]),
        });
    }
    if rows.is_empty() {
        return Err("nvidia-smi returned no GPU rows".into());
    }
    Ok(rows)
}

#[derive(Deserialize)]
struct AdlxReading {
    name: String,
    #[serde(rename = "temperatureC")]
    temperature_c: f64,
    #[serde(rename = "hotspotC")]
    hotspot_c: f64,
    #[serde(rename = "powerW")]
    power_w: f64,
    #[serde(rename = "vramUsedMB")]
    vram_used_mb: f64,
    #[serde(rename = "vramTotalMB")]
    vram_total_mb: f64,
    #[serde(rename = "utilPct")]
    util_pct: f64,
}

struct AdlxMonitor {
    path: String,
    child: Child,
    stdin: ChildStdin,
    responses: mpsc::Receiver<Result<String, String>>,
}

impl AdlxMonitor {
    fn poll(&mut self) -> Result<Vec<GpuReading>, String> {
        self.stdin
            .write_all(b"poll\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("write AMD ADLX monitor request: {e}"))?;

        let line = self
            .responses
            .recv_timeout(Duration::from_millis(1500))
            .map_err(|_| "AMD ADLX helper did not respond within 1.5 seconds".to_string())??;

        let raw: Vec<AdlxReading> = serde_json::from_str(line.trim())
            .map_err(|e| format!("parse AMD ADLX telemetry: {e}"))?;
        let rows: Vec<GpuReading> = raw
            .into_iter()
            .filter(|r| r.vram_total_mb.is_finite() && r.vram_total_mb > 0.0)
            .enumerate()
            .map(|(index, r)| GpuReading {
                index: index as u32,
                name: r.name,
                temp: r.temperature_c,
                hotspot_temp: r.hotspot_c,
                power_w: r.power_w,
                vram_used_mb: r.vram_used_mb,
                vram_total_mb: r.vram_total_mb,
                util_pct: r.util_pct,
            })
            .collect();
        if rows.is_empty() {
            return Err("AMD ADLX returned no usable GPU rows".into());
        }
        Ok(rows)
    }
}

static ADLX_MONITOR: OnceLock<Mutex<Option<AdlxMonitor>>> = OnceLock::new();

pub fn shutdown_monitor() {
    if let Some(monitor) = ADLX_MONITOR.get() {
        if let Ok(mut slot) = monitor.lock() {
            stop_adlx(&mut slot);
        }
    }
}

fn spawn_adlx(path: &str) -> Result<AdlxMonitor, String> {
    let mut cmd = Command::new(path);
    cmd.arg("--serve")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("AMD ADLX monitor not runnable ({path}): {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or("AMD ADLX monitor stdin was not available")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("AMD ADLX monitor stdout was not available")?;
    let (tx, responses) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            let response = match reader.read_line(&mut line) {
                Ok(0) => Err("AMD ADLX helper exited without a response".to_string()),
                Ok(_) => Ok(line),
                Err(_) => Err("AMD ADLX helper response could not be read".to_string()),
            };
            let failed = response.is_err();
            if tx.send(response).is_err() || failed {
                break;
            }
        }
    });
    Ok(AdlxMonitor {
        path: path.to_string(),
        child,
        stdin,
        responses,
    })
}

fn stop_adlx(slot: &mut Option<AdlxMonitor>) {
    if let Some(mut monitor) = slot.take() {
        let _ = monitor.child.kill();
        let _ = monitor.child.wait();
    }
}

/// Poll a persistent, read-only AMD ADLX helper. Keeping the helper alive avoids
/// paying ADLX initialization cost on every two-second UI refresh.
pub fn poll_adlx(path: &str) -> Result<Vec<GpuReading>, String> {
    let monitor = ADLX_MONITOR.get_or_init(|| Mutex::new(None));
    let mut slot = monitor
        .lock()
        .map_err(|_| "AMD ADLX monitor lock is poisoned".to_string())?;

    let restart = match slot.as_mut() {
        None => true,
        Some(current) if current.path != path => true,
        Some(current) => match current.child.try_wait() {
            Ok(Some(_)) => true,
            Ok(None) => false,
            Err(_) => true,
        },
    };
    if restart {
        stop_adlx(&mut slot);
        *slot = Some(spawn_adlx(path)?);
    }

    let result = slot
        .as_mut()
        .ok_or("AMD ADLX monitor failed to initialize")?
        .poll();
    if result.is_err() {
        stop_adlx(&mut slot);
    }
    result
}

#[derive(Serialize, Clone, Debug)]
pub struct SystemStats {
    #[serde(rename = "cpuPct")]
    pub cpu_pct: f64,
    #[serde(rename = "ramUsedGB")]
    pub ram_used_gb: f64,
    #[serde(rename = "ramTotalGB")]
    pub ram_total_gb: f64,
}

/// Read CPU% + RAM from a persistent System (refreshed each call). The ~2s gap
/// between launcher polls is enough for a valid CPU-usage delta - no sleeping.
pub fn system_stats(sys: &mut sysinfo::System) -> SystemStats {
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let cpu = sys.global_cpu_usage() as f64;
    let total = sys.total_memory() as f64;
    let used = sys.used_memory() as f64;
    let gb = 1024.0 * 1024.0 * 1024.0;
    SystemStats {
        cpu_pct: cpu.clamp(0.0, 100.0),
        ram_used_gb: used / gb,
        ram_total_gb: total / gb,
    }
}
