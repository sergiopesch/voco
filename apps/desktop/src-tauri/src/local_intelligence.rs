//! Optional localhost processing, separate from on-device recognition.

use super::{read_bounded_response_body, MAX_MODEL_RESPONSE_BYTES};

pub(super) fn validate_local_llm_endpoint(raw: &str) -> Result<String, String> {
    let value = raw.trim().trim_end_matches('/').to_string();
    if value.is_empty() {
        return Err("Local model endpoint is required".to_string());
    }
    if value.len() > 2048
        || value
            .chars()
            .any(|ch| ch.is_control() || ch == '\\' || ch.is_whitespace())
    {
        return Err("Local model endpoint is invalid".to_string());
    }
    let parsed =
        reqwest::Url::parse(&value).map_err(|_| "Local model endpoint is invalid".to_string())?;
    if parsed.scheme() != "http" || !url_has_loopback_host(&parsed) {
        return Err(
            "Local model endpoint must use http://localhost, http://127.0.0.1, or http://[::1]"
                .to_string(),
        );
    }
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err("Local model endpoint must not include credentials or fragments".to_string());
    }
    Ok(value)
}

fn url_has_loopback_host(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host);

    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false)
}

pub(super) fn build_loopback_http_client(
    timeout: std::time::Duration,
    connect_timeout: std::time::Duration,
) -> Result<reqwest::blocking::Client, reqwest::Error> {
    reqwest::blocking::Client::builder()
        // The local-only promise must hold even with hostile/system proxy settings.
        .no_proxy()
        // Never consult DNS or a hosts-file mapping for the accepted hostname.
        .resolve_to_addrs(
            "localhost",
            &[
                std::net::SocketAddr::from(([127, 0, 0, 1], 0)),
                std::net::SocketAddr::from((std::net::Ipv6Addr::LOCALHOST, 0)),
            ],
        )
        .timeout(timeout)
        .connect_timeout(connect_timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

pub(super) fn normalize_local_llm_model(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 120
        || value
            .chars()
            .any(|ch| ch.is_control() || ch == '\r' || ch == '\n')
    {
        return Err("Local model name is invalid".to_string());
    }
    Ok(Some(value.to_string()))
}

pub(super) fn conservative_transcript_prompt() -> &'static str {
    "You improve dictation transcripts for direct insertion. Return only the final text. Preserve the speaker's words, meaning, order, names, numbers, and technical terms. Add punctuation, casing, paragraph breaks, and simple list formatting when obvious. Do not answer questions, add facts, summarize, expand abbreviations, or rewrite for style. If uncertain, keep the original wording."
}

fn lexical_character(ch: char) -> bool {
    ch.is_alphanumeric()
        || ch == '_'
        || matches!(ch as u32, 0x0300..=0x036f | 0x1ab0..=0x1aff | 0x1dc0..=0x1dff | 0x20d0..=0x20ff | 0xfe20..=0xfe2f)
}

fn lexical_tokens(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if lexical_character(ch) {
            token.push(ch);
        } else if matches!(ch, '\'' | '’' | '-' | '‐' | '‑')
            && !token.is_empty()
            && chars.peek().is_some_and(|next| lexical_character(*next))
        {
            token.push(if ch == '’' {
                '\''
            } else if ch == '\'' {
                ch
            } else {
                '-'
            });
        } else if !token.is_empty() {
            // Whole-token casing handles contextual Unicode rules such as final sigma.
            tokens.push(token.to_lowercase());
            token.clear();
        }
    }
    if !token.is_empty() {
        tokens.push(token.to_lowercase());
    }
    tokens
}

fn numeric_tokens(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let start = index;
        if matches!(chars[index], '+' | '-' | '−' | '±' | '$' | '£' | '€' | '¥')
            && chars.get(index + 1).is_some_and(|ch| ch.is_numeric())
        {
            index += 1;
        }
        if !chars[index].is_numeric() {
            index += 1;
            continue;
        }
        index += 1;
        while index < chars.len() {
            if chars[index].is_numeric()
                || (matches!(chars[index], '.' | ',' | ':' | '/' | '-')
                    && chars.get(index + 1).is_some_and(|ch| ch.is_numeric()))
            {
                index += 1;
            } else {
                break;
            }
        }
        if chars
            .get(index)
            .is_some_and(|ch| matches!(ch, '%' | '‰' | '°'))
        {
            index += 1;
        }
        tokens.push(chars[start..index].iter().collect());
    }
    tokens
}

fn technical_tokens(text: &str) -> Vec<&str> {
    text.split_whitespace()
        .filter_map(|part| {
            let part = part.trim_matches(|ch| {
                matches!(
                    ch,
                    '"' | '“' | '”' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';' | '!' | '?'
                )
            });
            let part = part.trim_end_matches(['.', ':']);
            let internal_dot = part.chars().collect::<Vec<_>>().windows(3).any(|window| {
                lexical_character(window[0]) && window[1] == '.' && lexical_character(window[2])
            });
            (internal_dot
                || part.contains(['/', '\\', '@', '_', '`', '<', '>', '=', '|', '&', '$', '#'])
                || (part.contains('+') && part.chars().any(lexical_character)))
            .then_some(part)
        })
        .collect()
}

// Preserve code bodies, including case and whitespace inside multiline fences.
// Backtick runs delimit opaque regions; incomplete code stays protected to EOF.
fn verbatim_code(text: &str) -> Vec<&str> {
    let mut regions = Vec::new();
    let mut remaining = text;
    while let Some(start) = remaining.find('`') {
        remaining = &remaining[start..];
        let delimiter_len = remaining.bytes().take_while(|byte| *byte == b'`').count();
        let delimiter = &remaining[..delimiter_len];
        let end = remaining[delimiter_len..]
            .find(delimiter)
            .map_or(remaining.len(), |offset| {
                delimiter_len + offset + delimiter_len
            });
        regions.push(&remaining[..end]);
        remaining = &remaining[end..];
    }
    regions
}

// Most punctuation is formatting, but symbols, non-Latin marks and invisible
// format characters can carry content. Anchor them to recognized character
// positions so a currency sign cannot migrate to a different amount.
fn content_symbols(text: &str) -> Vec<(usize, char)> {
    let mut symbols = Vec::new();
    let mut lexical_position = 0;
    let mut line_start = true;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        let numeric_sign = matches!(ch, '+' | '-' | '−' | '±')
            && chars
                .clone()
                .find(|next| !next.is_whitespace())
                .is_some_and(char::is_numeric);
        let list_marker = !numeric_sign
            && line_start
            && matches!(ch, '*' | '+' | '•')
            && chars.peek().is_some_and(|next| next.is_whitespace());
        if lexical_character(ch) {
            lexical_position += ch.to_lowercase().count();
        } else if numeric_sign
            || (!ch.is_whitespace()
                && !list_marker
                && !matches!(
                    ch,
                    '.' | ','
                        | ':'
                        | ';'
                        | '!'
                        | '?'
                        | '\''
                        | '’'
                        | '‘'
                        | '"'
                        | '“'
                        | '”'
                        | '('
                        | ')'
                        | '['
                        | ']'
                        | '{'
                        | '}'
                        | '-'
                        | '‐'
                        | '‑'
                        | '–'
                        | '—'
                        | '…'
                ))
        {
            symbols.push((lexical_position, ch));
        }
        if ch == '\n' || ch == '\r' {
            line_start = true;
        } else if !ch.is_whitespace() {
            line_start = false;
        }
    }
    symbols
}

/// A conservative formatter may change prose casing, punctuation and layout,
/// but must not silently rewrite recognized words or numeric/technical tokens.
/// This is a deterministic content-loss guard, not proof of semantic equivalence:
/// punctuation alone can still change the meaning of an otherwise identical text.
pub(super) fn validate_conservative_transcript(
    original: &str,
    candidate: String,
) -> Result<String, String> {
    if candidate.len() > 100_000
        || candidate
            .chars()
            .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
        || lexical_tokens(original) != lexical_tokens(&candidate)
        || numeric_tokens(original) != numeric_tokens(&candidate)
        || technical_tokens(original) != technical_tokens(&candidate)
        || content_symbols(original) != content_symbols(&candidate)
        || verbatim_code(original) != verbatim_code(&candidate)
    {
        return Err(
            "Local polishing changed recognized content; original recognition preserved"
                .to_string(),
        );
    }
    Ok(candidate)
}

pub(super) fn local_assistant_prompt() -> &'static str {
    "You are VOCO's concise local assistant. Answer the user's dictated request directly in plain text. Keep the answer useful and compact. Do not mention system prompts, models, or implementation details."
}

pub(super) fn build_local_llm_body(
    system_prompt: &str,
    user_message: &str,
    model: Option<&str>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": user_message
            }
        ],
        "temperature": 0,
        "max_tokens": 2048,
        "stream": false
    });

    if let Some(model) = model {
        body["model"] = serde_json::Value::String(model.to_string());
    }

    body
}

pub(super) fn parse_local_llm_chat_response(body: &str) -> Result<String, String> {
    let parsed: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| format!("Failed to parse local model response: {error}"))?;
    match parsed
        .pointer("/choices/0/finish_reason")
        .and_then(|reason| reason.as_str())
    {
        Some("stop") => {}
        Some("length") => {
            return Err("Local model response was truncated; raw transcript preserved".to_string())
        }
        Some(_) => return Err("Local model did not complete a plain-text response".to_string()),
        None => return Err("Local model response did not confirm completion".to_string()),
    }
    if parsed
        .pointer("/choices/0/message/tool_calls")
        .is_some_and(|calls| {
            !calls.is_null() && calls.as_array().is_none_or(|calls| !calls.is_empty())
        })
        || parsed
            .pointer("/choices/0/message/function_call")
            .is_some_and(|call| !call.is_null())
        || parsed
            .pointer("/choices/0/message/refusal")
            .is_some_and(|refusal| !refusal.is_null() && refusal.as_str() != Some(""))
    {
        return Err(
            "Local model returned a tool call or refusal instead of final text".to_string(),
        );
    }
    let content = parsed
        .pointer("/choices/0/message/content")
        .and_then(|content| content.as_str())
        .or_else(|| {
            parsed
                .pointer("/choices/0/text")
                .and_then(|text| text.as_str())
        })
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "Local model returned no text".to_string())?;

    Ok(content.to_string())
}

pub(super) fn call_local_llm_chat(
    endpoint: &str,
    system_prompt: &str,
    user_message: &str,
    model: Option<&str>,
    timeout: std::time::Duration,
) -> Result<String, String> {
    let endpoint = validate_local_llm_endpoint(endpoint)?;
    let model = normalize_local_llm_model(model)?;
    let client = build_loopback_http_client(timeout, std::time::Duration::from_millis(900))
        .map_err(|error| format!("Failed to build local model client: {error}"))?;
    let response = client
        .post(endpoint)
        .header("Content-Type", "application/json")
        .body(build_local_llm_body(system_prompt, user_message, model.as_deref()).to_string())
        .send()
        .map_err(|error| format!("Local model request failed: {error}"))?;
    let status = response.status();
    let response_body =
        read_bounded_response_body(response, MAX_MODEL_RESPONSE_BYTES, "local model response")?;
    if !status.is_success() {
        // Server error bodies may echo the transcript; warnings are logged by the UI.
        return Err(format!("Local model request failed ({status})"));
    }

    parse_local_llm_chat_response(&response_body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::{Duration, Instant};

    #[test]
    fn loopback_validation_accepts_default_http_port_without_relaxing_host_rules() {
        // URL parsing normalizes explicit :80 to the default port. Both forms
        // remain loopback and must work just like a non-default local port.
        for endpoint in [
            "http://localhost/v1/chat/completions",
            "http://localhost:80/v1/chat/completions",
            "http://127.0.0.1:80/v1/chat/completions",
            "http://[::1]:80/v1/chat/completions",
        ] {
            assert_eq!(validate_local_llm_endpoint(endpoint).unwrap(), endpoint);
        }
        for endpoint in [
            "http://example.com:80/v1",
            "https://localhost/v1",
            "http://localhost.example/v1",
        ] {
            assert!(validate_local_llm_endpoint(endpoint).is_err());
        }
    }

    #[test]
    fn conservative_polish_allows_layout_and_prose_casing_without_rewriting() {
        for (original, candidate) in [
            ("hello world this is voco", "Hello, world. This is VOCO."),
            ("first item second item", "- First item\n- Second item"),
            ("don't change o'reilly", "Don’t change O’Reilly."),
            ("use 1.5 mg at 12:30", "Use 1.5 mg at 12:30."),
            (
                "read /tmp/VOCO.log then foo_bar",
                "Read /tmp/VOCO.log, then foo_bar.",
            ),
            ("naïve café", "Naïve café."),
            ("ΟΣ", "ος."),
            ("first item second item", "* First item\n+ Second item"),
            ("launch 🚀 with कि", "Launch 🚀 with कि."),
            ("cost $ 5", "Cost $ 5."),
            ("use C++ and C#", "Use C++ and C#."),
            ("read `CallMe()` now", "Read `CallMe()` now."),
        ] {
            assert_eq!(
                validate_conservative_transcript(original, candidate.to_string()).unwrap(),
                candidate
            );
        }
    }

    #[test]
    fn conservative_polish_rejects_word_loss_invention_reordering_and_numeric_changes() {
        for (original, candidate) in [
            ("do not send it", "Do send it."),
            ("send it", "Do not send it."),
            ("use fourteen", "Use 14."),
            ("use 1.5 mg", "Use 15 mg."),
            ("use 1.5 mg", "Use 1,5 mg."),
            ("set -5 degrees", "Set 5 degrees."),
            ("set 5%", "Set 5."),
            ("alice calls bob", "Bob calls Alice."),
            ("repeat repeat", "Repeat."),
            ("can't send", "Cant send."),
            ("re-sign it", "Resign it."),
            ("cafe\u{301}", "Cafe."),
            ("read /tmp/VOCO.log", "Read /tmp/voco.log."),
            ("send alice@example.com", "Send alice example com."),
            ("use foo_bar", "Use foo bar."),
            ("test", "Test.\u{0000}"),
            ("use C++ and C#", "Use C and C."),
            ("cost $ 5", "Cost 5."),
            ("cost $ 5 and 6", "Cost 5 and $ 6."),
            ("set − 5", "Set 5."),
            ("set - 5", "Set 5."),
            ("+ 5", "5"),
            ("5 × 3", "5 ÷ 3"),
            ("launch 🚀", "Launch."),
            ("use कि", "Use क."),
            ("safe words", "Safe \u{202e}words."),
            ("```python\nCallMe()\n```", "```python\ncallme()\n```"),
            ("read `CallMe()`", "Read `callme()`"),
        ] {
            assert!(
                validate_conservative_transcript(original, candidate.to_string()).is_err(),
                "accepted {original:?} -> {candidate:?}"
            );
        }
        assert!(
            validate_conservative_transcript("test", format!("test{}", ".".repeat(100_000)))
                .is_err()
        );
    }

    #[test]
    fn rejects_incomplete_refused_and_tool_responses() {
        for reason in [
            serde_json::Value::Null,
            serde_json::json!("length"),
            serde_json::json!("content_filter"),
            serde_json::json!("tool_calls"),
            serde_json::json!("unexpected"),
        ] {
            let body = serde_json::json!({"choices":[{"finish_reason": reason,"message":{"content":"Only the first half"}}]});
            assert!(
                parse_local_llm_chat_response(&body.to_string()).is_err(),
                "{body}"
            );
        }
        assert!(parse_local_llm_chat_response(
            r#"{"choices":[{"message":{"content":"Missing completion status"}}]}"#
        )
        .is_err());
        assert!(parse_local_llm_chat_response(r#"{"choices":[{"finish_reason":"stop","message":{"content":"Partial text","tool_calls":[{}]}}]}"#).is_err());
        assert!(parse_local_llm_chat_response(r#"{"choices":[{"finish_reason":"stop","message":{"content":"Partial text","refusal":"No"}}]}"#).is_err());
        assert_eq!(
            parse_local_llm_chat_response(
                r#"{"choices":[{"finish_reason":"stop","text":"Complete compatibility response"}]}"#
            )
            .unwrap(),
            "Complete compatibility response"
        );
        assert_eq!(
            parse_local_llm_chat_response(r#"{"choices":[{"finish_reason":"stop","message":{"content":"Complete response","tool_calls":null,"function_call":null,"refusal":null}}]}"#).unwrap(),
            "Complete response"
        );
    }

    fn serve_requests(listener: TcpListener, count: usize) -> std::thread::JoinHandle<()> {
        listener.set_nonblocking(true).unwrap();
        std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(8);
            let mut served = 0;
            while served < count {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream
                            .set_read_timeout(Some(Duration::from_secs(1)))
                            .unwrap();
                        let mut request = [0; 4096];
                        assert!(stream.read(&mut request).unwrap() > 0);
                        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").unwrap();
                        served += 1;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            Instant::now() < deadline,
                            "loopback server did not receive expected requests"
                        );
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("loopback server failed: {error}"),
                }
            }
        })
    }

    #[test]
    fn proxy_environment_child() {
        let Ok(port) = std::env::var("VOCO_TEST_LOOPBACK_PORT") else {
            return;
        };
        let client =
            build_loopback_http_client(Duration::from_secs(2), Duration::from_secs(1)).unwrap();
        for host in ["127.0.0.1", "localhost"] {
            assert_eq!(
                client
                    .get(format!("http://{host}:{port}/synthetic-only"))
                    .send()
                    .unwrap()
                    .text()
                    .unwrap(),
                "ok"
            );
        }
    }

    #[test]
    fn proxies_cannot_receive_loopback_requests() {
        // Environment variables are process-global: exercise hostile proxy settings in a
        // subprocess so parallel tests and unrelated clients are never affected.
        let proxy = TcpListener::bind("127.0.0.1:0").unwrap();
        proxy.set_nonblocking(true).unwrap();
        let proxy_url = format!("http://{}", proxy.local_addr().unwrap());
        let origin = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = origin.local_addr().unwrap().port();
        let server = serve_requests(origin, 2);
        let executable = std::env::current_exe().unwrap();
        let child = crate::process_runner::command(executable.to_str().unwrap())
            .args([
                "--exact",
                "local_intelligence::tests::proxy_environment_child",
                "--nocapture",
            ])
            .env("VOCO_TEST_LOOPBACK_PORT", port.to_string())
            .env("HTTP_PROXY", &proxy_url)
            .env("http_proxy", &proxy_url)
            .env("HTTPS_PROXY", &proxy_url)
            .env("https_proxy", &proxy_url)
            .env("ALL_PROXY", &proxy_url)
            .env("all_proxy", &proxy_url)
            .env_remove("NO_PROXY")
            .env_remove("no_proxy")
            .spawn()
            .unwrap();
        let output =
            crate::process_runner::wait_with_output(child, Duration::from_secs(6), 64 * 1024)
                .unwrap();
        assert!(
            output.status.success(),
            "{} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        server.join().unwrap();
        assert_eq!(
            proxy.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[test]
    fn direct_ipv6_loopback_is_supported_when_available() {
        let Ok(listener) = TcpListener::bind("[::1]:0") else {
            eprintln!("IPv6 loopback unavailable in this test environment");
            return;
        };
        let address = listener.local_addr().unwrap();
        let server = serve_requests(listener, 1);
        let client =
            build_loopback_http_client(Duration::from_secs(2), Duration::from_secs(1)).unwrap();
        assert_eq!(
            client
                .get(format!("http://{address}/"))
                .send()
                .unwrap()
                .text()
                .unwrap(),
            "ok"
        );
        server.join().unwrap();
    }
}
