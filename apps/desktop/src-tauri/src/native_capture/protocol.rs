use serde::{Deserialize, Serialize};

pub const MAX_FRAMES: u64 = 26_460_000;
pub const BLOCK_BYTES: usize = 35_280;
pub const BATCH_BLOCKS: usize = 8;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub selection_token: String,
    pub name: String,
    pub label: String,
    pub index: u32,
    pub object_serial: Option<String>,
    pub is_monitor: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceList {
    pub revision: String,
    pub sources: Vec<Source>,
    pub default_selection_token: Option<String>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub capture_id: String,
    pub session_id: u64,
    pub generation: u64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BeginRequest {
    pub session_id: u64,
    pub generation: u64,
    pub selection_token: String,
}
impl BeginRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.session_id == 0
            || self.session_id > MAX_SAFE_INTEGER
            || self.generation > MAX_SAFE_INTEGER
        {
            return Err("Invalid native capture session identity".into());
        }
        Ok(())
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DrainRequest {
    pub capture_id: String,
    pub session_id: u64,
    pub generation: u64,
    pub ack_through_sequence: u64,
}
impl DrainRequest {
    pub fn identity(&self) -> Identity {
        Identity {
            capture_id: self.capture_id.clone(),
            session_id: self.session_id,
            generation: self.generation,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDescriptor {
    #[serde(flatten)]
    pub identity: Identity,
    pub source: Source,
    pub format: &'static str,
    pub sample_rate: u32,
    pub channels: u8,
    pub channel_map: [&'static str; 2],
    pub frame_bytes: u8,
    pub max_frames: u64,
}
#[derive(Clone, Debug, Serialize)]
pub struct Health {
    pub healthy: bool,
    pub reason: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopReceipt {
    pub state: &'static str,
    pub produced_frames: u64,
    pub last_sequence: u64,
    pub cork_acknowledged: bool,
    pub barrier_acknowledged: bool,
    pub health: Health,
    pub limit_reached: bool,
    pub acknowledged_sequence: u64,
}
#[derive(Clone, Debug)]
pub struct Block {
    pub sequence: u64,
    pub frame_start: u64,
    pub bytes: Vec<u8>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BlockHeader {
    sequence: u64,
    frame_start: u64,
    frames: usize,
    byte_offset: usize,
    byte_length: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Header<'a> {
    version: u8,
    #[serde(flatten)]
    identity: &'a Identity,
    blocks: Vec<BlockHeader>,
    receipt: &'a StopReceipt,
}
/// The issued packet is immutable until every block in that packet is acknowledged.
/// A repeated ACK therefore retries the same bytes, including its receipt snapshot.
#[derive(Default)]
pub struct Delivery {
    acknowledged: u64,
    frames: u64,
    pending: Option<(u64, usize, Vec<u8>)>,
}
impl Delivery {
    pub fn acknowledged(&self) -> u64 {
        self.acknowledged
    }
    pub fn acknowledge(&mut self, through: u64) -> Result<usize, String> {
        if through == self.acknowledged {
            return Ok(0);
        }
        let Some((last, count, _)) = self.pending.as_ref() else {
            return Err("ACK was not issued".into());
        };
        if through != *last {
            return Err("ACK must cover exactly the issued batch".into());
        }
        let count = *count;
        self.acknowledged = through;
        self.pending = None;
        Ok(count)
    }
    pub fn replay(&self) -> Option<Vec<u8>> {
        self.pending.as_ref().map(|(_, _, packet)| packet.clone())
    }
    pub fn issue(
        &mut self,
        identity: &Identity,
        blocks: &[Block],
        receipt: &StopReceipt,
    ) -> Result<Vec<u8>, String> {
        if self.pending.is_some() {
            return Err("Unacknowledged batch exists".into());
        }
        if blocks.len() > BATCH_BLOCKS {
            return Err("Native batch exceeds block bound".into());
        }
        let mut headers = Vec::with_capacity(blocks.len());
        let mut bytes = Vec::new();
        let mut next = self.acknowledged + 1;
        let mut frames = self.frames;
        for block in blocks {
            if block.sequence != next
                || block.frame_start != frames
                || block.bytes.is_empty()
                || block.bytes.len() > BLOCK_BYTES
                || block.bytes.len() % 4 != 0
            {
                return Err("Native block coverage is invalid".into());
            }
            let count = block.bytes.len() / 4;
            frames = frames
                .checked_add(count as u64)
                .filter(|v| *v <= MAX_FRAMES)
                .ok_or("Native frame limit exceeded")?;
            headers.push(BlockHeader {
                sequence: next,
                frame_start: block.frame_start,
                frames: count,
                byte_offset: bytes.len(),
                byte_length: block.bytes.len(),
            });
            bytes.extend_from_slice(&block.bytes);
            next += 1;
        }
        let json = serde_json::to_vec(&Header {
            version: 1,
            identity,
            blocks: headers,
            receipt,
        })
        .map_err(|e| e.to_string())?;
        if json.len() > 65_536 {
            return Err("Native header exceeds bound".into());
        }
        let mut packet = Vec::with_capacity(4 + json.len() + bytes.len());
        packet.extend_from_slice(&(json.len() as u32).to_le_bytes());
        packet.extend_from_slice(&json);
        packet.extend_from_slice(&bytes);
        if !blocks.is_empty() {
            self.frames = frames;
            self.pending = Some((next - 1, blocks.len(), packet.clone()));
        }
        Ok(packet)
    }
}
