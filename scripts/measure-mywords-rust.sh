#!/bin/bash
# Run Rust My words measurement as a cargo test

cd "$(dirname "$0")/.."

cat > apps/desktop/src-tauri/tests/measure_mywords.rs << 'EOF'
use std::fs;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct TestCase {
    label: String,
    input: String,
    #[serde(rename = "expectedVerdict")]
    expected_verdict: String,
    #[serde(rename = "expectedWordCount")]
    expected_word_count: Option<usize>,
    #[serde(default)]
    comment: String,
}

#[derive(Debug, Serialize)]
struct TestResult {
    label: String,
    input: String,
    input_repr: String,
    expected_verdict: String,
    expected_word_count: Option<usize>,
    actual_verdict: String,
    actual_word_count: Option<usize>,
    error: Option<String>,
    matches_expected: bool,
}

const MY_WORDS_MAX_CHARS: usize = 40;
const MY_WORDS_MAX_WORDS: usize = 4;

fn listable_word_count(term: &str) -> Option<usize> {
    let chars: Vec<char> = term.chars().collect();
    let (mut index, mut words) = (0, 0);
    loop {
        let start = index;
        while index < chars.len() && chars[index].is_alphanumeric() {
            index += 1;
        }
        if index == start {
            return None;
        }
        while index + 1 < chars.len()
            && matches!(chars[index], '\'' | '\u{2019}')
            && chars[index + 1].is_alphanumeric()
        {
            index += 1;
            while index < chars.len() && chars[index].is_alphanumeric() {
                index += 1;
            }
        }
        words += 1;
        match chars.get(index) {
            None => return Some(words),
            Some(' ' | '-') => index += 1,
            Some('.') => {
                index += 1;
                if index == chars.len() {
                    return Some(words);
                }
                if chars[index] == ' ' {
                    index += 1;
                }
            }
            Some(_) => return None,
        }
    }
}

fn validate_entry(term: &str) -> (String, Option<usize>, Option<String>) {
    if term.is_empty() {
        return ("reject".to_string(), None, Some("empty string".to_string()));
    }
    
    let char_count = term.chars().count();
    if char_count > MY_WORDS_MAX_CHARS {
        return (
            "reject".to_string(),
            None,
            Some(format!("too long: {} > {}", char_count, MY_WORDS_MAX_CHARS)),
        );
    }
    
    match listable_word_count(term) {
        None => ("reject".to_string(), None, Some("invalid structure".to_string())),
        Some(word_count) if word_count > MY_WORDS_MAX_WORDS => (
            "reject".to_string(),
            Some(word_count),
            Some(format!("too many words: {} > {}", word_count, MY_WORDS_MAX_WORDS)),
        ),
        Some(word_count) => ("accept".to_string(), Some(word_count), None),
    }
}

#[test]
fn measure_my_words_validation() {
    let fixture_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../scripts/my-words-fixture.json");
    let content = fs::read_to_string(fixture_path).expect("Failed to read fixture");
    let cases: Vec<TestCase> = serde_json::from_str(&content).expect("Failed to parse fixture");
    
    let mut results = Vec::new();
    
    for case in cases {
        let (actual_verdict, actual_word_count, error) = validate_entry(&case.input);
        
        let matches_expected = actual_verdict == case.expected_verdict
            && (actual_verdict == "reject" || actual_word_count == case.expected_word_count);
        
        results.push(TestResult {
            label: case.label,
            input: case.input.clone(),
            input_repr: format!("{:?}", case.input),
            expected_verdict: case.expected_verdict,
            expected_word_count: case.expected_word_count,
            actual_verdict,
            actual_word_count,
            error,
            matches_expected,
        });
    }
    
    let output = serde_json::to_string_pretty(&results).unwrap();
    fs::write("/tmp/rust-results.json", &output).expect("Failed to write results");
    
    // Also print to stdout for visibility
    println!("{}", output);
}
EOF

cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test measure_mywords -- --nocapture
