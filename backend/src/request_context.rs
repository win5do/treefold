//! Request-local correlation for the existing log facade. Never use a global current ID.
use std::future::Future;

use axum::{extract::Request, http::HeaderValue, middleware::Next, response::Response};
use tokio::task::JoinHandle;

tokio::task_local! { static REQUEST_ID: String; }

pub(crate) fn current_id() -> Option<String> {
    REQUEST_ID.try_with(Clone::clone).ok()
}

/// Capture before crossing a task boundary (including WebSocket upgrades).
pub(crate) fn inherit<F: Future>(future: F) -> impl Future<Output = F::Output> {
    let id = current_id();
    with_id(id, future)
}

pub(crate) async fn with_id<F: Future>(id: Option<String>, future: F) -> F::Output {
    match id {
        Some(id) => REQUEST_ID.scope(id, future).await,
        None => future.await,
    }
}

pub(crate) fn spawn<F>(future: F) -> JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    tokio::spawn(inherit(future))
}

pub(crate) fn spawn_blocking<F, T>(operation: F) -> JoinHandle<T>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    let id = current_id();
    tokio::task::spawn_blocking(move || match id {
        Some(id) => REQUEST_ID.sync_scope(id, operation),
        None => operation(),
    })
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub(crate) async fn correlate(request: Request, next: Next) -> Response {
    // Browser WebSocket/EventSource APIs cannot attach custom headers.
    let stream = request.uri().path() == "/api/events"
        || (request.uri().path().starts_with("/api/sessions/")
            && request.uri().path().ends_with("/terminal"));
    let query_id = stream
        .then(|| {
            request
                .uri()
                .query()
                .unwrap_or("")
                .split('&')
                .find_map(|part| part.strip_prefix("request_id="))
        })
        .flatten();
    let id = request
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .or(query_id)
        .filter(|id| valid_id(id))
        .map(str::to_owned)
        .unwrap_or_else(crate::ids::new_id);
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    REQUEST_ID
        .scope(id.clone(), async move {
            let started = std::time::Instant::now();
            let mut response = next.run(request).await;
            response
                .headers_mut()
                .insert("x-request-id", HeaderValue::from_str(&id).unwrap());
            let level = if response.status().is_server_error() {
                log::Level::Error
            } else if response.status().is_client_error() {
                log::Level::Warn
            } else if method == "GET" || method == "HEAD" || method == "OPTIONS" {
                log::Level::Debug
            } else {
                log::Level::Info
            };
            log::log!(
                level,
                "HTTP {} {} status={} elapsed_ms={}",
                method,
                path,
                response.status().as_u16(),
                started.elapsed().as_millis()
            );
            response
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, body::Body, middleware, routing::get};
    use tower::ServiceExt;

    #[tokio::test]
    async fn concurrent_requests_and_child_tasks_keep_their_own_id() {
        let app = Router::new()
            .route(
                "/",
                get(|| async {
                    let id = current_id().unwrap();
                    let child = spawn(async {
                        tokio::task::yield_now().await;
                        current_id()
                    });
                    let blocking = spawn_blocking(current_id);
                    assert_eq!(child.await.unwrap(), Some(id.clone()));
                    assert_eq!(blocking.await.unwrap(), Some(id.clone()));
                    id
                }),
            )
            .layer(middleware::from_fn(correlate));
        let run = |id| {
            app.clone().oneshot(
                Request::builder()
                    .uri("/")
                    .header("x-request-id", id)
                    .body(Body::empty())
                    .unwrap(),
            )
        };
        let (a, b) = tokio::join!(run("request-a"), run("request-b"));
        for (response, id) in [(a.unwrap(), "request-a"), (b.unwrap(), "request-b")] {
            assert_eq!(response.headers()["x-request-id"], id);
            assert_eq!(
                axum::body::to_bytes(response.into_body(), 1024)
                    .await
                    .unwrap(),
                id
            );
        }
        assert_eq!(current_id(), None);
    }

    #[tokio::test]
    async fn generated_ids_cover_errors_and_stream_queries_are_validated() {
        let app = Router::new().layer(middleware::from_fn(correlate));
        for (uri, header, expected) in [
            ("/missing", None, None),
            ("/missing", Some("bad id"), None),
            ("/missing?request_id=ignored", None, None),
            ("/api/events?request_id=stream-1", None, Some("stream-1")),
            (
                "/api/events?request_id=stream-1",
                Some("header-1"),
                Some("header-1"),
            ),
            (
                "/api/sessions/test/terminal?request_id=socket-1",
                None,
                Some("socket-1"),
            ),
        ] {
            let mut request = Request::builder().uri(uri);
            if let Some(header) = header {
                request = request.header("x-request-id", header);
            }
            let response = app
                .clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), 404);
            let id = response.headers()["x-request-id"].to_str().unwrap();
            if let Some(expected) = expected {
                assert_eq!(id, expected);
            } else {
                assert_eq!(id.len(), 32);
                assert!(valid_id(id));
            }
        }
    }
}
