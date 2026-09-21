use super::*;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

// Every fixture owns a private bus. Tests never send to the user's desktop or
// mutate the process-wide session bus environment, even under parallel cargo test.
struct Fixture {
    daemon: Child,
    address: String,
    observer: gio::DBusConnection,
    last_sender: Arc<Mutex<String>>,
    calls: Arc<AtomicU32>,
    main_loop: glib::MainLoop,
    thread: Option<JoinHandle<()>>,
}

fn connect(address: &str) -> gio::DBusConnection {
    gio::DBusConnection::for_address_sync(
        address,
        gio::DBusConnectionFlags::AUTHENTICATION_CLIENT
            | gio::DBusConnectionFlags::MESSAGE_BUS_CONNECTION,
        None,
        gio::Cancellable::NONE,
    )
    .unwrap()
}

impl Fixture {
    fn new() -> Self {
        let mut daemon = Command::new("dbus-daemon")
            .args(["--session", "--nofork", "--print-address=1"])
            .stdout(Stdio::piped())
            .spawn()
            .expect("private notification fixture needs dbus-daemon");
        let output = daemon.stdout.take().unwrap();
        let (address_tx, address_rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut address = String::new();
            BufReader::new(output).read_line(&mut address).unwrap();
            let _ = address_tx.send(address.trim().to_owned());
        });
        let address = match address_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(address) if !address.is_empty() => address,
            _ => {
                let _ = daemon.kill();
                let _ = daemon.wait();
                panic!("private notification bus did not start");
            }
        };
        let observer = connect(&address);
        let last_sender = Arc::new(Mutex::new(String::new()));
        let calls = Arc::new(AtomicU32::new(0));
        let context = glib::MainContext::new();
        let main_loop = glib::MainLoop::new(Some(&context), false);
        let mut fixture = Self {
            daemon,
            address,
            observer,
            last_sender,
            calls,
            main_loop,
            thread: None,
        };
        let address = fixture.address.clone();
        let last_sender = fixture.last_sender.clone();
        let calls = fixture.calls.clone();
        let main_loop = fixture.main_loop.clone();
        let (ready_tx, ready_rx) = mpsc::channel();
        fixture.thread = Some(std::thread::spawn(move || {
            context
                .with_thread_default(|| {
                    let connection = connect(&address);
                    connection
                        .call_sync(
                            Some("org.freedesktop.DBus"),
                            "/org/freedesktop/DBus",
                            "org.freedesktop.DBus",
                            "RequestName",
                            Some(&(SERVICE, 0u32).to_variant()),
                            None,
                            gio::DBusCallFlags::NONE,
                            1_000,
                            gio::Cancellable::NONE,
                        )
                        .unwrap();
                    let info = gio::DBusNodeInfo::for_xml(
                        r#"
                    <node><interface name="org.freedesktop.Notifications">
                      <method name="Notify">
                        <arg type="s" direction="in"/><arg type="u" direction="in"/>
                        <arg type="s" direction="in"/><arg type="s" direction="in"/>
                        <arg type="s" direction="in"/><arg type="as" direction="in"/>
                        <arg type="a{sv}" direction="in"/><arg type="i" direction="in"/>
                        <arg type="u" direction="out"/>
                      </method>
                    </interface></node>"#,
                    )
                    .unwrap()
                    .lookup_interface(SERVICE)
                    .unwrap();
                    let registration = connection
                        .register_object(
                            PATH,
                            &info,
                            move |_, sender, _, _, _, parameters, invocation| {
                                let count = calls.fetch_add(1, Ordering::SeqCst) + 1;
                                *last_sender.lock().unwrap() = sender.to_owned();
                                assert_eq!(parameters.type_().as_str(), "(susssasa{sv}i)");
                                assert_eq!(parameters.child_get::<String>(0), "VOCO");
                                assert_eq!(parameters.child_get::<u32>(1), 0);
                                assert_eq!(parameters.child_get::<String>(2), "voco");
                                assert!(parameters.child_get::<Vec<String>>(5).is_empty());
                                let hints =
                                    parameters.child_get::<HashMap<String, glib::Variant>>(6);
                                assert_eq!(
                                    hints["desktop-entry"].get::<String>().as_deref(),
                                    Some("VOCO")
                                );
                                assert_eq!(hints["urgency"].get::<u8>(), Some(1));
                                assert_eq!(parameters.child_get::<i32>(7), -1);
                                match parameters.child_get::<String>(3).as_str() {
                                    "reject" => invocation.return_dbus_error(
                                        "org.freedesktop.DBus.Error.Failed",
                                        "private server detail",
                                    ),
                                    "invalid" => {
                                        invocation.return_value(Some(&(0u32,).to_variant()))
                                    }
                                    "timeout" => {
                                        // Reply after the client's production deadline.
                                        std::thread::sleep(Duration::from_millis(3_500));
                                        invocation.return_value(Some(&(count,).to_variant()));
                                    }
                                    _ => invocation.return_value(Some(&(count,).to_variant())),
                                }
                            },
                            |_, _, _, _, _| false.to_variant(),
                            |_, _, _, _, _, _| false,
                        )
                        .unwrap();
                    let _ = ready_tx.send(());
                    main_loop.run();
                    connection.unregister_object(registration).unwrap();
                    connection.close_sync(gio::Cancellable::NONE).unwrap();
                })
                .unwrap();
        }));
        ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        fixture
    }

    fn send(&self, client: &Notifications, summary: &str) -> Result<(), NotificationError> {
        client.send_with(summary, "Synthetic notification", || {
            Ok(connect(&self.address))
        })
    }

    fn sender_alive(&self, sender: &str) -> bool {
        self.observer
            .call_sync(
                Some("org.freedesktop.DBus"),
                "/org/freedesktop/DBus",
                "org.freedesktop.DBus",
                "NameHasOwner",
                Some(&(sender,).to_variant()),
                None,
                gio::DBusCallFlags::NONE,
                1_000,
                gio::Cancellable::NONE,
            )
            .unwrap()
            .get::<(bool,)>()
            .unwrap()
            .0
    }

    fn sender(&self) -> String {
        self.last_sender.lock().unwrap().clone()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.main_loop.quit();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        let _ = self.observer.close_sync(gio::Cancellable::NONE);
        let _ = self.daemon.kill();
        let _ = self.daemon.wait();
    }
}

#[test]
fn retains_sender_between_notifications_and_reconnects_only_after_disconnect() {
    let fixture = Fixture::new();
    let client = Notifications(Mutex::new(None));
    fixture.send(&client, "first").unwrap();
    let first_sender = fixture.sender();
    assert!(
        fixture.sender_alive(&first_sender),
        "sender must outlive Notify"
    );
    client
        .send_with("second", "Synthetic notification", || {
            panic!("must reuse sender")
        })
        .unwrap();
    assert_eq!(fixture.sender(), first_sender);
    assert!(fixture.sender_alive(&first_sender));

    client
        .0
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .close_sync(gio::Cancellable::NONE)
        .unwrap();
    assert!(!fixture.sender_alive(&first_sender));
    fixture.send(&client, "after disconnect").unwrap();
    assert_ne!(fixture.sender(), first_sender);
    assert!(fixture.sender_alive(&fixture.sender()));
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 3);
}

#[test]
fn failures_are_finite_do_not_retry_and_do_not_poison_next_request() {
    let fixture = Fixture::new();
    let client = Notifications(Mutex::new(None));
    assert_eq!(
        fixture.send(&client, "reject"),
        Err(NotificationError::RequestFailed)
    );
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        fixture.send(&client, "invalid"),
        Err(NotificationError::InvalidReply)
    );
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 2);
    let started = Instant::now();
    assert_eq!(
        fixture.send(&client, "timeout"),
        Err(NotificationError::RequestFailed)
    );
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 3);
    fixture.send(&client, "next").unwrap();
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 4);
    assert_eq!(
        NotificationError::RequestFailed.event(),
        "desktop_notification_request_failed"
    );
}

#[test]
fn unavailable_connection_returns_a_fixed_error() {
    let client = Notifications(Mutex::new(None));
    let result = client.send_with("Synthetic", "Synthetic", || {
        Err(glib::Error::new(
            gio::IOErrorEnum::Failed,
            "private connection detail",
        ))
    });
    assert_eq!(result, Err(NotificationError::ConnectionUnavailable));
}
