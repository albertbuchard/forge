import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const outputDir = path.join(projectRoot, "openclaw-plugin/docs/media/ios");

const screens = [
  {
    name: "01-pairing.png",
    title: "Set up sync",
    subtitle: "Pick your Forge runtime.",
    body: `
      <p class="muted lead">Found 2 demo runtimes ready for pairing.</p>
      <div class="runtime-card">
        <div class="row">
          <h2>Forge on Mira's Mac</h2>
          <span class="tag">Tailscale</span>
        </div>
        <p>Secure demo tailnet route with live /api and /forge reachability.</p>
        <button>Pair</button>
      </div>
      <div class="runtime-card">
        <div class="row">
          <h2>Forge in Studio Wi-Fi</h2>
          <span class="tag">Local network</span>
        </div>
        <p>Local network runtime exposed from the studio desktop.</p>
        <button>Pair</button>
      </div>
      <div class="card">
        <h3>Tailscale devices</h3>
        <p>2 demo devices online. Forge is reachable through the tailnet.</p>
        <div class="device"><strong>Mira's MacBook Pro</strong><span>API</span><span>/forge</span></div>
        <code>mira-studio.example.ts.net</code>
        <div class="device dim"><strong>Mira's iPhone</strong><span>API</span><span>/forge</span></div>
        <code>iphone-demo.example.ts.net</code>
      </div>
      <button class="secondary">Scan QR</button>
      <button class="secondary">Paste code</button>
    `
  },
  {
    name: "02-home.png",
    title: "Companion linked",
    subtitle: "Health, movement, and life history are syncing into Forge.",
    body: `
      <div class="hero">
        <p>Forge</p>
        <h1>Companion linked</h1>
        <p>Health, movement, and life history are protected locally.</p>
        <div><span class="chip">Healthy sync</span><span class="chip">Tailscale</span></div>
      </div>
      <div class="metrics">
        <div class="card"><p class="muted">Last sync</p><strong>09:37</strong><p>8 sleep sessions</p></div>
        <div class="card"><p class="muted">Movement</p><strong>4 stays</strong><p>3 repaired trips</p></div>
      </div>
      <div class="card timeline">
        <h3>Today</h3>
        <div><b>Studio</b><span>Ongoing stay - 2.8h</span></div>
        <div><b>Harbor walk</b><span>1.9 km walk - 24 min</span></div>
        <div><b>Library</b><span>Quiet documentation block</span></div>
      </div>
      <div class="card">
        <h3>Captured automatically</h3>
        <div class="row"><span>HealthKit sleep</span><b>8 sessions</b></div>
        <div class="row"><span>Workout imports</span><b>4 summaries</b></div>
        <div class="row"><span>Known places</span><b>3 canonical places</b></div>
        <div class="row"><span>Movement timeline</span><b>Repair gaps active</b></div>
      </div>
    `
  },
  {
    name: "03-life-timeline.png",
    title: "Life Timeline",
    subtitle: "Stays, trips, edits, and sync truth.",
    frameClass: "timeline-screen",
    body: `
      <div class="nav-row"><button class="small">Close</button><button class="icon">Refresh</button></div>
      <div class="vertical-line"></div>
      <div class="bubble primary"><span>Visible day</span><strong>10.06.26</strong><b>Stay</b><p>Sleep home, 00:18-06:40</p></div>
      <div class="bubble ghost"><span>Move</span><strong>24m</strong><p>1.9 km harbor walk</p></div>
      <div class="bubble amber"><strong>3.1h</strong><b>Stay</b><p>Studio focus, 07:04-10:10</p></div>
      <div class="bubble ghost lower"><span>Move</span><strong>18m</strong><p>Library route</p></div>
      <div class="bubble primary bottom"><strong>2.4h</strong><b>Stay</b><p>Harbor Library, 10:28-12:52</p></div>
    `
  },
  {
    name: "04-diagnostics.png",
    title: "Diagnostics",
    subtitle: "",
    frameClass: "diagnostics-screen",
    body: `
      <div class="nav-row"><button class="small">Close</button></div>
      <div class="segmented"><span>Overview</span><span>Movement</span><span>Logs</span></div>
      <div class="card">
        <h3>Sync state</h3>
        <div class="kv"><span>Connection</span><b>Healthy sync</b></div>
        <div class="kv"><span>Health</span><b>HealthKit full access</b></div>
        <div class="kv"><span>Movement</span><b>always</b></div>
        <div class="kv"><span>Watch</span><b>Watch bridge idle</b></div>
        <div class="kv"><span>Last sync</span><b>8 sleep, 4 workouts, 3 trips</b></div>
      </div>
      <div class="card">
        <h3>Latest payload</h3>
        <div class="kv"><span>Built</span><b>09:37</b></div>
        <div class="kv"><span>Sleep sessions</span><b>8</b></div>
        <div class="kv"><span>Stage entries</span><b>31</b></div>
        <div class="kv"><span>Workouts</span><b>4</b></div>
        <div class="kv"><span>Known places</span><b>3</b></div>
        <div class="kv"><span>Trips</span><b>3</b></div>
      </div>
      <div class="card">
        <h3>What synced and what did not</h3>
        <div class="row"><span>Sleep</span><b>8 sessions</b></div>
        <p>Stage segments synced as summarized sleep sessions, not raw category samples.</p>
        <div class="row"><span>Workouts</span><b>4 workouts</b></div>
        <p>Timing, energy, route points, and effort metadata are ready for Forge.</p>
      </div>
    `
  }
];

function documentFor(screen) {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          :root {
            color-scheme: dark;
            font-family: Inter, ui-rounded, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #070d1d;
            color: #f8fbff;
          }
          * { box-sizing: border-box; }
          body { margin: 0; width: 946px; height: 2048px; overflow: hidden; background: #070d1d; }
          .screen {
            position: relative;
            width: 946px;
            min-height: 2048px;
            padding: 150px 44px 70px;
            background:
              radial-gradient(circle at 80% 0%, rgba(86, 134, 255, 0.22), transparent 30%),
              linear-gradient(180deg, #0b1024 0%, #081022 52%, #070c19 100%);
          }
          .status {
            position: absolute;
            inset: 30px 70px auto 90px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 42px;
            font-weight: 800;
          }
          .notch {
            position: absolute;
            left: 338px;
            top: 30px;
            width: 270px;
            height: 78px;
            border-radius: 999px;
            background: #000;
          }
          .icons { display: flex; gap: 26px; align-items: center; font-size: 36px; }
          .battery {
            width: 60px;
            height: 30px;
            border: 4px solid rgba(255,255,255,0.82);
            border-radius: 9px;
            position: relative;
          }
          .battery::before {
            content: "";
            position: absolute;
            right: -10px;
            top: 7px;
            width: 6px;
            height: 12px;
            border-radius: 4px;
            background: rgba(255,255,255,0.82);
          }
          .battery::after {
            content: "";
            position: absolute;
            inset: 4px;
            width: 38px;
            border-radius: 5px;
            background: #6ee49d;
          }
          h1, h2, h3, p { margin: 0; }
          .title-block { margin-bottom: 54px; }
          .title-block h1 { font-size: 66px; line-height: 0.98; letter-spacing: 0; }
          .title-block p { margin-top: 22px; font-size: 31px; color: rgba(248,251,255,0.66); line-height: 1.25; }
          .lead { margin-bottom: 44px; font-size: 28px; }
          .muted { color: rgba(248,251,255,0.56); }
          .runtime-card, .card, .hero {
            border: 2px solid rgba(132, 166, 255, 0.18);
            background: rgba(21, 37, 77, 0.82);
            border-radius: 48px;
            padding: 38px;
            margin-bottom: 26px;
            box-shadow: 0 28px 90px rgba(0, 0, 0, 0.28);
          }
          .row, .device, .kv {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 18px;
          }
          .card > .row {
            margin-top: 20px;
            font-size: 28px;
            color: rgba(248,251,255,0.72);
          }
          .card > .row b {
            color: #a8bbff;
            font-weight: 900;
            text-align: right;
          }
          .runtime-card h2 { font-size: 37px; }
          .runtime-card p, .card p { margin-top: 16px; font-size: 28px; line-height: 1.28; color: rgba(248,251,255,0.68); }
          .tag, .chip {
            display: inline-flex;
            align-items: center;
            border-radius: 999px;
            padding: 12px 22px;
            background: rgba(255,255,255,0.12);
            color: rgba(248,251,255,0.74);
            font-size: 25px;
            font-weight: 800;
          }
          .chip { margin-right: 16px; background: rgba(225, 235, 255, 0.78); color: #10192d; }
          button {
            width: 100%;
            margin-top: 32px;
            min-height: 104px;
            border: 0;
            border-radius: 40px;
            background: #91a8ff;
            color: #081025;
            font-size: 34px;
            font-weight: 900;
          }
          button.secondary { margin-top: 24px; background: rgba(255,255,255,0.1); color: #f8fbff; }
          button.small, button.icon {
            width: auto;
            min-height: 80px;
            margin: 0;
            padding: 0 34px;
            background: rgba(255,255,255,0.1);
            color: #f8fbff;
          }
          .card h3 { font-size: 34px; margin-bottom: 22px; }
          .device { margin-top: 24px; font-size: 28px; }
          .device span { padding: 8px 16px; border-radius: 999px; background: #b9f6c8; color: #112019; font-weight: 900; }
          .device.dim span { background: rgba(255,255,255,0.1); color: rgba(248,251,255,0.48); }
          code { display: block; margin-top: 10px; color: rgba(248,251,255,0.52); font-size: 22px; }
          .hero { background: #8298f3; color: #071126; min-height: 420px; }
          .hero h1 { margin: 38px 0 22px; font-size: 68px; }
          .hero p { font-size: 31px; color: rgba(7, 17, 38, 0.7); }
          .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
          .metrics .card { min-height: 230px; }
          .metrics strong { display: block; margin-top: 22px; font-size: 54px; }
          .timeline div { margin-top: 28px; padding-left: 70px; position: relative; }
          .timeline div::before { content: ""; position: absolute; left: 18px; top: 6px; width: 24px; height: 88px; border-radius: 999px; background: #91a8ff; }
          .timeline b { display: block; font-size: 36px; }
          .timeline span { display: block; margin-top: 8px; font-size: 28px; color: rgba(248,251,255,0.62); }
          .timeline-screen .title-block, .diagnostics-screen .title-block { text-align: center; margin-bottom: 40px; }
          .timeline-screen .title-block h1, .diagnostics-screen .title-block h1 { font-size: 38px; }
          .nav-row { position: absolute; left: 44px; right: 44px; top: 132px; display: flex; justify-content: space-between; }
          .vertical-line { position: absolute; left: 472px; top: 410px; width: 8px; height: 1350px; border-radius: 999px; background: rgba(255,255,255,0.92); }
          .bubble {
            position: absolute;
            left: 263px;
            width: 420px;
            min-height: 178px;
            border-radius: 52px;
            padding: 34px;
            background: rgba(30, 47, 88, 0.72);
            border: 2px solid rgba(255,255,255,0.08);
          }
          .bubble.primary { top: 300px; background: #59a8ff; }
          .bubble.ghost { top: 580px; left: 246px; width: 310px; color: rgba(248,251,255,0.75); }
          .bubble.amber { top: 820px; background: #ffb345; color: #fff; }
          .bubble.lower { top: 1140px; }
          .bubble.bottom { top: 1400px; left: 244px; width: 460px; }
          .bubble span { text-transform: uppercase; letter-spacing: 0.28em; color: rgba(255,255,255,0.52); font-size: 22px; font-weight: 900; }
          .bubble strong { display: block; margin-top: 8px; font-size: 38px; }
          .bubble b { display: block; margin-top: 20px; text-transform: uppercase; letter-spacing: 0.22em; font-size: 24px; }
          .bubble p { margin-top: 8px; font-size: 25px; line-height: 1.18; color: rgba(255,255,255,0.78); }
          .segmented { display: grid; grid-template-columns: 1fr 1fr 1fr; border-radius: 999px; padding: 4px; background: rgba(255,255,255,0.12); margin-bottom: 34px; }
          .segmented span { padding: 22px; text-align: center; border-radius: 999px; font-size: 29px; }
          .segmented span:first-child { background: rgba(255,255,255,0.24); }
          .kv { margin-top: 24px; font-size: 27px; }
          .kv span { color: rgba(248,251,255,0.55); font-weight: 800; }
          .kv b { max-width: 520px; text-align: right; }
        </style>
      </head>
      <body>
        <main class="screen ${screen.frameClass ?? ""}">
          <div class="status">
            <span>09:41</span>
            <span class="notch"></span>
            <span class="icons">Wi-Fi<span class="battery"></span></span>
          </div>
          <section class="title-block">
            <h1>${screen.title}</h1>
            ${screen.subtitle ? `<p>${screen.subtitle}</p>` : ""}
          </section>
          ${screen.body}
        </main>
      </body>
    </html>`;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 946, height: 2048 }, deviceScaleFactor: 1 });
  for (const screen of screens) {
    await page.setContent(documentFor(screen), { waitUntil: "load" });
    await page.screenshot({
      path: path.join(outputDir, screen.name),
      fullPage: false,
      type: "png"
    });
    console.log(path.join(outputDir, screen.name));
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
