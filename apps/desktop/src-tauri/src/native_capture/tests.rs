use super::*;
use protocol::{Block, BATCH_BLOCKS};
fn source() -> Source {
    Source {
        selection_token: pulse::source_token(1, 4, "explicit-source", Some("55")),
        name: "explicit-source".into(),
        label: "Selected microphone".into(),
        index: 4,
        object_serial: Some("55".into()),
        is_monitor: false,
    }
}
fn identity() -> Identity {
    Identity {
        capture_id: "native-1-1".into(),
        session_id: 7,
        generation: 2,
    }
}
fn block(sequence: u64, start: u64) -> Block {
    Block {
        sequence,
        frame_start: start,
        bytes: vec![1, 2, 3, 4],
    }
}
fn session() -> Session {
    Session {
        identity: identity(),
        delivery: Delivery::default(),
        lease: Instant::now(),
        failure: None,
        audit: None,
        audit_requested: false,
    }
}
#[derive(Default)]
struct Fake {
    status: Status,
    blocks: Vec<Block>,
    stopped: bool,
    cancelled: bool,
    acknowledged: usize,
    fail_start: bool,
    startup_delay: Duration,
    begin_calls: usize,
    catalog_revision: u64,
    catalog_sources: Option<Vec<Source>>,
    default_index: Option<u32>,
    fail_blocks: bool,
}
impl CaptureBackend for Fake {
    fn connect() -> Result<Self, String> {
        Ok(Self::default())
    }
    fn enumerate(&mut self, epoch: u64) -> Result<(u64, Vec<Source>, Option<String>), String> {
        let mut sources = self
            .catalog_sources
            .clone()
            .unwrap_or_else(|| vec![source()]);
        for item in &mut sources {
            item.selection_token =
                pulse::source_token(epoch, item.index, &item.name, item.object_serial.as_deref());
        }
        let default = sources
            .iter()
            .find(|s| s.index == self.default_index.unwrap_or(4))
            .map(|s| s.selection_token.clone());
        Ok((self.catalog_revision.max(1), sources, default))
    }
    fn begin(&mut self, _: &Source, _: u64) -> Result<(), String> {
        self.begin_calls += 1;
        thread::sleep(self.startup_delay);
        if self.fail_start {
            Err("source disappeared".into())
        } else {
            self.status.ready = true;
            Ok(())
        }
    }
    fn tick(&mut self) {}
    fn stop(&mut self) {
        self.stopped = true;
        self.status.stopped = true;
        self.status.cork_ack = true;
        self.status.barrier_ack = true;
    }
    fn cancel(&mut self) {
        self.cancelled = true;
        self.blocks.clear();
        if self.status.error.is_none() {
            self.status = Status {
                stopped: true,
                ..Status::default()
            };
        }
    }
    fn status(&self) -> Status {
        self.status.clone()
    }
    fn blocks(&self) -> Result<Vec<Block>, String> {
        if self.fail_blocks {
            return Err("Fake block read failure".into());
        }
        Ok(self.blocks.iter().take(BATCH_BLOCKS).cloned().collect())
    }
    fn ack(&mut self, n: usize) -> Result<(), String> {
        if n > self.blocks.len() {
            return Err("fake ACK overflow".into());
        }
        self.blocks.drain(..n);
        self.acknowledged += n;
        Ok(())
    }
}
fn active() -> Worker<Fake> {
    Worker {
        pulse: Some(Fake {
            status: Status {
                ready: true,
                frames: 2,
                blocks: 2,
                ..Status::default()
            },
            blocks: vec![block(1, 0), block(2, 1)],
            ..Fake::default()
        }),
        sources: vec![source()],
        revision: 1,
        epoch: 1,
        approved: Some(source().selection_token),
        session: Some(session()),
        next_capture: 1,
        request_deadline: None,
        audit_attempted: false,
        audit_enabled: false,
    }
}
fn drain(ack: u64) -> Request {
    Request::Drain(DrainRequest {
        capture_id: identity().capture_id,
        session_id: 7,
        generation: 2,
        ack_through_sequence: ack,
    })
}
fn bytes(response: Response) -> Vec<u8> {
    match response {
        Response::Bytes(bytes) => bytes,
        _ => panic!("Wrong response"),
    }
}
#[test]
fn acknowledgement_replays_exact_packet_then_advances_once() {
    let mut worker = active();
    let first = bytes(worker.handle(drain(0)).unwrap());
    worker.pulse.as_mut().unwrap().status.stopped = true;
    assert_eq!(first, bytes(worker.handle(drain(0)).unwrap()));
    assert!(worker.handle(drain(1)).is_err());
    assert!(worker.handle(drain(3)).is_err());
    assert_eq!(worker.pulse.as_ref().unwrap().acknowledged, 0);
    let fresh = bytes(worker.handle(drain(2)).unwrap());
    assert_ne!(first, fresh);
    assert_eq!(worker.pulse.as_ref().unwrap().acknowledged, 2);
    worker.handle(drain(2)).unwrap();
    assert_eq!(worker.pulse.as_ref().unwrap().acknowledged, 2);
}
#[test]
fn packet_contains_exact_stereo_bytes_and_contiguous_offsets() {
    let mut worker = active();
    let packet = bytes(worker.handle(drain(0)).unwrap());
    let length = u32::from_le_bytes(packet[..4].try_into().unwrap()) as usize;
    let header: serde_json::Value = serde_json::from_slice(&packet[4..4 + length]).unwrap();
    assert_eq!(header["version"], 1);
    assert_eq!(header["captureId"], identity().capture_id);
    assert_eq!(header["blocks"][1]["byteOffset"], 4);
    assert_eq!(header["blocks"][1]["frameStart"], 1);
    assert_eq!(&packet[4 + length..], &[1, 2, 3, 4, 1, 2, 3, 4]);
}
#[test]
fn stop_does_not_ack_audio_and_next_begin_waits_for_complete_delivery() {
    let mut worker = active();
    worker.handle(Request::Stop(identity())).unwrap();
    assert!(worker.release_complete().is_err());
    worker.handle(drain(0)).unwrap();
    let packet = bytes(worker.handle(drain(2)).unwrap());
    let size = u32::from_le_bytes(packet[..4].try_into().unwrap()) as usize;
    let value: serde_json::Value = serde_json::from_slice(&packet[4..4 + size]).unwrap();
    assert_eq!(value["receipt"]["acknowledgedSequence"], 2);
    assert_eq!(value["receipt"]["health"]["healthy"], true);
    worker.release_complete().unwrap();
    assert!(worker.session.is_none());
}
#[test]
fn stale_stop_cancel_and_ack_never_touch_owned_stream() {
    let mut worker = active();
    let mut old = identity();
    old.generation += 1;
    assert!(worker.handle(Request::Stop(old.clone())).is_err());
    assert!(worker.handle(Request::Cancel(old)).is_err());
    assert!(!worker.pulse.as_ref().unwrap().stopped);
    assert!(!worker.pulse.as_ref().unwrap().cancelled);
    let mut wrong = match drain(0) {
        Request::Drain(v) => v,
        _ => unreachable!(),
    };
    wrong.session_id += 1;
    assert!(worker.handle(Request::Drain(wrong)).is_err());
    assert_eq!(worker.pulse.as_ref().unwrap().acknowledged, 0);
}
#[test]
fn lease_loss_stops_and_invalidates_automatic_completion() {
    let mut worker = active();
    worker.session.as_mut().unwrap().lease = Instant::now() - Duration::from_secs(6);
    worker.tick();
    assert!(worker.pulse.as_ref().unwrap().stopped);
    let receipt = worker
        .session
        .as_ref()
        .unwrap()
        .receipt(&worker.pulse.as_ref().unwrap().status());
    assert!(!receipt.health.healthy);
    assert_eq!(
        receipt.health.reason.as_deref(),
        Some("Renderer drain lease expired")
    );
}
#[test]
fn holes_moves_and_missing_stop_ack_are_never_healthy() {
    for reason in [
        "audio-hole",
        "source-moved",
        "server-overflow",
        "source-removed",
    ] {
        let status = Status {
            stopped: true,
            cork_ack: true,
            barrier_ack: true,
            error: Some(reason.into()),
            ..Status::default()
        };
        assert!(!session().receipt(&status).health.healthy);
    }
    assert!(
        !session()
            .receipt(&Status {
                stopped: true,
                ..Status::default()
            })
            .health
            .healthy
    );
}
#[test]
fn select_requires_acknowledgement_and_supported_exact_token() {
    let mut worker = Worker::<Fake>::new();
    worker.handle(Request::List).unwrap();
    assert!(worker
        .handle(Request::Select(source().selection_token, false))
        .is_err());
    assert!(worker
        .handle(Request::Select("browser-device-id".into(), true))
        .is_err());
    worker.sources[0].object_serial = None;
    assert!(worker
        .handle(Request::Select(source().selection_token, true))
        .is_err());
    assert!(worker.approved.is_none());
}
#[test]
fn startup_failure_closes_backend_and_revokes_selection() {
    let mut worker = Worker::<Fake>::new();
    worker.handle(Request::List).unwrap();
    worker
        .handle(Request::Select(source().selection_token, true))
        .unwrap();
    worker.pulse.as_mut().unwrap().fail_start = true;
    assert!(worker
        .handle(Request::Begin(BeginRequest {
            session_id: 1,
            generation: 0,
            selection_token: source().selection_token
        }))
        .is_err());
    assert!(worker.pulse.is_none());
    assert!(worker.approved.is_none());
    assert!(worker.session.is_none());
}
#[test]
fn invalid_native_blocks_fail_before_pending_delivery() {
    let mut delivery = Delivery::default();
    let receipt = session().receipt(&Status::default());
    for blocks in [
        vec![block(2, 0)],
        vec![block(1, 1)],
        vec![Block {
            sequence: 1,
            frame_start: 0,
            bytes: vec![0; 3],
        }],
    ] {
        assert!(delivery.issue(&identity(), &blocks, &receipt).is_err());
        assert!(delivery.replay().is_none());
    }
}
#[test]
fn cap_receipt_is_explicit_and_does_not_synthesize_missing_frames() {
    let receipt = session().receipt(&Status {
        frames: MAX_FRAMES,
        blocks: 3000,
        stopped: true,
        cork_ack: true,
        barrier_ack: true,
        limit_reached: true,
        ..Status::default()
    });
    assert!(receipt.health.healthy);
    assert!(receipt.limit_reached);
    assert_eq!(receipt.produced_frames, MAX_FRAMES);
    assert_eq!(receipt.acknowledged_sequence, 0);
}

#[test]
fn renderer_reset_cancels_and_revokes_but_worker_can_enumerate_again() {
    let mut worker = active();
    worker.handle(Request::ResetRenderer).unwrap();
    assert!(worker.pulse.is_none());
    assert!(worker.session.is_none());
    assert!(worker.sources.is_empty());
    assert!(worker.approved.is_none());
    assert!(worker
        .handle(Request::Begin(BeginRequest {
            session_id: 8,
            generation: 0,
            selection_token: source().selection_token
        }))
        .is_err());
    worker.handle(Request::List).unwrap();
    assert_eq!(worker.sources.len(), 1);
    assert!(worker.approved.is_none());
}

#[test]
fn lost_old_begin_reply_cannot_cancel_newer_owner() {
    let mut worker = active();
    let mut stale = identity();
    stale.generation += 1;
    worker.abandon_begin(&stale);
    assert!(worker.session.is_some());
    worker.abandon_begin(&identity());
    assert!(worker.session.is_none());
    assert!(worker.pulse.as_ref().unwrap().cancelled);
}

#[test]
fn expired_queued_begin_does_not_start_and_late_ready_is_cancelled() {
    let mut worker = Worker::<Fake>::new();
    worker.handle(Request::List).unwrap();
    worker
        .handle(Request::Select(source().selection_token, true))
        .unwrap();
    let begin = || {
        Request::Begin(BeginRequest {
            session_id: 1,
            generation: 0,
            selection_token: source().selection_token,
        })
    };
    assert!(worker
        .dispatch(begin(), Instant::now() - Duration::from_secs(1))
        .is_err());
    assert_eq!(worker.pulse.as_ref().unwrap().begin_calls, 0);
    worker.pulse.as_mut().unwrap().startup_delay = Duration::from_millis(5);
    assert!(worker
        .dispatch(begin(), Instant::now() + Duration::from_millis(1))
        .is_err());
    assert!(worker.pulse.is_none());
    assert!(worker.session.is_none());
    assert!(worker.approved.is_none());
}

#[test]
fn delayed_pre_reset_selection_and_begin_cannot_use_new_catalog() {
    let mut worker = active();
    let stale = source().selection_token;
    worker.handle(Request::ResetRenderer).unwrap();
    worker.handle(Request::List).unwrap();
    let current = worker.sources[0].selection_token.clone();
    assert_ne!(stale, current);
    worker
        .handle(Request::Select(current.clone(), true))
        .unwrap();
    assert!(worker.handle(Request::Select(stale.clone(), true)).is_err());
    assert!(worker
        .handle(Request::Begin(BeginRequest {
            session_id: 7,
            generation: 2,
            selection_token: stale
        }))
        .is_err());
    assert_eq!(worker.approved.as_ref(), Some(&current));
    assert_eq!(worker.pulse.as_ref().unwrap().begin_calls, 0);
}
#[test]
fn healthy_cancel_retains_grant_but_interrupted_cancel_requires_reselection() {
    let mut worker = active();
    worker.handle(Request::Cancel(identity())).unwrap();
    assert_eq!(worker.approved.as_ref(), Some(&source().selection_token));
    worker
        .handle(Request::Begin(BeginRequest {
            session_id: 8,
            generation: 3,
            selection_token: source().selection_token,
        }))
        .unwrap();
    assert_eq!(worker.pulse.as_ref().unwrap().begin_calls, 1);
    let mut worker = active();
    worker.pulse.as_mut().unwrap().status.error = Some("source-removed".into());
    worker.handle(Request::Cancel(identity())).unwrap();
    assert!(worker.approved.is_none());
    assert!(worker.pulse.is_none());
}

#[test]
fn unhealthy_fully_delivered_release_revokes_native_grant() {
    for lease_failure in [false, true] {
        let mut worker = active();
        worker.handle(Request::Stop(identity())).unwrap();
        if lease_failure {
            worker.session.as_mut().unwrap().failure = Some("Renderer drain lease expired".into());
        } else {
            worker.pulse.as_mut().unwrap().status.error = Some("source-removed".into());
        }
        worker.handle(drain(0)).unwrap();
        worker.handle(drain(2)).unwrap();
        worker.release_complete().unwrap();
        assert!(worker.approved.is_none());
        assert!(worker
            .handle(Request::Begin(BeginRequest {
                session_id: 8,
                generation: 3,
                selection_token: source().selection_token
            }))
            .is_err());
    }
}
#[test]
fn cancelling_session_lease_failure_revokes_even_if_c_status_is_healthy() {
    let mut worker = active();
    worker.session.as_mut().unwrap().failure = Some("Renderer drain lease expired".into());
    assert!(worker.pulse.as_ref().unwrap().status.error.is_none());
    worker.handle(Request::Cancel(identity())).unwrap();
    assert!(worker.pulse.is_none());
    assert!(worker.approved.is_none());
}

#[test]
fn harmless_catalog_changes_preserve_exact_source_grant_and_next_begin() {
    let mut worker = active();
    worker.handle(Request::Cancel(identity())).unwrap();
    let approved = worker.approved.clone();
    let mut renamed_label = source();
    renamed_label.label = "Updated display label".into();
    let mut unrelated = source();
    unrelated.index = 9;
    unrelated.name = "other-source".into();
    unrelated.object_serial = Some("99".into());
    let backend = worker.pulse.as_mut().unwrap();
    backend.catalog_revision = 42;
    backend.catalog_sources = Some(vec![renamed_label, unrelated]);
    backend.default_index = Some(9);
    let Response::Sources(list) = worker.handle(Request::List).unwrap() else {
        panic!("catalog expected")
    };
    assert_eq!(worker.approved, approved);
    assert_ne!(list.default_selection_token, approved);
    worker.pulse.as_mut().unwrap().catalog_sources = Some(vec![source()]);
    worker.pulse.as_mut().unwrap().catalog_revision = 43;
    worker.handle(Request::List).unwrap();
    assert_eq!(worker.approved, approved);
    worker
        .handle(Request::Begin(BeginRequest {
            session_id: 8,
            generation: 2,
            selection_token: approved.unwrap(),
        }))
        .unwrap();
    assert_eq!(worker.pulse.as_ref().unwrap().begin_calls, 1);
}

#[test]
fn catalog_identity_changes_revoke_and_missing_serial_cannot_be_selected() {
    for field in 0..4 {
        let mut worker = active();
        worker.handle(Request::Cancel(identity())).unwrap();
        let old = worker.approved.clone().unwrap();
        let mut changed = source();
        match field {
            0 => changed.object_serial = Some("replacement".into()),
            1 => changed.name = "replacement".into(),
            2 => changed.index = 8,
            _ => changed.object_serial = None,
        }
        worker.pulse.as_mut().unwrap().catalog_sources = Some(vec![changed]);
        // Even without a catalog event revision, identity replacement must revoke.
        worker.handle(Request::List).unwrap();
        assert!(worker.approved.is_none());
        assert!(worker.handle(Request::Select(old, true)).is_err());
        if field == 3 {
            let token = worker.sources[0].selection_token.clone();
            assert!(worker.handle(Request::Select(token, true)).is_err());
        }
    }
}

#[test]
fn source_token_encoding_is_unambiguous_and_connection_scoped() {
    let token = pulse::source_token(1, 4, "a:b", Some("c"));
    assert_ne!(token, pulse::source_token(1, 4, "a", Some("b:c")));
    assert_ne!(token, pulse::source_token(2, 4, "a:b", Some("c")));
}

#[test]
fn retained_export_requires_exact_stopped_session_without_releasing_it() {
    let mut worker = active();
    worker.session.as_mut().unwrap().audit_requested = true;
    assert!(worker.handle(Request::VerifyStopped(identity())).is_err());
    worker.pulse.as_mut().unwrap().status.stopped = true;
    let mut stale = identity();
    stale.generation += 1;
    assert!(worker.handle(Request::VerifyStopped(stale)).is_err());
    worker.handle(Request::VerifyStopped(identity())).unwrap();
    assert!(worker.session.is_some());
    assert!(!worker.pulse.as_ref().unwrap().cancelled);
}

#[test]
fn audit_records_actual_partial_ack_rejection_without_accepting_or_dropping_pcm() {
    let mut worker = active();
    worker.session.as_mut().unwrap().audit = Some(audit::Audit::for_test());
    let first = bytes(worker.handle(drain(0)).unwrap());
    assert!(worker.handle(drain(1)).is_err());
    let replay = bytes(worker.handle(drain(0)).unwrap());
    assert_eq!(first, replay);
    assert_eq!(worker.pulse.as_ref().unwrap().acknowledged, 0);
    let events = worker
        .session
        .as_ref()
        .unwrap()
        .audit
        .as_ref()
        .unwrap()
        .test_events();
    assert_eq!(events[0]["kind"], "drain");
    assert_eq!(events[1]["kind"], "drainRejected");
    assert_eq!(events[1]["ackAccepted"], false);
    assert_eq!(events[2]["replay"], true);
    // Dropping an unterminated in-memory audit does not create filesystem artifacts.
    worker.session.as_mut().unwrap().audit = None;
}

#[test]
fn audit_distinguishes_accepted_ack_from_later_response_failure() {
    let mut worker = active();
    worker.session.as_mut().unwrap().audit = Some(audit::Audit::for_test());
    worker.handle(drain(0)).unwrap();
    worker.pulse.as_mut().unwrap().fail_blocks = true;
    assert!(worker.handle(drain(2)).is_err());
    assert_eq!(worker.pulse.as_ref().unwrap().acknowledged, 2);
    let events = worker
        .session
        .as_ref()
        .unwrap()
        .audit
        .as_ref()
        .unwrap()
        .test_events();
    assert_eq!(events[1]["kind"], "drainRejected");
    assert_eq!(events[1]["ackAccepted"], true);
    assert_eq!(events[1]["responseIssued"], false);
    assert_eq!(events[1]["acknowledgedAfter"], 2);
    worker.session.as_mut().unwrap().audit = None;
}

#[test]
#[ignore = "Explicit offline fixture export requires a dedicated XDG_STATE_HOME"]
fn export_actual_audit_fake_backend_bundle() {
    let root = std::env::var_os("VOCO_AUDIT_TEST_EXPORT_ROOT").expect("explicit export root");
    assert_eq!(std::env::var_os("XDG_STATE_HOME"), Some(root.clone()));
    assert!(std::path::Path::new(&root).is_absolute());
    let mut worker = active();
    let descriptor = CaptureDescriptor {
        identity: identity(),
        source: source(),
        format: "s16le",
        sample_rate: 44100,
        channels: 2,
        channel_map: ["front-left", "front-right"],
        frame_bytes: 4,
        max_frames: MAX_FRAMES,
    };
    let mut audit = audit::Audit::for_test();
    audit.descriptor(&descriptor);
    worker.session.as_mut().unwrap().audit = Some(audit);
    let first = bytes(worker.handle(drain(0)).unwrap());
    assert_eq!(first, bytes(worker.handle(drain(0)).unwrap()));
    worker.handle(Request::Stop(identity())).unwrap();
    // Keep this generated fixture synchronous; the actual manager still produces its final response.
    let mut audit = worker.session.as_mut().unwrap().audit.take().unwrap();
    let final_packet = bytes(worker.handle(drain(2)).unwrap());
    let request = DrainRequest {
        capture_id: identity().capture_id,
        session_id: 7,
        generation: 2,
        ack_through_sequence: 2,
    };
    audit.drain(&request, 0, 2, &final_packet, false);
    let receipt = worker
        .session
        .as_ref()
        .unwrap()
        .receipt(&worker.pulse.as_ref().unwrap().status());
    println!("NATIVE_AUDIT_FIXTURE_GUI_PID={}", std::process::id());
    let path = audit.test_export(&receipt).unwrap();
    println!("NATIVE_AUDIT_FIXTURE={}", path.display());
}

#[test]
fn retained_export_rejects_later_unaudited_stopped_capture() {
    let mut worker = active();
    worker.pulse.as_mut().unwrap().status.stopped = true;
    assert!(!worker.session.as_ref().unwrap().audit_requested);
    assert!(worker.handle(Request::VerifyStopped(identity())).is_err());
    assert!(worker.session.is_some());
}

#[test]
fn audited_orphan_and_renderer_reset_terminate_once_without_active_disk_work() {
    for reset in [false, true] {
        let mut worker = active();
        let (send, receive) = mpsc::sync_channel(1);
        let mut audit = audit::Audit::for_test();
        audit.observe_terminal(send);
        worker.session.as_mut().unwrap().audit = Some(audit);
        worker.session.as_mut().unwrap().audit_requested = true;
        worker.audit_attempted = true;
        let mut stale = identity();
        stale.generation += 1;
        worker.abandon_begin(&stale);
        assert!(receive.try_recv().is_err());
        assert!(!worker.pulse.as_ref().unwrap().cancelled);
        if reset {
            worker.handle(Request::ResetRenderer).unwrap();
            assert!(worker.pulse.is_none());
            assert_eq!(receive.try_recv().unwrap(), "reset");
        } else {
            worker.abandon_begin(&identity());
            assert!(worker.pulse.as_ref().unwrap().cancelled);
            assert_eq!(receive.try_recv().unwrap(), "cancel");
        }
        assert!(worker.session.is_none());
        assert!(worker.audit_attempted);
        assert!(receive.try_recv().is_err());
    }
}

#[test]
fn disconnected_backend_waits_for_commands_without_poll_timeouts() {
    let worker = Worker::<Fake>::new();
    let (send, incoming) = mpsc::sync_channel(1);
    let sender = thread::spawn(move || {
        thread::sleep(Duration::from_millis(30));
        let (reply, _) = mpsc::sync_channel(1);
        send.send(Envelope {
            deadline: Instant::now() + CALL_TIMEOUT,
            request: Request::List,
            reply,
        })
        .unwrap();
    });
    assert!(matches!(
        worker.next_command(&incoming).unwrap().request,
        Request::List
    ));
    sender.join().unwrap();
    assert!(matches!(
        worker.next_command(&incoming),
        Err(mpsc::RecvTimeoutError::Disconnected)
    ));
}

#[test]
fn connected_backend_keeps_periodic_pump_and_lease_checks() {
    let worker = active();
    let (_send, incoming) = mpsc::sync_channel(1);
    assert!(matches!(
        worker.next_command(&incoming),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
}
