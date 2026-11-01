use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

async fn finished(jobs: &Jobs, id: &str) -> Job {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let job = jobs.get(id).unwrap();
            if !matches!(job.status.as_str(), "queued" | "running") {
                return job;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn commands_read_stdin_without_shell_interpolation_and_report_failures() {
    let dir = tempfile::tempdir().unwrap();
    let message = "Fix $(touch should-not-exist) and `touch also-not`";
    assert_eq!(run("cat", message, dir.path()).await.unwrap(), message);
    assert!(!dir.path().join("should-not-exist").exists());
    assert!(
        run("printf fail >&2; exit 7", "", dir.path())
            .await
            .unwrap_err()
            .to_string()
            .contains("fail")
    );
    assert!(run("true", "", dir.path()).await.is_err());
    assert!(
        run("head -c 40000 /dev/zero", "", dir.path())
            .await
            .is_err()
    );
    assert_eq!(
        process::clean_message("```text\nFix greeting\n```").unwrap(),
        "Fix greeting"
    );
    assert_eq!(
        process::clean_message(
            "{\"type\":\"step_start\"}\n{\"type\":\"text\",\"part\":{\"text\":\"Fix greeting\"}}"
        )
        .unwrap(),
        "Fix greeting"
    );
    assert!(process::clean_message("{\"type\":\"error\",\"error\":\"auth\"}").is_err());
}

#[tokio::test]
async fn timeout_and_cancellation_stop_descendants() {
    for cancel in [true, false] {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("survived");
        let ready = dir.path().join("ready");
        let command = format!(
            "(sleep 0.4; touch {}) & touch {}; wait",
            shell_words::quote(&marker.to_string_lossy()),
            shell_words::quote(&ready.to_string_lossy())
        );
        let cwd = dir.path().to_owned();
        let jobs = Jobs::default();
        let job = jobs
            .start_with_timeout(
                async move { run(&command, "", &cwd).await },
                Duration::from_millis(if cancel { 2000 } else { 120 }),
            )
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while !ready.exists() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        if cancel {
            jobs.cancel(&job.id).unwrap();
        }
        assert_eq!(
            finished(&jobs, &job.id).await.status,
            if cancel { "canceled" } else { "timed_out" }
        );
        tokio::time::sleep(Duration::from_millis(550)).await;
        assert!(!marker.exists(), "child survived cancellation/timeout");
    }
}

#[tokio::test]
async fn independent_jobs_are_bounded_and_queued_cancellation_never_executes() {
    let jobs = Jobs::default();
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));
    let gate = Arc::new(Semaphore::new(0));
    let mut ids = vec![];
    for _ in 0..4 {
        let (active, maximum, gate) = (active.clone(), maximum.clone(), gate.clone());
        ids.push(
            jobs.start(async move {
                let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                maximum.fetch_max(count, Ordering::SeqCst);
                gate.acquire().await.unwrap().forget();
                active.fetch_sub(1, Ordering::SeqCst);
                Ok("Message".into())
            })
            .unwrap()
            .id,
        );
    }
    tokio::time::timeout(Duration::from_secs(2), async {
        while active.load(Ordering::SeqCst) < 3 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let queued = ids
        .iter()
        .find(|id| jobs.get(id).unwrap().status == "queued")
        .unwrap();
    jobs.cancel(queued).unwrap();
    gate.add_permits(4);
    for id in &ids {
        let _ = finished(&jobs, id).await;
    }
    assert_eq!(maximum.load(Ordering::SeqCst), 3);
    assert_eq!(jobs.get(queued).unwrap().status, "canceled");
}
