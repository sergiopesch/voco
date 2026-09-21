//! Four immutable PNGs retained while delayed desktop readers may still open them.
use std::{
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

pub struct TrayIcons(PathBuf);

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
}

impl Drop for TrayIcons {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
