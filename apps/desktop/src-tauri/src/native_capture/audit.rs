//! Opt-in, one-shot evidence. No filesystem work occurs on the capture worker.
use super::protocol::{CaptureDescriptor, DrainRequest, StopReceipt};
use serde_json::{json, Value};

const PACKET_LIMIT: usize = 144 * 1024 * 1024;
const EVENT_LIMIT: usize = 131_072;

pub fn enabled() -> bool {
    flags_enabled(|name| std::env::var(name).ok())
}
fn flags_enabled(mut get: impl FnMut(&str) -> Option<String>) -> bool {
    [
        "VOCO_DEV_NATIVE_CAPTURE",
        "VOCO_DEBUG_CAPTURE_AUDIO",
        "VOCO_DEBUG_NATIVE_CAPTURE",
    ]
    .iter()
    .all(|name| get(name).as_deref() == Some("1"))
}

fn request_json(request: &DrainRequest) -> Value {
    json!({"captureId":request.capture_id,"sessionId":request.session_id,"generation":request.generation,
        "ackThroughSequence":request.ack_through_sequence})
}

pub(super) struct Audit {
    descriptor: Value,
    packets: Vec<u8>,
    events: Vec<Value>,
    reasons: Vec<String>,
    packet_limit: usize,
    event_limit: usize,
    #[cfg(test)]
    terminal_observer: Option<std::sync::mpsc::SyncSender<&'static str>>,
}
impl Audit {
    #[cfg(test)]
    pub(super) fn for_test() -> Self {
        Self::with_limits(65536, 32).unwrap()
    }
    #[cfg(test)]
    pub(super) fn observe_terminal(&mut self, sender: std::sync::mpsc::SyncSender<&'static str>) {
        self.terminal_observer = Some(sender);
    }
    #[cfg(test)]
    pub(super) fn test_events(&self) -> &[Value] {
        &self.events
    }
    #[cfg(test)]
    pub(super) fn test_export(self, receipt: &StopReceipt) -> Result<std::path::PathBuf, String> {
        self.prepare("complete", Some(receipt))?.write()
    }
    pub fn reserve() -> Result<Self, String> {
        Self::with_limits(PACKET_LIMIT, EVENT_LIMIT)
    }
    fn with_limits(packet_limit: usize, event_limit: usize) -> Result<Self, String> {
        let mut packets = Vec::new();
        packets
            .try_reserve_exact(packet_limit)
            .map_err(|_| "Native audit packet reservation unavailable")?;
        let mut events = Vec::new();
        events
            .try_reserve_exact(event_limit)
            .map_err(|_| "Native audit event reservation unavailable")?;
        Ok(Self {
            descriptor: Value::Null,
            packets,
            events,
            reasons: Vec::new(),
            packet_limit,
            event_limit,
            #[cfg(test)]
            terminal_observer: None,
        })
    }
    pub fn descriptor(&mut self, value: &CaptureDescriptor) {
        self.descriptor = json!({"schemaVersion":1,"guiPid":std::process::id(),
            "optIn":{"nativeCaptureDev":true,"debugCaptureAudio":true,"debugNativeCapture":true},
            "descriptor":value});
    }
    fn incomplete(&mut self, reason: &str) {
        if !self.reasons.iter().any(|r| r == reason) {
            self.reasons.push(reason.into());
        }
    }
    fn event(&mut self, mut event: Value) {
        if self.events.len() >= self.event_limit {
            self.incomplete("event-limit");
            return;
        }
        event["ordinal"] = json!(self.events.len());
        self.events.push(event);
    }
    pub fn drain(
        &mut self,
        request: &DrainRequest,
        before: u64,
        after: u64,
        packet: &[u8],
        replay: bool,
    ) {
        if self.reasons.iter().any(|r| r == "packet-or-event-limit") {
            return;
        }
        if self.events.len() >= self.event_limit
            || packet.len() > self.packet_limit.saturating_sub(self.packets.len())
        {
            self.incomplete("packet-or-event-limit");
            return;
        }
        let offset = self.packets.len();
        self.packets.extend_from_slice(packet);
        self.event(
            json!({"kind":"drain","request":request_json(request),"ackAccepted":true,
            "acknowledgedBefore":before,"acknowledgedAfter":after,"packetOffset":offset,
            "packetBytes":packet.len(),"replay":replay}),
        );
    }
    pub fn rejected(
        &mut self,
        request: &DrainRequest,
        ack_accepted: bool,
        before: u64,
        after: u64,
        error: &str,
    ) {
        self.incomplete("drain-rejected");
        self.event(
            json!({"kind":"drainRejected","request":request_json(request),"error":error,
            "ackAccepted":ack_accepted,"responseIssued":false,"acknowledgedBefore":before,"acknowledgedAfter":after}),
        );
    }
    pub fn stop(&mut self, receipt: &StopReceipt) {
        self.event(json!({"kind":"stop","receipt":receipt}));
    }

    fn prepare(mut self, reason: &str, receipt: Option<&StopReceipt>) -> Result<Prepared, String> {
        if reason != "complete" {
            self.incomplete(reason);
        }
        let mut spans = Vec::new();
        let mut frames = 0u64;
        let mut sequence = 0u64;
        let mut final_empty = false;
        for event in &self.events {
            if event["kind"] != "drain" {
                continue;
            }
            let offset = event["packetOffset"]
                .as_u64()
                .ok_or("Missing packet offset")? as usize;
            let length = event["packetBytes"]
                .as_u64()
                .ok_or("Missing packet length")? as usize;
            let packet = self
                .packets
                .get(offset..offset.checked_add(length).ok_or("Packet overflow")?)
                .ok_or("Packet extent")?;
            let prefix: [u8; 4] = packet
                .get(..4)
                .ok_or("Packet prefix")?
                .try_into()
                .map_err(|_| "Packet prefix")?;
            let header_end = 4usize
                .checked_add(u32::from_le_bytes(prefix) as usize)
                .ok_or("Header overflow")?;
            let header: Value =
                serde_json::from_slice(packet.get(4..header_end).ok_or("Header extent")?)
                    .map_err(|e| e.to_string())?;
            let blocks = header["blocks"].as_array().ok_or("Missing blocks")?;
            final_empty = blocks.is_empty()
                && header["receipt"]["state"] == "stopped"
                && header["receipt"]["health"]["healthy"] == true
                && header["receipt"]["corkAcknowledged"] == true
                && header["receipt"]["barrierAcknowledged"] == true
                && header["receipt"]["acknowledgedSequence"].as_u64() == Some(sequence)
                && header["receipt"]["producedFrames"].as_u64() == Some(frames);
            if event["replay"] == true {
                continue;
            }
            for block in blocks {
                let seq = block["sequence"].as_u64().ok_or("Block sequence")?;
                let start = block["frameStart"].as_u64().ok_or("Block start")?;
                let count = block["frames"].as_u64().ok_or("Block frames")?;
                let byte_offset = block["byteOffset"].as_u64().ok_or("Block bytes")? as usize;
                let byte_length = block["byteLength"].as_u64().ok_or("Block length")? as usize;
                if seq != sequence + 1
                    || start != frames
                    || count == 0
                    || count * 4 != byte_length as u64
                {
                    return Err("Audit raw coverage mismatch".into());
                }
                let begin = header_end
                    .checked_add(byte_offset)
                    .ok_or("Block overflow")?;
                packet
                    .get(begin..begin.checked_add(byte_length).ok_or("Block overflow")?)
                    .ok_or("Block extent")?;
                frames = frames
                    .checked_add(count)
                    .filter(|n| *n <= super::protocol::MAX_FRAMES)
                    .ok_or("Raw frame cap")?;
                sequence = seq;
                spans.push((offset + begin, byte_length));
            }
        }
        let healthy = receipt.is_some_and(|r| {
            r.state == "stopped"
                && r.health.healthy
                && r.cork_acknowledged
                && r.barrier_acknowledged
                && r.produced_frames == frames
                && r.last_sequence == sequence
                && r.acknowledged_sequence == sequence
        });
        if !healthy || !final_empty {
            self.incomplete("terminal-coverage-unconfirmed");
        }
        let complete = self.reasons.is_empty() && !self.descriptor.is_null();
        let metadata = self.descriptor["descriptor"].clone();
        let journal = json!({"schemaVersion":1,"events":self.events,"termination":{"reason":reason,"receipt":receipt},
            "complete":complete,"incompleteReasons":self.reasons,"uniqueIssuedFrames":frames,"uniqueIssuedSequences":sequence});
        Ok(Prepared {
            descriptor: self.descriptor,
            journal,
            packets: self.packets,
            spans,
            complete,
            metadata,
        })
    }
    pub fn finish(self, reason: &'static str, receipt: Option<StopReceipt>) {
        #[cfg(test)]
        if let Some(observer) = &self.terminal_observer {
            let _ = observer.try_send(reason);
            return;
        }
        let identity = self.descriptor["descriptor"].clone();
        let spawn = std::thread::Builder::new()
            .name("voco-native-audit-writer".into())
            .spawn(move || {
                let result = self
                    .prepare(reason, receipt.as_ref())
                    .and_then(|bundle| bundle.write());
                if let Err(error) = result {
                    eprintln!("Native capture audit incomplete: {error}");
                }
            });
        if let Err(error) = spawn {
            eprintln!("Native audit writer unavailable for {identity}: {error}; no complete audit committed");
        }
    }
}
struct Prepared {
    descriptor: Value,
    journal: Value,
    packets: Vec<u8>,
    spans: Vec<(usize, usize)>,
    complete: bool,
    metadata: Value,
}
impl Prepared {
    fn write(self) -> Result<std::path::PathBuf, String> {
        let metadata = json!({"complete":self.complete,"guiPid":std::process::id(),"captureId":self.metadata["captureId"],
            "sessionId":self.metadata["sessionId"],"generation":self.metadata["generation"]});
        super::private_bundle::write_bundle_streaming("native", metadata, |writer| {
            writer.write_file(
                "descriptor.json",
                &serde_json::to_vec_pretty(&self.descriptor).map_err(|e| e.to_string())?,
            )?;
            writer.write_file(
                "journal.json",
                &serde_json::to_vec_pretty(&self.journal).map_err(|e| e.to_string())?,
            )?;
            writer.write_file("packets.bin", &self.packets)?;
            writer.write_file_chunks(
                "raw.s16le",
                self.spans.iter().map(|(o, n)| &self.packets[*o..*o + *n]),
            )?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn flags_require_exact_all_three_values() {
        assert!(!flags_enabled(|_| None));
        assert!(!flags_enabled(|_| Some("true".into())));
        for missing in [
            "VOCO_DEV_NATIVE_CAPTURE",
            "VOCO_DEBUG_CAPTURE_AUDIO",
            "VOCO_DEBUG_NATIVE_CAPTURE",
        ] {
            assert!(!flags_enabled(|name| (name != missing).then(|| "1".into())));
        }
        assert!(flags_enabled(|_| Some("1".into())));
    }
    #[test]
    fn reservation_and_event_limits_fail_explicitly() {
        assert!(Audit::with_limits(usize::MAX, 1).is_err());
        let mut audit = Audit::with_limits(0, 0).unwrap();
        audit.event(json!({"kind":"stop"}));
        assert_eq!(audit.reasons, vec!["event-limit"]);
        assert!(audit.events.is_empty());
    }
    fn receipt(stopped: bool, ack: u64) -> StopReceipt {
        StopReceipt {
            state: if stopped { "stopped" } else { "stopping" },
            produced_frames: 1,
            last_sequence: 1,
            cork_acknowledged: stopped,
            barrier_acknowledged: stopped,
            limit_reached: false,
            acknowledged_sequence: ack,
            health: super::super::protocol::Health {
                healthy: true,
                reason: None,
            },
        }
    }
    fn recording() -> (Audit, super::super::protocol::Identity) {
        let identity = super::super::protocol::Identity {
            capture_id: "native-1-1".into(),
            session_id: 1,
            generation: 0,
        };
        let mut audit = Audit::with_limits(16384, 16).unwrap();
        audit.descriptor(&CaptureDescriptor {
            identity: identity.clone(),
            source: super::super::protocol::Source {
                selection_token: "explicit".into(),
                name: "source".into(),
                label: "Source".into(),
                index: 1,
                object_serial: Some("1".into()),
                is_monitor: false,
            },
            format: "s16le",
            sample_rate: 44100,
            channels: 2,
            channel_map: ["front-left", "front-right"],
            frame_bytes: 4,
            max_frames: super::super::protocol::MAX_FRAMES,
        });
        (audit, identity)
    }
    #[test]
    fn exact_replay_bytes_and_final_empty_ack_prove_unique_raw_coverage() {
        use super::super::protocol::{Block, Delivery};
        let (mut audit, identity) = recording();
        let mut delivery = Delivery::default();
        let request = |ack| DrainRequest {
            capture_id: identity.capture_id.clone(),
            session_id: 1,
            generation: 0,
            ack_through_sequence: ack,
        };
        let packet = delivery
            .issue(
                &identity,
                &[Block {
                    sequence: 1,
                    frame_start: 0,
                    bytes: vec![1, 2, 3, 4],
                }],
                &receipt(false, 0),
            )
            .unwrap();
        audit.drain(&request(0), 0, 0, &packet, false);
        audit.drain(&request(0), 0, 0, &delivery.replay().unwrap(), true);
        audit.stop(&receipt(true, 0));
        assert_eq!(delivery.acknowledge(1).unwrap(), 1);
        let empty = delivery.issue(&identity, &[], &receipt(true, 1)).unwrap();
        audit.drain(&request(1), 0, 1, &empty, false);
        let prepared = audit.prepare("complete", Some(&receipt(true, 1))).unwrap();
        assert!(prepared.complete);
        assert_eq!(prepared.spans.len(), 1);
        let (offset, length) = prepared.spans[0];
        assert_eq!(&prepared.packets[offset..offset + length], &[1, 2, 3, 4]);
        assert_eq!(
            &prepared.packets[..packet.len()],
            &prepared.packets[packet.len()..packet.len() * 2]
        );
    }
    #[test]
    fn stop_without_final_drain_and_rejected_ack_never_claim_complete() {
        let (mut audit, identity) = recording();
        audit.stop(&receipt(true, 1));
        audit.rejected(
            &DrainRequest {
                capture_id: identity.capture_id,
                session_id: 1,
                generation: 0,
                ack_through_sequence: 1,
            },
            false,
            0,
            0,
            "ACK was not issued",
        );
        let prepared = audit.prepare("complete", Some(&receipt(true, 1))).unwrap();
        assert!(!prepared.complete);
        assert!(prepared.journal["incompleteReasons"]
            .as_array()
            .unwrap()
            .contains(&json!("drain-rejected")));
    }
    #[test]
    fn packet_cap_records_incomplete_without_partial_packet_append() {
        let mut audit = Audit::with_limits(1, 4).unwrap();
        let request = DrainRequest {
            capture_id: "test".into(),
            session_id: 1,
            generation: 0,
            ack_through_sequence: 0,
        };
        audit.drain(&request, 0, 0, &[1, 2], false);
        audit.drain(&request, 0, 0, &[1], false); // A later smaller packet must not create a gap.
        assert!(audit.packets.is_empty());
        assert!(audit.events.is_empty());
        assert!(!audit.prepare("cancel", None).unwrap().complete);
    }
}
