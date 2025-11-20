import express from "express";
import puppeteer from "puppeteer";
import { WebSocketServer } from "ws";
import cors from "cors";

const app = express();
app.use(cors());

const wss = new WebSocketServer({ noServer: true });

let browser, page;

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

app.get("/url", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing ?url=");
  await page.goto(url, { waitUntil: "networkidle0" });
  res.send("Navigated");
});

// WebSocket input forwarding
const server = app.listen(3000, () => console.log("Server running on port 3000"));
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
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
