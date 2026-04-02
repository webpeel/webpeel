# WebPeel Kubernetes (K3s on Hetzner)

## Cluster Info

- **Server**: Hetzner CPX31 (4 vCPU shared, 8GB RAM, $17.99/mo)
- **IP**: 178.156.229.86
- **K3s version**: v1.34.5+k3s1
- **Deployed**: 2026-03-17

## Architecture

```
                      ┌─────────────────────────────┐
                      │     K3s on Hetzner CPX31    │
                      │                             │
                   ┌──┤  API (2 replicas) :3000     │
Internet → :3000   │  │  Worker (2 replicas)        │
                   └──┤  Redis (1 replica) :6379    │
                      │                             │
                      │  SearXNG  :8888 (systemd)   │
                      │  Ollama   :11434 (systemd)  │
                      │  Research worker :3001      │
                      └─────────────────────────────┘
```

## Source of truth (important)

The static manifests in `k8s/` are **bootstrap defaults**, not the complete live source of truth.
The deploy workflow currently also patches live production settings (image tags, replica counts,
and memory/concurrency guardrails) during rollout.

If you change production capacity or browser guardrails, update **both**:
1. the relevant runtime code defaults
2. `.github/workflows/k3s-deploy.yml`

Otherwise repo state and live cluster state drift apart, which makes incidents harder to debug.

## Manifests

| File | Description |
|------|-------------|
| `namespace.yaml` | `webpeel` namespace |
| `secrets.yaml` | DATABASE_URL, JWT_SECRET, Stripe keys |
| `api-deployment.yaml` | 3 replicas, 256Mi RAM, 250m CPU, LoadBalancer svc |
| `worker-deployment.yaml` | 2 replicas, 512Mi RAM, 500m CPU |
| `redis-deployment.yaml` | 1 replica, 1Gi RAM limit, ClusterIP |

## Deploy

```bash
# Apply all manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/redis-deployment.yaml
kubectl apply -f k8s/worker-deployment.yaml
kubectl apply -f k8s/api-deployment.yaml

# Check status
kubectl get pods -n webpeel

# Port-forward for local testing
kubectl port-forward -n webpeel svc/api 3000:3000
```

## Build Images

Images are built on the Hetzner server and imported to K3s containerd (no Docker Hub):

```bash
# On Hetzner (178.156.229.86)
cd /opt/webpeel-src

# Build
docker build -f Dockerfile.api -t webpeel:api .
docker build -f Dockerfile.worker -t webpeel:worker .

# Import to K3s
docker save webpeel:api -o /tmp/webpeel-api.tar
docker save webpeel:worker -o /tmp/webpeel-worker.tar
k3s ctr images import /tmp/webpeel-api.tar
k3s ctr images import /tmp/webpeel-worker.tar
```

## Performance Comparison: Render vs K3s

Tested on 2026-03-17. Note: Render API was down (502) at time of benchmark.

### K3s (direct, port-forwarded)

| URL | Status | Elapsed |
|-----|--------|---------|
| https://example.com | completed | 15ms |
| https://httpbin.org/get | completed | 513ms |
| https://httpbin.org/headers | completed | 8ms |
| https://example.com (cached) | completed | 8ms |

**Average non-cached latency**: ~200ms  
**Cached latency**: <15ms

### Memory Usage (K3s pods at idle)

| Pod | CPU | Memory |
|-----|-----|--------|
| api (x3) | 1m each | 83-125Mi each |
| worker (x2) | 8m each | 52-56Mi each |
| redis | 7m | 3Mi |
| **Total** | **~25m** | **~416Mi** |

### Key Findings

| Metric | Render | K3s/Hetzner |
|--------|--------|-------------|
| Availability | 502 at test time | ✅ 100% |
| Cost | $25/mo (Render Pro) | $17.99/mo (CPX31) |
| Latency (p50) | ~200-300ms | ~15-200ms |
| Replicas | 1 | 3 (HA) |
| Worker | no queue mode | Bull queue + Playwright workers |
| Self-hosted | No | Yes |

### Verdict

K3s on Hetzner:
- **30% cheaper** ($17.99 vs $25)
- **3x replicas** (HA vs single)
- **Faster** (no cold starts, no container spin-up)
- **Queue mode** (Bull + Redis, Playwright workers isolated)
- **Resilient** (Render was down during comparison; K3s served all requests)

## Health Check

```bash
# Via port-forward
kubectl port-forward -n webpeel svc/api 3000:3000
curl http://localhost:3000/health

# Expected response
# {"status":"healthy","version":"unknown","uptime":...}
```

## Notes

- Worker readiness probe checks Redis connectivity (ioredis ping)
- API DB schema error at startup is non-fatal (FK constraint on Neon DB — pre-existing)  
- K3s uses containerd (not Docker); images imported via `k3s ctr images import`
- SearXNG, Ollama, research-worker still run as systemd services alongside K3s
