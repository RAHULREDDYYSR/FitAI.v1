const { onRequest } = require("firebase-functions/v2/https");

/**
 * LangSmith Proxy — Forwards trace data from the browser to api.smith.langchain.com.
 * 
 * This solves the CORS issue: the browser sends traces to /langsmith/* (same origin),
 * Firebase Hosting rewrites to this function, which forwards to LangSmith's real API.
 * The API key is kept server-side in functions/.env — never exposed in the browser.
 */
exports.langsmithProxy = onRequest(
  { cors: true, region: "us-central1" },
  async (req, res) => {
    try {
      const apiKey = process.env.LANGSMITH_API_KEY;

      if (!apiKey) {
        console.error("LANGSMITH_API_KEY not configured in functions/.env");
        return res.status(500).json({ error: "LangSmith proxy not configured" });
      }

      // Strip the /langsmith prefix that Firebase Hosting rewrite adds
      // req.url might be /langsmith/runs/batch or just /runs/batch depending on rewrite
      let targetPath = req.url || "/";
      targetPath = targetPath.replace(/^\/langsmith/, "");
      if (!targetPath.startsWith("/")) targetPath = "/" + targetPath;

      const targetUrl = `https://api.smith.langchain.com${targetPath}`;

      // Build headers — forward content-type but inject our server-side API key
      const headers = {
        "Content-Type": req.headers["content-type"] || "application/json",
        "X-API-Key": apiKey,
      };

      // Forward the request
      const fetchOptions = {
        method: req.method,
        headers,
      };

      // Only include body for non-GET requests
      if (req.method !== "GET" && req.method !== "HEAD") {
        fetchOptions.body = typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body);
      }

      const response = await fetch(targetUrl, fetchOptions);
      const responseText = await response.text();

      // Forward the response status and body
      res.status(response.status).send(responseText);
    } catch (error) {
      console.error("LangSmith proxy error:", error);
      res.status(502).json({ error: "LangSmith proxy failed", details: error.message });
    }
  }
);
