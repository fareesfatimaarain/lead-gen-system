// Calling Agent — control center SPA (vanilla, hash-routed).

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const view = $("#view");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { data });
  return data;
}

function toast(message, kind = "info") {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3800);
}

function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
function fmtTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const LEAD_STATUS = {
  queued: "Queued", dialing: "Dialing", in_progress: "On Call", completed: "Completed",
  no_answer: "No Answer", voicemail: "Voicemail", failed: "Failed", dnc: "Do Not Call", done: "Done"
};
const CAMPAIGN_STATUS = { draft: "Draft", running: "Running", paused: "Paused", completed: "Completed" };
const CLASS_KEYS = { Hot: "hot", Warm: "warm", Cold: "cold", Skipped: "skipped", Unclassified: "unclassified" };

function statusBadge(status) {
  return `<span class="badge st-${esc(status)}">${esc(LEAD_STATUS[status] || status || "—")}</span>`;
}
function classBadge(c) {
  if (!c) return `<span class="badge unclassified">—</span>`;
  return `<span class="badge ${CLASS_KEYS[c] || "unclassified"}">${esc(c)}</span>`;
}
function campaignChip(status) {
  return `<span class="status-chip cs-${esc(status)}">${esc(CAMPAIGN_STATUS[status] || status)}</span>`;
}

function progressBar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
          <span class="progress-label">${done}/${total} done · ${pct}%</span>`;
}

// ---------------- Router ----------------

let pollTimer = null;
function clearPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function router() {
  clearPoll();
  const hash = location.hash.replace(/^#/, "") || "/";
  $$("#nav .nav-link").forEach((a) => a.classList.toggle("active", a.dataset.route === hash));
  try {
    if (hash === "/") return renderOverview();
    if (hash === "/tools") return renderTools();
    if (hash === "/dnc") return renderDnc();
    const m = hash.match(/^\/campaign\/(.+)$/);
    if (m) return renderCampaign(m[1]);
    renderOverview();
  } catch (err) {
    view.innerHTML = `<div class="empty">Failed to load: ${esc(err.message)}</div>`;
  }
}

// ---------------- Overview ----------------

async function renderOverview() {
  const [status] = await Promise.all([api("/api/status").catch(() => null)]);
  view.innerHTML = `
    <header class="topbar">
      <div class="topbar-title">
        <p class="eyebrow">Command Center</p>
        <h1>Outreach Overview</h1>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" id="ovRefresh"><span class="btn-ico">↻</span> Refresh</button>
      </div>
    </header>
    ${status && status.warnings && status.warnings.length ? `<div class="warnings">${status.warnings.map((w) => `<div class="warning">${esc(w)}</div>`).join("")}</div>` : ""}
    <section class="metrics" id="ovMetrics"></section>
    <section class="grid two">
      <article class="card">
        <div class="panel-head"><div><p class="eyebrow">Pipeline</p><h2>Campaigns</h2></div>
          <button class="btn btn-secondary" id="ovNew"><span class="btn-ico">＋</span> New</button></div>
        <div id="ovCampaigns" class="campaign-list"></div>
      </article>
      <article class="card">
        <div class="panel-head"><div><p class="eyebrow">Scheduling</p><h2>Upcoming Meetings</h2></div></div>
        <div id="ovMeetings" class="feed"></div>
      </article>
    </section>
    <section class="card full">
      <div class="panel-head"><div><p class="eyebrow">Live</p><h2>Recent Calls</h2></div></div>
      <div id="ovCalls" class="feed"></div>
    </section>`;

  $("#ovRefresh").onclick = refreshOverview;
  $("#ovNew").onclick = openNewCampaign;
  await refreshOverview();
  pollTimer = setInterval(refreshOverview, 5000);
}

async function refreshOverview() {
  const data = await api("/api/overview");
  const t = data.totals;
  $("#ovMetrics").innerHTML = [
    metric("Total Leads", t.total, ""),
    metric("Hot", t.hot, "hot"),
    metric("Warm", t.warm, "warm"),
    metric("Cold", t.cold, "cold"),
    metric("Completed", t.completed, "ok"),
    metric("Meetings", data.upcomingBookings.length, "violet")
  ].join("");

  $("#ovCampaigns").innerHTML = data.campaigns.length
    ? data.campaigns.map(campaignCard).join("")
    : `<div class="empty">No campaigns yet. Click “New” to import your first lead list.</div>`;
  $$("#ovCampaigns [data-open]").forEach((b) => (b.onclick = () => (location.hash = `#/campaign/${b.dataset.open}`)));
  $$("#ovCampaigns [data-action]").forEach((b) => (b.onclick = () => campaignAction(b.dataset.id, b.dataset.action)));

  $("#ovMeetings").innerHTML = data.upcomingBookings.length
    ? data.upcomingBookings.map(bookingRow).join("")
    : `<div class="empty small">No meetings booked yet.</div>`;

  $("#ovCalls").innerHTML = data.recentCalls.length
    ? data.recentCalls.map(callRow).join("")
    : `<div class="empty small">No calls yet.</div>`;
}

function metric(label, value, kind) {
  return `<article class="metric ${kind}"><span class="metric-label">${esc(label)}</span>
    <strong>${value ?? 0}</strong><span class="metric-bar"></span></article>`;
}

function campaignCard(c) {
  const s = c.stats || { total: 0, finished: 0, classCounts: {}, statusCounts: {} };
  const controls = [];
  if (c.status === "draft" || c.status === "paused") controls.push(`<button class="btn btn-primary sm" data-action="start" data-id="${c.id}">▶ Start</button>`);
  if (c.status === "running") controls.push(`<button class="btn btn-ghost sm" data-action="pause" data-id="${c.id}">⏸ Pause</button>`);
  return `<div class="campaign-card">
    <div class="cc-head">
      <button class="cc-name" data-open="${c.id}">${esc(c.name)}</button>
      ${campaignChip(c.status)}
    </div>
    ${progressBar(s.finished, s.total)}
    <div class="cc-stats">
      <span>${s.statusCounts.queued || 0} queued</span>
      <span class="dot hot">${s.classCounts.Hot || 0} hot</span>
      <span>${s.statusCounts.completed || 0} done</span>
    </div>
    <div class="cc-actions">${controls.join("")}
      <button class="btn btn-secondary sm" data-open="${c.id}">Open →</button></div>
  </div>`;
}

function bookingRow(b) {
  return `<div class="feed-item">
    <div class="fi-icon violet">📅</div>
    <div class="fi-body"><strong>${esc(b.attendee_name || "Lead")}</strong>
      <span>${esc(b.attendee_email || "")}</span></div>
    <div class="fi-meta">${esc(fmtDateTime(b.start_time))}</div>
  </div>`;
}

function callRow(c) {
  const icon = c.disposition === "answered" ? "✅" : c.disposition === "no_answer" ? "📵" : c.disposition === "voicemail" ? "📼" : c.status === "ended" ? "⚠️" : "📞";
  return `<div class="feed-item">
    <div class="fi-icon">${icon}</div>
    <div class="fi-body">
      <strong>${esc(c.classification || (c.disposition || c.status || "in progress"))}</strong>
      <span>${esc(c.reason || c.ended_reason || "")}</span>
    </div>
    <div class="fi-meta">${esc(fmtTime(c.created_at))}</div>
  </div>`;
}

// ---------------- Campaign detail ----------------

const cmpFilters = { status: "", classification: "", search: "" };

async function renderCampaign(id) {
  const { campaign } = await api(`/api/campaigns/${id}`);
  const c = campaign;
  view.innerHTML = `
    <header class="topbar">
      <div class="topbar-title">
        <p class="eyebrow"><a href="#/" class="back">← Overview</a></p>
        <h1 id="cmpName">${esc(c.name)}</h1>
      </div>
      <div class="actions" id="cmpControls"></div>
    </header>
    <section class="metrics" id="cmpMetrics"></section>
    <div class="card full" id="cmpProgressCard"><div class="panel-head"><div><p class="eyebrow">Progress</p><h2>Campaign Progress</h2></div><span id="cmpDialHint" class="hint"></span></div><div id="cmpProgress"></div></div>

    <section class="grid two">
      <article class="card">
        <div class="panel-head"><div><p class="eyebrow">Leads</p><h2>Import</h2></div></div>
        <p class="help">Upload a CSV or paste rows. We auto-detect name / phone / email / company columns and normalize numbers to E.164.</p>
        <input type="file" id="csvFile" accept=".csv,text/csv" class="file-input" />
        <textarea id="csvText" rows="5" placeholder="name,phone,company&#10;Ayesha,03001234567,Acme"></textarea>
        <div class="form-row"><button class="btn btn-primary" id="importBtn">Import Leads</button><span id="importMsg" class="hint"></span></div>
      </article>
      <article class="card">
        <div class="panel-head"><div><p class="eyebrow">Config</p><h2>Settings</h2></div><button class="btn btn-secondary sm" id="saveSettings">Save</button></div>
        <div class="field-grid">
          <label class="field"><span>Phone number ID</span><input id="setPhone" value="${esc(c.phone_number_id || "")}" placeholder="phone_number_id" /></label>
          <label class="field"><span>Assistant ID</span><input id="setAssistant" value="${esc(c.assistant_id || "")}" /></label>
          <label class="field"><span>Timezone</span><input id="setTz" value="${esc(c.timezone || "")}" /></label>
          <label class="field"><span>Max attempts</span><input id="setMax" type="number" min="1" value="${c.max_attempts}" /></label>
          <label class="field"><span>Call from (hr)</span><input id="setStart" type="number" min="0" max="23" value="${c.call_window_start}" /></label>
          <label class="field"><span>Call until (hr)</span><input id="setEnd" type="number" min="0" max="23" value="${c.call_window_end}" /></label>
        </div>
      </article>
    </section>

    <section class="card full">
      <div class="panel-head"><div><p class="eyebrow">Agent</p><h2>Agent Script &amp; Knowledge</h2></div><button class="btn btn-secondary sm" id="saveScript">Save Script</button></div>
      <p class="help">Configure what the agent says and what it knows — no code required. Applied to every call this campaign places.</p>
      <div class="script-grid">
        <label class="field"><span>First message — the agent's opening line</span>
          <textarea id="setFirstMsg" rows="2">${esc(c.first_message || "")}</textarea></label>
        <label class="field"><span>System prompt — how the agent behaves and qualifies</span>
          <textarea id="setSysPrompt" rows="10">${esc(c.system_prompt || "")}</textarea></label>
        <label class="field"><span>Knowledge base — facts the agent answers questions from</span>
          <textarea id="setKb" rows="8" placeholder="Paste product details, FAQs, pricing guidance, policies, objection handling… The agent uses this to answer prospect questions accurately.">${esc(c.knowledge_base || "")}</textarea></label>
      </div>
    </section>

    <section class="card full">
      <div class="panel-head"><div><p class="eyebrow">Pipeline</p><h2>Leads</h2></div>
        <div class="filters">
          <input id="leadSearch" type="search" placeholder="Search name / phone / company" />
          <select id="leadStatusFilter"><option value="">All statuses</option>${Object.entries(LEAD_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
          <select id="leadClassFilter"><option value="">All classes</option><option>Hot</option><option>Warm</option><option>Cold</option><option>Skipped</option><option>Unclassified</option></select>
        </div>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>Lead</th><th>Phone</th><th>Status</th><th>Class</th><th>Next Action</th><th>Attempts</th><th>Reason</th>
      </tr></thead><tbody id="leadRows"></tbody></table></div>
      <p id="leadEmpty" class="empty" hidden>No leads match.</p>
    </section>

    <section class="grid two">
      <article class="card"><div class="panel-head"><div><p class="eyebrow">Live</p><h2>Call Activity</h2></div></div><div id="cmpCalls" class="feed"></div></article>
      <article class="card"><div class="panel-head"><div><p class="eyebrow">Scheduling</p><h2>Meetings Booked</h2></div></div><div id="cmpMeetings" class="feed"></div></article>
    </section>`;

  // wire import
  $("#csvFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (file) $("#csvText").value = await file.text();
  };
  $("#importBtn").onclick = () => importLeads(id);
  $("#saveSettings").onclick = () => saveSettings(id);
  $("#saveScript").onclick = () => saveScript(id);
  const applyFilters = () => {
    cmpFilters.search = $("#leadSearch").value.trim();
    cmpFilters.status = $("#leadStatusFilter").value;
    cmpFilters.classification = $("#leadClassFilter").value;
    refreshLeads(id);
  };
  $("#leadSearch").oninput = applyFilters;
  $("#leadStatusFilter").onchange = applyFilters;
  $("#leadClassFilter").onchange = applyFilters;

  await refreshCampaign(id);
  pollTimer = setInterval(() => refreshCampaign(id), 4000);
}

async function refreshCampaign(id) {
  let data;
  try {
    data = await api(`/api/campaigns/${id}`);
  } catch {
    return;
  }
  const c = data.campaign;
  const s = c.stats;
  updateDialerState(c.status);

  // controls
  const controls = [];
  if (c.status === "draft" || c.status === "paused") controls.push(`<button class="btn btn-primary" data-do="start">▶ Start Calling</button>`);
  if (c.status === "running") controls.push(`<button class="btn btn-ghost" data-do="pause">⏸ Pause</button>`);
  controls.push(`<button class="btn btn-secondary" data-do="dial">📞 Dial Next Now</button>`);
  controls.push(`<button class="btn btn-ghost" data-do="delete" title="Delete campaign">🗑</button>`);
  const ctrlEl = $("#cmpControls");
  if (ctrlEl) {
    ctrlEl.innerHTML = campaignChip(c.status) + controls.join("");
    $$("#cmpControls [data-do]").forEach((b) => (b.onclick = () => campaignAction(id, b.dataset.do)));
  }

  if ($("#cmpMetrics")) {
    $("#cmpMetrics").innerHTML = [
      metric("Total", s.total, ""),
      metric("Queued", s.statusCounts.queued || 0, ""),
      metric("Hot", s.classCounts.Hot || 0, "hot"),
      metric("Warm", s.classCounts.Warm || 0, "warm"),
      metric("Completed", s.statusCounts.completed || 0, "ok"),
      metric("No Answer", (s.statusCounts.no_answer || 0) + (s.statusCounts.voicemail || 0), "cold")
    ].join("");
  }
  if ($("#cmpProgress")) $("#cmpProgress").innerHTML = progressBar(s.finished, s.total);
  if ($("#cmpDialHint")) {
    $("#cmpDialHint").textContent = !c.phone_number_id ? "⚠ Set a phone number to enable calling" : `Calls ${c.call_window_start}:00–${c.call_window_end}:00 ${c.timezone}`;
  }

  await Promise.all([refreshLeads(id), refreshCampaignFeeds(id)]);
}

async function refreshLeads(id) {
  const params = new URLSearchParams();
  if (cmpFilters.status) params.set("status", cmpFilters.status);
  if (cmpFilters.classification) params.set("classification", cmpFilters.classification);
  if (cmpFilters.search) params.set("search", cmpFilters.search);
  const { leads } = await api(`/api/campaigns/${id}/leads?${params}`);
  const body = $("#leadRows");
  if (!body) return;
  body.innerHTML = leads
    .map(
      (l) => `<tr>
      <td><strong>${esc(l.name || "—")}</strong><br /><span class="muted small">${esc(l.company || "")}</span></td>
      <td class="mono">${esc(l.phone)}</td>
      <td>${statusBadge(l.status)}</td>
      <td>${classBadge(l.classification)}</td>
      <td>${esc(l.next_action || "—")}</td>
      <td>${l.attempts}</td>
      <td class="muted small">${esc(l.reason || "")}</td>
    </tr>`
    )
    .join("");
  $("#leadEmpty").hidden = leads.length > 0;
}

async function refreshCampaignFeeds(id) {
  const [{ calls }, { bookings }] = await Promise.all([
    api(`/api/campaigns/${id}/calls?limit=20`),
    api(`/api/campaigns/${id}/bookings`)
  ]);
  if ($("#cmpCalls")) $("#cmpCalls").innerHTML = calls.length ? calls.map(callRow).join("") : `<div class="empty small">No calls yet.</div>`;
  if ($("#cmpMeetings")) $("#cmpMeetings").innerHTML = bookings.length ? bookings.map(bookingRow).join("") : `<div class="empty small">No meetings yet.</div>`;
}

async function importLeads(id) {
  const csv = $("#csvText").value.trim();
  if (!csv) return toast("Paste CSV or choose a file first", "warn");
  $("#importMsg").textContent = "Importing…";
  try {
    const { result } = await api(`/api/campaigns/${id}/import`, { method: "POST", body: JSON.stringify({ csv }) });
    $("#importMsg").textContent = `Imported ${result.inserted} · ${result.duplicates} dupes · ${result.invalid} invalid${result.dnc ? ` · ${result.dnc} DNC` : ""}`;
    $("#csvText").value = "";
    toast(`Imported ${result.inserted} leads`, "ok");
    refreshCampaign(id);
  } catch (err) {
    $("#importMsg").textContent = err.message;
    toast(err.message, "error");
  }
}

async function saveSettings(id) {
  try {
    await api(`/api/campaigns/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        phoneNumberId: $("#setPhone").value.trim(),
        assistantId: $("#setAssistant").value.trim(),
        timezone: $("#setTz").value.trim(),
        maxAttempts: Number($("#setMax").value),
        callWindowStart: Number($("#setStart").value),
        callWindowEnd: Number($("#setEnd").value)
      })
    });
    toast("Settings saved", "ok");
    refreshCampaign(id);
  } catch (err) {
    toast(err.message, "error");
  }
}

async function saveScript(id) {
  try {
    await api(`/api/campaigns/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        firstMessage: $("#setFirstMsg").value,
        systemPrompt: $("#setSysPrompt").value,
        knowledgeBase: $("#setKb").value
      })
    });
    toast("Agent script saved", "ok");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function campaignAction(id, action) {
  try {
    if (action === "delete") {
      if (!confirm("Delete this campaign and all its leads, calls and meetings?")) return;
      await api(`/api/campaigns/${id}`, { method: "DELETE" });
      toast("Campaign deleted", "ok");
      location.hash = "#/";
      return;
    }
    if (action === "dial") {
      await api(`/api/campaigns/${id}/dial-next`, { method: "POST" });
      toast("Placing call to next lead…", "ok");
    } else {
      await api(`/api/campaigns/${id}/${action}`, { method: "POST" });
      toast(`Campaign ${action}ed`, "ok");
    }
    if (location.hash.includes(id)) refreshCampaign(id);
    else refreshOverview();
  } catch (err) {
    if (err.data && err.data.problems) toast(err.data.problems.join(" "), "warn");
    else toast(err.message, "error");
  }
}

function updateDialerState(status) {
  const el = $("#dialerState");
  if (el) el.textContent = status === "running" ? "Dialer active" : "Dialer idle";
}

// ---------------- Do Not Call ----------------

async function renderDnc() {
  const { dnc } = await api("/api/dnc");
  view.innerHTML = `
    <header class="topbar"><div class="topbar-title"><p class="eyebrow">Compliance</p><h1>Do Not Call List</h1></div></header>
    <section class="card">
      <p class="help">Numbers here are skipped by every campaign. Add opt-outs to stay compliant.</p>
      <div class="form-row"><input id="dncPhone" placeholder="+923001234567" style="max-width:320px" /><button class="btn btn-primary" id="dncAdd">Add Number</button></div>
    </section>
    <section class="card full"><div class="panel-head"><div><p class="eyebrow">Blocked</p><h2>${dnc.length} numbers</h2></div></div>
      <div class="table-wrap"><table><thead><tr><th>Phone</th><th>Reason</th><th>Added</th></tr></thead>
      <tbody>${dnc.map((d) => `<tr><td class="mono">${esc(d.phone)}</td><td>${esc(d.reason)}</td><td class="muted small">${esc(fmtDateTime(d.created_at))}</td></tr>`).join("")}</tbody></table></div>
      ${dnc.length ? "" : `<p class="empty">No numbers blocked.</p>`}
    </section>`;
  $("#dncAdd").onclick = async () => {
    try {
      await api("/api/dnc", { method: "POST", body: JSON.stringify({ phone: $("#dncPhone").value.trim() }) });
      toast("Number blocked", "ok");
      renderDnc();
    } catch (err) {
      toast(err.message, "error");
    }
  };
}

// ---------------- Live Test (browser web call + manual classifier) ----------------

let VapiCtor = null, vapi = null;
async function renderTools() {
  const cfg = await api("/api/client-config").catch(() => ({}));
  view.innerHTML = `
    <header class="topbar"><div class="topbar-title"><p class="eyebrow">QA</p><h1>Live Test</h1></div></header>
    <section class="grid two">
      <article class="card action-card accent-violet">
        <div class="card-top"><span class="tag">Browser Call</span><span class="card-glyph">🎙️</span></div>
        <h2>Talk To The Agent</h2>
        <p class="help">Places a live web call from your browser to test the voice agent end-to-end.</p>
        <div class="button-row"><button id="startWebCall" class="btn btn-primary">Start Web Call</button><button id="stopWebCall" class="btn btn-danger" disabled>End</button></div>
        <pre id="webCallStatus" class="mini-result">Waiting</pre>
      </article>
      <article class="card action-card accent-blue">
        <div class="card-top"><span class="tag">Classifier</span><span class="card-glyph">✎</span></div>
        <h2>Transcript Classifier</h2>
        <p class="help">Paste a transcript to see how DeepSeek categorizes the lead.</p>
        <textarea id="clsInput" rows="6" placeholder="Paste a call transcript…"></textarea>
        <button id="clsBtn" class="btn btn-primary full-width">Classify</button>
        <pre id="clsResult" class="mini-result">Waiting</pre>
      </article>
    </section>`;

  $("#startWebCall").onclick = () => startWebCall(cfg);
  $("#stopWebCall").onclick = stopWebCall;
  $("#clsBtn").onclick = async () => {
    const transcript = $("#clsInput").value.trim();
    if (!transcript) return;
    $("#clsResult").textContent = "Classifying…";
    try {
      const { classification } = await api("/api/classify", { method: "POST", body: JSON.stringify({ transcript }) });
      $("#clsResult").textContent = JSON.stringify(classification, null, 2);
    } catch (err) {
      $("#clsResult").textContent = err.message;
    }
  };
}

async function startWebCall(cfg) {
  if (!cfg.vapiPublicKey || !cfg.assistantId) {
    $("#webCallStatus").textContent = "Voice keys are missing — set them in your .env and restart the server.";
    return;
  }
  try {
    // Request mic first so the browser prompts and we fail loudly if it's blocked.
    // Without a live mic track the call connects but sends silence, and the agent
    // ends it with "did-not-receive-customer-audio".
    $("#webCallStatus").textContent = "Requesting microphone…";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (micErr) {
      $("#webCallStatus").textContent = `Microphone blocked: ${micErr.name}. Allow mic access for this site (click the 🔒 in the address bar), then try again.`;
      return;
    }
    $("#webCallStatus").textContent = "Loading voice SDK…";
    if (!VapiCtor) {
      const mod = await import("https://esm.sh/@vapi-ai/web");
      VapiCtor = mod.default || mod.Vapi;
    }
    vapi = new VapiCtor(cfg.vapiPublicKey);
    vapi.on("call-start", () => { $("#webCallStatus").textContent = "Call active. Speak into your mic."; $("#stopWebCall").disabled = false; });
    vapi.on("call-end", () => { $("#webCallStatus").textContent = "Call ended."; $("#stopWebCall").disabled = true; });
    vapi.on("error", (e) => { $("#webCallStatus").textContent = `Error: ${e?.message || JSON.stringify(e)}`; });
    await vapi.start(cfg.assistantId);
    $("#startWebCall").disabled = true;
    $("#stopWebCall").disabled = false;
  } catch (err) {
    $("#webCallStatus").textContent = `Could not start: ${err.message}`;
  }
}
function stopWebCall() {
  if (vapi) vapi.stop();
  $("#startWebCall").disabled = false;
  $("#stopWebCall").disabled = true;
}

// ---------------- New campaign modal ----------------

function openNewCampaign() {
  $("#modalRoot").hidden = false;
}
function closeModal() {
  $("#modalRoot").hidden = true;
}

$("#newCampaignBtn").onclick = openNewCampaign;
$$("[data-close]").forEach((el) => (el.onclick = closeModal));
$("#newCampaignForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const { campaign } = await api("/api/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: f.get("name"),
        timezone: f.get("timezone"),
        maxAttempts: Number(f.get("maxAttempts")),
        callWindowStart: Number(f.get("callWindowStart")),
        callWindowEnd: Number(f.get("callWindowEnd")),
        retryMinutes: Number(f.get("retryMinutes"))
      })
    });
    closeModal();
    e.target.reset();
    toast("Campaign created", "ok");
    location.hash = `#/campaign/${campaign.id}`;
  } catch (err) {
    toast(err.message, "error");
  }
};

window.addEventListener("hashchange", router);
router();
