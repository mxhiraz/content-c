import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir, stat, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import waPkg from "whatsapp-web.js";
import qrcode from "qrcode";
import path from "node:path";
import { log } from "../log.js";
import { config } from "../config.js";
import { loadDeliveryConfig, saveDeliveryConfig } from "./config.js";

const { Client, LocalAuth } = waPkg;

const PORT = Number.parseInt(process.env.CONFIG_PORT ?? "8080", 10);

interface State {
  client: InstanceType<typeof Client> | null;
  qr: string | null;
  ready: boolean;
  initializing: boolean;
}

const state: State = { client: null, qr: null, ready: false, initializing: false };

async function getLatestWaVersion(): Promise<string | null> {
  // env override always wins
  if (process.env.WA_WEB_VERSION) return process.env.WA_WEB_VERSION;
  const cachePath = path.join(config.pipeline.outputDir, ".wa-web-version.json");
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as { version: string; ts: number };
    if (Date.now() - cached.ts < 7 * 86_400_000) return cached.version;
  } catch { /* miss */ }
  try {
    const r = await fetch("https://api.github.com/repos/wppconnect-team/wa-version/contents/html?ref=main", {
      headers: { "User-Agent": "ai-carousel-factory", accept: "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      log.warn("wa-config", `wa-version github HTTP ${r.status}, using upstream default`);
      return null;
    }
    const list = (await r.json()) as { name: string }[];
    const versions = list
      .filter((f) => f.name.endsWith(".html"))
      .map((f) => f.name.replace(/\.html$/, ""))
      .filter((v) => /^\d+(\.\d+){2,}/.test(v))
      .sort((a, b) => compareVersion(b, a));
    const latest = versions[0];
    if (!latest) return null;
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ version: latest, ts: Date.now() }));
    log.ok("wa-config", `wa-version pinned to latest from wppconnect mirror: ${latest}`);
    return latest;
  } catch (e) {
    log.warn("wa-config", `wa-version fetch failed: ${(e as Error).message}, using upstream default`);
    return null;
  }
}

function compareVersion(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function startWa(): void {
  startWaClientAsync().catch((e) => log.err("wa-config", `startWaClient: ${(e as Error).message}`));
}

async function startWaClientAsync(): Promise<void> {
  if (state.client || state.initializing) return;
  state.initializing = true;
  state.ready = false;
  state.qr = null;
  groupsCache = null;
  const sessionDir = path.join(config.pipeline.outputDir, ".wa-session");
  // Clean stale Chromium singleton locks from previous container (container hostname
  // changes each recreate, puppeteer thinks another machine owns the profile).
  // Locks are tiny symlinks/files — safe to delete.
  for (const lockName of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    await rm(path.join(sessionDir, "session", lockName), { force: true }).catch(() => undefined);
    await rm(path.join(sessionDir, lockName), { force: true }).catch(() => undefined);
  }
  // Auto-pin to latest WA Web version published in wppconnect mirror — works around
  // upstream "stuck at 99%" regressions (whatsapp-web.js issues #5717, #5758, #127084).
  const webVersion = await getLatestWaVersion();
  const versionConfig = webVersion
    ? {
        webVersion,
        webVersionCache: {
          type: "remote" as const,
          remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${webVersion}.html`,
        },
      }
    : {};
  const client = new Client({
    ...versionConfig,
    authStrategy: new LocalAuth({ dataPath: sessionDir }),
    puppeteer: {
      headless: true,
      // protocolTimeout default is 30s. Bump to 120s for chat-heavy accounts where
      // getChats() / getModelsArray() can take >30s on first call.
      protocolTimeout: 120_000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        // NOTE: --single-process / --no-zygote BREAKS whatsapp-web.js ready event in containers. Do NOT add.
      ],
    },
  });
  state.client = client;

  let readyLogged = false;
  let authLogged = false;
  let qrLogged = false;
  client.on("qr", (qr) => {
    state.qr = qr;
    state.ready = false;
    if (!qrLogged) {
      qrLogged = true;
      log.info("wa-config", "QR generated, waiting for scan");
    }
  });
  client.on("authenticated", () => {
    state.qr = null;
    if (authLogged) return;
    authLogged = true;
    log.ok("wa-config", "authenticated, waiting for ready (90s fallback armed)");
    // Fallback: if ready doesn't fire in 90s, manually check via getChats and force ready
    setTimeout(async () => {
      if (state.ready || !state.client) return;
      try {
        const chats = await state.client.getChats();
        if (chats.length >= 0) {
          state.ready = true;
          state.initializing = false;
          log.ok("wa-config", `force-marked ready via getChats fallback (${chats.length} chats)`);
        }
      } catch (e) {
        log.warn("wa-config", `ready fallback failed: ${(e as Error).message}. Try Reset WA Session.`);
      }
    }, 90_000);
  });
  client.on("ready", () => {
    if (readyLogged) return;
    readyLogged = true;
    state.ready = true;
    state.qr = null;
    state.initializing = false;
    log.ok("wa-config", "client ready, kicking off background chat sync");
    // Fire-and-forget: prime Store.Chat. UI continues polling fast-path which fills as sync completes.
    void client.getChats().then(
      (chats: { length: number }) => log.ok("wa-config", `background sync: ${chats.length} chats loaded into Store`),
      (e: unknown) => log.warn("wa-config", `background getChats failed: ${(e as Error).message}`)
    );
  });
  client.on("disconnected", (reason) => {
    log.warn("wa-config", `disconnected: ${reason}`);
    state.ready = false;
    state.client = null;
    state.initializing = false;
    state.qr = null;
    readyLogged = false;
    groupsCache = null;
  });
  client.on("auth_failure", (m) => log.err("wa-config", `auth_failure: ${m}`));

  client.initialize().catch((e) => {
    log.err("wa-config", `init failed: ${(e as Error).message}`);
    state.client = null;
    state.initializing = false;
    state.ready = false;
    // Auto-retry after 10s on init failure
    setTimeout(() => startWa(), 10_000);
  });
}

// Keep process alive on puppeteer protocol crashes
process.on("uncaughtException", (e) => {
  log.err("wa-config", `uncaughtException: ${(e as Error).message}`);
});
process.on("unhandledRejection", (e) => {
  log.err("wa-config", `unhandledRejection: ${(e as Error)?.message ?? String(e)}`);
});

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

function html(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const PAGE = (data: {
  ready: boolean;
  qrDataUrl: string | null;
  cfg: Awaited<ReturnType<typeof loadDeliveryConfig>>;
  groups: { id: string; name: string }[];
  folders: FolderInfo[];
  justTriggered?: string;
}): string => `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Carousel Delivery Config</title>
<style>
  body { font: 14px -apple-system, system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #111; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 16px; margin: 24px 0 8px; }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 12px 0; background: #fafafa; }
  .ok { color: #059669; font-weight: 600; }
  .pending { color: #d97706; font-weight: 600; }
  label { display: block; margin: 12px 0 4px; font-weight: 600; }
  input[type=text], input[type=email], select { width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box; }
  button { background: #111; color: #fff; padding: 10px 16px; border: 0; border-radius: 6px; cursor: pointer; }
  button:hover { background: #333; }
  .toggle { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
  pre { background: #f3f4f6; padding: 12px; border-radius: 6px; font-size: 12px; overflow-x: auto; }
  img.qr { display: block; max-width: 280px; margin: 12px 0; }
</style></head><body>
<h1>Carousel Delivery Config</h1>
<p style="color:#6b7280">WhatsApp + Email delivery for daily-scheduled and event-triggered carousels.</p>

${(() => {
  const waReady = data.cfg.enableWhatsApp && (data.cfg.whatsappGroupId || data.cfg.whatsappGroupName);
  const emailReady = data.cfg.enableEmail && (data.cfg.emailRecipients ?? []).length > 0;
  const canStart = waReady || emailReady;
  return `<div class="card" style="${data.cfg.automationEnabled ? "background:#ecfdf5;border-color:#10b981" : "background:#fef3c7;border-color:#f59e0b"}">
  <h2>Automation</h2>
  <p>Status: <strong style="${data.cfg.automationEnabled ? "color:#059669" : "color:#d97706"}">${data.cfg.automationEnabled ? "RUNNING" : "STOPPED"}</strong></p>
  <p style="font-size:13px">Channel readiness:</p>
  <ul style="font-size:13px;margin-top:0">
    <li>WhatsApp: ${waReady ? '<span style="color:#059669">✅ ready</span>' : '<span style="color:#9ca3af">— not configured (pick group + enable)</span>'}</li>
    <li>Email: ${emailReady ? '<span style="color:#059669">✅ ready</span>' : '<span style="color:#9ca3af">— not configured (add recipients + enable)</span>'}</li>
  </ul>
  <p style="color:#6b7280;font-size:12px">When ON: scheduled crons + breaking-news watcher fire. At least ONE channel must be configured + enabled.</p>
  <form method="POST" action="/automation/toggle">
    <button type="submit" ${!data.cfg.automationEnabled && !canStart ? "disabled style=\"opacity:0.5;cursor:not-allowed;background:#9ca3af;font-size:16px;padding:14px 28px\"" : `style="${data.cfg.automationEnabled ? "background:#dc2626" : "background:#059669"};font-size:16px;padding:14px 28px"`}>${data.cfg.automationEnabled ? "Stop Automation" : (canStart ? "Start Automation" : "Configure a channel first")}</button>
  </form>
</div>`;
})()}

<div class="card" id="wa-card">
  <h2>WhatsApp</h2>
  <div id="wa-content">
    <p class="pending">Loading...</p>
  </div>
</div>

<script>
(function() {
  const card = document.getElementById('wa-content');
  const currentGroupId = ${JSON.stringify(data.cfg.whatsappGroupId ?? "")};
  const enableChecked = ${data.cfg.enableWhatsApp ? "true" : "false"};
  let lastState = "";
  let timer = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderConnecting() {
    card.innerHTML = '<p class="pending">⏳ Initializing WhatsApp client (chromium booting)... live polling.</p>';
  }
  function renderQr(dataUrl) {
    card.innerHTML =
      '<p class="pending">📱 Scan with your phone: WhatsApp → Settings → Linked Devices → Link a Device</p>' +
      '<img class="qr" src="' + dataUrl + '" alt="QR"/>' +
      '<p style="color:#6b7280;font-size:12px">QR refreshes automatically. Auto-detects when you scan.</p>';
  }
  function renderReady(groups, totalChats) {
    if (groups.length === 0) {
      card.innerHTML =
        '<p class="ok">✅ Connected.</p>' +
        '<p class="pending">⏳ Syncing your WhatsApp chats... ' + (totalChats >= 0 ? totalChats + ' chats loaded so far, 0 groups detected yet.' : '') + '</p>' +
        '<p style="color:#6b7280;font-size:12px">WhatsApp Web takes 30-90 seconds to sync chats after first login. Polling every 3s — when groups appear they\\'ll show automatically.</p>' +
        '<p style="margin-top:12px"><button onclick="forceRefresh()" style="background:#0369a1">Force Refresh Now</button></p>' +
        '<p style="margin-top:8px;font-size:12px;color:#6b7280">Still nothing after 2 minutes? On your phone, open the WhatsApp group at least once so it syncs to Web. Then click Force Refresh.</p>' +
        '<p style="margin-top:12px;font-size:12px"><a href="javascript:void(0)" onclick="document.getElementById(\\'wa-logout\\').submit()">Disconnect / re-auth</a></p>' +
        '<form id="wa-logout" method="POST" action="/reset/wa-session" style="display:none"></form>';
      return;
    }
    let opts = '<option value="">-- pick a group --</option>';
    for (const g of groups) {
      const sel = g.id === currentGroupId ? ' selected' : '';
      opts += '<option value="' + escapeHtml(g.id) + '"' + sel + '>' + escapeHtml(g.name) + '</option>';
    }
    card.innerHTML =
      '<p class="ok">✅ Connected. ' + groups.length + ' group(s) found.</p>' +
      '<form method="POST" action="/wa/select">' +
        '<label>Send carousel ZIPs to group:</label>' +
        '<select name="groupId" required>' + opts + '</select>' +
        '<div class="toggle"><input type="checkbox" name="enableWhatsApp" id="ewa"' + (enableChecked ? ' checked' : '') + '/><label for="ewa" style="display:inline">Enabled</label></div>' +
        '<button type="submit" style="margin-top:8px">Save WhatsApp Target</button>' +
      '</form>' +
      '<p style="margin-top:8px"><button onclick="forceRefresh()" style="background:#0369a1;font-size:12px;padding:6px 12px">Refresh Group List</button></p>' +
      '<p style="margin-top:12px;font-size:12px"><a href="javascript:void(0)" onclick="document.getElementById(\\'wa-logout\\').submit()">Disconnect / re-auth</a></p>' +
      '<form id="wa-logout" method="POST" action="/reset/wa-session" style="display:none"></form>';
  }
  window.forceRefresh = async function() {
    try {
      const r = await fetch('/api/wa-refresh-groups', { method: 'POST' });
      const j = await r.json();
      lastState = ''; // force re-render
      renderReady(j.groups || [], -1);
      lastState = 'ready';
    } catch (e) {
      alert('Refresh failed: ' + e.message);
    }
  };

  async function poll() {
    try {
      const r = await fetch('/api/wa-status');
      const j = await r.json();
      const stateKey = j.ready ? 'ready' : (j.qrDataUrl ? 'qr' : 'init');
      // Re-render whenever ready+0groups (we want to keep polling for sync) OR state changed
      const shouldRender = stateKey !== lastState || (stateKey === 'ready' && (j.groups || []).length === 0);
      if (shouldRender) {
        if (stateKey === 'ready') renderReady(j.groups || [], j.totalChats ?? -1);
        else if (stateKey === 'qr') renderQr(j.qrDataUrl);
        else renderConnecting();
        lastState = stateKey;
      }
      // poll fast while waiting OR while ready-but-syncing groups, slow once we have groups
      const haveGroups = stateKey === 'ready' && (j.groups || []).length > 0;
      const next = haveGroups ? 30000 : 3000;
      timer = setTimeout(poll, next);
    } catch (e) {
      timer = setTimeout(poll, 5000);
    }
  }
  poll();
})();
</script>

${(() => {
  const provider = data.cfg.llmProvider ?? "claude";
  const gKey = data.cfg.geminiApiKey ?? "";
  const gImgModel = data.cfg.geminiImageModel ?? "";
  const gTextModel = data.cfg.geminiTextModel ?? "";
  const envGKey = process.env.GEMINI_API_KEY ?? "";
  const envAKey = process.env.ANTHROPIC_API_KEY ?? "";
  const activeGKey = gKey || envGKey;
  const mask = (k: string) => k ? `••••${k.slice(-4)}` : "(not set)";
  const envImgModel = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image-preview";
  const envTextModel = process.env.GEMINI_TEXT_MODEL ?? "gemini-3.1-pro-preview";
  const activeImgModel = gImgModel || envImgModel;
  const activeTextModel = gTextModel || envTextModel;
  const imgModels = [
    { id: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image (Nano Banana Pro, slowest, highest quality)" },
    { id: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image (Nano Banana, fast + cheap)" },
    { id: "gemini-2.5-flash-image-preview", label: "Gemini 2.5 Flash Image (older, fastest)" },
  ];
  const textModels = [
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview (latest, highest reasoning)" },
    { id: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview (proven)" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview (fast)" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (stable production, balanced)" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (stable, fast + cheap)" },
    { id: "gemini-pro-latest", label: "Gemini Pro Latest (alias, auto-bumps)" },
  ];
  const imgOpts = imgModels.map((m) => `<option value="${escapeHtml(m.id)}" ${activeImgModel === m.id ? "selected" : ""}>${escapeHtml(m.label)}</option>`).join("");
  const textOpts = textModels.map((m) => `<option value="${escapeHtml(m.id)}" ${activeTextModel === m.id ? "selected" : ""}>${escapeHtml(m.label)}</option>`).join("");
  return `<div class="card">
  <h2>AI Models</h2>
  <p style="color:#6b7280;font-size:13px">Pick which AI writes the slides + which renders the images. Live switchable — no restart.</p>
  <form method="POST" action="/llm/save">
    <label><strong>Slide-spec writer (text generation)</strong></label>
    <label><input type="radio" name="llmProvider" value="claude" ${provider === "claude" ? "checked" : ""}/> <strong>Claude</strong> (Anthropic Sonnet 4.6). 90% prompt-cache discount. Requires ANTHROPIC_API_KEY.</label>
    <label><input type="radio" name="llmProvider" value="gemini" ${provider === "gemini" ? "checked" : ""}/> <strong>Gemini</strong> (Google). Uses the Gemini text model picked below.</label>
    <p style="color:#9ca3af;font-size:11px">Research + playbook always use Claude (web_search tool). This switches only the slide-spec writer.</p>

    <label style="margin-top:14px"><strong>Gemini text model</strong> (used when slide writer = Gemini)</label>
    <select name="geminiTextModel">
      <option value="" ${!gTextModel ? "selected" : ""}>(env default: ${escapeHtml(envTextModel)})</option>
      ${textOpts}
    </select>
    <p style="color:#6b7280;font-size:12px;margin:2px 0">Active text: <code>${escapeHtml(activeTextModel)}</code></p>

    <label style="margin-top:14px"><strong>Gemini image model</strong> (always used for carousel images)</label>
    <select name="geminiImageModel">
      <option value="" ${!gImgModel ? "selected" : ""}>(env default: ${escapeHtml(envImgModel)})</option>
      ${imgOpts}
    </select>
    <p style="color:#6b7280;font-size:12px;margin:2px 0">Active image: <code>${escapeHtml(activeImgModel)}</code></p>

    <label style="margin-top:14px">Gemini API key (override env)</label>
    <input type="password" name="geminiApiKey" value="${escapeHtml(gKey)}" placeholder="AIza… leave blank to use env"/>
    <p style="color:#6b7280;font-size:12px;margin:2px 0">Active: ${escapeHtml(mask(activeGKey))}${envAKey ? " · ANTHROPIC_API_KEY set" : " · ANTHROPIC_API_KEY missing"}</p>

    <p style="color:#9ca3af;font-size:11px;margin-top:8px">Get Gemini key at aistudio.google.com/app/apikey. Persists in <code>${escapeHtml(config.pipeline.outputDir)}/.delivery.json</code> plaintext — local dev only.</p>
    <button type="submit" style="margin-top:8px">Save AI Models</button>
  </form>
</div>`;
})()}

<div class="card">
  <h2>Email (SMTP)</h2>
  ${(data.cfg.emailRecipients ?? []).length > 0
    ? `<p>Currently sending to: <strong>${(data.cfg.emailRecipients ?? []).map(escapeHtml).join(", ")}</strong></p>`
    : `<p style="color:#9ca3af">No recipients yet.</p>`
  }
  <form method="POST" action="/email/save">
    <label>Recipients (comma-separated, can be many):</label>
    <input type="text" name="recipients" value="${escapeHtml((data.cfg.emailRecipients ?? []).join(", "))}" placeholder="me@x.com, team@y.com, boss@z.com"/>
    <div class="toggle"><input type="checkbox" name="enableEmail" id="eem" ${data.cfg.enableEmail ? "checked" : ""}/><label for="eem" style="display:inline">Enabled</label></div>
    <button type="submit">Save Email</button>
  </form>
  <p style="color:#6b7280; font-size:12px; margin-top:8px">SMTP creds set via env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.</p>
  <form method="POST" action="/email/test" style="margin-top:12px">
    <button type="submit">Send Test Email</button>
  </form>
</div>

<div class="card">
  <h2>Schedule × Feed</h2>
  <p>Pick which type of carousel goes out at each daily time slot. Times shown in <strong>${escapeHtml(process.env.SCHEDULE_TZ ?? "Asia/Kolkata")}</strong>.</p>
  <p style="color:#6b7280;font-size:13px;line-height:1.6">
    <strong>What each feed means:</strong><br>
    <strong>viral</strong> — jaw-dropping AI demos, "wait what" moments (robot does the impossible, agent did X)<br>
    <strong>controversy</strong> — drama, lawsuits, founder fights, layoffs, leaks<br>
    <strong>prompts</strong> — best ChatGPT/Claude prompts of the week, agent tactics, copy-pasteable how-to<br>
    <strong>latest</strong> — fresh AI news, lab releases, raises, papers (just-the-facts, no spin)
  </p>
  <form method="POST" action="/slots/save">
    <table style="width:100%;border-collapse:collapse;margin:8px 0">
      <thead><tr style="border-bottom:1px solid #e5e7eb"><th style="text-align:left;padding:6px">Delivery time</th><th>viral</th><th>controversy</th><th>prompts</th><th>latest</th></tr></thead>
      <tbody>
        ${(process.env.SCHEDULE_CRONS ?? "53 12 * * *,53 14 * * *,38 17 * * *,38 18 * * *,23 19 * * *").split(",").map((c, i) => {
          const cron = c.trim();
          const human = humanizeCron(cron);
          const slot = data.cfg.slotFeeds?.[i] ?? [];
          const cb = (f: string) => `<input type="checkbox" name="slot_${i}_${f}" ${slot.includes(f as "viral") ? "checked" : ""}/>`;
          return `<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:6px"><strong>${escapeHtml(human)}</strong> <span style="color:#9ca3af;font-size:11px;font-family:monospace">cron ${escapeHtml(cron)}</span></td><td style="text-align:center">${cb("viral")}</td><td style="text-align:center">${cb("controversy")}</td><td style="text-align:center">${cb("prompts")}</td><td style="text-align:center">${cb("latest")}</td></tr>`;
        }).join("")}
      </tbody>
    </table>
    <button type="submit">Save Slot Mapping</button>
  </form>
  <p style="color:#6b7280; font-size:12px">Crons start ~7 minutes before the delivery target above (so research + render + zip + send completes on time). Edit <code>SCHEDULE_CRONS</code> in <code>.env</code> to change.</p>
  <p style="color:#6b7280; font-size:12px">Breaking-news watcher checks viral feed every 10 minutes. Only fires if newsworthiness ≥ ${escapeHtml(process.env.BREAKING_THRESHOLD ?? "0.85")} (won't spam mid-day).</p>
</div>

${(() => {
  const justTriggered = data.justTriggered ?? "";
  return `<div class="card" style="background:#eff6ff;border-color:#3b82f6">
  <h2>🚀 Send Now</h2>
  ${justTriggered ? `<p style="background:#dcfce7;border:1px solid #16a34a;padding:10px;border-radius:6px;color:#166534"><strong>✅ Queued: ${escapeHtml(justTriggered)}</strong> — ZIP lands in WhatsApp + email in ~2-3 min. <a href="http://localhost:13000/queue" target="_blank" style="color:#166534">Watch progress</a></p>` : ''}
  <p style="color:#6b7280;font-size:13px;margin-bottom:12px">One click = research → render → ZIP → send to your group + email. No waiting for cron.</p>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px">
    <form method="POST" action="/trigger/run"><input type="hidden" name="feed" value="viral"/><button type="submit" style="background:#dc2626;width:100%;padding:14px;font-size:15px;font-weight:600">📈 Send Viral</button></form>
    <form method="POST" action="/trigger/run"><input type="hidden" name="feed" value="controversy"/><button type="submit" style="background:#7c2d12;width:100%;padding:14px;font-size:15px;font-weight:600">⚔️ Send Controversy</button></form>
    <form method="POST" action="/trigger/run"><input type="hidden" name="feed" value="prompts"/><button type="submit" style="background:#7c3aed;width:100%;padding:14px;font-size:15px;font-weight:600">💡 Send Prompt</button></form>
    <form method="POST" action="/trigger/run"><input type="hidden" name="feed" value="latest"/><button type="submit" style="background:#0369a1;width:100%;padding:14px;font-size:15px;font-weight:600">📰 Send Latest News</button></form>
    <form method="POST" action="/trigger/newsletter"><button type="submit" style="background:#059669;width:100%;padding:14px;font-size:15px;font-weight:600">📬 Pull Newsletter Pick</button></form>
  </div>
</div>`;
})()}

<div class="card" style="background:#fff7ed;border-color:#fdba74">
  <h2>Reset / Maintenance</h2>
  <p style="color:#6b7280;font-size:13px">Use when something gets stuck. Each button is targeted; nothing else changes.</p>

  <form method="POST" action="/reset/wa-session" onsubmit="return confirm('Disconnect WhatsApp and wipe session? You will need to scan a fresh QR.')" style="display:inline-block;margin:4px">
    <button type="submit" style="background:#dc2626">Reset WA Session</button>
  </form>
  <span style="color:#6b7280;font-size:12px">Force a new QR scan. Use if QR not appearing or wrong account linked.</span><br>

  <form method="POST" action="/reset/seen" onsubmit="return confirm('Clear seen-articles list?')" style="display:inline-block;margin:4px">
    <button type="submit" style="background:#dc2626">Clear Seen Articles</button>
  </form>
  <span style="color:#6b7280;font-size:12px">Allows already-rendered stories to re-render. Use if pipeline says "no fresh stories".</span><br>

  <form method="POST" action="/reset/playbook" onsubmit="return confirm('Force playbook re-research on next carousel?')" style="display:inline-block;margin:4px">
    <button type="submit" style="background:#dc2626">Force Playbook Refresh</button>
  </form>
  <span style="color:#6b7280;font-size:12px">Re-fetch live viral copy patterns. Use weekly or after niche change.</span><br>

  <form method="POST" action="/reset/queue" onsubmit="return confirm('Clear all pending/delayed BullMQ jobs?')" style="display:inline-block;margin:4px">
    <button type="submit" style="background:#dc2626">Clear Job Queue</button>
  </form>
  <span style="color:#6b7280;font-size:12px">Drains pending/delayed/stale jobs. Use after changing slot config to cancel already-queued runs.</span><br>

  <form method="POST" action="/reset/all" onsubmit="return confirm('NUKE EVERYTHING: WhatsApp session, seen list, playbook, watch state, ALL output folders. Delivery config (groups/emails) preserved. Continue?')" style="display:inline-block;margin:4px">
    <button type="submit" style="background:#7c2d12">Nuke All (keep config)</button>
  </form>
  <span style="color:#6b7280;font-size:12px">Full reset. Keeps your group + email recipients.</span>
</div>

<div class="card">
  <h2>Output Folders (${data.folders.length})</h2>
  ${data.folders.length === 0
    ? `<p style="color:#9ca3af">No carousels generated yet.</p>`
    : `<form method="POST" action="/folders/delete-all" onsubmit="return confirm('Delete ALL ${data.folders.length} folders?')" style="margin-bottom:12px">
         <button type="submit" style="background:#dc2626">Delete All</button>
       </form>
       <table style="width:100%;border-collapse:collapse">
         <thead><tr style="border-bottom:1px solid #e5e7eb"><th style="text-align:left;padding:6px">Folder</th><th style="text-align:right;padding:6px">Size</th><th style="text-align:right;padding:6px">Modified</th><th></th></tr></thead>
         <tbody>${data.folders.map((f) => `
           <tr style="border-bottom:1px solid #f3f4f6">
             <td style="padding:6px;font-family:monospace;font-size:12px">${escapeHtml(f.name)}</td>
             <td style="padding:6px;text-align:right">${f.sizeKB > 1024 ? (f.sizeKB / 1024).toFixed(1) + " MB" : f.sizeKB + " KB"}</td>
             <td style="padding:6px;text-align:right;font-size:12px;color:#6b7280">${new Date(f.mtime).toISOString().slice(0, 16).replace("T", " ")}</td>
             <td style="padding:6px;text-align:right"><form method="POST" action="/folders/delete" onsubmit="return confirm('Delete ${escapeHtml(f.name)}?')" style="display:inline"><input type="hidden" name="folder" value="${escapeHtml(f.name)}"/><button type="submit" style="background:#dc2626;padding:4px 10px;font-size:12px">Delete</button></form></td>
           </tr>`).join("")}</tbody>
       </table>`
  }
</div>

<div class="card">
  <h2>Current Config</h2>
  <pre>${escapeHtml(JSON.stringify(data.cfg, null, 2))}</pre>
</div>

</body></html>`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Convert "53 12 * * *" → "1:00 PM IST (delivery)". Adds 7-min lead so cron 12:53 = 1:00 PM target. */
function humanizeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;
  const min = Number.parseInt(parts[0]!, 10);
  const hr = Number.parseInt(parts[1]!, 10);
  if (!Number.isFinite(min) || !Number.isFinite(hr)) return cron;
  // Add 7-min lead time to get the actual delivery target
  let delivM = min + 7;
  let delivH = hr;
  if (delivM >= 60) {
    delivM -= 60;
    delivH += 1;
  }
  if (delivH >= 24) delivH -= 24;
  const ampm = delivH >= 12 ? "PM" : "AM";
  let displayH = delivH % 12;
  if (displayH === 0) displayH = 12;
  const mm = delivM.toString().padStart(2, "0");
  const tz = (process.env.SCHEDULE_TZ ?? "Asia/Kolkata").includes("Kolkata") ? "IST" : process.env.SCHEDULE_TZ ?? "";
  return `${displayH}:${mm} ${ampm} ${tz}`.trim();
}

function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const [k, v] = pair.split("=");
    if (k) out[decodeURIComponent(k.replace(/\+/g, " "))] = decodeURIComponent((v ?? "").replace(/\+/g, " "));
  }
  return out;
}

interface FolderInfo {
  name: string;
  sizeKB: number;
  mtime: number;
}

async function dirSize(p: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(p, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(p, e.name);
      if (e.isDirectory()) total += await dirSize(fp);
      else if (e.isFile()) {
        try { total += (await stat(fp)).size; } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return total;
}

async function listOutFolders(): Promise<FolderInfo[]> {
  const outDir = config.pipeline.outputDir;
  try {
    const entries = await readdir(outDir, { withFileTypes: true });
    const folders: FolderInfo[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".")) continue;
      const fp = path.join(outDir, e.name);
      const st = await stat(fp).catch(() => null);
      if (!st) continue;
      const size = await dirSize(fp);
      folders.push({ name: e.name, sizeKB: Math.round(size / 1024), mtime: st.mtimeMs });
    }
    folders.sort((a, b) => b.mtime - a.mtime);
    return folders;
  } catch {
    return [];
  }
}

let groupsCache: { ts: number; groups: { id: string; name: string }[] } | null = null;
let groupsFetchInFlight = false;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label} took >${ms}ms`)), ms)),
  ]);
}

async function listGroups(): Promise<{ id: string; name: string }[]> {
  if (!state.client || !state.ready) return [];
  if (groupsCache && groupsCache.groups.length > 0 && Date.now() - groupsCache.ts < 5 * 60_000) return groupsCache.groups;
  if (groupsFetchInFlight) return groupsCache?.groups ?? [];
  groupsFetchInFlight = true;
  try {
    // Fast path only: try multiple Store keys in priority order.
    // Background getChats() (fired on ready) primes Store as it completes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pupPage: any = (state.client as unknown as { pupPage?: unknown }).pupPage;
    if (!pupPage) {
      log.warn("wa-config", "no pupPage, can't read Store");
      return groupsCache?.groups ?? [];
    }
    try {
      const groups = await withTimeout(
        pupPage.evaluate(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const w = window as unknown as { Store?: Record<string, unknown> };
          const Store = w.Store;
          if (!Store) return [];

          // Try 1: Store.Chat.getModelsArray() filter isGroup (most populated source)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chatStore: any = Store.Chat;
          if (chatStore?.getModelsArray) {
            const arr = chatStore.getModelsArray() as Array<{ id?: { _serialized?: string }; isGroup?: boolean; name?: string; formattedTitle?: string }>;
            const groups = arr
              .filter((c) => c.isGroup === true)
              .map((c) => ({ id: c.id?._serialized ?? "", name: c.name ?? c.formattedTitle ?? "(unnamed)" }))
              .filter((c) => c.id);
            if (groups.length > 0) return groups;
          }

          // Try 2: Store.GroupMetadata.getModelsArray() (lightweight, group-only)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const meta: any = Store.GroupMetadata;
          if (meta?.getModelsArray) {
            const arr = meta.getModelsArray() as Array<{ id?: { _serialized?: string; toString?: () => string }; subject?: string; name?: string }>;
            const groups = arr
              .map((g) => ({
                id: g.id?._serialized ?? (g.id?.toString?.() ?? ""),
                name: g.subject ?? g.name ?? "(unnamed)",
              }))
              .filter((g) => g.id);
            if (groups.length > 0) return groups;
          }

          return [];
        }) as Promise<{ id: string; name: string }[]>,
        10_000,
        "storeRead"
      );
      const sorted = groups.sort((a, b) => a.name.localeCompare(b.name));
      if (sorted.length > 0) groupsCache = { ts: Date.now(), groups: sorted };
      log.info("wa-config", `Store read: ${sorted.length} groups`);
      return sorted;
    } catch (e) {
      log.warn("wa-config", `Store read failed: ${(e as Error).message}`);
      return groupsCache?.groups ?? [];
    }
  } catch (e) {
    log.warn("wa-config", `listGroups failed: ${(e as Error).message}`);
    return groupsCache?.groups ?? [];
  } finally {
    groupsFetchInFlight = false;
  }
}

export function startConfigServer(): void {
  startWa();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost`);
      if (req.method === "GET" && url.pathname === "/") {
        const cfg = await loadDeliveryConfig();
        const groups = state.ready ? await listGroups() : [];
        const folders = await listOutFolders();
        const qrDataUrl = state.qr ? await qrcode.toDataURL(state.qr, { width: 280 }) : null;
        const justTriggered = url.searchParams.get("triggered") ?? undefined;
        return html(res, PAGE({ ready: state.ready, qrDataUrl, cfg, groups, folders, justTriggered }));
      }
      if (req.method === "POST" && url.pathname === "/folders/delete") {
        const form = parseFormBody(await readBody(req));
        const folder = form.folder ?? "";
        if (!folder || folder.includes("..") || folder.includes("/")) {
          res.writeHead(400).end("invalid folder name");
          return;
        }
        const target = path.join(config.pipeline.outputDir, folder);
        await rm(target, { recursive: true, force: true });
        await rm(`${target}.zip`, { force: true }).catch(() => undefined);
        log.ok("wa-config", `deleted folder ${folder}`);
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/folders/delete-all") {
        const folders = await listOutFolders();
        for (const f of folders) {
          const target = path.join(config.pipeline.outputDir, f.name);
          await rm(target, { recursive: true, force: true }).catch(() => undefined);
          await rm(`${target}.zip`, { force: true }).catch(() => undefined);
        }
        log.ok("wa-config", `deleted ${folders.length} folders`);
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/internal/wa-send") {
        // Internal HTTP bridge: worker process posts here so we share the single WA client.
        const body = await readBody(req);
        let payload: { zipPath: string; chatId?: string; chatName?: string; caption?: string };
        try {
          payload = JSON.parse(body) as typeof payload;
        } catch {
          return json(res, { error: "invalid JSON" }, 400);
        }
        if (!payload.zipPath) return json(res, { error: "zipPath required" }, 400);
        if (!state.client || !state.ready) return json(res, { error: "wa_not_ready" }, 503);
        try {
          const { sendZipViaClient } = await import("./whatsapp.js");
          await sendZipViaClient(state.client, payload.zipPath, {
            chatId: payload.chatId,
            chatName: payload.chatName,
            caption: payload.caption,
          });
          return json(res, { sent: true });
        } catch (e) {
          log.err("wa-config", `internal send failed: ${(e as Error).message}`);
          return json(res, { error: (e as Error).message }, 500);
        }
      }
      if (req.method === "POST" && url.pathname === "/wa/select") {
        const form = parseFormBody(await readBody(req));
        const groupId = form.groupId;
        const enableWhatsApp = !!form.enableWhatsApp;
        const groups = await listGroups();
        const found = groups.find((g) => g.id === groupId);
        const next = await saveDeliveryConfig({
          whatsappGroupId: groupId || undefined,
          whatsappGroupName: found?.name,
          enableWhatsApp,
        });
        log.ok("wa-config", `target group: ${found?.name ?? groupId ?? "(none)"} enabled=${enableWhatsApp}`);
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/trigger/run") {
        const form = parseFormBody(await readBody(req));
        const feed = (form.feed ?? "viral") as "viral" | "controversy" | "prompts" | "latest";
        let triggeredMsg = `${feed} feed (no fresh stories)`;
        try {
          const { researchTopArticles } = await import("../research/index.js");
          const { carouselQueue } = await import("../queue/queue.js");
          const articles = await researchTopArticles({ feed, limit: 1, skipSeen: true });
          if (articles.length) {
            const a = articles[0]!;
            await carouselQueue.add("render", {
              url: a.url,
              title: a.title,
              body: a.body,
              source: a.source,
              feed,
              newsworthiness: a.topicScore,
              related_image_urls: a.relatedImageUrls,
              related_video_urls: a.relatedVideoUrls,
              entity_x_handles: a.entityXHandles,
            } as Parameters<typeof carouselQueue.add>[1]);
            triggeredMsg = `${feed.toUpperCase()}: ${a.title.slice(0, 80)}`;
            log.ok("wa-config", `manual trigger [${feed}]: queued "${a.title.slice(0, 60)}"`);
          } else {
            log.warn("wa-config", `manual trigger [${feed}]: no fresh stories`);
          }
        } catch (e) {
          log.err("wa-config", `manual trigger failed: ${(e as Error).message}`);
          triggeredMsg = `Failed: ${(e as Error).message}`;
        }
        res.writeHead(303, { location: `/?triggered=${encodeURIComponent(triggeredMsg)}` });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/trigger/newsletter") {
        let msg = "Newsletter poll done";
        try {
          const { pollNewsletters } = await import("../queue/newsletterWatch.js");
          const r = await pollNewsletters();
          msg = `Newsletter pull: enqueued ${r.enqueued} of ${r.checked} checked`;
          log.ok("wa-config", `manual newsletter trigger: enqueued=${r.enqueued} checked=${r.checked}`);
        } catch (e) {
          log.err("wa-config", `manual newsletter trigger failed: ${(e as Error).message}`);
          msg = `Failed: ${(e as Error).message}`;
        }
        res.writeHead(303, { location: `/?triggered=${encodeURIComponent(msg)}` });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/reset/queue") {
        const { carouselQueue } = await import("../queue/queue.js");
        const jobs = await carouselQueue.getJobs(["delayed", "waiting", "paused", "active"]);
        let cleared = 0;
        for (const j of jobs) {
          try { await j.remove(); cleared += 1; } catch { /* ignore */ }
        }
        log.ok("wa-config", `cleared ${cleared} pending jobs from queue`);
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/reset/wa-session") {
        if (state.client) await state.client.logout().catch(() => undefined);
        if (state.client) await state.client.destroy().catch(() => undefined);
        state.client = null;
        state.qr = null;
        state.ready = false;
        state.initializing = false;
        const sessionDir = path.join(config.pipeline.outputDir, ".wa-session");
        await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
        log.ok("wa-config", "WA session wiped, restarting client for fresh QR");
        startWa();
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/reset/seen") {
        await rm(path.join(config.pipeline.outputDir, ".seen.json"), { force: true }).catch(() => undefined);
        log.ok("wa-config", "seen-articles cleared");
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/reset/playbook") {
        await rm(path.join(config.pipeline.outputDir, ".playbook.json"), { force: true }).catch(() => undefined);
        log.ok("wa-config", "playbook cleared (will refresh on next carousel)");
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/reset/all") {
        if (state.client) await state.client.logout().catch(() => undefined);
        if (state.client) await state.client.destroy().catch(() => undefined);
        state.client = null;
        state.qr = null;
        state.ready = false;
        state.initializing = false;
        const out = config.pipeline.outputDir;
        // Wipe state files
        for (const f of [".wa-session", ".seen.json", ".playbook.json", ".watch-state"]) {
          await rm(path.join(out, f), { recursive: true, force: true }).catch(() => undefined);
        }
        // Wipe carousel folders (keep .delivery.json + dotfiles already preserved by listOutFolders skip)
        const folders = await listOutFolders();
        for (const f of folders) {
          await rm(path.join(out, f.name), { recursive: true, force: true }).catch(() => undefined);
          await rm(path.join(out, `${f.name}.zip`), { force: true }).catch(() => undefined);
        }
        log.ok("wa-config", `nuked: state files + ${folders.length} carousel folders. Delivery config preserved. Restarting WA client.`);
        startWa();
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/automation/toggle") {
        const cfg = await loadDeliveryConfig();
        const turningOn = !cfg.automationEnabled;
        if (turningOn) {
          const waOk = cfg.enableWhatsApp && (cfg.whatsappGroupId || cfg.whatsappGroupName);
          const emailOk = cfg.enableEmail && (cfg.emailRecipients ?? []).length > 0;
          if (!waOk && !emailOk) {
            html(res, `<!doctype html><html><body style="font-family:system-ui;max-width:560px;margin:60px auto;padding:0 16px"><h2>Cannot start automation</h2><p>Configure AND enable at least one delivery channel first:</p><ul><li><strong>WhatsApp</strong>: pick a group + check Enabled</li><li><strong>Email</strong>: add recipients + check Enabled</li></ul><p><a href="/">← Back to config</a></p></body></html>`, 400);
            return;
          }
        }
        await saveDeliveryConfig({ automationEnabled: turningOn });
        log.ok("wa-config", `automation ${turningOn ? "STARTED" : "STOPPED"}`);
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/slots/save") {
        const form = parseFormBody(await readBody(req));
        const cronCount = (process.env.SCHEDULE_CRONS ?? "53 12 * * *,53 14 * * *,38 17 * * *,38 18 * * *,23 19 * * *").split(",").length;
        const feeds: ("viral" | "controversy" | "prompts" | "latest")[] = ["viral", "controversy", "prompts", "latest"];
        const slotFeeds: ("viral" | "controversy" | "prompts" | "latest")[][] = [];
        for (let i = 0; i < cronCount; i += 1) {
          const picks: ("viral" | "controversy" | "prompts" | "latest")[] = [];
          for (const f of feeds) {
            if (form[`slot_${i}_${f}`]) picks.push(f);
          }
          slotFeeds.push(picks);
        }
        await saveDeliveryConfig({ slotFeeds });
        log.ok("wa-config", `slot mapping saved: ${slotFeeds.map((s, i) => `${i}:[${s.join(",")}]`).join(" ")}`);
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/email/test") {
        const cfg = await loadDeliveryConfig();
        const { sendCarouselEmail } = await import("./email.js");
        for (const to of cfg.emailRecipients ?? []) {
          const testBody = [
            "If you got this, SMTP works.",
            "",
            "──────────────────────────────────────────",
            "TEST PAYLOAD (simulates a real carousel delivery)",
            "──────────────────────────────────────────",
            "",
            "Carousel: TEST — ANTHROPIC RAISED AT $400B. THAT'S 4X SPACEX.",
            "Feed: viral",
            "Source: https://example.com/test-article",
            "",
            "First line is the hook. Sharper or different angle from the cover.",
            "",
            "Three short context lines follow.",
            "Each adds one idea the slides couldn't fit.",
            "Multiple short sentences > one long sentence.",
            "",
            "Save this for the next time someone asks if AI is in a bubble.",
            "Comment STACK and I'll DM the breakdown.",
            "",
            "Follow @unfoldedai for more.",
            "",
            "#AI #Anthropic #LLM #TechNews #AINews",
            "",
            "──────────────────────────────────────────",
            "Files that would attach on a real run:",
            "  • 01_hook.png  (Anton headline + photo + yellow highlights + SWIPE chip)",
            "  • 02_body.png  (text-top + photo-bottom, mixed case body)",
            "  • 03_body.png  (stat_card variant)",
            "  • 04_body.png  (quote_pull variant)",
            "  • caption.txt  (full Instagram caption above)",
            "  • spec.json    (the structured carousel spec the renderer used)",
            "  • dm-reply.md  (when feed=prompts: what to DM back to commenters)",
            "  • 00_source.mp4 (when VIDEO_COVER=true)",
            "──────────────────────────────────────────",
            "",
            "If this email rendered cleanly with all sections visible, SMTP is good to go.",
          ].join("\n");
          await sendCarouselEmail({ to, subject: "Carousel Factory test email — full payload preview", body: testBody }).catch((e) => log.err("wa-config", `test email to ${to} failed: ${(e as Error).message}`));
        }
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/llm/save") {
        const form = parseFormBody(await readBody(req));
        const provider = (form.llmProvider === "gemini" ? "gemini" : "claude") as "claude" | "gemini";
        const geminiApiKey = (form.geminiApiKey ?? "").trim();
        const geminiImageModel = (form.geminiImageModel ?? "").trim();
        const geminiTextModel = (form.geminiTextModel ?? "").trim();
        await saveDeliveryConfig({
          llmProvider: provider,
          geminiApiKey,
          geminiImageModel,
          geminiTextModel,
        });
        const { invalidateGeminiRuntimeCache } = await import("../render/geminiClient.js");
        const { invalidateTextGenCache } = await import("../llm/textGen.js");
        invalidateGeminiRuntimeCache();
        invalidateTextGenCache();
        log.ok("wa-config", `LLM saved: writer=${provider} text=${geminiTextModel || "env"} image=${geminiImageModel || "env"} key=${geminiApiKey ? "set" : "env"}`);
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/email/save") {
        const form = parseFormBody(await readBody(req));
        const recipients = (form.recipients ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        await saveDeliveryConfig({ emailRecipients: recipients, enableEmail: !!form.enableEmail });
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "GET" && url.pathname === "/wa/logout") {
        if (state.client) await state.client.logout().catch(() => undefined);
        state.client = null;
        state.qr = null;
        state.ready = false;
        state.initializing = false;
        startWa();
        res.writeHead(303, { location: "/" });
        return res.end();
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        return json(res, { ready: state.ready, hasQr: !!state.qr });
      }
      if (req.method === "GET" && url.pathname === "/api/wa-status") {
        const groups = state.ready ? await listGroups() : [];
        const qrDataUrl = state.qr ? await qrcode.toDataURL(state.qr, { width: 280 }).catch(() => null) : null;
        const totalChats = state.ready && state.client ? await state.client.getChats().then((c) => c.length).catch(() => -1) : 0;
        return json(res, {
          ready: state.ready,
          initializing: state.initializing,
          qrDataUrl,
          groups,
          totalChats,
        });
      }
      if (req.method === "POST" && url.pathname === "/api/wa-refresh-groups") {
        groupsCache = null;
        const groups = state.ready ? await listGroups() : [];
        return json(res, { groups });
      }
      res.writeHead(404).end("not found");
    } catch (e) {
      log.err("wa-config", `handler error: ${(e as Error).message}`);
      res.writeHead(500).end((e as Error).message);
    }
  });
  server.listen(PORT, () => {
    log.ok("wa-config", `config UI on http://0.0.0.0:${PORT}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startConfigServer();
}
