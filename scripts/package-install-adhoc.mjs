import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");
const bundleConfigPath = path.join(root, "src-tauri", "tauri.bundle.conf.json");
const stagingRoot = path.join(root, "src-tauri", "bundle-staging");
const generatedConfigPath = path.join(stagingRoot, "package-install-adhoc.conf.json");
const sourceApp = path.join(
  root,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  "Treefold.app",
);

function timestamp() {
  const now = new Date();
  const part = (value, width = 2) => String(value).padStart(width, "0");
  return [
    part(now.getFullYear(), 4),
    part(now.getMonth() + 1),
    part(now.getDate()),
    part(now.getHours()),
    part(now.getMinutes()),
    part(now.getSeconds()),
  ].join("");
}

function buildVersion() {
  if (process.env.TREEFOLD_BUILD_VERSION) {
    return process.env.TREEFOLD_BUILD_VERSION;
  }
  const configured = JSON.parse(readFileSync(tauriConfigPath, "utf8")).version;
  const base = configured.split(/[+-]/, 1)[0];
  return `${base}-alpha.${timestamp()}`;
}

function validateVersion(version) {
  const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  if (!semver.test(version)) {
    throw new Error(`TREEFOLD_BUILD_VERSION must be valid SemVer, received: ${version}`);
  }
}

function macOSBundleVersion(version) {
  return version.match(/-alpha\.(\d{14})$/)?.[1] ?? version.split("-", 1)[0];
}

function verifyApp(appPath, expectedVersion) {
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
    stdio: "inherit",
  });
  const signatureResult = spawnSync("codesign", ["-dv", "--verbose=4", appPath], {
    encoding: "utf8",
  });
  if (signatureResult.status !== 0) {
    throw new Error(signatureResult.stderr || `Could not inspect signature for ${appPath}`);
  }
  const signature = `${signatureResult.stdout}${signatureResult.stderr}`;
  if (!signature.includes("Signature=adhoc")) {
    throw new Error("Packaged App is not ad-hoc signed");
  }
  const packagedVersion = execFileSync(
    "plutil",
    ["-extract", "CFBundleShortVersionString", "raw", path.join(appPath, "Contents", "Info.plist")],
    { encoding: "utf8" },
  ).trim();
  if (packagedVersion !== expectedVersion) {
    throw new Error(`Packaged App version ${packagedVersion} does not match ${expectedVersion}`);
  }
  const packagedBundleVersion = execFileSync(
    "plutil",
    ["-extract", "CFBundleVersion", "raw", path.join(appPath, "Contents", "Info.plist")],
    { encoding: "utf8" },
  ).trim();
  const expectedBundleVersion = macOSBundleVersion(expectedVersion);
  if (packagedBundleVersion !== expectedBundleVersion) {
    throw new Error(
      `Packaged App bundle version ${packagedBundleVersion} does not match ${expectedBundleVersion}`,
    );
  }
}

function installApp(appPath) {
  const installDir = path.resolve(process.env.TREEFOLD_INSTALL_DIR ?? "/Applications");
  const installedApp = path.join(installDir, "Treefold.app");
  const running = spawnSync("pgrep", ["-f", `${installedApp}/Contents/MacOS/`], {
    stdio: "ignore",
  }).status === 0;
  if (running) {
    throw new Error(`Quit the installed Treefold App before replacing ${installedApp}`);
  }

  mkdirSync(installDir, { recursive: true });
  const transaction = mkdtempSync(path.join(installDir, ".treefold-install-"));
  const stagedApp = path.join(transaction, "Treefold.app");
  const previousApp = path.join(transaction, "Treefold.previous.app");
  let previousMoved = false;
  try {
    execFileSync("ditto", [appPath, stagedApp], { stdio: "inherit" });
    if (existsSync(installedApp)) {
      renameSync(installedApp, previousApp);
      previousMoved = true;
    }
    renameSync(stagedApp, installedApp);
    verifyApp(installedApp, version);
    rmSync(previousApp, { recursive: true, force: true });
    previousMoved = false;
  } catch (error) {
    if (existsSync(installedApp)) {
      rmSync(installedApp, { recursive: true, force: true });
    }
    if (previousMoved) {
      renameSync(previousApp, installedApp);
      previousMoved = false;
    }
    throw error;
  } finally {
    rmSync(transaction, { recursive: true, force: true });
  }
  return installedApp;
}

if (process.platform !== "darwin") {
  throw new Error("Ad-hoc App packaging and installation is supported only on macOS");
}

const version = buildVersion();
validateVersion(version);
const environment = { ...process.env, TREEFOLD_BUILD_VERSION: version };

execFileSync("npm", ["run", "prepare:sidecars"], {
  cwd: root,
  env: environment,
  stdio: "inherit",
});

const bundleConfig = JSON.parse(readFileSync(bundleConfigPath, "utf8"));
bundleConfig.version = version;
bundleConfig.bundle.macOS = {
  ...(bundleConfig.bundle.macOS ?? {}),
  bundleVersion: macOSBundleVersion(version),
  signingIdentity: "-",
};
mkdirSync(stagingRoot, { recursive: true });
writeFileSync(generatedConfigPath, `${JSON.stringify(bundleConfig, null, 2)}\n`);

execFileSync(
  "npm",
  ["run", "tauri", "--", "build", "--config", generatedConfigPath, "--bundles", "app,dmg"],
  { cwd: root, env: environment, stdio: "inherit" },
);

verifyApp(sourceApp, version);
const installedApp = installApp(sourceApp);
const dmgDir = path.join(root, "src-tauri", "target", "release", "bundle", "dmg");
const dmg = readdirSync(dmgDir)
  .filter((name) => name.endsWith(".dmg") && name.includes(version))
  .map((name) => path.join(dmgDir, name))
  .at(0);

console.log(`Installed Treefold ${version} at ${installedApp}`);
if (dmg) console.log(`Packaged DMG: ${dmg}`);
