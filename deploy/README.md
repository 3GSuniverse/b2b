# Putting Drona live

The end result: **https://dhrona.kurukshetra-travels.in** runs on its own small Google Cloud VM, reachable only through a Cloudflare tunnel. One command (`drona`) installs, updates, backs up and manages it.

About 45 minutes the first time. Steps 1 to 4 happen once; after that, updating is `drona deploy`.

## Why a separate, always-on VM

`automation-vm` sleeps until someone opens the doorman link. Drona can't sleep:

- scheduled campaigns and automations have to fire at their time, with nobody watching
- the WhatsApp trial link drops if the VM stops, and the company has to scan the QR code again
- Amazon SES reports bounces and complaints at any hour; if they're missed, your SES account gets put on hold
- unsubscribe links in sent emails must always work (Gmail and Yahoo require it)

So Drona gets its own VM, and the doorman setup for the other services stays as it is.

## 1. Create the VM

Google Cloud console → Compute Engine → **Create instance**:

| Setting | Value |
|---|---|
| Name | `drona-vm` |
| Region | `asia-south1` (Mumbai) |
| Machine type | **e2-small** (2 vCPU, 2 GB). Go to e2-medium once you have 15+ paying companies |
| Boot disk | Ubuntu 24.04 LTS, **30 GB** balanced persistent disk |
| Firewall | leave HTTP/HTTPS **unticked**. Cloudflare reaches it from the inside, so no ports are opened |

e2-small costs about $15 a month in Mumbai (check the pricing calculator for today's rate).

Then turn on daily disk snapshots: Compute Engine → Snapshots → **Create snapshot schedule** (daily, keep 7) and attach it to the disk. This is a second safety net next to the nightly database backup.

## 2. Get the code onto the VM

The repository is private, so the VM gets a read-only key for it.

```bash
# On the VM (SSH from the console)
ssh-keygen -t ed25519 -N '' -f ~/.ssh/drona_deploy -C drona-vm
cat ~/.ssh/drona_deploy.pub
```

Copy what it prints. On GitHub: **3GSuniverse/b2b → Settings → Deploy keys → Add deploy key**, paste it, leave "Allow write access" off.

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/drona_deploy
EOF
git clone git@github.com:3GSuniverse/b2b.git ~/drona
```

## 3. Install

```bash
~/drona/deploy/drona install
```

The first run installs Docker and asks you to log out and back in. Do that, then run the same command again. It asks for:

- **Public address**: press Enter for `https://dhrona.kurukshetra-travels.in`
- **Port**: press Enter for `4100`
- **AWS access key and secret** for SES. Press Enter to skip; emails are then only printed to the logs, which is fine for a first look
- **SNS topic ARN** for bounces, if you have it

It generates the passwords and encryption keys, builds everything (5 to 10 minutes the first time), starts it and checks it's healthy. From now on `drona` works from any folder.

> **Back up `deploy/.env` somewhere safe** (a password manager). It holds the key that encrypts linked Gmail and WhatsApp logins. Without it, a restored database can't use them.

## 4. Connect the Cloudflare tunnel

The tunnel on `automation-vm` stops when that VM sleeps, so `drona-vm` gets its own.

Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** → Cloudflared → name it `drona`. Choose Debian, copy the install command it shows and run it on `drona-vm`. The connector should turn **Healthy**.

Then **Public hostname → Add**:

| Field | Value |
|---|---|
| Subdomain | `dhrona` |
| Domain | `kurukshetra-travels.in` |
| Type | `HTTP` |
| URL | `localhost:4100` |

Open https://dhrona.kurukshetra-travels.in. The sign-in page should load.

Recommended in Cloudflare → SSL/TLS → Edge Certificates: **Always Use HTTPS** on.

## 5. Email (Amazon SES)

In the AWS console, region **ap-south-1**:

1. **SNS → Topics**, open the topic your SES configuration set sends events to → Create subscription → Protocol **HTTPS** → Endpoint `https://dhrona.kurukshetra-travels.in/webhooks/ses`. Drona confirms it by itself within a few seconds; refresh and the status shows *Confirmed*.
2. Copy the topic ARN into `SES_SNS_TOPIC_ARN` in `~/drona/deploy/.env`, so notifications from any other topic are refused.
3. Make sure the SES configuration set named in `SES_CONFIGURATION_SET` (`drona-events` for a new setup) sends Bounce, Complaint, Delivery, Open and Click events to that topic.
4. Once SES production access is approved, raise `SEND_RATE_PER_SECOND` to your account's rate (SES → Account dashboard → Sending rate).

After editing `.env`: `drona restart`.

## 6. "Connect Gmail" (optional)

Google Cloud → Google Auth Platform → Clients → your web client → **Authorized redirect URIs**, add:

```
https://dhrona.kurukshetra-travels.in/api/integrations/gmail/callback
```

Download the client JSON and copy it to the VM as `~/drona/deploy/secrets/google-oauth.json` (the SSH window's **Upload file** button, then `mv`). That folder is never committed. Then `drona restart`.

## 7. First company

1. Open the site and **Sign up** with Kurukshetra Travels' details. Every new company starts on the 5-day free trial.
2. Make Kurukshetra a paid company with a monthly email allowance, and keep WhatsApp Web on for it until the official WhatsApp provider is connected. Use the email you signed up with:

```bash
drona plan owner@kurukshetra-travels.in paid 20000
drona feature whatsapp-web owner@kurukshetra-travels.in on
```

New sign-ups get the trial automatically: every feature, 200 emails, WhatsApp Web up to 100 messages a day. Agencies pay online in Plan & billing. For one that pays you offline, run `drona plan <their email> professional <logins>` (or `basic` / `ultra`; add the number of days if it isn't 30).

## 8. Customer care

Every agency login has **Customer care** (the headset at the top, and in the profile menu) to send a request. Your support team answers them at **/care** on the same site, with everything about the agency beside each request: plan and payments, logins and devices, WhatsApp and email health, recent broadcasts and errors.

Make a login for each person in your support team:

```bash
drona care add support@yourcompany.in "Ravi Kumar" lead
drona care add priya@yourcompany.in "Priya Sharma"
```

Each command prints a password once. They sign in at `https://<your site>/care`. A team lead can move anyone's request; an agent can take unassigned requests and their own.

## Everyday commands

| Command | What it does |
|---|---|
| `drona deploy` | Get the latest code from GitHub, back up, update, restart. Database changes apply automatically |
| `drona status` | What's running, and the health check |
| `drona logs` | Follow the logs (`drona logs worker` for sending and WhatsApp only) |
| `drona restart` | Restart after editing `deploy/.env` |
| `drona env` | Add settings that are new since the server was installed to `deploy/.env`, ready to fill in (deploy and restart do this too) |
| `drona backup` | Back up the database now (also runs every night at 02:30, keeps 14 days) |
| `drona restore <file>` | Put a backup back. Asks before replacing anything |
| `drona plan <email> basic\|professional\|ultra <logins> [days]` | Paid plan for 30 days (or the days given), for an agency that paid offline |
| `drona plan <email> paid [emails]` | Everything, with no end date (the company owner's email, or the company slug) |
| `drona plan <email> trial <days>` | Restart or extend a trial |
| `drona feature whatsapp-web <email> on\|off` | Allow WhatsApp Web after the trial (for a company you trust) |
| `drona care add <email> "<name>" [lead]` | A customer care login (prints a one-time password). Add `lead` for a team lead, who can move anyone's requests |
| `drona care password <email>` | A new password for a customer care login |
| `drona care off <email>` / `on <email>` | Switch a customer care login off (signs them out) or back on |
| `drona care list` | Everyone in customer care |

Off-server backups: create a Cloud Storage bucket, set `BACKUP_BUCKET=gs://your-bucket` in `deploy/.env`, and give the VM's service account *Storage Object Creator* on it. Each nightly backup is then copied there too.

## When something's wrong

- **Site shows a Cloudflare error 1033/502**: the tunnel connector or the app is down. `drona status` on the VM; `sudo systemctl status cloudflared` for the tunnel.
- **`drona deploy` says the app didn't become healthy**: it prints the last logs. A bad value in `.env` shows up as `Invalid environment configuration` with the setting's name. Fix it and run `drona deploy` again. If a database change failed, the app isn't started at all, and the backup taken just before is in `deploy/backups/`.
- **WhatsApp says "Waiting for scan" forever**: `drona logs worker`. The VM needs outbound internet access to WhatsApp, which Google Cloud allows by default.
- **Emails stuck as "Sending"**: `drona logs worker`. Usually missing or wrong AWS keys, or SES still in the sandbox (it only sends to verified addresses until production access is approved).
