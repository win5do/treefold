import { remote } from "webdriverio";


const DEFAULT_CHROME_ARGS = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
];
const DEFAULT_BROWSER_TRANSPORT = process.env.TREEFOLD_UI_TRANSPORT || "chrome";
const DEFAULT_BROWSER_WINDOW_SIZE =
  process.env.TREEFOLD_BROWSER_WINDOW_SIZE || "1400,900";

const defaultConfig = {
  transport: DEFAULT_BROWSER_TRANSPORT,
  logLevel: process.env.TREEFOLD_UI_WEBDRIVER_LOG_LEVEL || "error",
  browser: {
    capabilities: {
      browserName: process.env.TREEFOLD_BROWSER_NAME || "chrome",
      "goog:chromeOptions": {
        args: parseChromeArgs(process.env.TREEFOLD_CHROME_ARGS),
      },
    },
  },
  webdriver: {
    host: process.env.TREEFOLD_WEBDRIVER_HOST,
    port: Number.parseInt(process.env.TREEFOLD_WEBDRIVER_PORT || "", 10),
    path: process.env.TREEFOLD_WEBDRIVER_PATH || undefined,
  },
  screenshotDir: process.env.TREEFOLD_UI_SCREENSHOT_DIR || "/tmp",
};

function parseChromeArgs(rawValue) {
  if (!rawValue) return DEFAULT_CHROME_ARGS;
  return rawValue
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeWindowSizeArg(args, windowSize) {
  const next = (args ?? []).filter(
    (value) =>
      !String(value).startsWith("--window-size=") &&
      !String(value).startsWith("--user-data-dir="),
  );
  if (windowSize) next.push(`--window-size=${windowSize}`);
  return next;
}

function getRemoteOptions(capabilities) {
  const remoteOptions = {
    logLevel: defaultConfig.logLevel,
    capabilities,
  };

  const webdriverHost = defaultConfig.webdriver.host;
  const webdriverPort = defaultConfig.webdriver.port;
  if (defaultConfig.transport !== "chrome") {
    throw new Error(
      `Unsupported transport at getRemoteOptions(): ${defaultConfig.transport}`,
    );
  }

  if (webdriverHost) remoteOptions.hostname = webdriverHost;
  if (webdriverPort) remoteOptions.port = webdriverPort;
  if (defaultConfig.webdriver.path) remoteOptions.path = defaultConfig.webdriver.path;
  return remoteOptions;
}

export function getUiDriverConfig() {
  return JSON.parse(JSON.stringify(defaultConfig));
}

export async function createUiSession({ windowSize, sessionName } = {}) {
  if (defaultConfig.transport !== "chrome") throw new Error("TREEFOLD_UI_TRANSPORT must be chrome");
  const capabilities = structuredClone(defaultConfig.browser.capabilities);
  capabilities["goog:chromeOptions"].args = mergeWindowSizeArg(capabilities["goog:chromeOptions"].args, windowSize || DEFAULT_BROWSER_WINDOW_SIZE);
  const browser = await remote(getRemoteOptions(capabilities));
  console.debug(`[ui-test] started Chrome (${sessionName || "ui test"}) => ${browser.sessionId}`);
  return browser;
}
export async function selectUiOption(browser, element, value) {
  await browser.execute(
    (select, nextValue) => {
      select.value = nextValue;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    element,
    value,
  );
}

export async function clickUiElement(browser, target) {
  const element = typeof target === "string" ? await browser.$(target) : target;
  if ((await element.getAttribute("aria-haspopup")) === "menu") await element.scrollIntoView({ block: "center" });
  await element.click();
}
export async function openUiContextMenu(browser, target) {
  const element = typeof target === "string" ? await browser.$(target) : target;
  await element.click({ button: "right" });
}
export async function moveUiPointerTo(browser, target) {
  const element = typeof target === "string" ? await browser.$(target) : target;
  await element.moveTo();
  // An unchanged virtual pointer position emits no new mouseenter on reopening.
  if ((await element.getAttribute("aria-haspopup")) === "menu" && (await element.getAttribute("aria-expanded")) !== "true") await element.click();
  await browser.pause(50);
}
export async function pressUiEscape(browser) { await browser.keys("\uE00C"); }
export async function beginUiPointerDrag(browser, source, destination) {
  const sourceLocation = await source.getLocation();
  const sourceSize = await source.getSize();
  const targetLocation = destination?.elementId
    ? await destination.getLocation()
    : sourceLocation;
  const targetSize = destination?.elementId
    ? await destination.getSize()
    : sourceSize;
  const targetX = destination?.elementId
    ? Math.round(targetLocation.x + targetSize.width / 2)
    : Math.round(sourceLocation.x + sourceSize.width / 2 + destination.x);
  const targetY = destination?.elementId
    ? Math.round(targetLocation.y + targetSize.height / 2)
    : Math.round(sourceLocation.y + sourceSize.height / 2 + destination.y);
  await browser
    .action("pointer")
    .move({
      x: Math.round(sourceLocation.x + sourceSize.width / 2),
      y: Math.round(sourceLocation.y + sourceSize.height / 2),
    })
    .down({ button: 0 })
    .pause(50)
    .move({ duration: 250, x: targetX, y: targetY })
    .perform(true);
  return () => browser.releaseActions();
}

export async function closeUiSession(browser) {
  if (!browser) return;
  try { await browser.deleteSession(); } catch { /* Always allow fixture cleanup. */ }
}
