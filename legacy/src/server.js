require("dotenv").config();

const express = require("express");
const path = require("path");

const webhookRouter = require("./routes/webhook");
const apiRouter = require("./routes/api");
const campaignsRouter = require("./routes/campaigns");
const dialer = require("./dialer/engine");

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "..", "public");

app.use(express.json({ limit: "8mb" }));
app.use(express.static(publicDir));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/dashboard", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

app.use("/api", apiRouter);
app.use("/api", campaignsRouter);
app.use("/webhook", webhookRouter);

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Malformed JSON payload" });
  }
  console.error("Unhandled server error:", err);
  return res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`Calling Agent server + dashboard on http://localhost:${port}`);
  dialer.start();
});
