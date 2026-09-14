//! Pure sample-range planning. Receipts contain no transcript or retained audio.
pub const SAMPLE_RATE: usize = 16_000;
pub const HORIZON: usize = 30 * SAMPLE_RATE;
pub const OVERLAP: usize = SAMPLE_RATE;
const FRAME: usize = 320;
const MIN_PLATEAU_FRAMES: usize = 10;
const MIN_SIDE: usize = 24_000;
const NUMERICAL_SPAN: f32 = 0.000_000_1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeftJoin {
    Initial,
    Disjoint,
    LegacyOverlap,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RightBoundary {
    NumericalPlateau,
    LegacyStride,
    Final,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannerError(pub &'static str);
impl std::fmt::Display for PlannerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for PlannerError {}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PlannerState {
    next_start: usize,
    previous_end: usize,
    sequence: u64,
    finalized: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Receipt {
    sequence: u64,
    input_start: usize,
    input_end: usize,
    previous_decoded_end: usize,
    left_join: LeftJoin,
    right_boundary: RightBoundary,
    plateau: Option<std::ops::Range<usize>>,
    next_input_start: usize,
    before: PlannerState,
}

impl Receipt {
    pub fn sequence(&self) -> u64 {
        self.sequence
    }
    pub fn input_start(&self) -> usize {
        self.input_start
    }
    pub fn input_end(&self) -> usize {
        self.input_end
    }
    pub fn previous_decoded_end(&self) -> usize {
        self.previous_decoded_end
    }
    pub fn left_join(&self) -> LeftJoin {
        self.left_join
    }
    pub fn right_boundary(&self) -> RightBoundary {
        self.right_boundary
    }
    pub fn plateau(&self) -> Option<&std::ops::Range<usize>> {
        self.plateau.as_ref()
    }
    pub fn next_input_start(&self) -> usize {
        self.next_input_start
    }
}

impl PlannerState {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn next_input_start(&self) -> usize {
        self.next_start
    }
    pub fn previous_decoded_end(&self) -> usize {
        self.previous_end
    }
    /// Commit after successful decode; caller separately fences its session/generation/delivery.
    pub fn commit(&mut self, receipt: &Receipt) -> Result<(), PlannerError> {
        if *self != receipt.before {
            return Err(PlannerError("stale planning receipt"));
        }
        let length = receipt
            .input_end
            .checked_sub(self.next_start)
            .ok_or(PlannerError("invalid receipt range"))?;
        let next = match receipt.right_boundary {
            RightBoundary::LegacyStride => receipt.input_end.checked_sub(OVERLAP),
            _ => Some(receipt.input_end),
        }
        .ok_or(PlannerError("invalid next cursor"))?;
        if receipt.sequence != self.sequence
            || receipt.input_start != self.next_start
            || receipt.previous_decoded_end != self.previous_end
            || receipt.left_join != self.left_join()?
            || receipt.next_input_start != next
            || length == 0
            || length > HORIZON
            || receipt.input_end <= self.previous_end
            || (receipt.right_boundary == RightBoundary::LegacyStride && length != HORIZON)
            || (receipt.right_boundary == RightBoundary::Final && length >= HORIZON)
            || (receipt.right_boundary == RightBoundary::NumericalPlateau)
                != receipt.plateau.is_some()
        {
            return Err(PlannerError("inconsistent planning receipt"));
        }
        let sequence = self
            .sequence
            .checked_add(1)
            .ok_or(PlannerError("sequence overflow"))?;
        self.next_start = next;
        self.previous_end = receipt.input_end;
        self.sequence = sequence;
        self.finalized = receipt.right_boundary == RightBoundary::Final;
        Ok(())
    }
    fn left_join(&self) -> Result<LeftJoin, PlannerError> {
        if self.sequence == 0 && self.next_start == 0 && self.previous_end == 0 {
            return Ok(LeftJoin::Initial);
        }
        match self.previous_end.checked_sub(self.next_start) {
            Some(0) => Ok(LeftJoin::Disjoint),
            Some(OVERLAP) => Ok(LeftJoin::LegacyOverlap),
            _ => Err(PlannerError("invalid incoming seam")),
        }
    }
}

fn has_signal(samples: &[f32]) -> Result<bool, PlannerError> {
    if samples.is_empty() {
        return Err(PlannerError("empty signal range"));
    }
    let mut minimum = f32::INFINITY;
    let mut maximum = f32::NEG_INFINITY;
    for &value in samples {
        if !value.is_finite() {
            return Err(PlannerError("nonfinite audio"));
        }
        minimum = minimum.min(value);
        maximum = maximum.max(value);
    }
    Ok(maximum - minimum > NUMERICAL_SPAN)
}

/// `available` starts exactly at state.next_input_start(), not at recording0.
/// Only the bounded current horizon is inspected. Call again after commit or more capture.
pub fn plan_next(
    state: &PlannerState,
    available: &[f32],
    final_input: bool,
) -> Result<Option<Receipt>, PlannerError> {
    if state.finalized {
        return Err(PlannerError("planner already finalized"));
    }
    let left_join = state.left_join()?;
    let length = available.len().min(HORIZON);
    // Validate even an overlap-only final suffix; bad PCM must not masquerade as success.
    if available[..length].iter().any(|v| !v.is_finite()) {
        return Err(PlannerError("nonfinite audio"));
    }
    let end = state
        .next_start
        .checked_add(length)
        .ok_or(PlannerError("sample index overflow"))?;
    if end <= state.previous_end || (length < HORIZON && !final_input) {
        return Ok(None);
    }
    let mut chosen = None;
    // Once committed fallback establishes overlap, retain that cadence.
    // No separate latch is needed: every later nonfinal stride preserves it.
    if length == HORIZON && left_join != LeftJoin::LegacyOverlap {
        let mut low = None;
        for (index, frame) in available[..HORIZON].chunks_exact(FRAME).enumerate() {
            if !has_signal(frame)? {
                if low.is_none() {
                    low = Some(index);
                }
            } else if let Some(start_frame) = low.take() {
                let start = start_frame * FRAME;
                let stop = index * FRAME;
                if index - start_frame >= MIN_PLATEAU_FRAMES
                    && !has_signal(&available[start..stop])?
                {
                    let cut = start + (stop - start) / 2;
                    if cut >= MIN_SIDE && HORIZON - cut >= MIN_SIDE {
                        chosen = Some((cut, start..stop));
                    }
                }
            }
        }
    }
    let (input_end, next_input_start, right_boundary, plateau) = if let Some((cut, run)) = chosen {
        let cut = state
            .next_start
            .checked_add(cut)
            .ok_or(PlannerError("sample index overflow"))?;
        let run_start = state
            .next_start
            .checked_add(run.start)
            .ok_or(PlannerError("sample index overflow"))?;
        let run_end = state
            .next_start
            .checked_add(run.end)
            .ok_or(PlannerError("sample index overflow"))?;
        (
            cut,
            cut,
            RightBoundary::NumericalPlateau,
            Some(run_start..run_end),
        )
    } else if length == HORIZON {
        (end, end - OVERLAP, RightBoundary::LegacyStride, None)
    } else {
        (end, end, RightBoundary::Final, None)
    };
    Ok(Some(Receipt {
        sequence: state.sequence,
        input_start: state.next_start,
        input_end,
        previous_decoded_end: state.previous_end,
        left_join,
        right_boundary,
        plateau,
        next_input_start,
        before: state.clone(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn varying(n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| if i % 2 == 0 { -0.01 } else { 0.01 })
            .collect()
    }
    fn full(audio: &[f32]) -> Vec<Receipt> {
        let mut state = PlannerState::new();
        let mut out = Vec::new();
        loop {
            let Some(r) = plan_next(&state, &audio[state.next_input_start()..], true).unwrap()
            else {
                break;
            };
            state.commit(&r).unwrap();
            let final_piece = r.right_boundary == RightBoundary::Final;
            out.push(r);
            if final_piece {
                break;
            }
        }
        out
    }
    #[test]
    fn legacy_no_cut_is_exact_for_short_exact_and_long_lengths() {
        for n in [
            1,
            HORIZON - 1,
            HORIZON,
            HORIZON + 1,
            2 * HORIZON,
            3 * HORIZON + 37,
        ] {
            let rs = full(&varying(n));
            let mut start = 0;
            for (index, r) in rs.iter().enumerate() {
                assert_eq!(
                    (r.input_start, r.input_end),
                    (start, (start + HORIZON).min(n))
                );
                assert_eq!(
                    r.left_join,
                    if index == 0 {
                        LeftJoin::Initial
                    } else {
                        LeftJoin::LegacyOverlap
                    }
                );
                assert!(r.plateau.is_none());
                start += HORIZON - OVERLAP;
            }
            assert_eq!(rs.last().unwrap().input_end, n);
        }
    }
    #[test]
    fn exact_horizon_cuts_and_dc_plateau_is_supported() {
        let mut base = varying(HORIZON);
        base[400_000..406_400].fill(0.0);
        let rs = full(&base);
        assert_eq!(rs.len(), 2);
        assert_eq!(rs[0].input_end, 403_200);
        assert_eq!(rs[1].left_join, LeftJoin::Disjoint);
        assert_eq!(rs[0].plateau, Some(400_000..406_400));
        base[400_000..406_400].fill(0.25);
        assert_eq!(full(&base), rs);
    }
    #[test]
    fn latest_closed_run_and_200ms_boundary() {
        let mut audio = varying(HORIZON);
        audio[100_160..103_360].fill(0.0); // exactly10 complete frames
        audio[400_000..402_880].fill(0.0); //9frames, unsupported
        assert_eq!(full(&audio)[0].input_end, 101_760);
        audio[400_000..403_200].fill(0.0);
        assert_eq!(full(&audio)[0].input_end, 401_600);
        audio[450_240..HORIZON].fill(0.0); // trailing run never closed
        assert_eq!(full(&audio)[0].input_end, 401_600);
    }
    #[test]
    fn drifting_constant_frames_do_not_form_one_plateau() {
        let mut audio = varying(HORIZON);
        for (i, frame) in audio[400_000..406_400].chunks_exact_mut(FRAME).enumerate() {
            frame.fill(i as f32 * 1e-8);
        }
        assert_eq!(full(&audio)[0].right_boundary, RightBoundary::LegacyStride);
    }
    #[test]
    fn one_and_half_second_margins_and_numeric_span_are_exact() {
        let mut audio = varying(HORIZON);
        audio[0..48_000].fill(0.0);
        assert_eq!(full(&audio)[0].input_end, MIN_SIDE);
        audio[0..48_000].copy_from_slice(&varying(48_000));
        audio[0..47_680].fill(0.0);
        assert_eq!(full(&audio)[0].right_boundary, RightBoundary::LegacyStride);
        assert!(!has_signal(&[0.0, NUMERICAL_SPAN]).unwrap());
        assert!(has_signal(&[0.0, f32::from_bits(NUMERICAL_SPAN.to_bits() + 1)]).unwrap());
        assert!(has_signal(&[f32::NAN]).is_err());
    }
    #[test]
    fn right_margin_and_future_audio_do_not_change_a_planned_prefix() {
        let mut audio = varying(HORIZON);
        audio[454_400..457_600].fill(0.0);
        assert_eq!(full(&audio)[0].input_end, HORIZON - MIN_SIDE);
        audio = varying(HORIZON);
        audio[454_720..457_920].fill(0.0);
        assert_eq!(full(&audio)[0].right_boundary, RightBoundary::LegacyStride);
        audio[400_000..406_400].fill(0.0);
        let first = plan_next(&PlannerState::new(), &audio, true).unwrap();
        audio.extend([f32::NAN]);
        assert_eq!(
            plan_next(&PlannerState::new(), &audio, false).unwrap(),
            first
        );
        let mut state = PlannerState::new();
        state.commit(&first.unwrap()).unwrap();
        assert!(plan_next(&state, &audio[state.next_input_start()..], true).is_err());
    }

    #[test]
    fn fallback_latches_overlap_despite_later_plateau() {
        let mut audio = varying(3 * HORIZON);
        audio[800_000..806_400].fill(0.0);
        let rs = full(&audio);
        assert_eq!(rs[0].right_boundary, RightBoundary::LegacyStride);
        assert_eq!(rs[1].left_join, LeftJoin::LegacyOverlap);
        assert_eq!(rs[1].right_boundary, RightBoundary::LegacyStride);
        assert_eq!(rs[2].left_join, LeftJoin::LegacyOverlap);
        assert_eq!(rs[2].right_boundary, RightBoundary::LegacyStride);
        assert_eq!(rs[3].left_join, LeftJoin::LegacyOverlap);
        for pair in rs.windows(2) {
            let overlap = pair[0].input_end - pair[1].input_start;
            assert_eq!(
                overlap,
                if pair[1].left_join == LeftJoin::LegacyOverlap {
                    OVERLAP
                } else {
                    0
                }
            );
        }
        assert_eq!(rs.last().unwrap().input_end, audio.len());
    }
    #[test]
    fn incremental_arbitrary_availability_has_identical_receipts() {
        let mut audio = varying(1_400_017);
        audio[400_000..406_400].fill(0.2);
        audio[1_100_160..1_106_560].fill(-0.1);
        let expected = full(&audio);
        for step in [127, 16_000, 480_000, 464_000, 700_000] {
            let mut state = PlannerState::new();
            let mut got = Vec::new();
            let mut available_end = 0;
            'capture: loop {
                available_end = (available_end + step).min(audio.len());
                loop {
                    let Some(r) = plan_next(
                        &state,
                        &audio[state.next_input_start()..available_end],
                        available_end == audio.len(),
                    )
                    .unwrap() else {
                        break;
                    };
                    state.commit(&r).unwrap();
                    let done = r.right_boundary == RightBoundary::Final;
                    got.push(r);
                    if done {
                        break 'capture;
                    }
                }
                if available_end == audio.len() {
                    break;
                }
            }
            assert_eq!(got, expected);
        }
    }
    #[test]
    fn uncommitted_error_cancel_and_stale_receipts_do_not_advance() {
        let audio = varying(HORIZON + 1);
        let mut state = PlannerState::new();
        let r = plan_next(&state, &audio, false).unwrap().unwrap();
        assert_eq!(state, PlannerState::new());
        assert_eq!(plan_next(&state, &audio, false).unwrap(), Some(r.clone()));
        state.commit(&r).unwrap();
        let committed = state.clone();
        assert!(state.commit(&r).is_err());
        assert_eq!(state, committed);
    }
    #[test]
    fn invalid_or_incomplete_input_cannot_be_a_silent_success() {
        let state = PlannerState::new();
        let mut audio = varying(HORIZON);
        audio[123] = f32::INFINITY;
        assert!(plan_next(&state, &audio, false).is_err());
        assert!(plan_next(&state, &[f32::NAN], true).is_err());
        assert_eq!(plan_next(&state, &[], true).unwrap(), None);
        assert_eq!(
            plan_next(&state, &varying(HORIZON - 1), false).unwrap(),
            None
        );
        let mut state = PlannerState::new();
        let r = plan_next(&state, &[0.0], true).unwrap().unwrap();
        state.commit(&r).unwrap();
        assert!(plan_next(&state, &[], true).is_err());
    }

    #[test]
    fn cut_then_fallback_latches_before_later_eligible_plateau() {
        let mut audio = varying(3 * HORIZON + 37);
        audio[400_000..406_400].fill(0.0);
        audio[1_100_160..1_106_560].fill(0.0);
        let rs = full(&audio);
        assert_eq!(rs[0].input_end, 403_200);
        assert_eq!(rs[0].right_boundary, RightBoundary::NumericalPlateau);
        assert_eq!(rs[1].left_join, LeftJoin::Disjoint);
        assert_eq!(rs[1].right_boundary, RightBoundary::LegacyStride);
        assert_eq!(rs[2].left_join, LeftJoin::LegacyOverlap);
        assert_eq!(rs[2].right_boundary, RightBoundary::LegacyStride);
        assert!(rs[2].plateau.is_none());
        assert_eq!(rs.last().unwrap().input_end, audio.len());
    }
    #[test]
    fn all_cut_prefix_remains_available_until_first_fallback() {
        let mut audio = varying(1_300_000);
        for start in [400_000, 800_000, 1_200_000] {
            audio[start..start + 6_400].fill(0.0);
        }
        let rs = full(&audio);
        assert_eq!(rs[0].input_end, 403_200);
        assert_eq!(rs[1].input_end, 803_200);
        // A third complete lookahead still permits a cut before the short final remainder.
        assert_eq!(rs[2].input_end, 1_203_200);
        assert_eq!(rs[2].right_boundary, RightBoundary::NumericalPlateau);
        assert_eq!(rs[3].right_boundary, RightBoundary::Final);
    }
    #[test]
    fn exact_horizon_and_overlap_only_tail_keep_completion_semantics() {
        let rs = full(&varying(HORIZON));
        assert_eq!(rs.len(), 1);
        assert_eq!(rs[0].right_boundary, RightBoundary::LegacyStride);
        let mut state = PlannerState::new();
        state.commit(&rs[0]).unwrap();
        assert!(plan_next(&state, &varying(OVERLAP), true)
            .unwrap()
            .is_none());
        let next = plan_next(&state, &varying(OVERLAP + 1), true)
            .unwrap()
            .unwrap();
        assert_eq!(next.left_join, LeftJoin::LegacyOverlap);
        assert_eq!(next.right_boundary, RightBoundary::Final);
        assert_eq!(next.input_end, HORIZON + 1);
        let mut cut = varying(HORIZON);
        cut[400_000..406_400].fill(0.0);
        let rs = full(&cut);
        assert_eq!(rs.len(), 2);
        assert_eq!(rs[0].right_boundary, RightBoundary::NumericalPlateau);
        assert_eq!(rs[1].right_boundary, RightBoundary::Final);
        assert_eq!(rs[1].input_end, HORIZON);
    }
    #[test]
    fn uncommitted_fallback_does_not_latch_state() {
        let state = PlannerState::new();
        let first = plan_next(&state, &varying(HORIZON), false)
            .unwrap()
            .unwrap();
        assert_eq!(first.right_boundary, RightBoundary::LegacyStride);
        assert_eq!(state, PlannerState::new());
        let mut cut = varying(HORIZON);
        cut[400_000..406_400].fill(0.0);
        assert_eq!(
            plan_next(&state, &cut, false)
                .unwrap()
                .unwrap()
                .right_boundary,
            RightBoundary::NumericalPlateau
        );
    }
}
