# Forge Calendar Provider Setup

This guide matches the live Forge settings flow in
`Settings -> Calendar`.

Forge sync is provider-aware:

- Forge mirrors provider events into the Calendar view.
- Writable providers let Forge write work blocks and owned task timeboxes into a
  dedicated calendar named `Forge`.
- `Calendars On This Mac` uses EventKit to access the calendars already
  configured in Calendar.app on the host Mac.
- When the same upstream account is already connected remotely, Forge replaces
  the older connection instead of keeping duplicate visible copies.
- Exchange Online is currently read-only in Forge through Microsoft Graph.
- Exchange Online now uses a guided Microsoft sign-in flow in Forge, but that
  flow still requires a Microsoft app registration first.
- Read-only `.ics` subscriptions are not enough for writable-provider flows
  because Forge needs write access.

## What Forge Asks For

Forge now has five guided provider paths:

- `Google Calendar`
- `Calendars On This Mac`
- `Apple Calendar`
- `Exchange Online`
- `Custom CalDAV`

The important change for Apple is that Forge no longer expects raw calendar
collection URLs up front. It starts from
[https://caldav.icloud.com](https://caldav.icloud.com), authenticates, discovers
the current user principal and calendar home, then lets you choose which
calendars to mirror and which calendar Forge should write into.

## Calendars On This Mac

What you need:

- a macOS host running Forge
- the relevant calendars already configured in Calendar.app
- Calendar full access granted to Forge on that Mac

Important notes:

- Forge uses Apple's EventKit API against the host calendar store.
- This path can surface iCloud, Google, Exchange, local, subscribed, and other
  calendars that Calendar.app already aggregates for that machine.
- Forge groups discovery by host calendar source and prevents duplicate steady-
  state sync by replacing overlapping remote account connections instead of
  running two live copies side by side.

Step by step:

1. Open Forge on the same Mac that already has the desired calendars in
   Calendar.app.
2. Go to `Settings -> Calendar`.
3. Click `Calendars On This Mac`.
4. Click `Request Calendar access` and approve full access in macOS if asked.
5. Click `Discover host calendars`.
6. Choose the source account Forge should connect.
7. Select which calendars Forge should mirror into Forge.
8. Choose an existing writable calendar for Forge writes, or let Forge create a
   dedicated `Forge` calendar under that source.
9. If Forge detects that the same account is already connected through Google,
   Apple, Microsoft, or another CalDAV connection, confirm the replacement so
   only one canonical copy remains visible.
10. Save the connection and run the first sync.

## Exchange Online

What you need:

- an Exchange Online / Microsoft 365 account that can sign in with Microsoft
- a Microsoft Entra app registration for Forge as a public client
- the public client ID for that app registration
- optionally a tenant-specific authority if you do not want to use `common`

Important note:

- Forge uses Microsoft Graph for Exchange Online / Microsoft 365 calendars.
- The current Forge implementation is read-only for Microsoft: it mirrors the
  selected calendars into Forge but does not publish work blocks or timeboxes
  back to Microsoft.

Step by step for a self-hosted local Forge install:

1. Open Microsoft Entra App registrations and create or reuse an app for this
   local Forge install:
   [https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
2. Choose the supported account type that matches your local self-hosted use
   case. For most personal self-hosted use, a broad delegated choice is the
   least painful option.
3. In Authentication, enable mobile and desktop or public client flow support.
4. Add a redirect URI for Forge's local callback. The default local Forge
   callback is:
   `http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback`
5. If your Forge server runs on another port or hostname, register that exact
   callback URI in the Microsoft app registration and copy the same URI into
   Forge settings.
6. In API permissions, add delegated Microsoft Graph permissions:
   - `User.Read`
   - `Calendars.Read`
   - `offline_access`
   [https://learn.microsoft.com/en-us/graph/permissions-reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
7. Grant admin consent if your tenant requires it, or complete the normal
   user-consent path later during sign-in.
8. Copy the Application (client) ID from the Microsoft app registration.
9. Open Forge on the same machine that is running the local Forge backend and
   go to `Settings -> Calendar`.
10. In the `Exchange Online local setup` card, enter:
    - `Microsoft client ID`: the Application (client) ID you copied
    - `Tenant / authority`: usually `common` unless you need a tenant-specific
      authority
    - `Redirect URI`: the exact callback URI registered in Microsoft
11. Click `Save Microsoft settings`.
12. Click `Test Microsoft configuration`. Forge only verifies that it can build
    a local Microsoft sign-in flow from those values; the real proof still
    comes from the popup completing successfully.
13. Click `Sign in with Microsoft`.
14. Complete the Microsoft popup flow. Forge finishes the local MSAL public-
    client authorization-code flow with PKCE on the backend.
15. After the popup returns, Forge discovers the calendars available to that
    account through Microsoft Graph.
16. Select which calendars Forge should mirror into the Calendar page.
17. Save the connection and run the first sync.

Important notes:

- No Microsoft client secret is required for the local self-hosted Forge flow.
- Complete Microsoft setup from a browser on the same machine that is running
  Forge. The default callback is localhost-based.
- A local Microsoft sign-in cannot work without an app registration. If the
  user cannot create or access one, the only alternative is a Forge runtime
  that ships with a shared Microsoft app registration.
- Exchange Online remains read-only in Forge today: it mirrors selected
  calendars into Forge but does not receive Forge-owned work blocks or
  timeboxes.

## Google Calendar

What you need:

- one Google Cloud OAuth client for Forge as a Desktop app
- the Google Calendar API enabled in that same Google Cloud project
- the exact Forge redirect URI registered on that OAuth client

Important notes:

- End users do not create their own Google OAuth app.
- The local Forge runtime uses one Google OAuth client ID.
- Each user only signs in with their own Google account and grants this Forge
  app access to that user's calendar data.
- Forge needs offline access so it can store a refresh token per connected user.
- Forge uses Authorization Code + PKCE, and the code exchange still happens on
  the backend for this local localhost app.
- Prefer a Google `Desktop app` client for Forge. If Google still treats the
  configured client as secret-based, set `GOOGLE_CLIENT_SECRET` on the Forge
  server as well.
- The redirect URI must match exactly. Do not rely on arbitrary localhost
  ports.

Step by step:

1. Open Google Cloud credentials:
   [https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Create or reuse a Google Cloud project and enable the Calendar API:
   [https://developers.google.com/workspace/calendar/api/quickstart](https://developers.google.com/workspace/calendar/api/quickstart)
3. Create or reuse one OAuth client for Forge as a `Desktop app`.
4. Register Forge's exact callback URI in Google Cloud Console. For the default
   local Forge runtime, that callback is:
   `http://127.0.0.1:4317/api/v1/calendar/oauth/google/callback`
5. Configure the Google consent screen and make sure the Calendar scopes Forge
   needs are allowed for that app.
6. Set these Forge environment variables for the runtime that will host the
   pairing flow:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET` only if the configured Google OAuth client still
     requires one
   - `APP_BASE_URL`
   - `GOOGLE_REDIRECT_URI`
   - `GOOGLE_ALLOWED_ORIGINS`
7. Open Forge and go to `Settings -> Calendar`.
8. Check that Forge shows the expected base URL, redirect URI, and allowed
   browser origins.
9. For local development, open Forge locally on the same machine that is
   running Forge. In the default local dev flow, that usually means the Vite UI
   on `http://127.0.0.1:3027/forge/`, while the redirect itself still returns
   to `http://127.0.0.1:4317`.
10. Do not start Google pairing from a Tailscale `.ts.net` URL on a phone or
    another device when the registered callback still points to
    `127.0.0.1`. Google will redirect to localhost on that device, not back to
    Forge on the Mac.
11. Click `Google Calendar`, then `Sign in with Google`.
12. Sign in with the user's own Google account and grant Forge access.
13. Forge exchanges the authorization code on the backend, stores that user's
    refresh token, and then discovers the calendars for that account.
14. Select which calendars Forge should mirror into the Calendar page.
15. Select the calendar Forge should write into for work blocks and timeboxes.
16. If no write calendar named `Forge` exists yet, choose `Create a new Forge
    calendar`.
17. Save the connection and run the first sync.

Developer note for Google Cloud Console:

1. Create one OAuth client for the local Forge app.
2. Set the app type to `Desktop app`.
3. Register the exact Forge redirect URI.
4. Configure the consent screen and Calendar scopes.
5. End users sign in with their own Google accounts to grant this Forge app
   access.

## Apple Calendar

What you need:

- the Apple account email
- an Apple app-specific password

Important note:

- You do not need to paste raw iCloud calendar collection URLs into Forge.
- Forge starts from `https://caldav.icloud.com` and performs CalDAV discovery
  for you.

Step by step:

1. Generate an Apple app-specific password:
   [https://support.apple.com/en-us/102654](https://support.apple.com/en-us/102654)
2. Review Apple's third-party calendar guidance if needed:
   [https://support.apple.com/guide/icloud/set-up-calendar-mmfc0f2442/icloud](https://support.apple.com/guide/icloud/set-up-calendar-mmfc0f2442/icloud)
3. Open Forge and go to `Settings -> Calendar`.
4. Click `Apple Calendar`.
5. Enter the Apple account email and the app-specific password.
6. Click discovery. Forge will:
   - start from `https://caldav.icloud.com`
   - discover the current user principal
   - discover the calendar home set
   - enumerate the writable calendars under that home set
7. Select which discovered calendars Forge should mirror.
8. If one discovered calendar is already named `Forge`, Forge will preselect it
   as the write calendar.
9. If no `Forge` calendar exists, choose `Create a new Forge calendar`.
10. Save the connection and run the first sync.

## Custom CalDAV

What you need:

- the account-level CalDAV base URL
- the username or email
- the password or app password

Important note:

- Use the base CalDAV server URL, not a single calendar collection URL.
- Forge discovers the actual calendars before saving the connection.

Step by step:

1. Confirm your provider supports CalDAV, not only `.ics` export.
2. Gather the account-level CalDAV base URL, username, and password or app
   password.
3. Open Forge and go to `Settings -> Calendar`.
4. Click `Custom CalDAV`.
5. Enter the base URL and account credentials.
6. Click discovery. Forge will enumerate the available calendars for that
   account.
7. Select which calendars Forge should mirror.
8. Select the calendar Forge should write into, or create a new `Forge`
   calendar if one does not exist.
9. Save the connection and run the first sync.

## Discovery Behavior For Apple

Forge follows the CalDAV discovery model rather than asking for hidden iCloud
calendar URLs:

1. Start from `https://caldav.icloud.com`.
2. Authenticate with the Apple account email and app-specific password.
3. Discover `DAV:current-user-principal`.
4. Discover `CALDAV:calendar-home-set`.
5. Enumerate calendar collections under that home set.
6. Persist the discovered principal URL, home URL, and selected calendar URLs
   for future sync.

This is why the guided Apple setup only asks for the Apple account email and
app-specific password.

## What Happens In Forge

After the connection succeeds:

- the Calendar page stays display-first and week-first
- provider configuration stays in `Settings -> Calendar`
- the Calendar page opens guided action flows rather than raw provider setup
  forms
- the dedicated write calendar keeps the default name `Forge`
- Exchange Online connections are mirrored read-only and do not receive Forge
  writebacks yet
- The Exchange Online UI is intentionally guided-sign-in based. Users should not
  be asked for raw Microsoft OAuth client secrets or refresh tokens in settings,
  but they still must provide a valid Microsoft app registration client ID and
  redirect URI in Forge's local settings first.
