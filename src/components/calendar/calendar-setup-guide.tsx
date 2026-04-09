import { ExternalLink, FileText, KeyRound, Link2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { CalendarProvider } from "@/lib/types";

const GUIDE_SECTIONS = [
  {
    title: "Before you connect anything",
    description:
      "Forge mirrors provider events into Forge. Writable providers can also publish work blocks plus owned timeboxes into a dedicated calendar named Forge, while Exchange Online stays read-only for now.",
    bullets: [
      "Google uses a localhost Authorization Code + PKCE flow. Each user signs in with their own Google account on the same machine running Forge, while Forge stores that user's refresh token on the server for background sync.",
      "Apple Calendar starts from https://caldav.icloud.com and autodiscovers the real principal plus calendar collections for you.",
      "Exchange Online uses Microsoft Graph with a guided local public-client Microsoft sign-in flow and mirrors the calendars you select into Forge.",
      "Custom CalDAV uses one account-level base URL, then Forge discovers the writable calendars before you choose what to mirror.",
      "Read-only .ics feeds are not enough for writable-provider flows because Forge needs write access for work blocks and task timeboxes."
    ],
    icon: Link2,
    links: []
  },
  {
    title: "Google Calendar setup",
    description:
      "Use one Google Cloud desktop-app OAuth client for local Forge, register the exact localhost callback URI, and let Forge complete the Authorization Code + PKCE exchange on the backend.",
    bullets: [
      "Open Google Cloud credentials and create or reuse one OAuth client for Forge as a Desktop app.",
      "Enable the Calendar API for the same project.",
      "Register Forge's exact callback URI. In local Forge, the default callback is http://127.0.0.1:4317/api/v1/calendar/oauth/google/callback.",
      "Open Forge on localhost on the same machine that is running Forge. If Forge is opened remotely from a phone or a Tailscale route while the callback is localhost, Google will redirect to localhost on that device and the flow will fail.",
      "The user signs in with their own Google account and grants Forge access. They do not create their own Google OAuth client during this step.",
      "Forge will discover the calendars, let you choose which calendars to mirror, and create or reuse Forge as the write calendar."
    ],
    icon: KeyRound,
    links: [
      {
        label: "Google Cloud credentials",
        href: "https://console.cloud.google.com/apis/credentials"
      },
      {
        label: "Calendar API quickstart",
        href: "https://developers.google.com/workspace/calendar/api/quickstart"
      }
    ]
  },
  {
    title: "Apple Calendar setup",
    description:
      "Apple does not require you to paste raw calendar collection URLs into Forge. Start with your Apple ID email, an app-specific password, and the iCloud CalDAV base URL.",
    bullets: [
      "Create an Apple app-specific password for third-party calendar access.",
      "Open Forge settings and choose Apple Calendar.",
      "Enter the Apple ID email and the app-specific password. Forge uses https://caldav.icloud.com for autodiscovery.",
      "After discovery, choose which calendars Forge should mirror.",
      "If a calendar named Forge already exists, Forge will preselect it as the write calendar. Otherwise you can ask Forge to create it for you."
    ],
    icon: FileText,
    links: [
      {
        label: "Apple app-specific passwords",
        href: "https://support.apple.com/en-us/102654"
      },
      {
        label: "Use iCloud Calendar with third-party apps",
        href: "https://support.apple.com/guide/icloud/set-up-calendar-mmfc0f2442/icloud"
      }
    ]
  },
  {
    title: "Exchange Online setup",
    description:
      "Use Microsoft Graph for Microsoft 365 or Exchange Online calendars. In self-hosted local Forge, the user first saves a Microsoft public client ID, tenant, and redirect URI in Settings -> Calendar, then completes a guided local sign-in flow with PKCE. The connection is still read-only in Forge today.",
    bullets: [
      "Open Microsoft Entra App registrations and create or reuse an app for this local Forge instance.",
      "Choose a supported account type that matches your self-hosted use case. Use a broad multi-account setup when Forge should work with normal personal or organizational Microsoft sign-ins.",
      "Enable mobile and desktop or public client flow support for that app registration.",
      "Add Forge's callback URI to the redirect URI list. The default local callback is http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback.",
      "Add delegated Graph permissions for User.Read and Calendars.Read, then grant or request consent as required by the tenant.",
      "Open Forge Settings -> Calendar and save the Microsoft client ID, tenant value, and redirect URI in the Exchange Online setup card.",
      "Use Test Microsoft configuration to confirm Forge can launch the local sign-in flow.",
      "Click Sign in with Microsoft, complete the popup flow, and then choose which Exchange Online calendars Forge should mirror."
    ],
    icon: KeyRound,
    links: [
      {
        label: "Microsoft Graph permissions",
        href: "https://learn.microsoft.com/en-us/graph/permissions-reference"
      },
      {
        label: "Microsoft identity platform",
        href: "https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow"
      },
      {
        label: "Microsoft Graph calendar overview",
        href: "https://learn.microsoft.com/en-us/graph/api/resources/calendar?view=graph-rest-1.0"
      }
    ]
  },
  {
    title: "Custom CalDAV setup",
    description:
      "Use this path for Nextcloud, Fastmail, Baikal, DAViCal, and other CalDAV-compatible providers that expose an account-level base URL.",
    bullets: [
      "Confirm the provider supports CalDAV, not just an .ics export.",
      "Gather the account-level CalDAV server URL, username, and password or app password.",
      "Open Forge settings and choose Custom CalDAV.",
      "Forge discovers the available calendars from that base URL before anything is saved.",
      "Choose which calendars to mirror and either select an existing Forge calendar or let Forge create one automatically."
    ],
    icon: Link2,
    links: []
  }
] as const;

type CalendarSetupGuideSection = (typeof GUIDE_SECTIONS)[number];

function getVisibleSections(provider?: CalendarProvider) {
  if (!provider) {
    return GUIDE_SECTIONS;
  }
  const providerTitle =
    provider === "google"
      ? "Google Calendar setup"
      : provider === "apple"
        ? "Apple Calendar setup"
        : provider === "microsoft"
          ? "Exchange Online setup"
          : "Custom CalDAV setup";
  return GUIDE_SECTIONS.filter(
    (section) => section.title === "Before you connect anything" || section.title === providerTitle
  );
}

function GuideSectionCard({
  section,
  compact
}: {
  section: CalendarSetupGuideSection;
  compact: boolean;
}) {
  const Icon = section.icon;

  return (
    <Card
      className={
        compact
          ? "grid gap-3 rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,28,38,0.98),rgba(11,17,28,0.98))] p-4"
          : "grid gap-4 rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,28,38,0.98),rgba(11,17,28,0.98))]"
      }
    >
      <div className="flex items-start gap-4">
        <div className="rounded-[18px] bg-[var(--primary)]/14 p-3 text-[var(--primary)]">
          <Icon className={compact ? "size-4" : "size-5"} />
        </div>
        <div className="min-w-0">
          <div className={compact ? "font-medium text-white" : "font-display text-[1.15rem] text-white"}>
            {section.title}
          </div>
          <p className={compact ? "mt-1.5 text-sm leading-6 text-white/62" : "mt-2 max-w-3xl text-sm leading-6 text-white/62"}>
            {section.description}
          </p>
        </div>
      </div>

      <div className={compact ? "grid gap-1.5" : "grid gap-2"}>
        {section.bullets.map((bullet) => (
          <div
            key={bullet}
            className={
              compact
                ? "rounded-[16px] bg-white/[0.04] px-3 py-2.5 text-sm leading-6 text-white/70"
                : "rounded-[18px] bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/72"
            }
          >
            {bullet}
          </div>
        ))}
      </div>

      {section.links.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {section.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/74 transition hover:bg-white/[0.08] hover:text-white"
            >
              <ExternalLink className="size-3.5" />
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export function CalendarSetupGuide({
  provider,
  compact = false
}: {
  provider?: CalendarProvider;
  compact?: boolean;
}) {
  const visibleSections = getVisibleSections(provider);

  return (
    <div className="grid gap-4">
      {visibleSections.map((section) => (
        <GuideSectionCard key={section.title} section={section} compact={compact} />
      ))}
    </div>
  );
}
