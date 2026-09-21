//! Immutable state and meter PNGs survive delayed desktop readers.
use image::ImageEncoder;
use std::{
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

pub struct TrayIcons(PathBuf);

pub const METER_FRAMES: usize = 64;

/// Fast attack and a short release smooth measured volume without inventing activity.
#[derive(Default)]
pub struct MeterEnvelope(f64);

impl MeterEnvelope {
    pub fn step(&mut self, level: f64, elapsed: f64, animate: bool) -> usize {
        let target = if level.is_finite() {
            level.clamp(0.0, 1.0)
        } else {
            0.0
        };
        let tau = if target > self.0 { 0.035 } else { 0.12 };
        self.0 = if animate {
            self.0 + (target - self.0) * (1.0 - (-elapsed.max(0.0) / tau).exp())
        } else {
            target
        };
        (self.0 * (METER_FRAMES - 1) as f64).round() as usize
    }
}

fn meter_rgba(frame: usize) -> Vec<u8> {
    let level = frame.min(METER_FRAMES - 1) as f64 / (METER_FRAMES - 1) as f64;
    let weights = [0.35, 0.65, 0.9, 1.0, 0.8, 0.55, 0.3];
    let mut rgba = vec![0; 32 * 32 * 4];
    // Supersample rounded ends; fractional heights keep quiet speech legible.
    for (bar, weight) in weights.iter().enumerate() {
        let center_x = 4.0 + bar as f64 * 4.0;
        let half_height = (3.0 + 23.0 * level * weight) / 2.0;
        for y in 0..32 {
            for x in 0..32 {
                let mut coverage = 0;
                for sy in 0..4 {
                    for sx in 0..4 {
                        let dx = (x as f64 + (sx as f64 + 0.5) / 4.0 - center_x).abs();
                        let dy = (y as f64 + (sy as f64 + 0.5) / 4.0 - 16.0).abs();
                        let end = (dy - (half_height - 1.25)).max(0.0);
                        if dx * dx + end * end <= 1.25 * 1.25 {
                            coverage += 1;
                        }
                    }
                }
                if coverage > 0 {
                    let offset = (y * 32 + x) * 4;
                    rgba[offset..offset + 4].copy_from_slice(&[
                        223,
                        227,
                        233,
                        (coverage * 255 / 16) as u8,
                    ]);
                }
            }
        }
    }
    rgba
}

impl TrayIcons {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let root = crate::single_instance::runtime_directory()?;
        for sequence in 0..100 {
            let path = root.join(format!("tray-{}-{sequence}", std::process::id()));
            match fs::DirBuilder::new().mode(0o700).create(&path) {
                Ok(()) => {
                    let icons = Self(path);
                    for (name, bytes) in [
                        (
                            "not-ready",
                            include_bytes!("../../public/tray/not-ready.png").as_slice(),
                        ),
                        (
                            "ready",
                            include_bytes!("../../public/tray/ready.png").as_slice(),
                        ),
                        (
                            "recording",
                            include_bytes!("../../public/tray/recording.png").as_slice(),
                        ),
                        (
                            "processing",
                            include_bytes!("../../public/tray/processing.png").as_slice(),
                        ),
                    ] {
                        fs::OpenOptions::new()
                            .write(true)
                            .create_new(true)
                            .mode(0o600)
                            .open(icons.path(name))?
                            .write_all(bytes)?;
                    }
                    for frame in 0..METER_FRAMES {
                        let file = fs::OpenOptions::new()
                            .write(true)
                            .create_new(true)
                            .mode(0o600)
                            .open(icons.meter_path(frame))?;
                        image::codecs::png::PngEncoder::new(file).write_image(
                            &meter_rgba(frame),
                            32,
                            32,
                            image::ExtendedColorType::Rgba8,
                        )?;
                    }
                    return Ok(icons);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.into()),
            }
        }
        Err("Could not create a private tray icon directory".into())
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.0.join(format!("{name}.png"))
    }
    pub fn directory(&self) -> &Path {
        &self.0
    }
    pub fn meter_path(&self, frame: usize) -> PathBuf {
        self.path(&format!("meter-{:02}", frame.min(METER_FRAMES - 1)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measured_levels_attack_quickly_and_settle_to_silence() {
        let mut meter = MeterEnvelope::default();
        assert_eq!(meter.step(0.0, 0.033, true), 0);
        let rising = meter.step(1.0, 0.033, true);
        assert!(rising > 30 && rising < 63);
        assert!(meter.step(1.0, 0.067, true) >= 59);
        assert!(meter.step(0.0, 0.033, true) < 59);
        for _ in 0..20 {
            meter.step(0.0, 0.033, true);
        }
        assert_eq!(meter.step(0.0, 0.033, true), 0);
        assert_eq!(meter.step(f64::NAN, 1.0, false), 0);
        assert_eq!(meter.step(4.0, 0.0, false), 63);
    }

    #[test]
    fn volume_frames_are_distinct_bounded_and_transparent() {
        let frames: Vec<_> = (0..METER_FRAMES).map(meter_rgba).collect();
        assert!(frames.windows(2).all(|pair| pair[0] != pair[1]));
        let ink = |pixels: &[u8]| pixels.chunks_exact(4).map(|p| u64::from(p[3])).sum::<u64>();
        assert!(frames.windows(2).all(|pair| ink(&pair[0]) < ink(&pair[1])));
        for frame in frames {
            assert_eq!(frame.len(), 4096);
            assert_eq!(&frame[..4], &[0; 4]);
        }
    }
}

impl Drop for TrayIcons {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
