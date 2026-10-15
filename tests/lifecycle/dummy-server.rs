//! Local HTTP lifecycle fixture. Does not link inference/GPU libraries or open model files.
//! Built directly with the installed rustc; only the Rust standard library is used.
use std::{
    env, fs::OpenOptions,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::{self, Command},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

fn option(args: &[String], key: &str, default: &str) -> String {
    args.windows(2).find(|pair| pair[0] == key)
        .map(|pair| pair[1].clone()).unwrap_or_else(|| default.into())
}
fn quoted(value: &str) -> String {
    let mut out = String::from("\"");
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
fn event(file: &str, json: String) {
    if !file.is_empty() {
        let mut f = OpenOptions::new().create(true).append(true).open(file).unwrap();
        f.write_all(format!("{json}\n").as_bytes()).unwrap();
        f.flush().unwrap();
    }
}
struct Fixture {
    alias: String,
    mode: String,
    ctx: u32,
    port: u16,
    born: Instant,
    delay_ms: u64,
}
fn response(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.flush();
}
fn serve(mut stream: TcpStream, state: Arc<Mutex<Fixture>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buffer = [0u8; 8192];
    let Ok(n) = stream.read(&mut buffer) else { return };
    let request = String::from_utf8_lossy(&buffer[..n]);
    let route = request.lines().next().and_then(|line| line.split_whitespace().nth(1)).unwrap_or("/");
    if let Some(mode) = route.strip_prefix("/__fixture/mode/") {
        state.lock().unwrap().mode = mode.to_owned();
        response(&mut stream, "200 OK", r#"{"fixture":true}"#);
        return;
    }
    if route == "/__fixture/quit" {
        response(&mut stream, "200 OK", r#"{"fixture":true}"#);
        thread::spawn(|| { thread::sleep(Duration::from_millis(100)); process::exit(24); });
        return;
    }
    let f = state.lock().unwrap();
    let alias = f.alias.clone();
    let mode = f.mode.clone();
    let delaying = f.born.elapsed().as_millis() < f.delay_ms as u128;
    let info = format!(r#"{{"fixture":true,"pid":{},"alias":{},"ctx":{},"port":{},"mode":{}}}"#,
        process::id(), quoted(&alias), f.ctx, f.port, quoted(&mode));
    drop(f);
    match route {
        "/__fixture/status" => response(&mut stream, "200 OK", &info),
        "/health" if mode == "hold-health" => {
            thread::sleep(Duration::from_secs(6));
            response(&mut stream, "200 OK", r#"{"status":"ok"}"#);
        }
        "/health" if mode == "health-fail" || delaying =>
            response(&mut stream, "503 Service Unavailable", r#"{"status":"loading"}"#),
        "/health" => response(&mut stream, "200 OK", r#"{"status":"ok"}"#),
        "/v1/models" if mode == "bad-json" => response(&mut stream, "200 OK", "not json"),
        "/v1/models" if mode == "models-error" =>
            response(&mut stream, "503 Service Unavailable", r#"{"error":"fixture not ready"}"#),
        "/v1/models" => {
            let id = if mode == "wrong-alias" { "unrelated-fixture" } else { &alias };
            response(&mut stream, "200 OK", &format!(r#"{{"object":"list","data":[{{"id":{}}}]}}"#, quoted(id)));
        }
        _ => response(&mut stream, "404 Not Found", r#"{"fixture":true}"#),
    }
}
fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let events = option(&args, "--fixture-events", "");
    let alias = option(&args, "--alias", "fixture");
    let parent = option(&args, "--fixture-parent", "0").parse::<u32>().unwrap();
    if args.iter().any(|s| s == "--fixture-child") {
        event(&events, format!(r#"{{"kind":"worker","pid":{},"parent":{},"alias":{}}}"#, process::id(), parent, quoted(&alias)));
        loop { thread::sleep(Duration::from_secs(1)); }
    }
    let host = option(&args, "--host", "127.0.0.1");
    assert_eq!(host, "127.0.0.1", "Fixture must bind IPv4 loopback only");
    let port = option(&args, "--port", "0").parse::<u16>().unwrap();
    let ctx = option(&args, "--ctx-size", "8192").parse::<u32>().unwrap();
    let mode = option(&args, "--fixture-mode", "healthy");
    event(&events, format!(r#"{{"kind":"spawn","pid":{},"alias":{},"ctx":{},"mode":{},"port":{}}}"#,
        process::id(), quoted(&alias), ctx, quoted(&mode), port));
    if mode == "exit-early" { process::exit(23); }
    let listener = TcpListener::bind((host.as_str(), port)).unwrap();
    let port = listener.local_addr().unwrap().port();
    if args.iter().any(|s| s == "--fixture-worker") {
        let mut worker = Command::new(env::current_exe().unwrap());
        worker.args(["--fixture-child", "--fixture-parent", &process::id().to_string(),
            "--fixture-events", &events, "--alias", &alias]);
        #[cfg(windows)]
        worker.creation_flags(0x0800_0000);
        worker.spawn().unwrap();
    }
    let state = Arc::new(Mutex::new(Fixture {
        alias, mode, ctx, port, born: Instant::now(),
        delay_ms: option(&args, "--fixture-ready-delay-ms", "0").parse().unwrap(),
    }));
    for stream in listener.incoming() {
        let Ok(stream) = stream else { break };
        let state = state.clone();
        thread::spawn(move || serve(stream, state));
    }
}
