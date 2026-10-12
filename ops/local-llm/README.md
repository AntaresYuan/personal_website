# local-llm — answering "Ask" from the model on my Mac

When this Mac is awake and online, the site's Ask assistant answers with a
model running here, in Ollama. When it isn't, the qa Worker answers from
Workers AI as before. Visitors never talk to the Mac: only the Worker
does, through a Cloudflare Tunnel that only it can pass.

```
visitor ─▶ qa Worker (qa.antaresyuan.site)
             │  retrieves passages from /ask-index.json
             ├─▶ llm.antaresyuan.site ── Cloudflare Access (service token)
             │        └─ Tunnel ─▶ this Mac: proxy.js :11435 ─▶ Ollama :11434
             └─▶ Workers AI, if the Mac is asleep, busy or slow (25 s)
```

- `proxy.js` lets exactly one call through, `POST /chat` (and
  `GET /health`). Ollama's own API, which can pull and delete models,
  stays unreachable. It answers one question at a time; a second visitor
  is told "busy" and gets the cloud answer instead of a queue. It logs
  status and timing, never the conversation.
- When the Mac fails to answer, the Worker parks it for a minute, so the
  following visitors don't each wait out the timeout.
- An answer from the Mac is marked in the panel: "Answered by a model
  running on my MacBook".

## Set up (once)

1. **Model.** Ollama is already running (the menu-bar app). The default
   model is `qwen3.5:4b`. For another one, `ollama pull <model>` and set
   `LLM_MODEL=<model>` in step 2.

2. **Proxy at login.**

   ```sh
   ops/local-llm/install.sh
   curl -s localhost:11435/health      # {"ok":true,"model":"qwen3.5:4b"}
   ```

3. **Tunnel.**

   ```sh
   brew install cloudflared
   cloudflared tunnel login                 # browser: pick antaresyuan.site
   cloudflared tunnel create antares-llm
   cloudflared tunnel route dns antares-llm llm.antaresyuan.site
   ops/local-llm/install.sh --tunnel antares-llm
   ```

4. **Lock it to the Worker.**
   1. In Cloudflare Zero Trust, open Access, then Service Auth, and create a
      service token. Copy its Client ID and Secret.
   2. Under Access, then Applications, add a self-hosted application for
      `llm.antaresyuan.site`.
   3. Give it one policy: action **Service Auth**, include
      **Service Token**, the token above.

5. **Point the Worker at it.**

   ```sh
   cd workers/qa
   npx wrangler secret put ACCESS_CLIENT_ID
   npx wrangler secret put ACCESS_CLIENT_SECRET
   # set LOCAL_LLM_URL = "https://llm.antaresyuan.site" in wrangler.toml, then
   npx wrangler deploy
   ```

6. **Stay awake when plugged in.** Open System Settings, then Battery, then
   Options, and turn on "Prevent automatic sleeping on power adapter when
   the display is off". With the lid closed or asleep, the cloud answers.

Check from outside: `curl -s https://llm.antaresyuan.site/health` returns an
Access error. That is the point; only the Worker's token gets through.

## Day to day

| | |
|---|---|
| Logs | `~/Library/Logs/antares-llm/` |
| Restart | `launchctl kickstart -k gui/$(id -u)/site.antaresyuan.llm-proxy` |
| Change model | `LLM_MODEL=<model> ops/local-llm/install.sh` (add `--tunnel antares-llm` to keep the tunnel) |
| Stop everything | `ops/local-llm/install.sh --uninstall` |
| Tests | `node ops/local-llm/proxy.test.js` |
