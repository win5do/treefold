import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
  .match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error("Could not determine the Rust host target");

const destination = path.join(root, "src-tauri", "binaries");
mkdirSync(destination, { recursive: true });

execFileSync("cargo", [
  "build", "--release", "--target", host,
  "--manifest-path", path.join(root, "cli", "Cargo.toml"),
], { stdio: "inherit" });
copyFileSync(
  path.join(root, "cli", "target", host, "release", "treefold"),
  path.join(destination, `treefold-${host}`),
);

const amuxManifest = process.env.TREEFOLD_AMUX_MANIFEST
  ?? path.resolve(root, "..", "amux", "Cargo.toml");
if (!existsSync(amuxManifest)) {
  throw new Error("amux source is required to build the private sidecar; set TREEFOLD_AMUX_MANIFEST");
}
execFileSync("cargo", ["build", "--release", "--target", host, "--bin", "amux", "--manifest-path", amuxManifest], { stdio: "inherit" });
copyFileSync(
  path.join(path.dirname(amuxManifest), "target", host, "release", "amux"),
  path.join(destination, `amux-${host}`),
);
