fn main() {
    println!("cargo:rerun-if-changed=migrations");
    println!("cargo:rerun-if-env-changed=TREEFOLD_BUILD_VERSION");
    println!("cargo:rerun-if-env-changed=TREEFOLD_AMUX_MANIFEST");
    println!("cargo:rerun-if-env-changed=TREEFOLD_RESOLVED_AMUX_MANIFEST");
    if let Some(configured) = std::env::var_os("TREEFOLD_AMUX_MANIFEST").filter(|s| !s.is_empty()) {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let expected = std::fs::canonicalize(root.join(configured))
            .expect("TREEFOLD_AMUX_MANIFEST must point to an existing amux Cargo.toml");
        let resolved = std::env::var_os("TREEFOLD_RESOLVED_AMUX_MANIFEST")
            .and_then(|path| std::fs::canonicalize(path).ok());
        assert_eq!(
            resolved.as_ref(),
            Some(&expected),
            "Use `cargo xtask backend <build|check|test|clippy|run>` or just recipes with TREEFOLD_AMUX_MANIFEST; raw Cargo does not apply this override"
        );
    }
}
