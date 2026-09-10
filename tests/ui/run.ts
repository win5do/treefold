import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const excludedFiles = new Set(["run.ts", "ui-harness.ts"]);
const preferredOrder = [
  "sidebar.core.ts",
  "git-diff.ts",
  "git-changes.ts",
  "parent-operations.ts",
  "resources.ts",
  "agent-integration.ts",
  "dev-processes.ts",
];
const orderByFile = new Map(
  preferredOrder.map((file, index) => [file, index]),
);
const files = (await readdir(testDirectory))
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts") && !excludedFiles.has(file))
  .sort(
    (left, right) =>
      (orderByFile.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (orderByFile.get(right) ?? Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right),
  );

for (const file of files) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(testDirectory, file)], {
      cwd: path.resolve(testDirectory, "../.."),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${file} failed ${signal ? `with signal ${signal}` : `with exit code ${code}`}`,
        ),
      );
    });
  });
}
