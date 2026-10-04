import { spawn } from "node:child_process";

export default function treefold(pi) {
  pi.on("session_start", async (event, ctx) => {
    if (!["startup", "resume", "reload"].includes(event.reason)) return;
    const id = ctx.sessionManager.getSessionId();
    const executable = process.env.TREEFOLD_AGENT_HOOK;
    if (!executable || !id) return;
    const child = spawn(executable, ["--agent-hook", "pi"], { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ session_id: id }));
  });
}
