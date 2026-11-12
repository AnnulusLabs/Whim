# Whim server

Runs Whim on your own machine with no outside service. Node 20 or newer, standard library only.

    npm ci && npm run build            # builds the app into dist/
    node server/whim-server.mjs        # http://127.0.0.1:8787

Shared sheets are stored as one JSON file each under `WHIM_DATA` (default `server/data`). No IP addresses are recorded.
Sheets in `server/library/` are loaded under fixed ids at every start.

`deploy/whim.service` and `deploy/Caddyfile` are a starting point for a Linux box. The app only installs for offline use over HTTPS.

Not ported from the Cloudflare worker: document export (`/docgen/`), which upstream sends to a separate service.
