use super::*;
use crate::{keymap::KeymapStore, settings::SettingsStore, terminal::TerminalManager};
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;

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

#[tokio::test]
async fn resolves_registered_directories_without_importing_unknown_paths() {
    let root = tempfile::tempdir().unwrap();
    let state = test_state(root.path()).await;
    let repo = root.path().join("repo");
    std::fs::create_dir_all(repo.join("nested/src")).unwrap();
    crate::git::output(&repo, &["init", "-b", "main"]).unwrap();
    crate::git::output(
        &repo,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.test",
            "commit",
            "--allow-empty",
            "-m",
            "initial",
        ],
    )
    .unwrap();
    let sibling = root.path().join("repo-other");
    std::fs::create_dir(&sibling).unwrap();
    let (status, unknown) = post(&state, "/api/projects/resolve-path", json!({"path": repo})).await;
    assert_eq!(status, StatusCode::OK);
    assert!(unknown["project_id"].is_null());
    assert!(state.store.projects().await.unwrap().is_empty());
    let (status, project) = post(
        &state,
        "/api/projects",
        json!({"name": "Repo", "path": repo}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{project}");
    let (status, workspace) = post(
        &state,
        &format!(
            "/api/projects/{}/workspaces",
            project["id"].as_str().unwrap()
        ),
        json!({"generated_branch": "feature/open"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{workspace}");
    let workspace_path = state
        .store
        .workspace_directories(workspace["id"].as_str().unwrap())
        .await
        .unwrap()[0]
        .path
        .clone();
    let (_, result) = post(
        &state,
        "/api/projects/resolve-path",
        json!({"path": workspace_path}),
    )
    .await;
    assert_eq!(result["project_id"], project["id"]);
    for path in [&repo, &repo.join("nested/src")] {
        let (status, result) =
            post(&state, "/api/projects/resolve-path", json!({"path": path})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result["project_id"], project["id"]);
    }
    let alias = root.path().join("alias");
    std::os::unix::fs::symlink(&repo, &alias).unwrap();
    let (_, result) = post(
        &state,
        "/api/projects/resolve-path",
        json!({"path": alias.join("nested")}),
    )
    .await;
    assert_eq!(result["project_id"], project["id"]);
    assert_eq!(
        result["path"],
        repo.join("nested")
            .canonicalize()
            .unwrap()
            .to_str()
            .unwrap()
    );
    let (_, result) = post(
        &state,
        "/api/projects/resolve-path",
        json!({"path": sibling}),
    )
    .await;
    assert!(result["project_id"].is_null());
    // A more specific registered scope wins over its parent Project.
    let (status, nested) = post(
        &state,
        "/api/projects",
        json!({"name": "Nested", "path": repo.join("nested")}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{nested}");
    let (_, result) = post(
        &state,
        "/api/projects/resolve-path",
        json!({"path": repo.join("nested/src")}),
    )
    .await;
    assert_eq!(result["project_id"], nested["id"]);
    state
        .store
        .update_project_status(nested["id"].as_str().unwrap(), "archived")
        .await
        .unwrap();
    let (_, result) = post(
        &state,
        "/api/projects/resolve-path",
        json!({"path": repo.join("nested")}),
    )
    .await;
    assert_eq!(result["project_id"], nested["id"]);
    assert_eq!(
        state
            .store
            .project(nested["id"].as_str().unwrap())
            .await
            .unwrap()
            .status,
        "archived"
    );
    for path in [
        "relative".to_owned(),
        root.path().join("missing").to_string_lossy().into_owned(),
    ] {
        assert_eq!(
            post(&state, "/api/projects/resolve-path", json!({"path": path}))
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(state.store.projects().await.unwrap().len(), 2);
}

#[tokio::test]
async fn resolves_imported_containers_with_real_or_symlinked_children() {
    for symlinks in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let state = test_state(root.path()).await;
        let container = root.path().join("cps-dev");
        std::fs::create_dir(&container).unwrap();
        for name in ["fe-cps", "hacking-cps"] {
            let repo = if symlinks {
                root.path().join(name)
            } else {
                container.join(name)
            };
            std::fs::create_dir(&repo).unwrap();
            crate::git::output(&repo, &["init", "-b", "main"]).unwrap();
            if symlinks {
                std::os::unix::fs::symlink(&repo, container.join(name)).unwrap();
            }
        }
        let route = "/api/projects/resolve-path";
        let input = json!({"path": container});
        let (_, result) = post(&state, route, input.clone()).await;
        assert!(result["project_id"].is_null());

        // Children split across different Projects must not select an arbitrary one.
        let inspection = inspect_project_path_value(container.to_str().unwrap()).unwrap();
        let locations = inspection
            .candidates
            .iter()
            .map(|candidate| candidate.path.clone())
            .collect::<Vec<_>>();
        for (index, location) in locations.iter().enumerate() {
            let (status, project) = post(
                &state,
                "/api/projects",
                json!({"name": format!("Separate {index}"), "locations": [location]}),
            )
            .await;
            assert_eq!(status, StatusCode::CREATED, "{project}");
            let (_, result) = post(&state, route, input.clone()).await;
            assert!(result["project_id"].is_null());
        }
        let (status, project) = post(
            &state,
            "/api/projects",
            json!({"name": "cps-dev", "locations": locations}),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{project}");
        for _ in 0..3 {
            let (status, result) = post(&state, route, input.clone()).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(result["project_id"], project["id"]);
        }
        assert_eq!(state.store.projects().await.unwrap().len(), 3);

        // An unregistered child means the current scan is not fully imported.
        std::fs::create_dir(container.join("new-context")).unwrap();
        let (_, result) = post(&state, route, input).await;
        assert!(result["project_id"].is_null());
        let empty = root.path().join("empty");
        std::fs::create_dir(&empty).unwrap();
        let (_, result) = post(&state, route, json!({"path": empty})).await;
        assert!(result["project_id"].is_null());
        assert_eq!(state.store.projects().await.unwrap().len(), 3);
    }
}

#[tokio::test]
async fn explicit_open_path_survives_partial_import_and_reopening_the_database() {
    let root = tempfile::tempdir().unwrap();
    let state = test_state(root.path()).await;
    let container = root.path().join("cps-dev");
    std::fs::create_dir(&container).unwrap();
    let mut real_repos = Vec::new();
    for name in ["fe-cps", "hacking-cps"] {
        let repo = root.path().join(name);
        std::fs::create_dir(&repo).unwrap();
        crate::git::output(&repo, &["init"]).unwrap();
        std::os::unix::fs::symlink(&repo, container.join(name)).unwrap();
        real_repos.push(repo.canonicalize().unwrap());
    }
    let (status, project) = post(
        &state,
        "/api/projects",
        json!({
            "name": "CPS", "open_path": container, "locations": [container.join("fe-cps")]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{project}");
    let id = project["id"].as_str().unwrap();
    assert_eq!(
        project["open_path"],
        container.canonicalize().unwrap().to_str().unwrap()
    );
    assert_eq!(
        state.store.directories(id).await.unwrap()[0].path,
        real_repos[0].to_str().unwrap()
    );
    assert_eq!(
        state.store.repositories(id).await.unwrap()[0].source_root,
        real_repos[0].to_str().unwrap()
    );
    // The discovery result can change without losing the explicitly saved entry.
    std::fs::create_dir(container.join("new-context")).unwrap();
    // An inferred container match must not override the explicit Project entry.
    let (status, _) = post(&state, "/api/projects", json!({
        "name": "Other", "locations": [container.join("fe-cps"), container.join("hacking-cps"), container.join("new-context")]
    })).await;
    assert_eq!(status, StatusCode::CREATED);
    state.store.pool.close().await;
    let store = Store::open(&root.path().join("home/data")).await.unwrap();
    for _ in 0..3 {
        let result = resolve_path(&store, container.to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(result.project_id.as_deref(), Some(id));
    }
    assert_eq!(store.projects().await.unwrap().len(), 2);
}
