# Forge Calendar Provider Setup

This guide matches the live Forge settings flow in
`Settings -> Calendar`.

Forge sync is provider-aware:

- Forge mirrors provider events into the Calendar view.
- Writable providers let Forge write work blocks and owned task timeboxes into a
  dedicated calendar named `Forge`.
- Exchange Online is currently read-only in Forge through Microsoft Graph.
- Exchange Online now uses a guided Microsoft sign-in flow in Forge rather than
  a user-pasted client-secret or refresh-token form.
- Read-only `.ics` subscriptions are not enough for writable-provider flows
  because Forge needs write access.

## What Forge Asks For

Forge now has four guided provider paths:

- `Google Calendar`
- `Apple Calendar`
- `Exchange Online`
- `Custom CalDAV`

The important change for Apple is that Forge no longer expects raw calendar
collection URLs up front. It starts from
[https://caldav.icloud.com](https://caldav.icloud.com), authenticates, discovers
the current user principal and calendar home, then lets you choose which
calendars to mirror and which calendar Forge should write into.

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

1. Create or reuse an Azure app registration for Forge:
   [https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
2. In that app registration, enable public client flows / mobile and desktop
   flow support.
3. Add a redirect URI for Forge's local callback. The default local Forge
   callback is:
   `http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback`
4. If your Forge server runs on another port, either register that exact
   callback URI or set `FORGE_MICROSOFT_REDIRECT_URI` to match it.
5. Add delegated Microsoft Graph calendar permissions such as
   `Calendars.Read`:
   [https://learn.microsoft.com/en-us/graph/permissions-reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
6. On the machine running Forge, set:
   - `FORGE_MICROSOFT_CLIENT_ID=<your public client id>`
   - optional: `FORGE_MICROSOFT_TENANT_ID=<tenant id or common>`
   - optional when not using the default callback:
     `FORGE_MICROSOFT_REDIRECT_URI=http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback`
7. Restart the Forge server after changing those environment variables.
8. Open Forge locally and go to `Settings -> Calendar`.
9. Click `Exchange Online`.
10. Enter a readable connection label if you want to rename the card.
11. Click `Sign in with Microsoft`.
12. Complete the Microsoft popup flow. Forge finishes the local MSAL public-
    client authorization-code flow with PKCE on the backend.
13. After the popup returns, Forge discovers the calendars available to that
    account through Microsoft Graph.
14. Select which calendars Forge should mirror into the Calendar page.
15. Save the connection and run the first sync.

Important notes:

- No Microsoft client secret is required for the local self-hosted Forge flow.
- Complete Microsoft setup from a browser on the same machine that is running
  Forge. The default callback is localhost-based.
- Exchange Online remains read-only in Forge today: it mirrors selected
  calendars into Forge but does not receive Forge-owned work blocks or
  timeboxes.

## Google Calendar

What you need:

- the Google account email
- a Google OAuth client ID
- a Google OAuth client secret
- a Google refresh token

Step by step:

1. Open Google Cloud credentials:
   [https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Create or reuse a Google Cloud project and enable the Calendar API:
   [https://developers.google.com/workspace/calendar/api/quickstart](https://developers.google.com/workspace/calendar/api/quickstart)
3. Create an OAuth client for that same project.
4. Generate a refresh token. The fastest Google-hosted helper is OAuth
   Playground:
   [https://developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
5. Open Forge and go to `Settings -> Calendar`.
6. Click `Google Calendar`.
7. Enter the account email, client ID, client secret, and refresh token.
8. Click discovery. Forge will load the available calendars for that account.
9. Select which calendars Forge should mirror into the Calendar page.
10. Select the calendar Forge should write into for work blocks and timeboxes.
11. If no write calendar named `Forge` exists yet, choose `Create a new Forge
    calendar`.
12. Save the connection and run the first sync.

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
  be asked for raw Microsoft OAuth client secrets or refresh tokens in settings.
