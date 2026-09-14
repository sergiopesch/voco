//! Optional final-text corroboration. No transcript or PCM survives in diagnostics.
use super::*;
use std::time::Instant;
use whisper_rs::SelectedWindowEvidence;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Diagnostics {
    additional_us: u64,
    candidate_us: u64,
    view_us: u64,
    candidate_native_calls: usize,
    view_native_calls: usize,
    view_piece_attempts: usize,
    silent_pieces: usize,
    evidence_rows: usize,
    structural: u32,
    actual_eot: bool,
    completed: bool,
    entropy_rejected: bool,
    native_failed: bool,
    original_no_speech: bool,
    lexical_no_speech: bool,
    candidate_avg_logprob: Option<f64>,
    candidate_text_tokens: i32,
    candidate_seek: Option<i64>,
    candidate_eligible: bool,
    candidate_error: bool,
    empty_candidate: bool,
    identical_words: bool,
    boundary_only_difference: bool,
    view_error: bool,
    view_available: bool,
    normalized_agreement: bool,
    raw_cleaned_agreement: bool,
    selected: bool,
    pieces: Vec<PieceEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    view_stopped_early: Option<ViewStoppedEarly>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ViewStoppedEarly {
    reason: ViewStopReason,
    unattempted_pieces: usize,
    unattempted_ranges: Vec<[usize; 2]>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum ViewStopReason {
    UnhealthyPiece,
    NormalizedPrefixMismatch,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PieceEvidence {
    start_sample: usize,
    end_sample: usize,
    audio_context: i32,
    signal: bool,
    error: bool,
    terminal_failure: bool,
    low_confidence_rejection: bool,
}
struct Candidate {
    text: String,
    evidence: Vec<SelectedWindowEvidence>,
}
fn elapsed(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_micros()).unwrap_or(u64::MAX)
}
pub(super) fn healthy_route(samples: usize, text: &str, d: &DecodeDecision) -> bool {
    samples > 0
        && samples <= CANONICAL_CHUNK_MAX_SAMPLES
        && samples == d.input_samples
        && !normalized_words(text).is_empty()
        && !d.native_repetition_rejection_history
        && !d.native_low_confidence_rejection
        && !d.native_terminal_failure
        && !d.retried
        && !d.retry_failed
        && d.retry_reason.is_none()
        && d.retry_ranges.is_empty()
        && d.retry_audio_contexts.is_empty()
        && d.retry_segment_bounds_ms.is_empty()
        && d.retry_native_rejections == 0
        && d.retry_terminal_failures == 0
        && d.retry_completed_windows == 0
}
// A preservation veto, not a claim that differently spaced words mean the same thing.
// Keep punctuation and Unicode scalar spelling; ignore only whitespace and case.
fn same_non_whitespace_text(baseline: &str, alternate: &str) -> bool {
    baseline
        .chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(char::to_lowercase)
        .eq(alternate
            .chars()
            .filter(|c| !c.is_whitespace())
            .flat_map(char::to_lowercase))
}

fn admitted(e: &SelectedWindowEvidence) -> bool {
    e.seek == 0
        && e.structural == 0
        && e.actual_eot
        && e.completed
        && e.text_tokens > 0
        && e.avg_logprob.is_finite()
        && e.avg_logprob >= -1.0
        && !e.original_no_speech
        && !e.lexical_no_speech
        && (!e.native_failed || e.entropy_rejected)
}
fn generate(
    ctx: &WhisperContext,
    samples: &[f32],
    d: &mut Diagnostics,
) -> Result<Candidate, String> {
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    let mut params = transcription_params();
    params.set_no_timestamps(true);
    params.set_temperature(0.0);
    params.set_temperature_inc(0.0);
    d.candidate_native_calls += 1;
    state.full(params, samples).map_err(|e| e.to_string())?;
    let evidence = state
        .selected_window_evidence()
        .map_err(|e| e.to_string())?;
    let mut raw = String::new();
    for i in 0..state.full_n_segments().map_err(|e| e.to_string())? {
        raw.push_str(&state.full_get_segment_text(i).map_err(|e| e.to_string())?);
    }
    // The state is dropped before direct piece decoding begins.
    Ok(Candidate {
        text: clean_transcript_text(&raw),
        evidence,
    })
}
pub(super) fn run(state: &WhisperState, samples: &[f32], baseline: &str) -> (String, Diagnostics) {
    run_using(
        samples,
        baseline,
        |d| generate(state.ctx.as_ref().ok_or("Model not loaded")?, samples, d),
        |audio, context, calls| {
            let counter = std::cell::Cell::new(0);
            let result = state.decode_validation_once(audio, context, &counter);
            *calls += counter.get();
            result
        },
    )
}
fn run_using<G, F>(
    samples: &[f32],
    baseline: &str,
    generate: G,
    mut decode: F,
) -> (String, Diagnostics)
where
    G: FnOnce(&mut Diagnostics) -> Result<Candidate, String>,
    F: FnMut(&[f32], DecodeContext, &mut usize) -> Result<DecodeAttempt, String>,
{
    let started = Instant::now();
    let mut d = Diagnostics::default();
    let text = run_inner(samples, baseline, generate, &mut decode, &mut d);
    d.additional_us = elapsed(started);
    (text, d)
}
fn run_inner<G, F>(
    samples: &[f32],
    baseline: &str,
    generate: G,
    decode: &mut F,
    d: &mut Diagnostics,
) -> String
where
    G: FnOnce(&mut Diagnostics) -> Result<Candidate, String>,
    F: FnMut(&[f32], DecodeContext, &mut usize) -> Result<DecodeAttempt, String>,
{
    let started = Instant::now();
    let candidate = generate(d);
    d.candidate_us = elapsed(started);
    let candidate = match candidate {
        Ok(c) => c,
        Err(_) => {
            d.candidate_error = true;
            return baseline.to_owned();
        }
    };
    d.evidence_rows = candidate.evidence.len();
    let [e] = candidate.evidence.as_slice() else {
        d.candidate_error = true;
        return baseline.to_owned();
    };
    d.structural = e.structural;
    d.actual_eot = e.actual_eot;
    d.completed = e.completed;
    d.entropy_rejected = e.entropy_rejected;
    d.native_failed = e.native_failed;
    d.original_no_speech = e.original_no_speech;
    d.lexical_no_speech = e.lexical_no_speech;
    d.candidate_avg_logprob = e.avg_logprob.is_finite().then_some(e.avg_logprob);
    d.candidate_text_tokens = e.text_tokens;
    d.candidate_seek = Some(e.seek);
    d.candidate_eligible = admitted(e);
    if !d.candidate_eligible {
        return baseline.to_owned();
    }
    let alternate = clean_transcript_text(&candidate.text);
    let alternative_words = normalized_words(&alternate);
    d.empty_candidate = alternative_words.is_empty();
    d.identical_words = alternative_words == normalized_words(baseline);
    if d.empty_candidate || d.identical_words {
        return baseline.to_owned();
    }
    d.boundary_only_difference = same_non_whitespace_text(baseline, &alternate);
    if d.boundary_only_difference {
        return baseline.to_owned();
    }
    let ranges = coalesce_retry_ranges(utterance_ranges(samples));
    if ranges.is_empty() || ranges.len() > CANONICAL_CHUNK_MAX_SAMPLES / 24000 {
        d.view_error = true;
        return baseline.to_owned();
    }
    let started = Instant::now();
    let mut joined = String::new();
    let mut healthy = true;
    for (index, range) in ranges.iter().enumerate() {
        let signal = match has_signal(&samples[range.clone()]) {
            Ok(s) => s,
            Err(_) => {
                d.view_error = true;
                healthy = false;
                break;
            }
        };
        d.view_piece_attempts += 1;
        d.silent_pieces += usize::from(!signal);
        let mut piece = PieceEvidence {
            start_sample: range.start,
            end_sample: range.end,
            audio_context: retry_audio_context(range.len(), DecodeContext::DecoderFailureRetry),
            signal,
            error: false,
            terminal_failure: false,
            low_confidence_rejection: false,
        };
        match decode(
            &samples[range.clone()],
            DecodeContext::DecoderFailureRetry,
            &mut d.view_native_calls,
        ) {
            Ok(attempt) => {
                piece.terminal_failure = attempt.native_terminal_failure;
                piece.low_confidence_rejection = attempt.native_low_confidence_rejection;
                healthy &= !piece.terminal_failure && !piece.low_confidence_rejection;
                append_disjoint_text(&mut joined, &attempt.output.text);
            }
            Err(_) => {
                piece.error = true;
                d.view_error = true;
                healthy = false;
            }
        }
        d.pieces.push(piece);
        if index + 1 < ranges.len() {
            // Every later piece is appended after a space, so completed words
            // cannot change. Neither a mismatching prefix nor unhealthy evidence
            // can become a selectable complete view through more decoding.
            let reason = if !healthy {
                Some(ViewStopReason::UnhealthyPiece)
            } else if !alternative_words.starts_with(&normalized_words(&joined)) {
                Some(ViewStopReason::NormalizedPrefixMismatch)
            } else {
                None
            };
            if let Some(reason) = reason {
                let unattempted_ranges: Vec<_> = ranges[index + 1..]
                    .iter()
                    .map(|range| [range.start, range.end])
                    .collect();
                d.view_stopped_early = Some(ViewStoppedEarly {
                    reason,
                    unattempted_pieces: unattempted_ranges.len(),
                    unattempted_ranges,
                });
                d.view_us = elapsed(started);
                // Partial view flags stay false; no full agreement/availability
                // claim is made for the skipped remainder.
                return baseline.to_owned();
            }
        }
    }
    d.view_us = elapsed(started);
    let words = normalized_words(&joined);
    d.view_available = healthy && !words.is_empty();
    d.normalized_agreement = !words.is_empty() && words == alternative_words;
    d.raw_cleaned_agreement = clean_transcript_text(&joined) == alternate;
    d.selected = d.view_available && d.normalized_agreement;
    if d.selected {
        alternate
    } else {
        baseline.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn evidence() -> SelectedWindowEvidence {
        SelectedWindowEvidence {
            seek: 0,
            structural: 0,
            actual_eot: true,
            completed: true,
            entropy_rejected: true,
            native_failed: true,
            avg_logprob: -0.1,
            original_no_speech: false,
            lexical_no_speech: false,
            text_tokens: 10,
        }
    }
    fn candidate(text: &str) -> Candidate {
        Candidate {
            text: text.into(),
            evidence: vec![evidence()],
        }
    }
    fn attempt(text: &str) -> DecodeAttempt {
        DecodeAttempt {
            output: PreviewTranscription {
                text: text.into(),
                segments: vec![],
            },
            native_low_confidence_rejection: false,
            native_repetition_rejection_history: false,
            native_terminal_failure: false,
            near_end_completion_offset_frames: None,
        }
    }
    fn audio() -> Vec<f32> {
        (0..32000)
            .map(|i| if i % 2 == 0 { 0.1 } else { -0.1 })
            .collect()
    }
    fn decision() -> DecodeDecision {
        DecodeDecision {
            input_samples: 32000,
            native_low_confidence_rejection: false,
            native_repetition_rejection_history: false,
            native_terminal_failure: false,
            near_end_completion_offset_frames: None,
            retry_reason: None,
            retried: false,
            retry_ranges: vec![],
            retry_audio_contexts: vec![],
            retry_segment_bounds_ms: vec![],
            retry_native_rejections: 0,
            retry_terminal_failures: 0,
            retry_completed_windows: 0,
            retry_failed: false,
            corroboration: None,
        }
    }
    #[test]
    fn healthy_route_excludes_every_recovery_and_failure_indicator() {
        assert!(healthy_route(32000, "Go", &decision()));
        for which in 0..11 {
            let mut d = decision();
            match which {
                0 => d.native_low_confidence_rejection = true,
                1 => d.native_terminal_failure = true,
                2 => d.retried = true,
                3 => d.retry_failed = true,
                4 => d.retry_reason = Some("test"),
                5 => d.retry_ranges.push((0, 1)),
                6 => d.retry_audio_contexts.push(512),
                7 => d.retry_segment_bounds_ms.push((0, 1)),
                8 => d.retry_native_rejections = 1,
                9 => d.retry_terminal_failures = 1,
                _ => d.retry_completed_windows = 1,
            };
            assert!(!healthy_route(32000, "Go", &d));
        }
        for n in [0, 31999, CANONICAL_CHUNK_MAX_SAMPLES + 1] {
            assert!(!healthy_route(n, "Go", &decision()));
        }
        assert!(!healthy_route(32000, "", &decision()));
        for text in [" \t\n", "...!?", "♪"] {
            assert!(!healthy_route(32000, text, &decision()));
        }
        assert!(healthy_route(32000, " Café! ", &decision()));
    }
    #[test]
    fn selected_evidence_keeps_entropy_annotation_and_all_other_guards() {
        assert!(admitted(&evidence()));
        for bit in [1, 2, 4, 8, 16] {
            assert!(!admitted(&SelectedWindowEvidence {
                structural: bit,
                ..evidence()
            }));
        }
        for e in [
            SelectedWindowEvidence {
                seek: 1,
                ..evidence()
            },
            SelectedWindowEvidence {
                actual_eot: false,
                ..evidence()
            },
            SelectedWindowEvidence {
                completed: false,
                ..evidence()
            },
            SelectedWindowEvidence {
                text_tokens: 0,
                ..evidence()
            },
            SelectedWindowEvidence {
                avg_logprob: f64::NAN,
                ..evidence()
            },
            SelectedWindowEvidence {
                avg_logprob: -1.001,
                ..evidence()
            },
            SelectedWindowEvidence {
                original_no_speech: true,
                ..evidence()
            },
            SelectedWindowEvidence {
                lexical_no_speech: true,
                ..evidence()
            },
            SelectedWindowEvidence {
                entropy_rejected: false,
                ..evidence()
            },
        ] {
            assert!(!admitted(&e));
        }
    }
    #[test]
    fn identical_unicode_words_skip_view_preserving_baseline_bytes() {
        let (text, d) = run_using(
            &audio(),
            "CAFÉ! Shakespeare's",
            |_| Ok(candidate("café Shakespeare S")),
            |_, _, _| panic!("view must be skipped"),
        );
        assert_eq!(text, "CAFÉ! Shakespeare's");
        assert!(d.identical_words);
        assert_eq!(d.view_piece_attempts, 0);
    }
    #[test]
    fn true_shorter_and_longer_require_exact_nonempty_sequence() {
        for (base, alt) in [("Go Go Go", "Go Go"), ("Go", "Go Go")] {
            let (text, d) = run_using(
                &audio(),
                base,
                |_| Ok(candidate(alt)),
                |_, _, _| Ok(attempt("GO! Go?")),
            );
            assert!(d.selected);
            assert_eq!(text, alt);
            assert!(!d.raw_cleaned_agreement);
        }
        let (text, d) = run_using(
            &audio(),
            "Go",
            |_| Ok(candidate("Go Go")),
            |_, _, _| Ok(attempt("Go")),
        );
        assert_eq!(text, "Go");
        assert!(!d.selected);
        let (_, d) = run_using(
            &audio(),
            "Go",
            |_| Ok(candidate("[BLANK_AUDIO]")),
            |_, _, _| panic!("empty must skip"),
        );
        assert!(d.empty_candidate);
    }
    #[test]
    fn candidate_errors_and_unavailable_evidence_preserve_baseline() {
        for mode in 0..3 {
            let (text, d) = run_using(
                &audio(),
                "base",
                |_| match mode {
                    0 => Err("secret error".into()),
                    1 => Ok(Candidate {
                        text: "alt".into(),
                        evidence: vec![],
                    }),
                    _ => Ok(Candidate {
                        text: "alt".into(),
                        evidence: vec![evidence(), evidence()],
                    }),
                },
                |_, _, _| panic!("unavailable must skip"),
            );
            assert_eq!(text, "base");
            assert!(d.candidate_error);
        }
    }
    #[test]
    fn failed_piece_never_validates_matching_text_and_diagnostics_retain_no_text() {
        const SECRET: &str = "private transcript never retained";
        for mode in 0..4 {
            let (text, d) = run_using(
                &audio(),
                "baseline",
                |_| Ok(candidate(SECRET)),
                |_, _, _| {
                    let mut a = attempt(SECRET);
                    match mode {
                        1 => a.native_terminal_failure = true,
                        2 => a.native_low_confidence_rejection = true,
                        3 => return Err(SECRET.into()),
                        _ => (),
                    };
                    Ok(a)
                },
            );
            assert_eq!(d.selected, mode == 0);
            assert_eq!(text, if mode == 0 { SECRET } else { "baseline" });
            drop(text);
            assert!(!format!("{d:?}").contains(SECRET));
            assert!(!serde_json::to_string(&d).unwrap().contains(SECRET));
        }
    }
    #[test]
    fn late_failure_preserves_literal_repeats_and_attempts_each_range_once() {
        let mut pcm = audio();
        pcm.extend(vec![0.0; 128000]);
        pcm.extend(audio());
        let ranges = coalesce_retry_ranges(utterance_ranges(&pcm));
        assert!(ranges.len() > 1);
        let alt = "Go ".repeat(ranges.len());
        let mut calls = 0;
        let (text, d) = run_using(
            &pcm,
            "base",
            |_| Ok(candidate(&alt)),
            |_, _, _| {
                calls += 1;
                let mut a = attempt("Go");
                if calls == ranges.len() {
                    a.native_terminal_failure = true;
                }
                Ok(a)
            },
        );
        assert_eq!(calls, ranges.len());
        assert_eq!(d.pieces.len(), ranges.len());
        assert_eq!(text, "base");
        assert!(!d.view_available);
        assert!(d.normalized_agreement);
    }
    #[test]
    fn optional_real_error_and_silence_preserve_original_aggregate() {
        let state = WhisperState::new();
        let count = std::cell::Cell::new(0);
        for original in [false, true] {
            state.last_decoder_rejection.set(original);
            assert!(state
                .decode_validation_once(&audio(), DecodeContext::DecoderFailureRetry, &count)
                .is_err());
            assert_eq!(state.had_decoder_rejection(), original);
            assert!(state
                .decode_validation_once(
                    &vec![0.0; 32000],
                    DecodeContext::DecoderFailureRetry,
                    &count
                )
                .is_ok());
            assert_eq!(state.had_decoder_rejection(), original);
            assert_eq!(count.get(), 0);
            assert!(state.decode_decisions().is_empty());
        }
    }
    #[test]
    fn actual_rejection_scope_restores_mutation_after_late_failure() {
        let state = WhisperState::new();
        let mut pcm = audio();
        pcm.extend(vec![0.0; 128000]);
        pcm.extend(audio());
        let count = coalesce_retry_ranges(utterance_ranges(&pcm)).len();
        assert!(count > 1);
        for original in [false, true] {
            state.last_decoder_rejection.set(original);
            let mut calls = 0;
            let (text, d) = run_using(
                &pcm,
                "base",
                |_| Ok(candidate(&"private segment ".repeat(count))),
                |_, _, _| {
                    calls += 1;
                    let result = state.preserve_rejection_using(|| {
                        state.last_decoder_rejection.set(!original);
                        if calls == count {
                            Err("private native error".into())
                        } else {
                            Ok(attempt("private segment"))
                        }
                    });
                    assert_eq!(state.had_decoder_rejection(), original);
                    result
                },
            );
            assert_eq!(calls, count);
            assert_eq!(text, "base");
            assert!(!d.selected && d.view_error);
            assert_eq!(state.had_decoder_rejection(), original);
            assert!(state.decode_decisions().is_empty());
            assert!(!serde_json::to_string(&d).unwrap().contains("private"));
        }
    }

    #[test]
    fn no_model_preview_silence_does_not_enter_corroboration() {
        let state = WhisperState::new();
        let result = state
            .transcribe_single_with_segments(&vec![0.0; 32000])
            .unwrap();
        assert!(result.text.is_empty());
        assert!(result.segments.is_empty());
        assert!(state
            .decode_decisions()
            .iter()
            .all(|d| d.corroboration.is_none()));
    }

    #[test]
    fn spacing_veto_preserves_baseline_bytes_and_skips_view() {
        for (baseline, alternate) in [
            ("Farm work.", "farmwork."),
            ("Farmwork.", "farm work."),
            ("An ice.", "A nice."),
            ("A nice.", "An ice."),
            ("CAFÉ\u{a0}SHOP!", "caféshop!"),
        ] {
            let (text, d) = run_using(
                &audio(),
                baseline,
                |_| Ok(candidate(alternate)),
                |_, _, _| panic!("spacing-only candidate must not start the view"),
            );
            assert_eq!(text.as_bytes(), baseline.as_bytes());
            assert!(d.candidate_eligible);
            assert!(!d.identical_words);
            assert!(d.boundary_only_difference);
            assert_eq!(d.view_piece_attempts, 0);
            assert_eq!(d.view_native_calls, 0);
            assert!(!d.view_available);
            assert!(!d.selected);
        }
    }

    #[test]
    fn punctuation_and_spelling_changes_still_require_actual_view_agreement() {
        for (baseline, alternate) in [
            ("re-sign", "resign"),
            ("resign", "re-sign"),
            ("Farm work!", "farmwork."),
            ("caf\u{e9} shop", "cafe\u{301}shop"),
        ] {
            let mut view_calls = 0;
            let (text, d) = run_using(
                &audio(),
                baseline,
                |_| Ok(candidate(alternate)),
                |_, _, _| {
                    view_calls += 1;
                    Ok(attempt(alternate))
                },
            );
            assert_eq!(view_calls, 1);
            assert_eq!(text, alternate);
            assert!(!d.boundary_only_difference);
            assert!(d.view_available);
            assert!(d.normalized_agreement);
            assert!(d.selected);
        }
    }

    #[test]
    fn repeated_word_count_changes_remain_eligible_for_corroboration() {
        for (baseline, alternate) in [("Go Go Go", "Go Go"), ("Go", "Go Go")] {
            let mut view_calls = 0;
            let (text, d) = run_using(
                &audio(),
                baseline,
                |_| Ok(candidate(alternate)),
                |_, _, _| {
                    view_calls += 1;
                    Ok(attempt(alternate))
                },
            );
            assert_eq!(view_calls, 1);
            assert_eq!(text, alternate);
            assert!(!d.boundary_only_difference);
            assert!(d.selected);
        }
    }

    #[test]
    fn spacing_predicate_keeps_punctuation_scalars_and_word_count_changes() {
        assert!(same_non_whitespace_text("CAFÉ\u{a0}SHOP!", "caféshop!"));
        assert!(same_non_whitespace_text("an ice", "a nice"));
        assert!(!same_non_whitespace_text("re-sign", "resign"));
        assert!(!same_non_whitespace_text("Go Go", "Go"));
        assert!(!same_non_whitespace_text("caf\u{e9}", "cafe\u{301}"));
        assert!(!same_non_whitespace_text("Straße", "STRASSE"));
    }
    // Frozen pre-optimization loop: differential reference, never called in production.
    fn exhaustive_before_optimization<G, F>(
        samples: &[f32],
        baseline: &str,
        generate: G,
        decode: &mut F,
        d: &mut Diagnostics,
    ) -> String
    where
        G: FnOnce(&mut Diagnostics) -> Result<Candidate, String>,
        F: FnMut(&[f32], DecodeContext, &mut usize) -> Result<DecodeAttempt, String>,
    {
        let started = Instant::now();
        let candidate = generate(d);
        d.candidate_us = elapsed(started);
        let candidate = match candidate {
            Ok(c) => c,
            Err(_) => {
                d.candidate_error = true;
                return baseline.to_owned();
            }
        };
        d.evidence_rows = candidate.evidence.len();
        let [e] = candidate.evidence.as_slice() else {
            d.candidate_error = true;
            return baseline.to_owned();
        };
        d.structural = e.structural;
        d.actual_eot = e.actual_eot;
        d.completed = e.completed;
        d.entropy_rejected = e.entropy_rejected;
        d.native_failed = e.native_failed;
        d.original_no_speech = e.original_no_speech;
        d.lexical_no_speech = e.lexical_no_speech;
        d.candidate_avg_logprob = e.avg_logprob.is_finite().then_some(e.avg_logprob);
        d.candidate_text_tokens = e.text_tokens;
        d.candidate_seek = Some(e.seek);
        d.candidate_eligible = admitted(e);
        if !d.candidate_eligible {
            return baseline.to_owned();
        }
        let alternate = clean_transcript_text(&candidate.text);
        let alternative_words = normalized_words(&alternate);
        d.empty_candidate = alternative_words.is_empty();
        d.identical_words = alternative_words == normalized_words(baseline);
        if d.empty_candidate || d.identical_words {
            return baseline.to_owned();
        }
        d.boundary_only_difference = same_non_whitespace_text(baseline, &alternate);
        if d.boundary_only_difference {
            return baseline.to_owned();
        }
        let ranges = coalesce_retry_ranges(utterance_ranges(samples));
        if ranges.is_empty() || ranges.len() > CANONICAL_CHUNK_MAX_SAMPLES / 24000 {
            d.view_error = true;
            return baseline.to_owned();
        }
        let started = Instant::now();
        let mut joined = String::new();
        let mut healthy = true;
        for range in ranges {
            let signal = match has_signal(&samples[range.clone()]) {
                Ok(s) => s,
                Err(_) => {
                    d.view_error = true;
                    healthy = false;
                    break;
                }
            };
            d.view_piece_attempts += 1;
            d.silent_pieces += usize::from(!signal);
            let mut piece = PieceEvidence {
                start_sample: range.start,
                end_sample: range.end,
                audio_context: retry_audio_context(range.len(), DecodeContext::DecoderFailureRetry),
                signal,
                error: false,
                terminal_failure: false,
                low_confidence_rejection: false,
            };
            match decode(
                &samples[range],
                DecodeContext::DecoderFailureRetry,
                &mut d.view_native_calls,
            ) {
                Ok(attempt) => {
                    piece.terminal_failure = attempt.native_terminal_failure;
                    piece.low_confidence_rejection = attempt.native_low_confidence_rejection;
                    healthy &= !piece.terminal_failure && !piece.low_confidence_rejection;
                    append_disjoint_text(&mut joined, &attempt.output.text);
                }
                Err(_) => {
                    piece.error = true;
                    d.view_error = true;
                    healthy = false;
                }
            }
            d.pieces.push(piece);
        }
        d.view_us = elapsed(started);
        let words = normalized_words(&joined);
        d.view_available = healthy && !words.is_empty();
        d.normalized_agreement = !words.is_empty() && words == alternative_words;
        d.raw_cleaned_agreement = clean_transcript_text(&joined) == alternate;
        d.selected = d.view_available && d.normalized_agreement;
        if d.selected {
            alternate
        } else {
            baseline.to_owned()
        }
    }
    #[test]
    fn monotone_short_circuit_matches_exhaustive_selection_and_normal_diagnostics() {
        let mut pcm = audio();
        pcm.extend(vec![0.0; 128000]);
        pcm.extend(audio());
        let ranges = coalesce_retry_ranges(utterance_ranges(&pcm));
        assert_eq!(ranges.len(), 3);
        let cases = [
            ("alpha beta", ["wrong", "", "beta"]),
            ("alpha beta", ["alpha beta extra", "", ""]),
            ("alpha beta", ["alpha", "", "beta"]),
            ("alpha", ["alpha", "", "extra"]),
            ("alpha beta", ["", "", "alpha beta"]),
            ("alpha beta", ["...", "", "alpha beta"]),
            ("CAFÉ İ", ["café", "", "İ"]),
            ("a nice", ["an", "", "ice"]),
            ("go go", ["go", "", "go"]),
            ("go go", ["go go go", "", "go"]),
            ("alpha beta", ["alpha;", "", "beta"]),
            ("alpha beta", ["alpha", "", "wrong"]),
        ];
        for (alternate, pieces) in cases {
            for failed_piece in 0..=3 {
                for failure in 0..=3 {
                    let make_attempt = |index: usize| -> Result<DecodeAttempt, String> {
                        let mut value = attempt(pieces[index]);
                        if failed_piece == index + 1 {
                            match failure {
                                1 => value.native_terminal_failure = true,
                                2 => value.native_low_confidence_rejection = true,
                                3 => return Err("unretained decoder error".into()),
                                _ => (),
                            }
                        }
                        Ok(value)
                    };
                    let mut calls = 0;
                    let (text, d) = run_using(
                        &pcm,
                        "BASELINE.",
                        |_| Ok(candidate(alternate)),
                        |_, _, native_calls| {
                            let index = calls;
                            calls += 1;
                            *native_calls += 1;
                            make_attempt(index)
                        },
                    );
                    let mut oracle_calls = 0;
                    let mut expected = Diagnostics::default();
                    let oracle_text = exhaustive_before_optimization(
                        &pcm,
                        "BASELINE.",
                        |_| Ok(candidate(alternate)),
                        &mut |_, _, native_calls| {
                            let index = oracle_calls;
                            oracle_calls += 1;
                            *native_calls += 1;
                            make_attempt(index)
                        },
                        &mut expected,
                    );
                    assert_eq!(text, oracle_text, "{alternate:?} {pieces:?}");
                    assert_eq!(d.selected, expected.selected);
                    assert_eq!(oracle_calls, ranges.len());
                    if let Some(stopped) = &d.view_stopped_early {
                        assert!(calls > 0 && calls < ranges.len());
                        assert_eq!(d.pieces.len(), calls);
                        assert_eq!(d.view_native_calls, calls);
                        assert_eq!(stopped.unattempted_pieces, ranges.len() - calls);
                        assert_eq!(
                            stopped.unattempted_ranges,
                            ranges[calls..]
                                .iter()
                                .map(|range| [range.start, range.end])
                                .collect::<Vec<_>>()
                        );
                        assert!(
                            !d.view_available
                                && !d.normalized_agreement
                                && !d.raw_cleaned_agreement
                                && !d.selected
                        );
                        assert_eq!(
                            stopped.reason,
                            if failed_piece == calls && failure != 0 {
                                ViewStopReason::UnhealthyPiece
                            } else {
                                ViewStopReason::NormalizedPrefixMismatch
                            }
                        );
                    } else {
                        assert_eq!(calls, ranges.len());
                        let mut actual_json = serde_json::to_value(&d).unwrap();
                        let mut expected_json = serde_json::to_value(&expected).unwrap();
                        for key in ["additionalUs", "candidateUs", "viewUs"] {
                            actual_json.as_object_mut().unwrap().remove(key);
                            expected_json.as_object_mut().unwrap().remove(key);
                        }
                        assert_eq!(actual_json, expected_json);
                        assert!(actual_json.get("viewStoppedEarly").is_none());
                    }
                }
            }
        }
    }

    #[test]
    fn rejected_prefix_never_calls_unattempted_decoder_and_keeps_candidate() {
        let mut pcm = audio();
        pcm.extend(vec![0.0; 128000]);
        pcm.extend(audio());
        let mut candidate_calls = 0;
        let mut view_calls = 0;
        let (text, d) = run_using(
            &pcm,
            "BASELINE.",
            |_| {
                candidate_calls += 1;
                Ok(candidate("wanted suffix"))
            },
            |_, _, _| {
                view_calls += 1;
                assert_eq!(view_calls, 1, "unattempted decoder must never run");
                Ok(attempt("different"))
            },
        );
        assert_eq!(candidate_calls, 1);
        assert_eq!(text, "BASELINE.");
        assert!(!d.selected && d.view_stopped_early.is_some());
        let serialized = serde_json::to_string(&d).unwrap();
        assert!(!serialized.contains("wanted") && !serialized.contains("different"));
    }
}
