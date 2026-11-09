import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";

const base = process.env.WAYMARK_URL || "http://127.0.0.1:3847";
const out = process.env.SMOKE_DIR || "/tmp/waymark-smoke";
await mkdir(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});

const logs = [];
async function shot(page, name) {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log("shot", path);
}

async function run(width, height, label) {
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on("console", (msg) => {
    if (msg.type() === "error") logs.push(`${label} console: ${msg.text()}`);
  });
  page.on("pageerror", (error) => logs.push(`${label} pageerror: ${error.message}`));
  await page.goto(base, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.innerText.includes("Suvarnabhumi"));
  const onFirst = await page.evaluate(() => document.body.innerText.includes("Tue 8 Dec"));
  if (!onFirst) {
    for (let step = 0; step < 20; step += 1) {
      const backDisabled = await page.evaluate(
        () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Back")?.disabled ?? true,
      );
      if (backDisabled) break;
      await page.click("button::-p-text(Back)");
      if (await page.evaluate(() => document.body.innerText.includes("Tue 8 Dec"))) break;
    }
  }
  await page.waitForSelector(".gm-style", { timeout: 20000 });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await shot(page, `${label}-airport`);

  await page.click("button::-p-text(Next)");
  await page.waitForFunction(
    () => /km/.test(document.body.innerText) && /Not live traffic/.test(document.body.innerText),
    { timeout: 20000 },
  );
  const leg = await page.evaluate(() => {
    const text = document.querySelector("[aria-live='polite']")?.textContent ?? "";
    const km = text.match(/(\d+(?:\.\d+)?)\s*km/);
    const time = text.match(/(\d+\s*h(?:\s*\d+\s*min)?|\d+\s*min)/);
    return {
      textHasAirport: text.includes("Suvarnabhumi"),
      textHasHotel: text.includes("Chatrium"),
      km: km?.[1] ?? null,
      time: time?.[0] ?? null,
      straight: text.toLowerCase().includes("straight line was"),
      basemap: document.body.innerText.includes("Basemap unavailable"),
    };
  });
  if (leg.basemap) throw new Error(`${label}: basemap failed`);
  console.log(label, "leg", JSON.stringify(leg));
  if (!leg.km || Number(leg.km) < 20) throw new Error(`${label}: expected a real airport drive, got ${leg.km}`);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await shot(page, `${label}-drive`);

  if (label === "desktop") {
    await page.click("button::-p-text(Walk)");
    await page.waitForFunction(() => /Typical walk time/.test(document.body.innerText), { timeout: 20000 });
    await shot(page, "desktop-walk");
    const walk = await page.evaluate(
      () => document.querySelector("[aria-live='polite']")?.textContent?.match(/(\d+(?:\.\d+)?)\s*km/)?.[1],
    );
    console.log("walk km", walk);

    await page.click("button::-p-text(Next)");
    await page.waitForFunction(() => document.body.innerText.includes("Stop 3 of 16"), { timeout: 20000 });
    await page.waitForFunction(() => /Typical drive time|Same place/.test(document.body.innerText));
    console.log("stop 3 ok");

    for (let i = 0; i < 5; i += 1) await page.click("button::-p-text(Next)");
    await page.waitForFunction(() => document.body.innerText.includes("Same place"), { timeout: 20000 });
    const same = await page.evaluate(() => document.body.innerText.includes("No road route was requested"));
    if (!same) throw new Error("same-place rest did not suppress the route");
    await shot(page, "desktop-same-place");
    console.log("same place ok");

    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.body.innerText.includes("Same place") || document.body.innerText.includes("Stop "));
    const kept = await page.evaluate(() => document.body.innerText.includes("Bangkok"));
    if (!kept) throw new Error("trip name missing after reload");
    console.log("reload kept the book");

    await page.click("button::-p-text(Library)");
    await page.waitForFunction(() => document.body.innerText.includes("Trip library"));
    await shot(page, "desktop-library");
    await page.keyboard.press("Escape");
    for (let step = 0; step < 20; step += 1) {
      if (await page.evaluate(() => document.body.innerText.includes("Tue 8 Dec"))) break;
      await page.click("button::-p-text(Back)");
    }
    await page.waitForFunction(() => document.body.innerText.includes("Tue 8 Dec"));
    await page.click("button::-p-text(Next)");
    await page.waitForFunction(() => /Typical drive time/.test(document.body.innerText));
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url().includes("/api/route")) request.abort("failed");
      else request.continue();
    });
    await page.click("button::-p-text(Cycle)");
    await page.waitForFunction(() => document.body.innerText.includes("Route unavailable"), { timeout: 15000 });
    const honest = await page.evaluate(() => {
      const text = document.querySelector("[aria-live='polite']")?.textContent ?? "";
      return text.includes("No route line was drawn") && !/\d+\s*km/.test(text);
    });
    if (!honest) throw new Error("cycle failure still showed a distance");
    await shot(page, "desktop-route-failure");
    console.log("route failure ok");
  }
  await page.close();
}

try {
  await run(1440, 900, "desktop");
  await run(390, 844, "mobile");
  console.log("LOGS");
  console.log(logs.join("\n") || "(none)");
  if (logs.some((line) => /pageerror|Map is not|is not a function|Hydration/.test(line))) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
