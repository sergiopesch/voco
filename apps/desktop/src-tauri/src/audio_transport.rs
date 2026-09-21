pub fn decode_samples(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if !bytes.len().is_multiple_of(4) {
        return Err("Audio data length is not a multiple of 4 bytes".to_string());
    }
    bytes
        .chunks_exact(4)
        .map(|chunk| {
            let sample = f32::from_le_bytes(chunk.try_into().unwrap());
            if sample.is_finite() {
                Ok(sample)
            } else {
                Err("Audio contains non-finite samples".to_string())
            }
        })
        .collect()
}
