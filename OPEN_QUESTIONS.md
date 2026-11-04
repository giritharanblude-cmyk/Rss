# OPEN QUESTIONS

Each item has the default that will be used if no answer arrives.

## From Section 8 of the master prompt

1. **"1 master user alone" but "master user can add members."** Default: one master account only; members are limited accounts created by the master.
2. **Netlify cannot run OpenWA or schedulers.** Default: Netlify serves the frontend and proxies `/api/*`; the whole backend runs on a free always-on VM.
3. **Admin email and sender mailbox are "to be added."** Default: read from environment variables and Settings; never hard-coded.
4. **"Alerts and Schedule" has no detail.** Default: digest rules plus instant alerts for important items (Phase 4).
5. **Member permissions not defined.** Default: member can use News Feed, view Delivery Log, and view Sources and Recipients read-only (Phase 6).
6. **Recipient email for login OTP.** Default: OTP goes to the master user's admin email only.
7. **"Manage topics" link in email.** Default: small public token page outside the six modules.
8. **Uncategorized items.** Default: category `Uncategorized`, still shown in the feed.
9. **Region field on sources.** Default: free text; extra match when mode is Specific Topics.
10. **Consent proof.** Default: master confirms with a note and date per recipient.
11. **OpenWA is an unofficial WhatsApp client.** Default: throttle sends, message only consenting contacts, document the account-ban risk, keep an adapter interface so the official WhatsApp Business API can replace it later.
12. **Live updates.** Default: short polling with ETag instead of SSE because of the Netlify proxy time limit.
13. **Free database storage is limited.** Default: retention 90 days of news, 180 days of delivery logs, configurable.
14. **VM provider not chosen.** Default: Oracle Cloud Always Free ARM; fallback is a home machine behind Cloudflare Tunnel.

## Phase 0 blockers / credentials

15. **Neon database credentials.** Default: free-stack proof is documented as "needs credentials"; a `db:proof` script is ready and runs the trivial migration once `DATABASE_URL` is set. **Finding (2026-11-03):** the shell's current `DATABASE_URL` is an unrelated local project database, not Neon and not supported by `pg`; it was not used. Phase 1 migrations and the master seed are implemented, but remain unapplied/unverified against a live database until the Neon pooled string is provided.
16. **Hostinger SMTP credentials and admin email.** Default: emailed OTP and status light remain "needs credentials" until provided; mock and SMTP adapters are implemented, but real delivery and SMTP verification are unconfirmed.
17. **OpenWA / WhatsApp account and QR provisioning.** Default: configure `OPENWA_SOCKET_URL` and `OPENWA_API_KEY` for the separately hosted OpenWA service; scan its QR code on that service host. The installed socket client exposes socket status, not QR data or linked-account status, so the app labels this as an OpenWA socket connection and does not claim that a WhatsApp account is linked. Real account verification still needs VM/service credentials.
18. **Netlify secret header substitution.** `netlify.toml` header values may not support environment substitution. Default: restrict the VM at Caddy/firewall to Netlify egress or use Cloudflare Access; record the final mechanism before deployment. Never ship an open origin.
19. **Oracle Always Free capacity.** A1 instances can fail with "out of host capacity." Default: retry across availability domains; fall back to a home machine behind Cloudflare Tunnel.
20. **Headless Chromium under QEMU.** The arm64 image was built and `/usr/bin/chromium --version` works, but `--dump-dom` hangs under QEMU emulation on the x86 Windows dev host (rendering is too slow/unstable). Default: treat the arm64 build as verified, run the full headless render smoke on a real arm64 VM during deployment (Phase 7), and record the result.
