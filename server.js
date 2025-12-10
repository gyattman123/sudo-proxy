import express from "express";
import http from "http";
import { createWispServer } from "wisp-protocol";

const app = express();
const server = http.createServer(app);

// Attach Wisp backend at /wisp
createWispServer(server, { path: "/wisp" });

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

