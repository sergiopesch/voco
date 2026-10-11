#!/usr/bin/env python3
"""Measure Python's My words validation on the shared fixture."""
import json
import sys
import os

# Add runtime/speech to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'runtime', 'speech'))

from mywords import MAX_CHARS, MAX_WORDS, SPELLED, TERM

def validate_entry(term):
    """Returns (verdict, word_count, error_reason)"""
    if not isinstance(term, str):
        return ('reject', None, 'not a string')
    
    if not term:
        return ('reject', None, 'empty string')
    
    if len(term) > MAX_CHARS:
        return ('reject', None, f'too long: {len(term)} > {MAX_CHARS}')
    
    if not TERM.fullmatch(term):
        return ('reject', None, 'does not match TERM regex')
    
    words = SPELLED.findall(term)
    word_count = len(words)
    
    if word_count > MAX_WORDS:
        return ('reject', None, f'too many words: {word_count} > {MAX_WORDS}')
    
    return ('accept', word_count, None)

def main():
    fixture_path = os.path.join(os.path.dirname(__file__), 'my-words-fixture.json')
    with open(fixture_path, 'r') as f:
        cases = json.load(f)
    
    results = []
    for case in cases:
        label = case['label']
        input_str = case['input']
        expected_verdict = case['expectedVerdict']
        expected_word_count = case.get('expectedWordCount')
        
        verdict, word_count, error = validate_entry(input_str)
        
        result = {
            'label': label,
            'input': input_str,
            'input_repr': repr(input_str),
            'expected_verdict': expected_verdict,
            'expected_word_count': expected_word_count,
            'actual_verdict': verdict,
            'actual_word_count': word_count,
            'error': error,
            'matches_expected': verdict == expected_verdict and (
                verdict == 'reject' or word_count == expected_word_count
            )
        }
        results.append(result)
    
    # Print results as JSON
    print(json.dumps(results, indent=2, ensure_ascii=False))

if __name__ == '__main__':
    main()
