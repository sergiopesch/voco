//! Bounded, versioned messages shared by the browser broker and native host.
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};

pub const PROTOCOL: u32 = 1;
pub const MAX_FRAME: usize = 1024 * 1024;
pub const MAX_TEXT: usize = 100_000;
// The extension's manifest key fixes this origin; it is not selected by input.
#[allow(dead_code)] // Used by the separately compiled native-messaging host.
pub const EXTENSION_ORIGIN: &str = "chrome-extension://dohnphckdenppjhdafmhefhomomodgcc/";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum BrowserMessage {
    Hello {
        protocol: u32,
        client: String,
        capabilities: Vec<String>,
    },
    Trigger {
        protocol: u32,
        token: String,
        #[serde(rename = "documentId")]
        document_id: String,
        mode: String,
    },
    Stop {
        protocol: u32,
        token: String,
        #[serde(rename = "documentId")]
        document_id: String,
    },
    Invalidate {
        protocol: u32,
        token: String,
        #[serde(rename = "documentId")]
        document_id: String,
        reason: String,
    },
    Receipt {
        protocol: u32,
        #[serde(rename = "requestId")]
        request_id: String,
        token: String,
        #[serde(rename = "documentId")]
        document_id: String,
        sequence: u64,
        #[serde(rename = "expectedCommittedCharacters")]
        expected_committed_characters: usize,
        outcome: String,
        #[serde(rename = "committedCharacters")]
        committed_characters: usize,
        reason: Option<String>,
    },
}

#[allow(dead_code)] // Used by the separately compiled native-messaging host.
pub fn allowed_origin(value: &str) -> bool {
    value == EXTENSION_ORIGIN
}

pub fn opaque_id(value: &str) -> bool {
    value.len() == 48
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

pub fn read_frame(reader: &mut impl Read) -> io::Result<Vec<u8>> {
    let mut prefix = [0; 4];
    reader.read_exact(&mut prefix)?;
    let length = u32::from_ne_bytes(prefix) as usize;
    if length == 0 || length > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "native frame length rejected",
        ));
    }
    let mut frame = vec![0; length];
    reader.read_exact(&mut frame)?;
    Ok(frame)
}

pub fn write_frame(writer: &mut impl Write, frame: &[u8]) -> io::Result<()> {
    if frame.is_empty() || frame.len() > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "native frame length rejected",
        ));
    }
    writer.write_all(&(frame.len() as u32).to_ne_bytes())?;
    writer.write_all(frame)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origin_is_exact_and_never_accepted_by_prefix() {
        assert!(allowed_origin(EXTENSION_ORIGIN));
        for origin in [
            "",
            "chrome-extension://other/",
            "https://dohnphckdenppjhdafmhefhomomodgcc/",
            "chrome-extension://dohnphckdenppjhdafmhefhomomodgcc/extra",
        ] {
            assert!(!allowed_origin(origin));
        }
    }
    #[test]
    fn framing_is_bounded_and_rejects_truncation() {
        for length in [0, MAX_FRAME + 1, u32::MAX as usize] {
            assert!(read_frame(&mut &(length as u32).to_ne_bytes()[..]).is_err());
        }
        assert!(read_frame(&mut &[2, 0, 0, 0, 1][..]).is_err());
        let mut bytes = Vec::new();
        write_frame(&mut bytes, b"{} ").unwrap();
        assert_eq!(read_frame(&mut &bytes[..]).unwrap(), b"{} ");
    }
    #[test]
    fn ids_are_exact_and_unknown_message_fields_fail() {
        assert!(opaque_id(&"a".repeat(48)));
        for id in ["a".repeat(47), "A".repeat(48), "z".repeat(48)] {
            assert!(!opaque_id(&id));
        }
        assert!(serde_json::from_str::<BrowserMessage>(
            r#"{"type":"hello","protocol":1,"client":"chromium","capabilities":[],"extra":true}"#
        )
        .is_err());
    }
}
