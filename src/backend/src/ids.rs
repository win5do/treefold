/// Generate a time-ordered, lowercase, 32-character ID for persisted entities.
pub(crate) fn new_id() -> String {
    uuid::Uuid::now_v7().simple().to_string()
}

#[cfg(test)]
mod tests {
    use uuid::Version;

    use super::new_id;

    #[test]
    fn generated_ids_are_compact_monotonic_uuid_v7_values() {
        let first = new_id();
        let second = new_id();

        assert_eq!(first.len(), 32);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
        assert_eq!(first, first.to_ascii_lowercase());
        assert!(first < second);
        assert_eq!(
            uuid::Uuid::parse_str(&first).unwrap().get_version(),
            Some(Version::SortRand)
        );
    }
}
