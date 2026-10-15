//! Windows icon is generated from AI Nexus's retained double-chevron mark.
use std::{fs, path::PathBuf};
fn distance(x: f64, y: f64, a: (f64, f64), b: (f64, f64)) -> f64 {
    let dx = b.0 - a.0;
    let dy = b.1 - a.1;
    let t = (((x - a.0) * dx + (y - a.1) * dy) / (dx * dx + dy * dy)).clamp(0., 1.);
    ((x - a.0 - t * dx).powi(2) + (y - a.1 - t * dy).powi(2)).sqrt()
}
fn main() {
    let root = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let out = root.parent().unwrap().join(".build/generated-icons");
    fs::create_dir_all(&out).unwrap();
    let w = 32usize;
    let mut pixels = vec![0u8; w * w * 4];
    for y in 0..w {
        for x in 0..w {
            let mut alpha = 0f64;
            for sy in 0..4 {
                for sx in 0..4 {
                    let px = (x as f64 + (sx as f64 + 0.5) / 4.) / w as f64 * 100.;
                    let py = (y as f64 + (sy as f64 + 0.5) / 4.) / w as f64 * 100.;
                    let top = distance(px, py, (22., 58.), (50., 30.)).min(distance(
                        px,
                        py,
                        (50., 30.),
                        (78., 58.),
                    )) <= 6.5;
                    let bottom = distance(px, py, (30., 75.), (50., 53.)).min(distance(
                        px,
                        py,
                        (50., 53.),
                        (70., 75.),
                    )) <= 4.5;
                    alpha += if top {
                        1.
                    } else if bottom {
                        0.45
                    } else {
                        0.
                    };
                }
            }
            let i = ((w - 1 - y) * w + x) * 4;
            pixels[i] = 47;
            pixels[i + 1] = 125;
            pixels[i + 2] = 232;
            pixels[i + 3] = (alpha / 16. * 255.) as u8;
        }
    }
    let bitmap_size = 40 + pixels.len() + w * 4;
    let mut ico = vec![0u8; 22 + bitmap_size];
    ico[2..4].copy_from_slice(&1u16.to_le_bytes());
    ico[4..6].copy_from_slice(&1u16.to_le_bytes());
    ico[6] = 32;
    ico[7] = 32;
    ico[10..12].copy_from_slice(&1u16.to_le_bytes());
    ico[12..14].copy_from_slice(&32u16.to_le_bytes());
    ico[14..18].copy_from_slice(&(bitmap_size as u32).to_le_bytes());
    ico[18..22].copy_from_slice(&22u32.to_le_bytes());
    ico[22..26].copy_from_slice(&40u32.to_le_bytes());
    ico[26..30].copy_from_slice(&32i32.to_le_bytes());
    ico[30..34].copy_from_slice(&64i32.to_le_bytes());
    ico[34..36].copy_from_slice(&1u16.to_le_bytes());
    ico[36..38].copy_from_slice(&32u16.to_le_bytes());
    ico[42..46].copy_from_slice(&(pixels.len() as u32).to_le_bytes());
    ico[62..62 + pixels.len()].copy_from_slice(&pixels);
    let path = out.join("icon.ico");
    if fs::read(&path).ok().as_deref() != Some(&ico) {
        fs::write(&path, ico).unwrap();
    }
    println!("cargo:rerun-if-changed=build.rs");
    tauri_build::build()
}
