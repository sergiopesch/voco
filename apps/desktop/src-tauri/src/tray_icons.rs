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

const PROCESSING: &[u8] = include_bytes!("../../public/tray/processing.png");
/// A badge for every visual state but listening, which the meter frames show.
/// Status belongs to the badge; the microphone stays silver in every state.
const STATE_ICONS: [(&str, &[u8]); 3] = [
    (
        "not-ready",
        include_bytes!("../../public/tray/not-ready.png"),
    ),
    ("ready", include_bytes!("../../public/tray/ready.png")),
    ("processing", PROCESSING),
];

/// The image the tray library writes for itself before VOCO selects a state icon.
pub fn startup_icon() -> image::ImageResult<image::RgbaImage> {
    image::load_from_memory_with_format(PROCESSING, image::ImageFormat::Png)
        .map(|icon| icon.to_rgba8())
}

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
    // Five thicker bars remain distinct when the panel scales to a 16px icon.
    let weights = [0.45, 0.8, 1.0, 0.8, 0.45];
    let mut rgba = vec![0; 32 * 32 * 4];
    // Supersample rounded ends; fractional heights keep quiet speech legible.
    for (bar, weight) in weights.iter().enumerate() {
        let center_x = 4.0 + bar as f64 * 6.0;
        let half_height = (3.5 + 23.0 * level * weight) / 2.0;
        for y in 0..32 {
            for x in 0..32 {
                let mut coverage = 0;
                for sy in 0..4 {
                    for sx in 0..4 {
                        let dx = (x as f64 + (sx as f64 + 0.5) / 4.0 - center_x).abs();
                        let dy = (y as f64 + (sy as f64 + 0.5) / 4.0 - 16.0).abs();
                        let end = (dy - (half_height - 1.75)).max(0.0);
                        if dx * dx + end * end <= 1.75 * 1.75 {
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
    /// Runs once, in the runtime directory whose single-instance lock this
    /// process holds. Managed state is never dropped, so every earlier VOCO
    /// left its icons there, and none of them can still be advertised.
    pub fn new(root: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                // Best effort: a directory that stays only moves this launch to
                // the next name.
                if entry.file_name().to_string_lossy().starts_with("tray-")
                    && entry.file_type().is_ok_and(|kind| kind.is_dir())
                {
                    let _ = fs::remove_dir_all(entry.path());
                }
            }
        }
        for sequence in 0..100 {
            let path = root.join(format!("tray-{}-{sequence}", std::process::id()));
            match fs::DirBuilder::new().mode(0o700).create(&path) {
                Ok(()) => {
                    let icons = Self(path);
                    for (name, bytes) in STATE_ICONS {
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

// Runs only when startup fails; the next launch removes what an exit leaves.
impl Drop for TrayIcons {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
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
    fn tray_assets_are_square_and_keep_the_microphone_stable() {
        // Panels scale the 32 px badges down; every state must stay apart.
        for size in [16, 24, 32] {
            let icons: Vec<_> = STATE_ICONS
                .iter()
                .map(|(_, bytes)| {
                    let icon = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
                        .expect("generated tray icon should decode");
                    assert_eq!((icon.width(), icon.height()), (32, 32));
                    icon.resize(size, size, image::imageops::FilterType::Lanczos3)
                        .to_rgba8()
                        .into_raw()
                })
                .collect();
            for (index, pixels) in icons.iter().enumerate() {
                assert_eq!(pixels.len(), (size * size * 4) as usize);
                assert!(pixels.chunks_exact(4).any(|pixel| pixel[3] == 0));
                assert!(pixels.chunks_exact(4).any(|pixel| pixel[3] == 255));
                for prior in &icons[..index] {
                    assert_ne!(
                        pixels, prior,
                        "Every tray state must remain visually distinct"
                    );
                    assert!(
                        pixels
                            .chunks_exact(4)
                            .zip(prior.chunks_exact(4))
                            .any(|(pixel, other)| pixel[3] != other[3]),
                        "State outlines must differ independently of color"
                    );
                }
                // Lanczos resampling spreads the lower-right badge boundary.
                // Compare the upper microphone, safely outside that filter support.
                assert_eq!(
                    &pixels[..(size * (size * 2 / 5) * 4) as usize],
                    &icons[0][..(size * (size * 2 / 5) * 4) as usize]
                );
            }
        }
        let startup = startup_icon().expect("generated tray icon should decode");
        assert_eq!(startup.dimensions(), (32, 32));
    }

    #[test]
    fn startup_replaces_earlier_icons_and_keeps_their_neighbours() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = std::env::temp_dir().join(format!(
            "voco-tray-icons-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        let stale = root.join("tray-1-0");
        fs::create_dir(&stale).unwrap();
        fs::write(stale.join("ready.png"), b"").unwrap();
        fs::write(root.join("instance.lock"), b"").unwrap();
        let outside = root.join("outside");
        fs::create_dir(&outside).unwrap();
        symlink(&outside, root.join("tray-2-0")).unwrap();

        let icons = TrayIcons::new(&root).unwrap();
        assert!(!stale.exists());
        assert!(root.join("instance.lock").exists());
        assert!(root.join("tray-2-0").is_symlink() && outside.is_dir());
        let directory = icons.directory().to_path_buf();
        let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&directory), 0o700);
        let files: Vec<_> = fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(files.len(), STATE_ICONS.len() + METER_FRAMES);
        assert!(files.iter().all(|file| mode(file) == 0o600));
        // A failed startup drops the icons together with their directory.
        drop(icons);
        assert!(!directory.exists());
        fs::remove_dir_all(&root).unwrap();
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
