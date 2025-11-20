import express from "express";
import puppeteer from "puppeteer";
import WebSocket, { WebSocketServer } from "ws";

const app = express();
const wss = new WebSocketServer({ noServer: true });

let page;
let browser;

// Launch Puppeteer on Render
async function startBrowser() {
  browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
}

startBrowser();

// Navigate to URL endpoint
app.get("/url", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.send("Missing ?url=");
  await page.goto(url, { waitUntil: "networkidle0" });
  res.send("Navigated!");
});

// Serve frontend
app.use(express.static("public"));

// WebSocket upgrade for input
const server = app.listen(3000, () => console.log("Server running on port 3000"));

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.on("message", async (msg) => {
      const data = JSON.parse(msg.toString());
      if (data.type === "mouse") {
        await page.mouse.move(data.x, data.y);
        if (data.action === "click") await page.mouse.click(data.x, data.y);
      }
      if (data.type === "keyboard") {
        await page.keyboard.type(data.text);
      }
    });
  });
});
