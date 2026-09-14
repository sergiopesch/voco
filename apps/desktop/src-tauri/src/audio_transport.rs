use serde::Deserialize;
use tauri::ipc::InvokeBody;

const MAX_METADATA_BYTES: usize = 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Metadata {
    previous_canonical_text: String,
}

pub struct AudioRequest {
    pub samples: Vec<f32>,
    pub previous_canonical_text: String,
}

pub fn decode_request(body: &InvokeBody, max_samples: usize) -> Result<AudioRequest, String> {
    let InvokeBody::Raw(bytes) = body else {
        return Err("Audio requires the binary VCA1 transport".to_string());
    };
    if bytes.len() < 8 || &bytes[..4] != b"VCA1" {
        return Err("Invalid audio transport header".to_string());
    }
    let metadata_len = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if metadata_len > MAX_METADATA_BYTES || metadata_len > bytes.len() - 8 {
        return Err("Invalid audio metadata size".to_string());
    }
    let audio = &bytes[8 + metadata_len..];
    if audio.is_empty() || audio.len() / 4 > max_samples {
        return Err("Audio request is empty or exceeds this command's sample limit".to_string());
    }
    let metadata: Metadata = serde_json::from_slice(&bytes[8..8 + metadata_len])
        .map_err(|_| "Invalid audio request metadata".to_string())?;
    Ok(AudioRequest {
        samples: decode_samples(audio)?,
        previous_canonical_text: metadata.previous_canonical_text,
    })
}

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

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(metadata: &[u8], samples: &[u8]) -> InvokeBody {
        let mut bytes = b"VCA1".to_vec();
        bytes.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
        bytes.extend_from_slice(metadata);
        bytes.extend_from_slice(samples);
        InvokeBody::Raw(bytes)
    }

    #[test]
    fn decodes_unicode_prefix_and_unaligned_float_payload() {
        let body = packet(
            "{\"previousCanonicalText\":\"naïve 🦀\"}".as_bytes(),
            &0.5_f32.to_le_bytes(),
        );
        let decoded = decode_request(&body, 1).unwrap();
        assert_eq!(decoded.previous_canonical_text, "naïve 🦀");
        assert_eq!(decoded.samples, vec![0.5]);
    }

    #[test]
    fn rejects_json_malformed_oversized_and_nonfinite_audio() {
        let metadata = br#"{"previousCanonicalText":""}"#;
        assert!(decode_request(&InvokeBody::Json(serde_json::json!({})), 2).is_err());
        assert!(decode_request(&InvokeBody::Raw(b"VCA1".to_vec()), 2).is_err());
        assert!(decode_request(&packet(metadata, &[]), 2).is_err());
        assert!(decode_request(&packet(metadata, &[0; 3]), 2).is_err());
        assert!(decode_request(&packet(metadata, &[0; 12]), 2).is_err());
        assert!(decode_request(&packet(br#"{"unknown":1}"#, &[0; 4]), 2).is_err());
        assert!(decode_request(&packet(metadata, &f32::NAN.to_le_bytes()), 2).is_err());
        assert!(decode_request(&packet(metadata, &f32::INFINITY.to_le_bytes()), 2).is_err());
        let mut oversized = b"VCA1".to_vec();
        oversized.extend_from_slice(&u32::MAX.to_le_bytes());
        assert!(decode_request(&InvokeBody::Raw(oversized), 2).is_err());
    }

    #[test]
    fn enforces_command_specific_limit_before_allocating_samples() {
        let body = packet(br#"{"previousCanonicalText":""}"#, &[0; 8]);
        assert!(decode_request(&body, 1).is_err());
        assert_eq!(decode_request(&body, 2).unwrap().samples.len(), 2);
    }
}
