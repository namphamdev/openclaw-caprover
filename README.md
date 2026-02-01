# openclaw-caprover

CapRover one-click app for OpenClaw.

## Architecture

```mermaid
flowchart TB
    subgraph Internet
        Client[Browser / CLI]
    end

    subgraph CapRover["CapRover Host"]
        Nginx[nginx reverse proxy<br/>TLS termination]
    end

    subgraph Container["Docker Container"]
        subgraph Wrapper["Wrapper Server :18789"]
            direction TB
            BasicAuth[Basic Auth middleware]
            SetupRoutes["/setup/*<br/>Setup wizard + API"]
            Proxy[HTTP/WS Proxy]
            TokenInjector[Token injection]
        end

        subgraph Gateway["OpenClaw Gateway :18790"]
            direction TB
            ControlUI[Control UI]
            WSRPC[WebSocket RPC]
            Channels[Chat channels]
        end

        ConfigDir[("/home/node/.openclaw<br/>Persistent volume")]
    end

    Client -->|HTTPS| Nginx
    Nginx -->|HTTP :18789| Wrapper

    BasicAuth --> SetupRoutes
    BasicAuth --> Proxy
    Proxy --> TokenInjector
    TokenInjector -->|"Authorization: Bearer TOKEN"| Gateway

    SetupRoutes -->|"openclaw config set"| ConfigDir
    Gateway --> ConfigDir

    Gateway -.->|localhost only| Wrapper
```

## Request Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant N as nginx
    participant W as Wrapper
    participant G as Gateway

    Note over C,G: Setup Flow (first access)
    C->>N: GET /
    N->>W: GET /
    W-->>C: 302 Redirect /setup

    C->>N: GET /setup
    N->>W: GET /setup
    W->>W: Check Basic Auth
    W-->>C: 401 + WWW-Authenticate
    C->>N: GET /setup (with credentials)
    N->>W: GET /setup
    W-->>C: setup.html

    C->>N: POST /setup/api/run
    N->>W: POST /setup/api/run
    W->>W: openclaw config set ...
    W->>G: spawn gateway process
    W-->>C: 200 OK

    Note over C,G: Normal Flow (configured)
    C->>N: GET /
    N->>W: GET /
    W->>W: Inject auth header
    W->>G: GET / + Bearer TOKEN
    G-->>W: Control UI
    W-->>C: Control UI

    C->>N: WS upgrade
    N->>W: WS upgrade
    W->>G: WS + Bearer TOKEN
    G-->>C: WebSocket established
```

## Usage

### One-Click App Repository

Add this URL to CapRover's third-party apps:
```
https://raw.githubusercontent.com/Achxy/openclaw-caprover/main/public
```

### Manual Deployment

1. Paste contents of `openclaw.yml` into CapRover's template field
2. Save credentials before deploying
3. Enable HTTPS after deployment
4. Open `/setup` to configure

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `SETUP_PASSWORD` | Yes | Basic auth password for /setup |
| `OPENCLAW_GATEWAY_TOKEN` | No | Gateway auth token (auto-generated if not set) |

## Endpoints

| Path | Auth | Handler |
|------|------|---------|
| `/setup` | Basic | Setup wizard |
| `/setup/api/*` | Basic | Configuration API |
| `/setup/export` | Basic | Backup download |
| `/health` | None | Health check |
| `/*` | Token (injected) | Proxied to gateway |
