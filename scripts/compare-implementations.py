#!/usr/bin/env python3
"""Compare the three implementations and generate a disagreement table."""
import json
import sys

def load_results(path):
    with open(path) as f:
        return {r['label']: r for r in json.load(f)}

def main():
    rust = load_results('/tmp/rust-results.json')
    python = load_results('/tmp/python-results.json')
    typescript = load_results('/tmp/typescript-results.json')
    
    all_labels = set(rust.keys()) | set(python.keys()) | set(typescript.keys())
    
    print("# Current Disagreements on master (commit 1cddc4b)")
    print()
    print("| Case | Input (repr) | Rust | Python | TypeScript | Agreement |")
    print("|------|-------------|------|--------|------------|-----------|")
    
    disagreements = []
    agreements = []
    
    for label in sorted(all_labels):
        r = rust.get(label, {})
        p = python.get(label, {})
        t = typescript.get(label, {})
        
        r_verdict = r.get('verdict', 'N/A')
        r_count = r.get('word_count')
        p_verdict = p.get('actual_verdict', 'N/A')
        p_count = p.get('actual_word_count')
        t_verdict = t.get('actual_verdict', 'N/A')
        t_count = t.get('actual_word_count')
        
        r_result = f"{r_verdict} ({r_count}w)" if r_count is not None else r_verdict
        p_result = f"{p_verdict} ({p_count}w)" if p_count is not None else p_verdict
        t_result = f"{t_verdict} ({t_count}w)" if t_count is not None else t_verdict
        
        # Check if all three agree
        all_agree = (r_verdict == p_verdict == t_verdict) and (r_count == p_count == t_count or r_verdict == 'reject')
        
        input_repr = r.get('input', p.get('input', t.get('input', '')))
        if len(input_repr) > 30:
            input_repr = input_repr[:27] + "..."
        
        row = (label, repr(input_repr), r_result, p_result, t_result, "✓" if all_agree else "✗")
        
        if all_agree:
            agreements.append(row)
        else:
            disagreements.append(row)
    
    # Print disagreements first
    for row in disagreements:
        print(f"| {row[0]} | {row[1]} | {row[2]} | {row[3]} | {row[4]} | **{row[5]}** |")
    
    # Then agreements
    for row in agreements:
        print(f"| {row[0]} | {row[1]} | {row[2]} | {row[3]} | {row[4]} | {row[5]} |")
    
    print()
    print(f"**Summary:** {len(disagreements)} disagreements, {len(agreements)} agreements")
    
    # Show specific NFD cases
    print()
    print("## Key Findings")
    print()
    print("### NFD (decomposed accents) handling:")
    for label in ["NFD Siobhán Kelly", "NFD Zoë"]:
        if label in rust and label in python and label in typescript:
            print(f"- **{label}:**")
            print(f"  - Rust: {rust[label]['verdict']}")
            print(f"  - Python: {python[label]['actual_verdict']}")
            print(f"  - TypeScript: {typescript[label]['actual_verdict']}")

if __name__ == '__main__':
    main()
