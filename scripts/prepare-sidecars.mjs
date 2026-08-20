import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const amuxRoot = path.dirname(amuxManifest);
const amuxSkill = path.join(amuxRoot, "skills", "amux");
if (!existsSync(path.join(amuxSkill, "SKILL.md"))) {
  throw new Error(`amux Skill is required at ${amuxSkill}`);
}

const amuxCargoToml = readFileSync(amuxManifest, "utf8");
const packageStart = amuxCargoToml.search(/^\[package\]\s*$/m);
const packageBody = packageStart < 0
  ? ""
  : amuxCargoToml.slice(packageStart + "[package]".length);
const nextSection = packageBody.search(/^\[/m);
const packageSection = nextSection < 0
  ? packageBody
  : packageBody.slice(0, nextSection);
const amuxVersion = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
if (!amuxVersion) {
  throw new Error(`Could not determine the amux package version from ${amuxManifest}`);
}

execFileSync("cargo", ["build", "--release", "--target", host, "--bin", "amux", "--manifest-path", amuxManifest], { stdio: "inherit" });
copyFileSync(
  path.join(amuxRoot, "target", host, "release", "amux"),
  path.join(destination, `amux-${host}`),
);

const integrationSource = path.join(root, "src-tauri", "resources", "agent-integration");
const integrationStaging = path.join(root, "src-tauri", "bundle-staging", "agent-integration");
const stagedAmuxSkill = path.join(integrationStaging, "skills", "amux");
rmSync(integrationStaging, { recursive: true, force: true });
mkdirSync(path.dirname(stagedAmuxSkill), { recursive: true });
cpSync(amuxSkill, stagedAmuxSkill, { recursive: true });

const integrationManifest = JSON.parse(
  readFileSync(path.join(integrationSource, "manifest.json"), "utf8"),
);
integrationManifest.components.amux_cli = amuxVersion;
integrationManifest.components.amux_skill = amuxVersion;
writeFileSync(
  path.join(integrationStaging, "manifest.json"),
  `${JSON.stringify(integrationManifest, null, 2)}\n`,
);
