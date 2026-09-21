//! Desktop notifications retain their D-Bus sender for the application's lifetime.
use glib::variant::ToVariant;
use std::collections::HashMap;
use std::sync::Mutex;
use webkit2gtk::gio;

const SERVICE: &str = "org.freedesktop.Notifications";
const PATH: &str = "/org/freedesktop/Notifications";
const CALL_TIMEOUT_MS: i32 = 3_000;
static NOTIFICATIONS: Notifications = Notifications(Mutex::new(None));

#[derive(Debug, PartialEq, Eq)]
pub enum NotificationError {
    ConnectionUnavailable,
    RequestFailed,
    InvalidReply,
}

impl NotificationError {
    pub fn event(&self) -> &'static str {
        match self {
            Self::ConnectionUnavailable => "desktop_notification_connection_unavailable",
            Self::RequestFailed => "desktop_notification_request_failed",
            Self::InvalidReply => "desktop_notification_invalid_reply",
        }
    }
}

struct Notifications(Mutex<Option<gio::DBusConnection>>);

impl Notifications {
    fn send_with(
        &self,
        summary: &str,
        body: &str,
        connect: impl FnOnce() -> Result<gio::DBusConnection, glib::Error>,
    ) -> Result<(), NotificationError> {
        let connection = {
            let mut cached = self
                .0
                .lock()
                .map_err(|_| NotificationError::ConnectionUnavailable)?;
            if cached.as_ref().is_none_or(|bus| bus.is_closed()) {
                *cached = Some(connect().map_err(|_| NotificationError::ConnectionUnavailable)?);
            }
            // GNOME removes registered-app notifications when their sender vanishes.
            // Retain the connection after this call; a short-lived helper is insufficient.
            cached.as_ref().unwrap().clone()
        };
        let hints = HashMap::from([
            ("desktop-entry", "VOCO".to_variant()),
            ("urgency", 1u8.to_variant()),
        ]);
        let parameters = (
            "VOCO",
            0u32,
            "voco",
            summary,
            body,
            Vec::<String>::new(),
            hints,
            -1i32,
        )
            .to_variant();
        // No retry: an unanswered request may already have displayed a notification.
        let reply = connection
            .call_sync(
                Some(SERVICE),
                PATH,
                SERVICE,
                "Notify",
                Some(&parameters),
                None,
                gio::DBusCallFlags::NONE,
                CALL_TIMEOUT_MS,
                gio::Cancellable::NONE,
            )
            .map_err(|_| NotificationError::RequestFailed)?;
        match reply.get::<(u32,)>() {
            Some((id,)) if id != 0 => Ok(()),
            _ => Err(NotificationError::InvalidReply),
        }
    }
}

pub fn send(summary: &str, body: &str) -> Result<(), NotificationError> {
    NOTIFICATIONS.send_with(summary, body, || {
        gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE)
    })
}

#[cfg(test)]
#[path = "../tests/desktop_notifications/mod.rs"]
mod tests;
