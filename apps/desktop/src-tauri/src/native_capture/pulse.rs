use super::protocol::{Block, Source, BATCH_BLOCKS, BLOCK_BYTES};
use std::{
    ffi::{c_char, c_int, CString},
    ptr::NonNull,
};

#[repr(C)]
#[derive(Clone, Copy)]
struct RawSource {
    name: [c_char; 512],
    label: [c_char; 512],
    serial: [c_char; 128],
    index: u32,
    monitor: c_int,
}
#[repr(C)]
struct Catalog {
    revision: u64,
    count: u32,
    default_name: [c_char; 512],
    sources: [RawSource; 128],
}

fn empty_catalog() -> Box<Catalog> {
    let mut catalog = Box::<Catalog>::new_uninit();
    // SAFETY: Catalog contains only integer fields/arrays, for which zero is
    // valid. Initialize in place instead of creating a large stack temporary.
    unsafe {
        catalog.as_mut_ptr().write_bytes(0, 1);
        catalog.assume_init()
    }
}
#[repr(C)]
struct RawStatus {
    frames: u64,
    blocks: u64,
    ready: c_int,
    stopped: c_int,
    cork_ack: c_int,
    barrier_ack: c_int,
    limit_reached: c_int,
    error: [c_char; 128],
}
// Only the opaque VOCO-owned shim ABI crosses this boundary; libpulse types stay in C.
unsafe extern "C" {
    fn vc_new(socket: *const c_char) -> *mut std::ffi::c_void;
    fn vc_free(p: *mut std::ffi::c_void);
    fn vc_enumerate(p: *mut std::ffi::c_void, out: *mut Catalog) -> c_int;
    fn vc_begin(p: *mut std::ffi::c_void, source: *const RawSource, revision: u64) -> c_int;
    fn vc_tick(p: *mut std::ffi::c_void);
    fn vc_stop(p: *mut std::ffi::c_void);
    fn vc_cancel(p: *mut std::ffi::c_void);
    fn vc_get_status(p: *mut std::ffi::c_void, out: *mut RawStatus);
    fn vc_peek(
        p: *mut std::ffi::c_void,
        offset: u32,
        bytes: *mut *const u8,
        length: *mut usize,
        sequence: *mut u64,
        frame_start: *mut u64,
    ) -> c_int;
    fn vc_ack(p: *mut std::ffi::c_void, count: u32) -> c_int;
}
#[derive(Clone, Debug, Default)]
pub struct Status {
    pub frames: u64,
    pub blocks: u64,
    pub ready: bool,
    pub stopped: bool,
    pub cork_ack: bool,
    pub barrier_ack: bool,
    pub limit_reached: bool,
    pub error: Option<String>,
}
fn text(bytes: &[c_char]) -> Result<String, String> {
    let end = bytes
        .iter()
        .position(|c| *c == 0)
        .ok_or("Unterminated native source metadata")?;
    String::from_utf8(bytes[..end].iter().map(|c| *c as u8).collect())
        .map_err(|_| "Native source metadata is not UTF-8".into())
}
// Catalog revision reports changes; consent identifies one concrete source for this connection.
pub(super) fn source_token(epoch: u64, index: u32, name: &str, serial: Option<&str>) -> String {
    serde_json::to_string(&(epoch, index, name, serial)).expect("Source identity tuple serializes")
}

fn raw_matches(raw: &RawSource, source: &Source) -> bool {
    raw.index == source.index
        && text(&raw.name).is_ok_and(|name| name == source.name)
        && text(&raw.serial).is_ok_and(|serial| {
            !serial.is_empty() && source.object_serial.as_deref() == Some(serial.as_str())
        })
}

pub struct Pulse {
    ptr: NonNull<std::ffi::c_void>,
    // Keep the bounded device table out of the capture worker's stack frames.
    catalog: Option<Box<Catalog>>,
}
impl Pulse {
    pub fn connect() -> Result<Self, String> {
        // Never consult PULSE_SERVER or autospawn: use this process user's existing socket.
        let uid = unsafe { libc::getuid() };
        let path = format!("/run/user/{uid}/pulse/native");
        use std::os::unix::fs::{FileTypeExt, MetadataExt};
        let meta = std::fs::symlink_metadata(&path)
            .map_err(|_| "Existing per-user Pulse socket unavailable")?;
        if !meta.file_type().is_socket() || meta.uid() != uid {
            return Err("Pulse socket identity is invalid".into());
        }
        let socket = CString::new(format!("unix:{path}")).map_err(|e| e.to_string())?;
        let ptr = NonNull::new(unsafe { vc_new(socket.as_ptr()) })
            .ok_or("Native Pulse allocation failed")?;
        Ok(Self { ptr, catalog: None })
    }
    pub fn enumerate(&mut self, epoch: u64) -> Result<(u64, Vec<Source>, Option<String>), String> {
        let mut catalog = empty_catalog();
        if unsafe { vc_enumerate(self.ptr.as_ptr(), &mut *catalog) } != 0 {
            return Err(self
                .status()
                .error
                .unwrap_or("Source enumeration unavailable".into()));
        }
        if catalog.count > 128 {
            return Err("Invalid source count".into());
        }
        let revision = catalog.revision;
        let default = text(&catalog.default_name)?;
        let mut sources = Vec::new();
        let mut default_token = None;
        for raw in &catalog.sources[..catalog.count as usize] {
            let name = text(&raw.name)?;
            let serial = text(&raw.serial)?;
            let token = source_token(
                epoch,
                raw.index,
                &name,
                (!serial.is_empty()).then_some(serial.as_str()),
            );
            if name == default && !serial.is_empty() {
                default_token = Some(token.clone());
            }
            sources.push(Source {
                selection_token: token,
                name,
                label: text(&raw.label)?,
                index: raw.index,
                object_serial: if serial.is_empty() {
                    None
                } else {
                    Some(serial)
                },
                is_monitor: raw.monitor != 0,
            });
        }
        self.catalog = Some(catalog);
        Ok((revision, sources, default_token))
    }
    pub fn begin(&mut self, source: &Source, revision: u64) -> Result<(), String> {
        let catalog = self.catalog.as_ref().ok_or("No native catalog")?;
        let raw = catalog.sources[..catalog.count as usize]
            .iter()
            .find(|s| raw_matches(s, source))
            .ok_or("Source not in catalog")?;
        if unsafe { vc_begin(self.ptr.as_ptr(), raw, revision) } != 0 {
            return Err(self
                .status()
                .error
                .unwrap_or("Selected source became stale; select it again".into()));
        }
        Ok(())
    }
    pub fn tick(&mut self) {
        unsafe { vc_tick(self.ptr.as_ptr()) }
    }
    pub fn stop(&mut self) {
        unsafe { vc_stop(self.ptr.as_ptr()) }
    }
    pub fn cancel(&mut self) {
        unsafe { vc_cancel(self.ptr.as_ptr()) }
    }
    pub fn status(&self) -> Status {
        let mut raw: RawStatus = unsafe { std::mem::zeroed() };
        unsafe { vc_get_status(self.ptr.as_ptr(), &mut raw) };
        let error = text(&raw.error).unwrap_or_else(|_| "Invalid native error metadata".into());
        Status {
            frames: raw.frames,
            blocks: raw.blocks,
            ready: raw.ready != 0,
            stopped: raw.stopped != 0,
            cork_ack: raw.cork_ack != 0,
            barrier_ack: raw.barrier_ack != 0,
            limit_reached: raw.limit_reached != 0,
            error: if error.is_empty() { None } else { Some(error) },
        }
    }
    pub fn blocks(&self) -> Result<Vec<Block>, String> {
        let mut blocks = Vec::new();
        for offset in 0..BATCH_BLOCKS {
            let (mut data, mut len, mut sequence, mut frame_start) = (std::ptr::null(), 0, 0, 0);
            let found = unsafe {
                vc_peek(
                    self.ptr.as_ptr(),
                    offset as u32,
                    &mut data,
                    &mut len,
                    &mut sequence,
                    &mut frame_start,
                )
            };
            if found == 0 {
                break;
            }
            if found != 1 || data.is_null() || len == 0 || len > BLOCK_BYTES || len % 4 != 0 {
                return Err("Invalid native block ABI".into());
            }
            // Worker is sole caller: no callback runs concurrently with this copy.
            blocks.push(Block {
                sequence,
                frame_start,
                bytes: unsafe { std::slice::from_raw_parts(data, len) }.to_vec(),
            });
        }
        Ok(blocks)
    }
    pub fn ack(&mut self, count: usize) -> Result<(), String> {
        if count > BATCH_BLOCKS || unsafe { vc_ack(self.ptr.as_ptr(), count as u32) } != 0 {
            return Err("Native ACK extent invalid".into());
        }
        Ok(())
    }
}
impl Drop for Pulse {
    fn drop(&mut self) {
        unsafe { vc_free(self.ptr.as_ptr()) }
    }
}

#[cfg(test)]
mod identity_tests {
    use super::*;
    #[test]
    fn device_catalog_initializes_on_a_small_worker_stack() {
        let catalog = std::thread::Builder::new()
            .stack_size(64 * 1024)
            .spawn(empty_catalog)
            .unwrap()
            .join()
            .unwrap();
        assert_eq!(catalog.count, 0);
        assert_eq!(catalog.revision, 0);
        assert!(catalog
            .sources
            .iter()
            .all(|source| source.name.iter().all(|c| *c == 0)));
    }

    #[test]
    fn raw_begin_lookup_rejects_index_reuse_and_missing_serial() {
        let mut raw: RawSource = unsafe { std::mem::zeroed() };
        raw.index = 4;
        raw.name[0] = b'a' as c_char;
        raw.serial[0] = b'5' as c_char;
        let mut selected = Source {
            selection_token: source_token(1, 4, "a", Some("5")),
            name: "a".into(),
            label: "Microphone".into(),
            index: 4,
            object_serial: Some("5".into()),
            is_monitor: false,
        };
        assert!(raw_matches(&raw, &selected));
        raw.serial[0] = b'6' as c_char;
        assert!(!raw_matches(&raw, &selected));
        raw.serial[0] = b'5' as c_char;
        raw.name[0] = b'b' as c_char;
        assert!(!raw_matches(&raw, &selected));
        raw.name[0] = b'a' as c_char;
        selected.object_serial = None;
        assert!(!raw_matches(&raw, &selected));
    }
}
