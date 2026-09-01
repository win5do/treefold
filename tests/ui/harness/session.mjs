import path from "node:path";
import { fileURLToPath } from "node:url";
import { remote } from "webdriverio";
import { cleanupWdioSession, startWdioSession } from "@wdio/tauri-service";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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
  tauri: {
    capabilities: {
      browserName: process.env.TREEFOLD_TAURI_BROWSER_NAME || "tauri",
      "tauri:options": {
        application:
          process.env.TREEFOLD_TAURI_APP_PATH ||
          path.resolve(projectRoot, "src-tauri/target/debug/treefold"),
      },
      "wdio:tauriServiceOptions": {
        driverProvider:
          process.env.TREEFOLD_TAURI_DRIVER_PROVIDER ||
          process.env.TREEFOLD_TAURI_DRIVER_MODE ||
          "embedded",
        logLevel: process.env.TREEFOLD_UI_WEBDRIVER_LOG_LEVEL || "error",
        startTimeout: Number.parseInt(
          process.env.TREEFOLD_TAURI_START_TIMEOUT || "60000",
          10,
        ),
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

function parseEmbeddedPort() {
  const rawPort = process.env.TREEFOLD_TAURI_WEBDRIVER_PORT;
  if (!rawPort) return undefined;
  const value = Number.parseInt(rawPort, 10);
  return Number.isNaN(value) ? undefined : value;
}

export async function createUiSession({ windowSize, sessionName } = {}) {
  const transport = defaultConfig.transport;
  if (transport !== "chrome" && transport !== "tauri") {
    throw new Error(
      `Invalid TREEFOLD_UI_TRANSPORT: ${transport}; expected chrome or tauri`,
    );
  }

  const config =
    transport === "tauri" ? defaultConfig.tauri : defaultConfig.browser;

  const capabilities = { ...config.capabilities };
  if (transport === "chrome" && capabilities?.["goog:chromeOptions"]?.args) {
    capabilities["goog:chromeOptions"] = {
      ...capabilities["goog:chromeOptions"],
      args: mergeWindowSizeArg(
        capabilities["goog:chromeOptions"].args,
        windowSize || DEFAULT_BROWSER_WINDOW_SIZE,
      ),
    };
  }

  if (transport === "tauri") {
    const options = { ...capabilities };
    const embeddedPort = parseEmbeddedPort();
    if (embeddedPort) {
      options["wdio:tauriServiceOptions"] = {
        ...options["wdio:tauriServiceOptions"],
        embeddedPort,
      };
    }
    const browser = await startWdioSession(options);
    browser?.sessionId &&
      console.debug(
        `[ui-test] started ${transport} session (${sessionName || "ui test"}) => ${browser.sessionId}`,
      );
    return browser;
  }

  const browser = await remote(getRemoteOptions(capabilities));
  browser?.sessionId &&
    console.debug(
      `[ui-test] started ${transport} session (${sessionName || "ui test"}) => ${browser.sessionId}`,
    );
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
  if (defaultConfig.transport !== "tauri") {
    if ((await element.getAttribute("aria-haspopup")) === "menu")
      await element.scrollIntoView({ block: "center" });
    await element.click();
    return;
  }
  const selector = typeof target === "string" ? target : element.selector;
  const opensMenu = await browser.execute((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!(target instanceof HTMLElement)) {
      throw new Error(`Unable to locate UI target: ${targetSelector}`);
    }
    if (target.getAttribute("aria-haspopup") === "menu") {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: "ArrowDown",
          key: "ArrowDown",
        }),
      );
      return true;
    }
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        cancelable: true,
        isPrimary: true,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );
    target.click();
    return false;
  }, selector);
  await browser.pause(50);
  if (
    opensMenu &&
    (await browser.execute(
      (targetSelector) =>
        document.querySelector(targetSelector)?.getAttribute("aria-expanded"),
      selector,
    )) !== "true"
  ) {
    await browser.execute(
      (targetSelector) => document.querySelector(targetSelector)?.click(),
      selector,
    );
    await browser.pause(50);
  }
}

export async function openUiContextMenu(browser, target) {
  const element = typeof target === "string" ? await browser.$(target) : target;
  if (defaultConfig.transport !== "tauri") {
    await element.click({ button: "right" });
    return;
  }
  await browser.execute((targetElement, targetSelector) => {
    const resolvedTarget = targetSelector
      ? document.querySelector(targetSelector)
      : targetElement;
    if (!(resolvedTarget instanceof HTMLElement)) {
      throw new Error(`Unable to locate context-menu target: ${targetSelector}`);
    }
    const rect = resolvedTarget.getBoundingClientRect();
    resolvedTarget.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        buttons: 2,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        view: window,
      }),
    );
  }, element, typeof target === "string" ? target : null);
  await browser.pause(50);
}

export async function moveUiPointerTo(browser, target) {
  const element = typeof target === "string" ? await browser.$(target) : target;
  if (defaultConfig.transport !== "tauri") {
    await element.moveTo();
    // Reopening a menu often leaves WebDriver's virtual pointer at the exact
    // same coordinates. In that case Chrome emits no new mouseenter event, so
    // submenu triggers need a click fallback when hover did not expand them.
    if (
      (await element.getAttribute("aria-haspopup")) === "menu" &&
      (await element.getAttribute("aria-expanded")) !== "true"
    ) {
      await element.click();
    }
    await browser.pause(50);
    return;
  }
  await browser.execute((targetElement, targetSelector) => {
    const resolvedTarget = targetSelector
      ? document.querySelector(targetSelector)
      : targetElement;
    if (!(resolvedTarget instanceof HTMLElement)) {
      throw new Error(`Unable to locate pointer target: ${targetSelector}`);
    }
    const rect = resolvedTarget.getBoundingClientRect();
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      pointerId: 1,
      pointerType: "mouse",
      view: window,
    };
    resolvedTarget.dispatchEvent(new PointerEvent("pointerover", eventOptions));
    resolvedTarget.dispatchEvent(new PointerEvent("pointerenter", eventOptions));
    resolvedTarget.dispatchEvent(new PointerEvent("pointermove", eventOptions));
    resolvedTarget.dispatchEvent(new MouseEvent("mouseover", eventOptions));
    resolvedTarget.dispatchEvent(new MouseEvent("mouseenter", eventOptions));
    resolvedTarget.dispatchEvent(new MouseEvent("mousemove", eventOptions));
    if (resolvedTarget.getAttribute("aria-haspopup") === "menu") {
      resolvedTarget.dispatchEvent(
        new MouseEvent("click", {
          ...eventOptions,
          button: 0,
          buttons: 0,
        }),
      );
    }
  }, element, typeof target === "string" ? target : null);
  await browser.pause(50);
}

export async function pressUiEscape(browser) {
  if (defaultConfig.transport !== "tauri") {
    await browser.keys("\uE00C");
    return;
  }
  await browser.execute(() => {
    const options = {
      bubbles: true,
      cancelable: true,
      code: "Escape",
      key: "Escape",
      keyCode: 27,
      which: 27,
    };
    // Base UI installs its dismiss listener directly on `document`. Dispatching
    // there avoids the embedded driver's incomplete native key implementation
    // and still exercises the overlay's Escape dismissal behavior.
    document.dispatchEvent(new KeyboardEvent("keydown", options));
    document.dispatchEvent(new KeyboardEvent("keyup", options));
  });
  await browser.pause(50);
}

export async function beginUiPointerDrag(browser, source, destination) {
  if (defaultConfig.transport === "tauri") {
    await browser.execute((sourceElement) => {
      const originalSetPointerCapture = sourceElement.setPointerCapture;
      sourceElement.setPointerCapture = () => {};
      const rect = sourceElement.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      window.__treefoldUiPointerDrag = {
        originalSetPointerCapture,
        sourceElement,
        x,
        y,
      };
      sourceElement.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: x,
          clientY: y,
          isPrimary: true,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );
    }, source);
    await browser.pause(50);
    await browser.execute(
      (sourceElement, targetElement, offset) => {
        const state = window.__treefoldUiPointerDrag;
        const targetRect = targetElement?.getBoundingClientRect();
        const x = targetRect
          ? targetRect.left + targetRect.width / 2
          : state.x + offset.x;
        const y = targetRect
          ? targetRect.top + targetRect.height / 2
          : state.y + offset.y;
        state.x = x;
        state.y = y;
        sourceElement.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            button: 0,
            buttons: 1,
            clientX: x,
            clientY: y,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
      },
      source,
      destination?.elementId ? destination : null,
      destination?.elementId ? { x: 0, y: 0 } : destination,
    );

    return async () => {
      await browser.execute(() => {
        const state = window.__treefoldUiPointerDrag;
        if (!state) return;
        state.sourceElement.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            button: 0,
            buttons: 0,
            clientX: state.x,
            clientY: state.y,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        state.sourceElement.setPointerCapture = state.originalSetPointerCapture;
        delete window.__treefoldUiPointerDrag;
      });
    };
  }

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

  if (defaultConfig.transport === "tauri") {
    try {
      // The standalone Tauri service clears mocks, deletes the WebDriver
      // session, and stops the embedded app in this order.
      await cleanupWdioSession(browser);
    } catch {
      // Keep fixture and runner cleanup reliable after a failed native session.
    }
    return;
  }

  try {
    await browser.deleteSession();
  } catch {
    // Ensure teardown remains robust for unstable browser-driver exits.
  }
}
