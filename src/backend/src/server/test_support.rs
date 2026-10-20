use super::AppState;
use crate::{
    integration::IntegrationManager, keymap::KeymapStore, settings::SettingsStore, store::Store,
    terminal::TerminalManager,
};
use std::path::Path;

/// Open isolated test state, retaining the caller's terminal configuration.
pub(super) async fn app_state(home: &Path, terminals: TerminalManager) -> AppState {
    AppState::new(
        Store::open(&home.join("data"))
            .await
            .expect("open test Store"),
        SettingsStore::open(home).expect("open test Settings"),
        KeymapStore::open(home).expect("open test Keymap"),
        terminals,
        IntegrationManager::test(home),
    )
}
