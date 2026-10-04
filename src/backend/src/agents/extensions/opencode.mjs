import { spawn } from "node:child_process";

// OpenCode 2 CLI plugin API: setup(context), local to this terminal.
export default {
  id: "treefold.session",
  setup(context) {
    let reported;
    const report = () => {
      const route = context.ui.router.current();
      if (route.type !== "session") return;
      const id = route.sessionID;
      const session = context.data.session.get(id);
      if (!session || context.data.session.root(id) !== id || reported === id) return;
      const executable = process.env.TREEFOLD_AGENT_HOOK;
      if (!executable) return;
      const child = spawn(executable, ["--agent-hook", "opencode"], { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => { reported = undefined; });
      child.stdin.on("error", () => { reported = undefined; });
      child.stdin.end(JSON.stringify({ session_id: id }));
      reported = id;
    };
    const timer = setInterval(report, 250);
    report();
    return () => clearInterval(timer);
  },
};
