//! Numeric-only whitelist for the pinned whisper.cpp debug messages.
use serde::Serialize;

const LIMIT: usize = 4096;
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Number {
    Finite(f64),
    Special(&'static str),
}
impl Number {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "-inf" => Some(Self::Special("negativeInfinity")),
            "inf" => Some(Self::Special("positiveInfinity")),
            _ => s
                .parse::<f64>()
                .ok()
                .filter(|n| n.is_finite())
                .map(Self::Finite),
        }
    }
    fn finite(&self) -> Option<f64> {
        match self {
            Self::Finite(n) => Some(*n),
            _ => None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Event {
    pub kind: &'static str,
    pub values: Vec<Number>,
}

// '#' placeholders contain exactly one numeric token; all other tokens are literal.
const FORMATS: &[(&str, &str)] = &[
("attempt", "whisper_full_with_state: strategy = #, decoding with # decoders, temperature = #"),
("score", "whisper_full_with_state: decoder #: score = #, result_len = #, avg_logprobs = #, entropy = #"),
("entropy", "whisper_full_with_state: decoder #: failed due to entropy # < #"),
("loop", "whisper_full_with_state: decoder #: failed due to repetition loop"),
("backward", "whisper_full_with_state: decoder #: failed due to seek_delta (# > #)"),
("empty", "whisper_full_with_state: decoder # failed (result_len = 0)"),
("completed", "whisper_full_with_state: decoder # completed"),
("best", "whisper_full_with_state: best decoder = #"),
("fallbackReason", "whisper_full_with_state: failed due to avg_logprobs # < # and no_speech_prob # < #"),
("fallback", "whisper_full_with_state: failed to decode with temperature = #"),
("singleTimestamp", "single timestamp ending - skip entire chunk"),
("seek", "seek = #, seek_delta = #"),
];

fn matches_format(text: &str, format: &str) -> Option<Vec<Number>> {
    let mut words = text.split_whitespace();
    let mut values = Vec::new();
    for expected in format.split_whitespace() {
        let actual = words.next()?;
        if let Some((prefix, suffix)) = expected.split_once('#') {
            values.push(Number::parse(
                actual.strip_prefix(prefix)?.strip_suffix(suffix)?,
            )?);
        } else if actual != expected {
            return None;
        }
    }
    words.next().is_none().then_some(values)
}
fn relevant(text: &str) -> bool {
    text.starts_with("whisper_full_with_state: strategy =")
        || text.starts_with("whisper_full_with_state: decoder ")
        || text.starts_with("whisper_full_with_state: best decoder =")
        || text.starts_with("whisper_full_with_state: failed due to")
        || text.starts_with("whisper_full_with_state: failed to decode with temperature =")
        || text.starts_with("single timestamp ending")
        || text.starts_with("seek =")
}
#[derive(Default, Serialize)]
pub struct Collector {
    pub events: Vec<Event>,
    pub invalid: bool,
    pub overflow: bool,
}
impl Collector {
    pub fn accept(&mut self, bytes: &[u8]) {
        // A complete native log invocation, not lines split out of potentially embedded token text.
        let Ok(text) = std::str::from_utf8(bytes) else {
            return;
        };
        let text = text.trim();
        if !relevant(text) {
            return;
        }
        if text.len() > 2048 {
            self.invalid = true;
            return;
        }
        let parsed = FORMATS.iter().find_map(|(kind, pattern)| {
            matches_format(text, pattern).map(|values| Event { kind, values })
        });
        let parsed = parsed.filter(|event| {
            let integer_indices: &[usize] = match event.kind {
                "attempt" => &[0, 1],
                "score" => &[0, 2],
                "entropy" | "loop" | "empty" | "completed" | "best" => &[0],
                "backward" => &[0, 1, 2],
                "seek" => &[0, 1],
                _ => &[],
            };
            integer_indices.iter().all(|i| {
                event.values[*i]
                    .finite()
                    .is_some_and(|n| n >= 0.0 && n <= i32::MAX as f64 && n.fract() == 0.0)
            })
        });
        match parsed {
            Some(event) if self.events.len() < LIMIT => self.events.push(event),
            Some(_) => self.overflow = true,
            None => self.invalid = true,
        }
    }
    pub fn groups(&self, expected_seeks: &[i64]) -> Result<Vec<SeekGroup>, &'static str> {
        if self.invalid || self.overflow {
            return Err("collectorInvalidOrOverflow");
        }
        if self.events.is_empty() {
            return Err("noDebugEvents");
        }
        let mut groups = Vec::new();
        let mut attempts = Vec::new();
        let mut best = false;
        let mut continuation = false;
        let mut entropy = false;
        let mut loop_rejection = false;
        for e in &self.events {
            match e.kind {
                "attempt" => {
                    if e.values[0].finite() != Some(0.0) || e.values[1].finite() != Some(1.0) {
                        return Err("unexpectedStrategy");
                    }
                    let temperature = e.values[2].finite().ok_or("nonfiniteTemperature")?;
                    const LADDER: [f64; 6] = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
                    if LADDER.get(attempts.len()) != Some(&temperature) {
                        return Err("temperatureLadderGap");
                    }
                    if !attempts.is_empty() && (!best || !continuation) {
                        return Err("missingFallbackTransition");
                    }
                    continuation = false;
                    attempts.push(temperature);
                    best = false;
                }
                "best" => {
                    if attempts.is_empty()
                        || best
                        || continuation
                        || e.values[0].finite() != Some(0.0)
                    {
                        return Err("unexpectedBest");
                    }
                    best = true;
                }
                "fallback" => {
                    if !best
                        || continuation
                        || attempts.last().copied() != e.values[0].finite()
                        || attempts.len() >= 6
                    {
                        return Err("invalidFallbackTransition");
                    }
                    continuation = true;
                }
                "entropy" => {
                    if attempts.is_empty() || best || continuation {
                        return Err("orphanRejection");
                    }
                    entropy = true;
                }
                "loop" => {
                    if attempts.is_empty() || best || continuation {
                        return Err("orphanRejection");
                    }
                    loop_rejection = true;
                }
                "seek" => {
                    let end = e.values[0].finite().ok_or("nonfiniteSeek")?;
                    let delta = e.values[1].finite().ok_or("nonfiniteSeek")?;
                    if !best
                        || continuation
                        || delta <= 0.0
                        || end < delta
                        || end.fract() != 0.0
                        || delta.fract() != 0.0
                        || end > i32::MAX as f64
                    {
                        return Err("invalidSeek");
                    }
                    let start = (end - delta) as i64;
                    if expected_seeks.get(groups.len()) != Some(&start) {
                        return Err("selectedEvidenceSeekMismatch");
                    }
                    let selected_temperature = *attempts.last().ok_or("missingAttempt")?;
                    groups.push(SeekGroup {
                        start,
                        end: end as i64,
                        temperatures: std::mem::take(&mut attempts),
                        selected_temperature,
                        any_entropy_rejection: entropy,
                        any_loop_rejection: loop_rejection,
                    });
                    entropy = false;
                    loop_rejection = false;
                    best = false;
                }
                _ => {
                    if attempts.is_empty() || continuation {
                        return Err("orphanEvent");
                    }
                }
            }
        }
        if !attempts.is_empty() || groups.len() != expected_seeks.len() {
            return Err("incompleteSeekHistory");
        }
        Ok(groups)
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeekGroup {
    pub start: i64,
    pub end: i64,
    pub temperatures: Vec<f64>,
    pub selected_temperature: f64,
    pub any_entropy_rejection: bool,
    pub any_loop_rejection: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn accept(c: &mut Collector, s: &str) {
        c.accept(s.as_bytes());
    }
    fn begin(c: &mut Collector, t: &str) {
        accept(c,&format!("\nwhisper_full_with_state: strategy = 0, decoding with 1 decoders, temperature = {t}\n"));
    }
    fn end(c: &mut Collector, end: i64, delta: i64) {
        accept(c, "whisper_full_with_state: best decoder = 0\n");
        accept(c, &format!("seek = {end}, seek_delta = {delta}\n"));
    }
    #[test]
    fn padded_entropy_and_multiseek_history() {
        let mut c = Collector::default();
        begin(&mut c, "0.00");
        accept(&mut c,"whisper_full_with_state: decoder  0: score = -0.20000, result_len =  44, avg_logprobs = -0.20000, entropy =  1.80000\n");
        accept(
            &mut c,
            "whisper_full_with_state: decoder  0: failed due to entropy  1.80000 <  2.40000\n",
        );
        accept(&mut c, "whisper_full_with_state: best decoder = 0");
        accept(
            &mut c,
            "\nwhisper_full_with_state: failed to decode with temperature = 0.00\n",
        );
        begin(&mut c, "0.20");
        end(&mut c, 1000, 1000);
        begin(&mut c, "0.00");
        end(&mut c, 1200, 200);
        let g = c.groups(&[0, 1000]).unwrap();
        assert_eq!(g.len(), 2);
        assert_eq!(g[0].selected_temperature, 0.2);
        assert!(g[0].any_entropy_rejection);
        assert!(!g[1].any_entropy_rejection);
    }
    #[test]
    fn failed_last_attempt_and_infinite_unscored_value_are_explicit() {
        let mut c = Collector::default();
        for t in ["0.00", "0.20", "0.40", "0.60", "0.80"] {
            begin(&mut c, t);
            accept(
                &mut c,
                "whisper_full_with_state: decoder 0: failed due to repetition loop",
            );
            accept(&mut c, "whisper_full_with_state: best decoder = 0");
            accept(&mut c, "whisper_full_with_state: failed due to avg_logprobs -inf < -1.00000 and no_speech_prob 0.50000 < 0.60000");
            accept(
                &mut c,
                &format!("whisper_full_with_state: failed to decode with temperature = {t}"),
            );
        }
        begin(&mut c, "1.00");
        accept(
            &mut c,
            "whisper_full_with_state: decoder 0: failed due to repetition loop",
        );
        end(&mut c, 3000, 3000);
        assert!(c.groups(&[0]).unwrap()[0].any_loop_rejection);
        assert!(serde_json::to_string(&c)
            .unwrap()
            .contains("negativeInfinity"));
    }
    #[test]
    fn missing_attempts_or_transition_markers_are_unavailable() {
        for initial in ["0.20", "1.00"] {
            let mut c = Collector::default();
            begin(&mut c, initial);
            end(&mut c, 3000, 3000);
            assert!(c.groups(&[0]).is_err());
        }
        for (next, include_best, include_fallback, fallback_t) in [
            ("0.40", true, true, "0.00"),
            ("0.20", false, true, "0.00"),
            ("0.20", true, false, "0.00"),
            ("0.20", true, true, "0.20"),
        ] {
            let mut c = Collector::default();
            begin(&mut c, "0.00");
            if include_best {
                accept(&mut c, "whisper_full_with_state: best decoder = 0");
            }
            if include_fallback {
                accept(
                    &mut c,
                    &format!(
                        "whisper_full_with_state: failed to decode with temperature = {fallback_t}"
                    ),
                );
            }
            begin(&mut c, next);
            end(&mut c, 3000, 3000);
            assert!(c.groups(&[0]).is_err());
        }
        let mut c = Collector::default();
        begin(&mut c, "0.00");
        accept(&mut c, "whisper_full_with_state: best decoder = 0");
        accept(
            &mut c,
            "whisper_full_with_state: failed to decode with temperature = 0.00",
        );
        accept(&mut c, "seek = 3000, seek_delta = 3000");
        assert!(c.groups(&[0]).is_err());
        let mut c = Collector::default();
        begin(&mut c, "0.00");
        accept(&mut c, "seek = 3000, seek_delta = 3000");
        assert!(c.groups(&[0]).is_err());
    }
    #[test]
    fn token_and_prompt_embedded_fake_events_are_not_retained() {
        let mut c = Collector::default();
        accept(
            &mut c,
            "whisper_full_with_state: prompt[0] = private\nseek = 10, seek_delta = 10",
        );
        accept(&mut c,"whisper_full_with_state: id = 1, decoder = 0, token = 1, p = 1, ts = private, 1, result_len = 1 'seek = 10, seek_delta = 10'");
        assert!(c.events.is_empty());
        assert!(!c.invalid);
        assert!(!serde_json::to_string(&c).unwrap().contains("private"));
    }
    #[test]
    fn malformed_nan_missing_end_and_wrong_seek_are_unavailable() {
        let mut c = Collector::default();
        begin(&mut c, "NaN");
        assert!(c.invalid);
        let mut c = Collector::default();
        begin(&mut c, "0.00");
        assert!(c.groups(&[0]).is_err());
        end(&mut c, 200, 100);
        assert!(c.groups(&[0]).is_err());
    }
    #[test]
    fn overflow_is_not_a_partial_success() {
        let mut c = Collector::default();
        for _ in 0..=LIMIT {
            accept(&mut c, "whisper_full_with_state: best decoder = 0");
        }
        assert_eq!(c.events.len(), LIMIT);
        assert!(c.overflow);
        assert!(c.groups(&[]).is_err());
    }
    #[test]
    fn normal_binary_absence_is_explicit() {
        assert_eq!(
            Collector::default().groups(&[]).unwrap_err(),
            "noDebugEvents"
        );
    }
}
