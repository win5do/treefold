const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

class Backend {
  constructor({ executable, env, onExit = () => {}, onStderr = () => {}, timeout = 30000 }) {
    Object.assign(this, { executable, env, onExit, onStderr, timeout });
    this.stopping = false;
    this.diagnostic = '';
  }
  async start() {
    this.child = spawn(this.executable, [], {
      env: { ...this.env, TREEFOLD_PARENT_PIPE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.child.stdin.on('error', () => {});
    this.exited = new Promise(resolve => {
      this.child.once('close', (code, signal) => {
        resolve();
        if (!this.stopping) this.onExit(new Error(this.withDiagnostics(`Rust backend exited (${signal || code})`)));
      });
      this.child.once('error', resolve);
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', data => {
      this.diagnostic = (this.diagnostic + data).slice(-8192);
      this.onStderr(data.trimEnd());
    });
    try {
      const apiUrl = await new Promise((resolve, reject) => {
        const lines = createInterface({ input: this.child.stdout });
        const timer = setTimeout(() => finish(new Error('Rust backend startup timed out')), this.timeout);
        const finish = (error, value) => {
          clearTimeout(timer); lines.close(); this.child.stdout.resume();
          this.child.removeListener('error', failed);
          this.child.removeListener('close', exited);
          error ? reject(error) : resolve(value);
        };
        const failed = error => finish(error);
        const exited = () => finish(new Error('Rust backend could not start.'));
        this.child.once('error', failed);
        this.child.once('close', exited);
        lines.on('line', line => {
          try {
            const event = JSON.parse(line);
            if (event.event !== 'listening') return;
            const url = new URL(event.api_url);
            if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)) {
              finish(new Error('Rust backend must listen on a loopback HTTP address'));
              return;
            }
            finish(null, url.origin);
          } catch { /* Non-protocol output is not a readiness signal. */ }
        });
      });
      // The listener announcement precedes amux reconciliation; wait for HTTP readiness.
      const deadline = Date.now() + this.timeout;
      while (Date.now() < deadline && this.child.exitCode === null && !this.child.signalCode) {
        try {
          const response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
          if (response.ok) { this.apiUrl = apiUrl; return apiUrl; }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Rust API did not become healthy.');
    } catch (error) {
      await this.stop();
      throw new Error(this.withDiagnostics(error.message), { cause: error });
    }
  }
  withDiagnostics(message) {
    const recent = this.diagnostic.trim();
    return recent ? `${message}\nRecent backend stderr:\n${recent}` : message;
  }
  async stop() {
    this.stopping = true;
    if (!this.child || this.child.exitCode !== null || this.child.signalCode) return;
    this.child.stdin.end('q');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 10000);
    try { await this.exited; } finally { clearTimeout(timer); }
  }
}
module.exports = { Backend };
