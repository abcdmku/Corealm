import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { RunningGameServer } from "./server.js";
import { safeName } from "./paths.js";
import type {} from "./debug-api.js";

export interface RuntimeSnapshot {
  state: unknown;
  player: unknown;
  playerPosition: unknown;
  camera: unknown;
  entities: unknown;
  currentActivity: unknown;
  objectives: unknown;
  navigation: unknown;
}

export interface DriverOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
}

export class GameDriver {
  readonly consoleErrors: string[] = [];
  readonly pageErrors: string[] = [];
  readonly requestErrors: string[] = [];

  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  page: Page | undefined;

  constructor(
    private readonly server: RunningGameServer,
    private readonly options: DriverOptions = {},
  ) {}

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.options.headless ?? true,
      args: ["--enable-unsafe-swiftshader", "--mute-audio"],
    });
    this.context = await this.browser.newContext({
      viewport: this.options.viewport ?? { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    this.page = await this.context.newPage();
    this.page.on("console", (message) => {
      if (message.type() === "error") this.consoleErrors.push(message.text().slice(0, 1000));
    });
    this.page.on("pageerror", (error) => this.pageErrors.push(String(error).slice(0, 1000)));
    this.page.on("requestfailed", (request) => {
      this.requestErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
    });
  }

  async open(timeoutMs = 20_000): Promise<void> {
    const page = this.requirePage();
    await page.goto(this.server.url, { waitUntil: "load", timeout: timeoutMs });
    await page.waitForFunction(
      () => window.__gameDebug?.getState().ready === true,
      undefined,
      { timeout: timeoutMs },
    );
    await this.wait(150);
  }

  async wait(ms: number): Promise<void> {
    await this.requirePage().waitForTimeout(ms);
  }

  async press(key: string, holdMs = 0): Promise<void> {
    const keyboard = this.requirePage().keyboard;
    if (holdMs > 0) {
      await keyboard.down(key);
      await this.wait(holdMs);
      await keyboard.up(key);
      return;
    }
    await keyboard.press(key);
  }

  async click(x: number, y: number, button: "left" | "right" | "middle" = "left"): Promise<void> {
    await this.requirePage().mouse.click(x, y, { button });
  }

  async drag(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    button: "left" | "right" | "middle" = "left",
  ): Promise<void> {
    const mouse = this.requirePage().mouse;
    await mouse.move(x1, y1);
    await mouse.down({ button });
    await mouse.move(x2, y2, { steps: 12 });
    await mouse.up({ button });
  }

  async moveMouse(x: number, y: number): Promise<void> {
    await this.requirePage().mouse.move(x, y, { steps: 8 });
  }

  async callDebug(method: string, args: unknown[] = []): Promise<unknown> {
    return this.requirePage().evaluate(
      ({ methodName, methodArgs }) => {
        const api = window.__gameDebug as unknown as Record<string, unknown> | undefined;
        const fn = api?.[methodName];
        if (typeof fn !== "function") throw new Error(`window.__gameDebug.${methodName} is not a function`);
        return JSON.parse(JSON.stringify((fn as (...values: unknown[]) => unknown)(...methodArgs) ?? null));
      },
      { methodName: method, methodArgs: args },
    );
  }

  async snapshot(): Promise<RuntimeSnapshot> {
    return this.requirePage().evaluate(() => {
      const api = window.__gameDebug;
      if (!api) throw new Error("window.__gameDebug is missing");
      return JSON.parse(JSON.stringify({
        state: api.getState(),
        player: api.getPlayer(),
        playerPosition: api.getPlayerPosition(),
        camera: api.getCamera(),
        entities: api.getEntities(),
        currentActivity: api.getCurrentActivity(),
        objectives: api.getObjectives(),
        navigation: api.getNavigationState(),
      })) as RuntimeSnapshot;
    });
  }

  async screenshot(directory: string, name: string): Promise<string> {
    const file = path.join(directory, `${safeName(name)}.png`);
    await this.requirePage().screenshot({ path: file, type: "png" });
    return file;
  }

  async reset(): Promise<void> {
    await this.callDebug("reset");
    await this.wait(150);
  }

  async reload(): Promise<void> {
    await this.requirePage().reload({ waitUntil: "load" });
    await this.requirePage().waitForFunction(() => window.__gameDebug?.getState().ready === true);
    await this.wait(150);
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
  }

  private requirePage(): Page {
    if (!this.page) throw new Error("GameDriver.launch() must run first");
    return this.page;
  }
}
