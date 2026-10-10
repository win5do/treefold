use super::*;
use crate::{
    keymap::KeymapStore, settings::SettingsStore, store::Store, terminal::TerminalManager,
};
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::{Value, json};
use tower::ServiceExt;

async fn test_state(root: &Path) -> AppState {
    let home = root.join("home");
    AppState {
        store: Store::open(&home.join("data")).await.unwrap(),
        settings: SettingsStore::open(&home).unwrap(),
        keymap: KeymapStore::open(&home).unwrap(),
        terminals: TerminalManager::default().with_treefold_home(home.clone()),
        runtime: super::super::RuntimeHub::default(),
        integration: crate::integration::IntegrationManager::test(&home),
    }
}

async fn post(state: &AppState, route: &str, input: Value) -> (StatusCode, Value) {
    let response = super::super::app(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(route)
                .header("content-type", "application/json")
                .body(Body::from(input.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    (status, body)
}

#[tokio::test]
async fn empty_source_validates_without_writes_then_initializes_an_unborn_repository() {
    let temp = tempfile::tempdir().unwrap();
    let state = test_state(temp.path()).await;
    let input =
        json!({"name": "new-project", "source": {"kind": "empty", "parent_path": temp.path()}});
    let (status, validation) = post(&state, "/api/projects/validate-source", input.clone()).await;
    assert_eq!(status, StatusCode::OK, "{validation}");
    assert!(!temp.path().join("new-project").exists());
    assert!(state.store.projects().await.unwrap().is_empty());
    let (status, created) = post(&state, "/api/projects", input).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let repo = temp.path().join("new-project");
    assert!(repo.join(".git").is_dir());
    assert!(crate::git::output(&repo, &["rev-parse", "--verify", "HEAD"]).is_err());
    let project_id = created["id"].as_str().unwrap();
    let project = state.store.project(project_id).await.unwrap();
    assert_eq!(
        project.open_path.as_deref(),
        repo.canonicalize().unwrap().to_str()
    );
    assert!(project.default_location_id.is_some());
    let repositories = state.store.repositories(project_id).await.unwrap();
    assert_eq!(repositories.len(), 1);
    assert_eq!(repositories[0].source_ownership, "external");
    let detail = super::super::workspace::get_project(
        State(state),
        axum::extract::Path(project_id.to_owned()),
    )
    .await
    .unwrap();
    assert_eq!(detail.0.project.id, project_id);
}

#[tokio::test]
async fn empty_source_rechecks_collisions_and_never_touches_existing_files() {
    let temp = tempfile::tempdir().unwrap();
    let state = test_state(temp.path()).await;
    let input =
        json!({"name": "existing", "source": {"kind": "empty", "parent_path": temp.path()}});
    assert_eq!(
        post(&state, "/api/projects/validate-source", input.clone())
            .await
            .0,
        StatusCode::OK
    );
    std::fs::create_dir(temp.path().join("existing")).unwrap();
    std::fs::write(temp.path().join("existing/keep.txt"), "keep").unwrap();
    for endpoint in ["/api/projects/validate-source", "/api/projects"] {
        let (status, body) = post(&state, endpoint, input.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(body["error"]["code"], "PROJECT_DESTINATION_EXISTS");
    }
    assert_eq!(
        std::fs::read_to_string(temp.path().join("existing/keep.txt")).unwrap(),
        "keep"
    );
    assert!(!temp.path().join("existing/.git").exists());
    for name in ["../escape", ".", "..", "a/b", "a\\b", ""] {
        let input = json!({"name": name, "source": {"kind": "empty", "parent_path": temp.path()}});
        assert_eq!(
            post(&state, "/api/projects", input).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    std::os::unix::fs::symlink(temp.path().join("missing"), temp.path().join("link")).unwrap();
    let input = json!({"name": "link", "source": {"kind": "empty", "parent_path": temp.path()}});
    assert_eq!(
        post(&state, "/api/projects", input).await.0,
        StatusCode::BAD_REQUEST
    );
    assert!(state.store.projects().await.unwrap().is_empty());
}

#[tokio::test]
async fn git_url_source_validates_and_clones_into_a_managed_project() {
    let temp = tempfile::tempdir().unwrap();
    let state = test_state(temp.path()).await;
    let remote = temp.path().join("remote.git");
    std::fs::create_dir(&remote).unwrap();
    crate::git::output(&remote, &["init", "--bare"]).unwrap();
    let url = format!("file://{}", remote.display());
    let input = json!({"name": "Cloned Project", "source": {"kind": "git_url", "url": url}});
    assert_eq!(
        post(&state, "/api/projects/validate-source", input.clone())
            .await
            .0,
        StatusCode::OK
    );
    assert!(state.store.projects().await.unwrap().is_empty());
    let (status, body) = post(&state, "/api/projects", input).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let repositories = state
        .store
        .repositories(body["id"].as_str().unwrap())
        .await
        .unwrap();
    assert_eq!(repositories.len(), 1);
    assert_eq!(repositories[0].source_ownership, "managed");
    assert_eq!(body["open_path"], repositories[0].source_root);
    assert!(
        Path::new(&repositories[0].source_root)
            .join(".git")
            .is_dir()
    );
    assert_eq!(
        repositories[0].repository_url.as_deref(),
        Some(url.as_str())
    );
}

#[tokio::test]
async fn clone_failure_rolls_back_the_project_and_rejects_ambiguous_sources() {
    let temp = tempfile::tempdir().unwrap();
    let state = test_state(temp.path()).await;
    let url = format!("file://{}/missing.git", temp.path().display());
    let input = json!({"name": "Missing", "source": {"kind": "git_url", "url": url}});
    let (status, error) = post(&state, "/api/projects/validate-source", input.clone()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error["error"]["code"], "GIT_REMOTE_UNAVAILABLE");
    assert_eq!(
        post(&state, "/api/projects", input).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        post(
            &state,
            "/api/projects",
            json!({"name":"Invalid", "source":{"kind":"unknown"}})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    for source in [
        json!({"kind":"git_url", "url":"ext::id"}),
        json!({"kind":"git_url", "url":"--upload-pack=anything"}),
        json!({"kind":"git_url", "url":"relative/path"}),
    ] {
        assert_eq!(
            post(
                &state,
                "/api/projects",
                json!({"name":"Invalid", "source":source})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    let input = json!({"name":"Ambiguous", "locations":[], "source":{"kind":"empty","parent_path":temp.path()}});
    assert_eq!(
        post(&state, "/api/projects", input).await.0,
        StatusCode::BAD_REQUEST
    );
    assert!(state.store.projects().await.unwrap().is_empty());
    let sources = state.settings.treefold_home().join("git/s");
    assert!(!sources.exists() || std::fs::read_dir(sources).unwrap().next().is_none());
}

#[tokio::test]
async fn existing_local_creation_payload_is_still_supported() {
    let temp = tempfile::tempdir().unwrap();
    let state = test_state(temp.path()).await;
    let repo = temp.path().join("local");
    std::fs::create_dir(&repo).unwrap();
    crate::git::output(&repo, &["init"]).unwrap();
    let (status, body) = post(
        &state,
        "/api/projects",
        json!({"name":"Local", "locations":[repo]}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(state.store.projects().await.unwrap().len(), 1);
}

#[tokio::test]
async fn empty_source_rejects_invalid_or_unwritable_parent_directories() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let state = test_state(temp.path()).await;
    let file = temp.path().join("file");
    std::fs::write(&file, "keep").unwrap();
    for parent in [file, temp.path().join("missing"), PathBuf::from("relative")] {
        let (status, body) = post(
            &state,
            "/api/projects/validate-source",
            json!({"name":"new", "source":{"kind":"empty", "parent_path":parent}}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(body["error"]["code"], "INVALID_PROJECT_PARENT");
    }
    let readonly = temp.path().join("readonly");
    std::fs::create_dir(&readonly).unwrap();
    std::fs::set_permissions(&readonly, std::fs::Permissions::from_mode(0o555)).unwrap();
    let result = post(
        &state,
        "/api/projects/validate-source",
        json!({"name":"new", "source":{"kind":"empty", "parent_path":readonly}}),
    )
    .await;
    std::fs::set_permissions(&readonly, std::fs::Permissions::from_mode(0o755)).unwrap();
    // Root can write regardless of mode bits; normal desktop users cannot.
    if unsafe { libc::getuid() } != 0 {
        assert_eq!(result.0, StatusCode::BAD_REQUEST);
        assert_eq!(result.1["error"]["code"], "PROJECT_PARENT_NOT_WRITABLE");
    }
    assert!(!readonly.join("new").exists());
}
