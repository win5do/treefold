fn main() {
    println!("cargo:rerun-if-changed=migrations");
    println!("cargo:rerun-if-env-changed=TREEFOLD_BUILD_VERSION");
}
