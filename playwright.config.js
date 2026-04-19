import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('@playwright/test').PlaywrightTestConfig} */
export default {
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  webServer: {
    command: "python3 -m http.server 8765 --bind 127.0.0.1",
    cwd: path.join(repoRoot, "tests/fixtures"),
    url: "http://127.0.0.1:8765/article.html",
    reuseExistingServer: !process.env.CI,
  },
};
