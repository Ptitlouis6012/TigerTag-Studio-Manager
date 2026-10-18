# Demo-printer TLS certificate

`demo-cert.pem` + `demo-key.pem` — a self-signed certificate the demo-mode faces
present on their TLS ports (Bambu Lab MQTT 8883 / camera 6000, Anycubic MQTT 9883),
because those drivers only ever speak TLS. See `docs/DEMO-MODE.md`.

**It protects nothing, on purpose.** The faces listen on loopback addresses only
(127.0.0.x); the key is public, in this repository. Never use it for anything that
leaves this computer.

Regenerate (valid 10 years):

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -subj "/CN=TigerTag Studio demo printer/O=TigerTag Studio demo" \
  -addext "subjectAltName=IP:127.0.0.1,DNS:localhost" \
  -keyout demo-key.pem -out demo-cert.pem
```
