use super::AppState;
use crate::{
    error::{ApiJson, AppError, Result},
    keymap::{Keymap, KeymapPatch},
};
use axum::{Json, extract::State};
pub(super) async fn get(State(state): State<AppState>) -> Result<Json<Keymap>> {
    Ok(Json(state.keymap.load()?))
}
pub(super) async fn update(
    State(state): State<AppState>,
    ApiJson(patch): ApiJson<KeymapPatch>,
) -> Result<Json<Keymap>> {
    Ok(Json(state.keymap.update(patch).map_err(|error| {
        AppError::BadRequest(error.to_string())
    })?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn configuration_routes_share_sparse_persistence_and_reject_conflicts() {
        let home =
            std::env::temp_dir().join(format!("treefold-config-api-{}", uuid::Uuid::new_v4()));
        let state = AppState {
            store: crate::store::Store::open(&home.join("data")).await.unwrap(),
            settings: crate::settings::SettingsStore::open(&home).unwrap(),
            keymap: crate::keymap::KeymapStore::open(&home).unwrap(),
            terminals: crate::terminal::TerminalManager::default(),
            runtime: super::super::RuntimeHub::default(),
            integration: crate::integration::IntegrationManager::test(&home),
        };
        let router = super::super::app(state.clone());
        for (uri, json, expected) in [
            ("/api/settings", r#"{"theme":"dark"}"#, StatusCode::OK),
            (
                "/api/keymap",
                r#"{"bindings":{"session.close":false,"session.new":"cmd+n"}}"#,
                StatusCode::OK,
            ),
            (
                "/api/keymap",
                r#"{"bindings":{"session.close":"super+n"}}"#,
                StatusCode::BAD_REQUEST,
            ),
            (
                "/api/keymap",
                r#"{"bindings":{"session.new":null}}"#,
                StatusCode::OK,
            ),
        ] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("PATCH")
                        .uri(uri)
                        .header("content-type", "application/json")
                        .body(Body::from(json))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
        }
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/keymap")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let snapshot: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(snapshot["commands"][0]["binding"], "super+t");
        assert_eq!(snapshot["commands"][1]["binding"], false);
        let settings = std::fs::read_to_string(home.join("config/settings.toml")).unwrap();
        assert!(settings.contains("theme = \"dark\""));
        assert!(!settings.contains("language"));
        let keymap = std::fs::read_to_string(home.join("config/keymap.toml")).unwrap();
        assert!(keymap.contains("false"));
        assert!(!keymap.contains("session.new"));
        drop(state);
        std::fs::remove_dir_all(home).unwrap();
    }
}
