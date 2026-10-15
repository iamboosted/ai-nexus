//! Managed child processes. Every long-lived process the launcher starts
//! (llama-server, OpenWebUI, the TTS sidecar) is tracked here so it can be
//! health-checked, hot-swapped, and torn down cleanly on exit.

use crate::config::ProcSpec;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct Managed {
    pub child: Child,
    #[allow(dead_code)]
    pub log: Option<PathBuf>,
    // A private handle retains ownership even when the root process has exited.
    #[cfg(windows)]
    job: Option<owned_job::Job>,
}

#[derive(Default)]
pub struct Registry {
    procs: HashMap<String, Managed>,
}

impl Registry {
    pub fn pid(&self, key: &str) -> Option<u32> {
        self.procs.get(key).map(|m| m.child.id())
    }

    /// True if the named process exists and has not exited.
    pub fn alive(&mut self, key: &str) -> bool {
        match self.procs.get_mut(key) {
            Some(m) => {
                let alive = matches!(m.child.try_wait(), Ok(None));
                #[cfg(windows)]
                if !alive {
                    // Reap surviving descendants as soon as a parent exit is observed.
                    // This uses the job handle, never a potentially stale parent PID.
                    drop(m.job.take());
                }
                alive
            }
            None => false,
        }
    }

    pub fn insert(&mut self, key: &str, m: Managed) {
        self.procs.insert(key.to_string(), m);
    }

    /// Kill one tracked process (and its children) and forget it.
    pub fn kill(&mut self, key: &str) {
        if let Some(mut m) = self.procs.remove(key) {
            #[cfg(windows)]
            drop(m.job.take());
            if matches!(m.child.try_wait(), Ok(None)) {
                #[cfg(not(windows))]
                kill_tree(m.child.id());
                let _ = m.child.kill();
            }
            let _ = m.child.wait();
        }
    }

    pub fn kill_all(&mut self) {
        let keys: Vec<String> = self.procs.keys().cloned().collect();
        for k in keys {
            self.kill(&k);
        }
    }
}

/// Non-Windows fallback. Windows uses the private job handle instead of a PID tree.
#[cfg(not(windows))]
fn kill_tree(pid: u32) {
    let _ = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status();
}

/// Build a std Command from a ProcSpec: program + args + extra env + cwd.
/// The process inherits the launcher's environment; `env` entries are added
/// on top. No shell is involved — the program is executed directly.
pub fn command_from_spec(spec: &ProcSpec) -> Command {
    let mut c = Command::new(&spec.program);
    c.args(&spec.args);
    if !spec.env.is_empty() {
        c.envs(&spec.env);
    }
    if let Some(dir) = &spec.cwd {
        if !dir.trim().is_empty() {
            c.current_dir(dir);
        }
    }
    c
}

/// Open (append/create) a log file and return a handle plus a clone for stderr.
fn open_log(path: &Path) -> std::io::Result<(File, File)> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let f = OpenOptions::new().create(true).append(true).open(path)?;
    let f2 = f.try_clone()?;
    Ok((f, f2))
}

/// Windows children enter a private kill-on-close job while suspended, before
/// they can create workers. Commands and logs otherwise use the existing plan.
pub fn spawn_logged(mut cmd: Command, log_path: Option<&Path>) -> Result<Managed, String> {
    let log = match log_path {
        Some(p) => {
            let (out, err) = open_log(p).map_err(|e| format!("open log {}: {e}", p.display()))?;
            cmd.stdout(Stdio::from(out)).stderr(Stdio::from(err));
            Some(p.to_path_buf())
        }
        None => {
            cmd.stdout(Stdio::null()).stderr(Stdio::null());
            None
        }
    };
    cmd.stdin(Stdio::null());

    #[cfg(windows)]
    let job = owned_job::Job::new()?;
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW | 0x0000_0004); // CREATE_SUSPENDED

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    #[cfg(windows)]
    if let Err(error) = job.assign_and_resume(&child) {
        // Never run an unowned backend when containment is unavailable.
        drop(job);
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    Ok(Managed {
        child,
        log,
        #[cfg(windows)]
        job: Some(job),
    })
}

#[cfg(windows)]
mod owned_job {
    use std::{
        mem::size_of,
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::Child,
    };
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::HANDLE,
            System::{
                Diagnostics::ToolHelp::{
                    CreateToolhelp32Snapshot, Thread32First, Thread32Next,
                    THREADENTRY32, TH32CS_SNAPTHREAD,
                },
                JobObjects::{
                    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
                    JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                },
                Threading::{
                    GetProcessIdOfThread, OpenThread, ResumeThread,
                    THREAD_QUERY_LIMITED_INFORMATION, THREAD_SUSPEND_RESUME,
                },
            },
        },
    };
    // The unnamed job has one non-inherited handle. Closing it kills its members.
    // OwnedHandle supplies handle cleanup and the required Send/Sync ownership.
    pub struct Job(OwnedHandle);
    impl Job {
        pub fn new() -> Result<Self, String> {
            let handle = unsafe { CreateJobObjectW(None, PCWSTR::null()) }
                .map_err(|e| format!("Create owned process job: {e}"))?;
            let job = Self(unsafe { OwnedHandle::from_raw_handle(handle.0) });
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            unsafe {
                SetInformationJobObject(
                    HANDLE(job.0.as_raw_handle()),
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const _,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            }
            .map_err(|e| format!("Set owned process job limits: {e}"))?;
            Ok(job)
        }
        pub fn assign_and_resume(&self, child: &Child) -> Result<(), String> {
            unsafe {
                AssignProcessToJobObject(
                    HANDLE(self.0.as_raw_handle()),
                    HANDLE(child.as_raw_handle()),
                )
            }
            .map_err(|e| format!("Assign backend to its owned process job: {e}"))?;
            // std closes the initial thread handle. Find only our own child's
            // suspended primary thread using the supported Windows API.
            let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) }
                .map_err(|e| format!("Locate suspended backend thread: {e}"))?;
            let snapshot = unsafe { OwnedHandle::from_raw_handle(snapshot.0) };
            let mut entry = THREADENTRY32 {
                dwSize: size_of::<THREADENTRY32>() as u32,
                ..Default::default()
            };
            unsafe { Thread32First(HANDLE(snapshot.as_raw_handle()), &mut entry) }
                .map_err(|e| format!("Read suspended backend thread: {e}"))?;
            let mut threads = Vec::new();
            loop {
                if entry.th32OwnerProcessID == child.id() {
                    threads.push(entry.th32ThreadID);
                }
                if unsafe { Thread32Next(HANDLE(snapshot.as_raw_handle()), &mut entry) }.is_err() {
                    break;
                }
            }
            let [thread_id] = threads.as_slice() else {
                return Err("Cannot identify one suspended backend thread; backend was stopped".into());
            };
            let thread = unsafe {
                OpenThread(THREAD_SUSPEND_RESUME | THREAD_QUERY_LIMITED_INFORMATION, false, *thread_id)
            }
            .map_err(|e| format!("Open suspended backend thread: {e}"))?;
            let thread = unsafe { OwnedHandle::from_raw_handle(thread.0) };
            // Open handles pin identities; recheck before resuming anything.
            if unsafe { GetProcessIdOfThread(HANDLE(thread.as_raw_handle())) } != child.id() {
                return Err("Suspended backend thread identity changed; backend was stopped".into());
            }
            if unsafe { ResumeThread(HANDLE(thread.as_raw_handle())) } != 1 {
                return Err("Could not safely resume backend; backend was stopped".into());
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TestChild(Option<Managed>);
    impl Drop for TestChild {
        fn drop(&mut self) {
            if let Some(mut m) = self.0.take() {
                let _ = m.child.kill();
                let _ = m.child.wait();
            }
        }
    }
    fn child() -> Managed {
        let mut c = Command::new(std::env::current_exe().unwrap());
        c.args(["--exact", "proc::tests::fixture_child", "--nocapture"])
            .env("AI_NEXUS_TEST_CHILD", "1");
        spawn_logged(c, None).unwrap()
    }
    #[test]
    fn fixture_child() {
        if std::env::var("AI_NEXUS_TEST_CHILD").as_deref() == Ok("1") {
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    }
    #[test]
    fn window_policy_preserves_then_stops_only_registered_native_fixture() {
        let mut registry = Registry::default();
        registry.insert("llama", child());
        let mut other = TestChild(Some(child()));
        assert!(registry.alive("llama"));
        crate::lifecycle::on_close("settings", || registry.kill_all());
        assert!(
            registry.alive("llama"),
            "Settings close stopped the fixture child"
        );
        crate::lifecycle::on_close("main", || registry.kill_all());
        assert!(!registry.alive("llama"));
        assert!(
            matches!(other.0.as_mut().unwrap().child.try_wait(), Ok(None)),
            "Unregistered fixture was terminated"
        );
    }
}
