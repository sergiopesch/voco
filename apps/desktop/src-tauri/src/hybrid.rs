//! Shared full/incremental receipt execution. Planning never retains transcripts.
use super::numerical_planner::{plan_next, LeftJoin, PlannerState, Receipt, RightBoundary};
use super::vca2::{NumericReceipt, Response};
use super::{CanonicalTranscription, DecodeDecision};
use serde::Serialize;

const MAX_SAMPLES: usize = 9_600_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowResponse {
    #[serde(flatten)]
    pub receipt: NumericReceipt,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub decode_decisions: Vec<DecodeDecision>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullTranscription {
    pub samples: usize,
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub completed_through: usize,
    pub next_input_start: usize,
    pub pending_range: Option<(usize, usize)>,
    pub unattempted_ranges: Vec<(usize, usize)>,
    pub windows: Vec<WindowResponse>,
}
impl FullTranscription {
    pub fn into_result(self) -> Result<String, String> {
        match (self.text, self.error) {
            (Some(text), None) => Ok(text),
            (_, Some(error)) => Err(error),
            _ => Err("Hybrid transcription has no completed result".into()),
        }
    }
}

/// Request-local evidence is available to native callers, never added to VCA2's
/// wire response or retained in a transcript getter.
#[derive(Debug)]
pub struct IncrementalResult {
    pub response: Response,
    pub decode_decisions: Vec<DecodeDecision>,
}

pub(crate) struct WindowDecode {
    pub result: Result<CanonicalTranscription, String>,
    pub decisions: Vec<DecodeDecision>,
}

fn append_disjoint(output: &mut String, next: &str) {
    if next.is_empty() {
        return;
    }
    if !output.is_empty() {
        output.push(' ');
    }
    output.push_str(next);
}

/// Both production entry points call this exact decode/join boundary. The
/// callback receives only the selected core and its actual native prefix.
pub(crate) fn execute_receipt<F>(
    receipt: &Receipt,
    core: &[f32],
    accumulated: &str,
    mut decode: F,
) -> WindowDecode
where
    F: FnMut(&[f32], &str) -> WindowDecode,
{
    if core.len() != receipt.input_end() - receipt.input_start() {
        return WindowDecode {
            result: Err("Receipt/core sample count mismatch".into()),
            decisions: Vec::new(),
        };
    }
    let prefix = if receipt.left_join() == LeftJoin::LegacyOverlap {
        accumulated
    } else {
        ""
    };
    let attempt = decode(core, prefix);
    let result = attempt.result.and_then(|decoded| {
        if decoded.canonical_text.strip_prefix(prefix) != Some(decoded.append_text.as_str()) {
            return Err(
                "Native canonical result did not preserve its exact input prefix and append".into(),
            );
        }
        if receipt.left_join() != LeftJoin::LegacyOverlap
            && (decoded.canonical_text != decoded.chunk_text
                || decoded.append_text != decoded.chunk_text)
        {
            return Err(
                "Empty-prefix canonical result must preserve its complete chunk text".into(),
            );
        }
        let mut next = accumulated.to_string();
        if receipt.left_join() == LeftJoin::LegacyOverlap {
            next = decoded.canonical_text;
        } else {
            append_disjoint(&mut next, &decoded.canonical_text);
        }
        let append = next
            .strip_prefix(accumulated)
            .ok_or("Hybrid join revised its completed prefix")?
            .to_string();
        Ok(CanonicalTranscription {
            canonical_text: next,
            append_text: append,
            chunk_text: decoded.chunk_text,
        })
    });
    WindowDecode {
        result,
        decisions: attempt.decisions,
    }
}

pub(crate) fn full_using<F>(samples: &[f32], mut decode: F) -> FullTranscription
where
    F: FnMut(&[f32], &str) -> WindowDecode,
{
    let mut state = PlannerState::new();
    let mut accumulated = String::new();
    let mut windows = Vec::new();
    let mut attempted_end = 0;
    let mut error = None;
    if samples.is_empty() || samples.len() > MAX_SAMPLES || samples.iter().any(|v| !v.is_finite()) {
        error = Some("Input must contain 1..9600000 finite prepared samples".into());
    }
    while error.is_none() {
        let receipt = match plan_next(&state, &samples[state.next_input_start()..], true) {
            Ok(Some(receipt)) => receipt,
            Ok(None) => {
                if state.previous_decoded_end() != samples.len() {
                    error = Some("Planner did not cover the complete input".into());
                }
                break;
            }
            Err(e) => {
                error = Some(e.to_string());
                break;
            }
        };
        let attempt = execute_receipt(
            &receipt,
            &samples[receipt.input_start()..receipt.input_end()],
            &accumulated,
            &mut decode,
        );
        attempted_end = receipt.input_end();
        let outcome = attempt.result.and_then(|result| {
            state.commit(&receipt).map_err(|e| e.to_string())?;
            Ok(result.canonical_text)
        });
        let (status, window_error) = match outcome {
            Ok(next) => {
                accumulated = next;
                ("completed", None)
            }
            Err(e) => {
                error = Some(e.clone());
                ("failed", Some(e))
            }
        };
        windows.push(WindowResponse {
            receipt: NumericReceipt::from(&receipt),
            status,
            error: window_error,
            decode_decisions: attempt.decisions,
        });
        if receipt.right_boundary() == RightBoundary::Final {
            break;
        }
    }
    let failed = error.is_some();
    FullTranscription {
        samples: samples.len(),
        text: if failed {
            None
        } else {
            Some(accumulated.clone())
        },
        partial_text: if failed { Some(accumulated) } else { None },
        error,
        completed_through: state.previous_decoded_end(),
        next_input_start: state.next_input_start(),
        pending_range: if failed {
            Some((state.next_input_start(), samples.len()))
        } else {
            None
        },
        unattempted_ranges: if failed && attempted_end < samples.len() {
            vec![(attempted_end, samples.len())]
        } else {
            Vec::new()
        },
        windows,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn audio(n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| if i % 2 == 0 { 0.1 } else { -0.1 })
            .collect()
    }
    fn decoded(prefix: &str, chunk: &str) -> WindowDecode {
        let append = if prefix.is_empty() || chunk.is_empty() {
            chunk.to_string()
        } else {
            format!(" {chunk}")
        };
        WindowDecode {
            result: Ok(CanonicalTranscription {
                canonical_text: format!("{prefix}{append}"),
                append_text: append,
                chunk_text: chunk.into(),
            }),
            decisions: Vec::new(),
        }
    }
    #[test]
    fn exact_horizon_has_one_decode_and_new_sample_keeps_overlap() {
        for (n, lengths) in [(480000, vec![480000]), (480001, vec![480000, 16001])] {
            let mut seen = Vec::new();
            let result = full_using(&audio(n), |a, p| {
                seen.push(a.len());
                decoded(p, "Again.")
            });
            assert_eq!(seen, lengths);
            assert_eq!(result.completed_through, n);
            assert!(result.error.is_none());
        }
    }
    #[test]
    fn disjoint_then_legacy_latch_preserves_exact_prefixes() {
        let mut samples = audio(1400000);
        samples[400000..406400].fill(0.0);
        samples[1100160..1106560].fill(0.0);
        let mut prefixes = Vec::new();
        let result = full_using(&samples, |_, p| {
            prefixes.push(p.to_string());
            decoded(p, "Again.")
        });
        assert_eq!(
            prefixes,
            vec!["", "", "Again. Again.", "Again. Again. Again."]
        );
        assert_eq!(result.text.as_deref(), Some("Again. Again. Again. Again."));
    }
    #[test]
    fn second_failure_keeps_committed_prefix_and_remaining_ranges() {
        let mut calls = 0;
        let result = full_using(&audio(1000000), |_, p| {
            calls += 1;
            if calls == 2 {
                WindowDecode {
                    result: Err("fixture failure".into()),
                    decisions: Vec::new(),
                }
            } else {
                decoded(p, "Keep.")
            }
        });
        assert_eq!(calls, 2);
        assert_eq!(result.text, None);
        assert_eq!(result.partial_text.as_deref(), Some("Keep."));
        assert_eq!(result.completed_through, 480000);
        assert_eq!(result.next_input_start, 464000);
        assert_eq!(result.pending_range, Some((464000, 1000000)));
        assert_eq!(result.unattempted_ranges, vec![(944000, 1000000)]);
        assert_eq!(result.windows[1].status, "failed");
    }
    #[test]
    fn silent_cut_does_not_consume_lookahead_speech() {
        let mut samples = audio(480000);
        samples[..224000].fill(0.0);
        let mut lengths = Vec::new();
        let result = full_using(&samples, |a, p| {
            lengths.push(a.len());
            decoded(p, if lengths.len() == 1 { "" } else { "Speech." })
        });
        assert_eq!(lengths, vec![112000, 368000]);
        assert_eq!(result.text.as_deref(), Some("Speech."));
    }
    #[test]
    fn invalid_audio_never_reaches_decoder_and_bad_append_never_commits() {
        for input in [vec![], vec![f32::NAN]] {
            let r = full_using(&input, |_, _| panic!("invalid input decoded"));
            assert!(r.error.is_some());
        }
        let r = full_using(&audio(1), |_, _| WindowDecode {
            result: Ok(CanonicalTranscription {
                canonical_text: "invented".into(),
                append_text: "different".into(),
                chunk_text: "invented".into(),
            }),
            decisions: Vec::new(),
        });
        assert!(r.error.is_some());
        assert_eq!(r.completed_through, 0);
    }
    #[test]
    fn command_result_returns_only_complete_success_including_silence() {
        let success = full_using(&audio(1), |_, p| decoded(p, "Complete."));
        assert_eq!(success.into_result(), Ok("Complete.".to_string()));
        let silence = full_using(&audio(1), |_, p| decoded(p, ""));
        assert_eq!(silence.into_result(), Ok(String::new()));
    }

    #[test]
    fn command_result_rejects_partial_prefix_and_missing_completion() {
        let mut calls = 0;
        let partial = full_using(&audio(480001), |_, p| {
            calls += 1;
            if calls == 1 {
                decoded(p, "Keep.")
            } else {
                WindowDecode {
                    result: Err("local decode unavailable".into()),
                    decisions: Vec::new(),
                }
            }
        });
        assert_eq!(partial.partial_text.as_deref(), Some("Keep."));
        let error = partial.error.clone().expect("failed full result");
        assert_eq!(partial.into_result(), Err(error));
        let mut missing = full_using(&audio(1), |_, p| decoded(p, "Complete."));
        missing.text = None;
        assert_eq!(
            missing.into_result(),
            Err("Hybrid transcription has no completed result".into())
        );
        let mut contradictory = full_using(&audio(1), |_, p| decoded(p, "Complete."));
        contradictory.error = Some("failed despite text".into());
        assert_eq!(
            contradictory.into_result(),
            Err("failed despite text".into())
        );
    }
}
