# WebPeel OOM / Node-Reboot Recovery

Use this when the Hetzner node is reachable again but the cluster is not healthy after an OOM or hard reboot.

## Symptoms
- `api.webpeel.dev` returns `521` or `522`
- SSH works again, but K8s pods are stuck `0/1`, `CrashLoopBackOff`, or `ImagePullBackOff`
- CoreDNS / Traefik / metrics-server fail after reboot

## 1) Clear host-level port conflicts
```bash
systemctl stop nginx || true
systemctl disable nginx || true
ss -ltnp | egrep ':80 |:443 |:6443 |:22 ' || true
```

## 2) Restart K3s
```bash
systemctl restart k3s
sleep 20
kubectl get pods -n kube-system -o wide
kubectl get pods -n webpeel -o wide
```

## 3) If kube-system images fail with `blob not found`
This indicates a corrupted/stale k3s containerd content store after the crash.

Bad digests seen on 2026-04-02:
- coredns: `sha256:82b57287b29beb757c740dbbe68f2d4723da94715b563fffad5c13438b71b14a`
- traefik: `sha256:9004e1cd1e33c5eb0b6ec02bc6cfda61fe9caca36751114b1c9c6662f01b264a`
- metrics-server: `sha256:b2d2efaf5ac3b366ed0f839d2412a2c4279d4fc2a2a733f12c52133faed36c41`

Repair pattern:
```bash
k3s ctr -n k8s.io content rm sha256:<bad-digest>
k3s ctr -n k8s.io images pull docker.io/rancher/mirrored-coredns-coredns:1.14.1
k3s ctr -n k8s.io images pull docker.io/rancher/mirrored-library-traefik:3.6.9
k3s ctr -n k8s.io images pull docker.io/rancher/mirrored-metrics-server:v0.8.1
kubectl rollout restart deployment/coredns -n kube-system
kubectl rollout restart deployment/traefik -n kube-system
kubectl rollout restart deployment/metrics-server -n kube-system
```

## 4) Verify WebPeel workloads
```bash
kubectl rollout status deployment/api -n webpeel --timeout=120s
kubectl rollout status deployment/worker -n webpeel --timeout=120s
kubectl get endpoints -n webpeel
curl -i https://api.webpeel.dev/health
```

## 5) Post-recovery cleanup
```bash
pgrep -af headless_shell | wc -l
free -h
ps aux --sort=-%mem | head -20
```

## Guardrails added after 2026-04-02 incident
- API replicas pinned to 2
- Worker replicas pinned to 2
- `WORKER_CONCURRENCY=1`
- `MEMORY_LIMIT_MB`, `MAX_CONCURRENT_PAGES`, and `PAGE_POOL_SIZE` now env-tunable
- smart-search result enrichment capped by `SMART_SEARCH_ENRICH_LIMIT` and `SMART_SEARCH_ENRICH_CONCURRENCY`
