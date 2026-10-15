//! Bounded parallelism for independent, blocking repository reads.
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

pub(crate) const REPOSITORY_CONCURRENCY: usize = 4;

pub(crate) fn map<T: Sync, R: Send>(items: &[T], operation: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let next = AtomicUsize::new(0);
    let results: Vec<_> = items.iter().map(|_| Mutex::new(None)).collect();
    std::thread::scope(|scope| {
        for _ in 0..items.len().min(REPOSITORY_CONCURRENCY) {
            scope.spawn(|| {
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some(item) = items.get(index) else { break };
                    *results[index].lock().unwrap() = Some(operation(item));
                }
            });
        }
    });
    results
        .into_iter()
        .map(|result| result.into_inner().unwrap().unwrap())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_workers_and_preserves_input_order() {
        let barrier = std::sync::Barrier::new(REPOSITORY_CONCURRENCY);
        let active = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let input: Vec<_> = (0..12).collect();
        let output = map(&input, |value| {
            let count = active.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(count, Ordering::SeqCst);
            barrier.wait();
            active.fetch_sub(1, Ordering::SeqCst);
            value * 2
        });
        assert_eq!(peak.load(Ordering::SeqCst), REPOSITORY_CONCURRENCY);
        assert_eq!(
            output,
            input.iter().map(|value| value * 2).collect::<Vec<_>>()
        );
    }
}
