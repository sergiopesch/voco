//! A deliberately explicit grammar: bare commands occupy a whole sentence; the
//! `command` prefix allows inline use. Quoted and `literal` phrases are preserved.

const COMMANDS: &[(&str, &str)] = &[
    ("end code block", "\n```\n"),
    ("new paragraph", "\n\n"),
    ("bullet point", "\n- "),
    ("scratch that", ""),
    ("new bullet", "\n- "),
    ("code block", "\n```\n"),
    ("new line", "\n"),
];

fn word_character(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

fn phrase_end(input: &str, start: usize, phrase: &str) -> Option<usize> {
    if input[..start]
        .chars()
        .next_back()
        .is_some_and(word_character)
    {
        return None;
    }
    let mut offset = start;
    for (index, word) in phrase.split(' ').enumerate() {
        if index > 0 {
            let remaining = &input[offset..];
            let spaces = remaining.len() - remaining.trim_start_matches([' ', '\t']).len();
            if spaces == 0 {
                return None;
            }
            offset += spaces;
        }
        let candidate = input.get(offset..offset.checked_add(word.len())?)?;
        if !candidate.eq_ignore_ascii_case(word) {
            return None;
        }
        offset += word.len();
    }
    if input[offset..].chars().next().is_some_and(word_character) {
        None
    } else {
        Some(offset)
    }
}

fn command_at(input: &str, start: usize) -> Option<(&'static str, &'static str, usize)> {
    COMMANDS.iter().find_map(|&(phrase, replacement)| {
        phrase_end(input, start, phrase).map(|end| (phrase, replacement, end))
    })
}

fn after_prefix(input: &str, start: usize, prefix: &str) -> Option<usize> {
    let end = phrase_end(input, start, prefix)?;
    let tail = &input[end..];
    let spaces = tail.len() - tail.trim_start_matches([' ', '\t']).len();
    (spaces > 0).then_some(end + spaces)
}

fn sentence_boundary(ch: char) -> bool {
    matches!(ch, '.' | '?' | '!' | ';' | '\n')
}

fn standalone(input: &str, start: usize, end: usize) -> bool {
    let before = input[..start]
        .trim_end_matches([' ', '\t'])
        .chars()
        .next_back();
    let after = input[end..].trim_start_matches([' ', '\t']).chars().next();
    before.is_none_or(sentence_boundary) && after.is_none_or(sentence_boundary)
}

fn closing_quote(ch: char) -> Option<char> {
    match ch {
        '"' => Some('"'),
        '\'' => Some('\''),
        '“' => Some('”'),
        '‘' => Some('’'),
        '`' => Some('`'),
        _ => None,
    }
}

fn normalize_command_whitespace(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut pending_space = false;
    let mut newline_run = 0;
    for ch in text.chars() {
        if ch == '\n' {
            pending_space = false;
            while output.ends_with(' ') {
                output.pop();
            }
            if newline_run < 2 {
                output.push('\n');
            }
            newline_run += 1;
        } else if ch.is_whitespace() {
            pending_space = true;
        } else {
            if pending_space && !output.is_empty() && !output.ends_with('\n') {
                output.push(' ');
            }
            pending_space = false;
            newline_run = 0;
            output.push(ch);
        }
    }
    output.trim().to_string()
}

pub(super) fn apply_spoken_formatting_commands(transcript: &str) -> String {
    let input = transcript.trim();
    let mut output = String::with_capacity(input.len());
    let mut offset = 0;
    let mut quote = None;
    let mut changed = false;
    while offset < input.len() {
        let ch = input[offset..]
            .chars()
            .next()
            .expect("offset is inside text");
        if let Some(closing) = quote {
            output.push(ch);
            offset += ch.len_utf8();
            if ch == closing {
                quote = None;
            }
            continue;
        }
        // Apostrophes within words are not quote delimiters.
        if let Some(closing) = closing_quote(ch) {
            let apostrophe_in_word = ch == '\''
                && input[..offset]
                    .chars()
                    .next_back()
                    .is_some_and(word_character);
            if !apostrophe_in_word {
                quote = Some(closing);
            }
            output.push(ch);
            offset += ch.len_utf8();
            continue;
        }
        if let Some(literal_start) = after_prefix(input, offset, "literal") {
            let command_start =
                after_prefix(input, literal_start, "command").unwrap_or(literal_start);
            if let Some((_, _, end)) = command_at(input, command_start) {
                output.push_str(&input[literal_start..end]);
                offset = end;
                changed = true;
                continue;
            }
        }
        let explicit_start = after_prefix(input, offset, "command");
        let start = explicit_start.unwrap_or(offset);
        if let Some((phrase, replacement, end)) = command_at(input, start) {
            if explicit_start.is_some() || standalone(input, offset, end) {
                if phrase == "scratch that" {
                    output.clear();
                } else {
                    while output.ends_with([' ', '\t']) {
                        output.pop();
                    }
                    output.push_str(replacement);
                }
                offset = end;
                // Punctuation ending a command belongs to the command, not its output.
                while input[offset..].starts_with([' ', '\t']) {
                    offset += 1;
                }
                if input[offset..].starts_with(['.', '?', '!', ';']) {
                    offset += 1;
                }
                changed = true;
                continue;
            }
        }
        output.push(ch);
        offset += ch.len_utf8();
    }
    if changed {
        normalize_command_whitespace(&output)
    } else {
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_mentions_and_substrings_are_never_commands() {
        for text in [
            "Read the new lines from the log.",
            "This is a code blocker.",
            "Please write the phrase scratch that in the title.",
            "Please add a new paragraph about Linux.",
            "Read the new line from the log.",
            "The command new linear algorithm is useful.",
            "Scratch thatcher's name from the list.",
            "écommand new line is a name.",
        ] {
            assert_eq!(apply_spoken_formatting_commands(text), text);
        }
    }

    #[test]
    fn punctuation_is_consumed_with_standalone_commands() {
        assert_eq!(
            apply_spoken_formatting_commands("First sentence. New paragraph. Second sentence."),
            "First sentence.\n\nSecond sentence."
        );
        assert_eq!(
            apply_spoken_formatting_commands("Bullet point. First. New bullet. Second."),
            "- First.\n- Second."
        );
        assert_eq!(
            apply_spoken_formatting_commands("Code block. let x = 1; End code block."),
            "```\nlet x = 1;\n```"
        );
    }

    #[test]
    fn explicit_inline_commands_are_supported_without_asr_punctuation() {
        assert_eq!(apply_spoken_formatting_commands("first command new paragraph command bullet point check gpio seventeen command new bullet stop"), "first\n\n- check gpio seventeen\n- stop");
        assert_eq!(
            apply_spoken_formatting_commands("old sentence command scratch that new sentence"),
            "new sentence"
        );
        assert_eq!(
            apply_spoken_formatting_commands("old sentence. Scratch that."),
            ""
        );
        assert_eq!(
            apply_spoken_formatting_commands("NEW\tPARAGRAPH. Hello."),
            "Hello."
        );
    }

    #[test]
    fn quoted_and_literal_commands_are_preserved() {
        for text in [
            "Say \"command scratch that\".",
            "'New paragraph.' is a phrase.",
            "‘Scratch that.’",
            "“Command new line.”",
            "`command code block`",
            "Don't write \"scratch that\".",
        ] {
            assert_eq!(apply_spoken_formatting_commands(text), text);
        }
        assert_eq!(
            apply_spoken_formatting_commands("literal scratch that"),
            "scratch that"
        );
        assert_eq!(
            apply_spoken_formatting_commands("literal command new line"),
            "command new line"
        );
        assert_eq!(
            apply_spoken_formatting_commands(
                "say literal new paragraph please command new line continue"
            ),
            "say new paragraph please\ncontinue"
        );
    }
}
