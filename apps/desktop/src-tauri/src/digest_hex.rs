/// Stable lowercase hex for digest 0.11 outputs, including leading zero bytes.
pub(crate) fn digest_hex(bytes: impl AsRef<[u8]>) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let bytes = bytes.as_ref();
    let mut output = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 15) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::digest_hex;
    use sha2::{Digest, Sha256};

    #[test]
    fn known_sha256_vector_and_leading_zeros_keep_the_wire_format() {
        assert_eq!(
            digest_hex(Sha256::digest(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(digest_hex([0, 1, 15, 16, 128, 255]), "00010f1080ff");
    }
}
