# Install Forge

The normal Forge installation is one guided command:

```bash
npx forge-memory
```

This guide matches the released `forge-memory@0.3.52` installer. It covers the local
Forge web app and the optional Codex, OpenClaw, Hermes, Claude Code, remote-browser, and
iPhone connections.

## Before You Start

You need Node.js 22 or newer. Node includes the `npm` and `npx` commands used by the
installer.

Check your versions:

```bash
node --version
npm --version
```

The first command must report version 22 or newer. If it does not, install a current
[Node.js LTS release](https://nodejs.org/en/download) and reopen your terminal.

Install Codex, OpenClaw, Hermes, or Claude Code before Forge if you want the guided
installer to detect that host automatically. This is optional. You can install a host
later and rerun `npx forge-memory configure`.

If you want to pair an iPhone, Forge Companion must already be installed on that phone.
The current app is distributed to invited testers through TestFlight. The
`forge-memory` installer creates the secure pairing material; it does not install the app
or enroll a TestFlight account. If you do not already have Companion, skip the optional
phone prompt.

Run Forge as your normal operating-system user. Do not use `sudo` for the Forge
installer.

## Exact First Install

1. Start the guided installer:

   ```bash
   npx forge-memory
   ```

2. Choose host adapters.

   Forge always installs its local web app and API. The adapter screen selects every
   detected Codex, OpenClaw, Hermes, and Claude Code host by default. Use the arrow keys
   to move, Space to toggle a detected host, and Enter to continue. A missing host stays
   visible as a disabled `not found` row. You can also skip adapter setup.

3. Confirm the Forge data folder.

   The normal default is `~/.forge`. Keep that folder unless you deliberately want a
   different location. The selected adapters use the same Forge runtime and data folder.

4. Decide whether to enable Forge-to-Forge sharing.

   This is separate from Codex, OpenClaw, Hermes, Claude Code, browser, and iPhone access.
   It is optional and defaults to off on a new install. Leave it off unless you intend to
   pair two independent Forge installations.

5. Decide whether to pair the iPhone companion now.

   The prompt defaults to yes. Choose no if you only want the browser or agent adapters;
   you can pair the phone later with:

   ```bash
   npx forge-memory pair-ios
   ```

6. Wait for the final checks.

   A successful install ends with:

   ```text
   Forge Memory configured and checked.
   Doctor: passed
   ```

7. Open and verify Forge:

   ```bash
   npx forge-memory ui
   npx forge-memory status
   npx forge-memory doctor
   ```

   The usual local web address is
   [`http://127.0.0.1:4317/forge/`](http://127.0.0.1:4317/forge/).

## What The iPhone Choice May Ask

Forge prefers a private Tailscale HTTPS connection for the iPhone when Tailscale is
available. If you choose iPhone pairing during installation or run
`npx forge-memory pair-ios` later, Forge may ask for additional consent:

- If Tailscale is missing and your platform has a supported installer, Forge asks
  whether to install it. The default is yes. You can decline.
- If Tailscale is authenticated but Forge is not yet reachable through it, Forge asks
  whether to configure Tailscale Serve. The default is yes. Serve creates the private
  HTTPS route; Tailscale Funnel is not required.
- If the verified Tailscale HTTPS origin changes, Forge may restart only its managed
  runtime so requests can be bound to that exact origin. The data folder is preserved.
- If Tailscale is unavailable or declined, Forge offers its Iroh fallback. The Iroh host
  is built locally, so Forge may ask to install the minimal Rust/Cargo toolchain. The
  default is yes. It then compiles the bundled native source before creating the QR code.

Skipping phone pairing is safe. Run `npx forge-memory pair-ios` later on the Forge host,
from the same operating-system account that owns the installation.

When the QR appears, open Forge Companion on the iPhone and scan it. If the camera cannot
scan the code, use **Manual connection** in the app and paste the owner-only payload saved
under `~/.forge/pairing/`.

An already paired Companion does not need to pair again while its renewable credential
remains valid. Normal synchronization can resume silently.

## Connect A Remote Browser

The base installation is local. It does not expose Forge to another machine. The normal
runtime listens on loopback at `127.0.0.1:4317`.

A remote browser needs an explicitly configured private HTTPS route first. The supported
automatic path in this release is the Tailscale Serve step offered by
`npx forge-memory pair-ios`. You can use the resulting MagicDNS HTTPS address from
another device in the same tailnet. Tailscale Funnel is unnecessary.

Network access is not authorization. After the HTTPS route exists:

1. Open the remote Forge URL ending in `/forge/`.
2. Forge automatically checks the device credential provider for an existing
   Forge passkey. Complete Face ID, Touch ID, Windows Hello, or the device
   passcode if one is available. A successful check opens Forge without another
   pairing code.
3. If this is the first authorization for the device, select **Pair this
   browser**.
4. Keep the short code visible on the requesting browser.
5. Approve the exact pending request once:
   - click the pairing notification in an already unlocked local-owner Forge window,
     review the request under **Settings → Agents**, enter the short code, and approve;
     or
   - on the Forge host, as the operating-system account that owns Forge, run:

     ```bash
     npx forge-memory pairing
     ```

     Select the request, enter the same code, and approve.

6. Return to the remote browser. Forge creates a scoped renewable session and
   immediately asks for one device-passkey verification. Complete that check so
   compatible browsers using the same credential provider and exact HTTPS host
   can restore the same profile and scopes without another owner approval. If
   passkeys are unavailable or declined, the new browser session still works.

Forge silently rotates the renewable session during normal use. If disposable
browser storage is cleared but the secure refresh cookie survives, Forge now
tries that cookie directly. Package updates and reinstalls preserve the device
credential when they preserve the canonical Forge data root and installation
identity.

Tailscale access controls remain useful as an additional network filter. They never
replace the Forge credential and pairing checks.

## Platform Differences In 0.3.52

| Capability                                     | macOS                                            | Linux                                                                                    | Windows                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Local Forge runtime and detected host adapters | Supported                                        | Supported                                                                                | Supported                                                                                                                            |
| Automatic local-browser owner handoff          | Uses the installed owner-only `forge://` handler | The macOS handler is not available; use the Forge-host CLI for a pending browser request | The macOS handler is not available; use the protected Windows owner channel through the Forge-host CLI for a pending browser request |
| Renewable remote CLI target credential         | Stored in macOS Keychain                         | Not available in 0.3.52                                                                  | Not available in 0.3.52                                                                                                              |
| Tailscale setup guidance for iPhone pairing    | Homebrew installation may be offered             | The official install script may be offered when `curl` is available                      | `winget` installation may be offered                                                                                                 |
| Iroh iPhone fallback                           | Built locally; Rust/Cargo may be requested       | Built locally; build tools and Rust/Cargo may be required                                | Built locally; Rust/Cargo may be requested                                                                                           |
| Forge-to-Forge sharing                         | Supported                                        | Supported                                                                                | Not available in 0.3.52; leave it disabled                                                                                           |

On Linux or Windows, the host-side `npx forge-memory pairing` command approves a browser
request only after that browser has created a pending request over a private HTTPS route.

## Add Or Change An Adapter

Install the desired Codex, OpenClaw, Hermes, or Claude Code host, then rerun:

```bash
npx forge-memory configure
```

The installer discovers hosts again and uses the current Forge settings as defaults.
Local adapters authenticate through the protected local-owner helper. You do not need to
copy a long-lived API key into their configuration.

Manual adapter commands remain available for source development and recovery:

- [Codex MCP](../plugins/codex/README.md)
- [OpenClaw](./reference/openclaw-plugin.md)
- [Hermes](./reference/hermes-plugin.md)
- [Claude Code](./reference/claude-code-adapter.md)

## Update Or Recover

Use the supported update path:

```bash
npx forge-memory update
```

Forge creates a pre-update backup when appropriate, prints its path, refreshes the
runtime and selected adapters, and preserves the Forge data folder.

If installation or health checks fail, run:

```bash
npx forge-memory doctor --repair
```

Repair recreates missing Forge-owned runtime folders and may restart an unhealthy managed
runtime. It does not delete the Forge data folder.

`ui` and a locally configured Forge Memory MCP client also repair a healthy
source runtime that was started without the verified local-browser handler. The
repair holds the runtime-manager locks, verifies the responder and canonical
data root, and fails closed or restores the prior process if ownership cannot be
proved. It does not require deleting browser state or pairing again.

Useful follow-up commands:

```bash
npx forge-memory configure
npx forge-memory status
npx forge-memory doctor
npx forge-memory ui
npx forge-memory restart
npx forge-memory stop
npx forge-memory export
npx forge-memory uninstall
```

`uninstall` keeps the Forge data folder by default. Only `uninstall --remove-data`
requests data deletion.

For deeper recovery and data-root checks, read
[Operator settings and recovery](./reference/operator-settings-and-recovery.md).
