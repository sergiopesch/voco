//! Test-only synthetic acceptance driver; never included in application packages.
#[path = "../src/browser_broker.rs"]
#[allow(dead_code)]
mod browser_broker;
#[path = "../src/browser_protocol.rs"]
#[allow(dead_code)]
mod browser_protocol;
#[path = "../src/browser_socket.rs"]
mod browser_socket;
use std::io::Write;
use std::sync::mpsc;
use std::time::Duration;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let output = args
        .get(1)
        .ok_or("usage: browser_broker_fixture OUTPUT_JSONL [DELAY_MS] [rejected]")?;
    let delay: u64 = args.get(2).map(|v| v.parse()).transpose()?.unwrap_or(0);
    if delay > 10_000 {
        return Err("fixture delay exceeds 10 seconds".into());
    }
    let expect_rejected = args.get(3).is_some_and(|s| s == "rejected");
    let mut file = std::fs::File::create(output)?;
    let (sender, receiver) = mpsc::channel();
    let broker = browser_broker::BrowserBroker::bind(move |event| sender.send(event).is_ok())?;
    writeln!(file, "{}", serde_json::json!({"phase":"ready"}))?;
    file.flush()?;
    let event = receiver.recv_timeout(Duration::from_secs(60))?;
    writeln!(
        file,
        "{}",
        serde_json::json!({"phase":"trigger","event":event})
    )?;
    file.flush()?;
    let claimed = broker.start(9001, &event.trigger_id);
    writeln!(
        file,
        "{}",
        serde_json::json!({"phase":"claim","result":claimed})
    )?;
    file.flush()?;
    let session_id = claimed
        .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?
        .session_id
        .ok_or("claim omitted session identity")?;
    std::thread::sleep(Duration::from_millis(delay));
    let result = broker.append(session_id, "", "Native café 🦀 你好.", true);
    writeln!(
        file,
        "{}",
        serde_json::json!({"phase":"append","result":result})
    )?;
    file.flush()?;
    if result.is_err() != expect_rejected {
        return Err("unexpected synthetic append outcome".into());
    }
    // Allow the browser test to read the DOM before exiting and dropping transport.
    std::thread::sleep(Duration::from_millis(300));
    Ok(())
}
