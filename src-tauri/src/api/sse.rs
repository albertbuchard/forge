use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream;
use std::{convert::Infallible, time::Duration};

pub async fn stream() -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let stream = stream::repeat_with(|| {
        Ok(Event::default().event("heartbeat").data(
            serde_json::json!({
                "transport": "sse",
                "backend": "forge-rust"
            })
            .to_string(),
        ))
    });

    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}
