import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from 'dotenv';
import { createAPIApp } from './server/app';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

async function startServer() {
  const app = createAPIApp();
  const PORT = 3000;

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
