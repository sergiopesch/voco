//! Regression for RUSTSEC-2024-0429. Run with production optimization too:
//! the original immutable C out-pointer can appear correct in debug builds.
use glib::prelude::*;

fn strings() -> glib::Variant {
    ["", "hello", "Español", "日本語", "🎙️"].to_variant()
}

#[test]
fn forward() {
    let value = strings();
    assert_eq!(
        value.array_iter_str().unwrap().collect::<Vec<_>>(),
        ["", "hello", "Español", "日本語", "🎙️"]
    );
}

#[test]
fn reverse() {
    let value = strings();
    assert_eq!(
        value.array_iter_str().unwrap().rev().collect::<Vec<_>>(),
        ["🎙️", "日本語", "Español", "hello", ""]
    );
}

#[test]
fn skip_front() {
    let value = strings();
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.nth(2), Some("Español"));
    assert_eq!(iter.len(), 2);
    assert_eq!(iter.next(), Some("日本語"));
}

#[test]
fn skip_back() {
    let value = strings();
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.nth_back(2), Some("Español"));
    assert_eq!(iter.len(), 2);
    assert_eq!(iter.next_back(), Some("hello"));
}

#[test]
fn last() {
    let value = strings();
    assert_eq!(value.array_iter_str().unwrap().last(), Some("🎙️"));
}

#[test]
fn alternating_and_exhaustion() {
    let value = strings();
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.next(), Some(""));
    assert_eq!(iter.next_back(), Some("🎙️"));
    assert_eq!(iter.nth(1), Some("Español"));
    assert_eq!(iter.next_back(), Some("日本語"));
    assert_eq!(iter.size_hint(), (0, Some(0)));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
}

#[test]
fn control_empty_bounds_and_wrong_type() {
    let value = Vec::<String>::new().to_variant();
    assert_eq!(value.array_iter_str().unwrap().next(), None);
    assert_eq!(value.array_iter_str().unwrap().next_back(), None);
    assert_eq!(value.array_iter_str().unwrap().last(), None);
    assert_eq!(strings().array_iter_str().unwrap().nth(usize::MAX), None);
    assert_eq!(
        strings().array_iter_str().unwrap().nth_back(usize::MAX),
        None
    );
    assert!(42u32.to_variant().array_iter_str().is_err());
    assert!([1u32, 2].to_variant().array_iter_str().is_err());
    assert!("scalar".to_variant().array_iter_str().is_err());
}
