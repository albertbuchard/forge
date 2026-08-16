# Agent Messages

Agent Messages is Forge's durable, asynchronous mailbox for work sent from a
Forge owner to a connected agent. It is deliberately closer to email than to
chat: delivery means Forge has stored the request, not that an agent is online
or responding in real time.

A message can contain text, one original voice note, or both. The voice note is
stored as a first-class sensitive Artifact and linked to the message through
Forge's normal entity-link graph. Forge preserves the original recording; a
transcript is optional derived information and never replaces the recording.

## Use Agent Messages

In the web app, open **Messages** or choose **Talk to agent** from the global
action surface. The composer requests microphone access and starts recording
immediately when the browser permits it. Text remains usable when microphone
permission is denied or recording is unsupported. Choose a connected agent, or
leave the recipient unchanged to use the configured default agent.

In Forge Companion for iPhone, open **Agent Messages**. The native SwiftUI
composer provides the same text, voice, and recipient choices. A new item is
written to the encrypted on-device outbox before Forge attempts the network.
The outbox shows whether it is queued, waiting for connectivity, waiting for
Wi-Fi approval, waiting for iOS background time, uploading, or needs a retry.

The mailbox has two owner views:

- **Outbox** contains every visible owner-authored message thread, including
  forwarded and retried child messages.
- **Inbox** contains threads with unread agent-authored progress,
  acknowledgement, handled, failed, or forwarded activity. Claims and lease
  renewals remain visible in history but do not create unread mail.

Both views use opaque, filter-bound keyset cursors. Outbox pages are ordered by
immutable server delivery time and message identifier. Inbox pages are ordered
by the newest unread eligible agent event, then event identifier and message
identifier, so later progress promotes an older thread while claim and lease
events do not. An Inbox cursor freezes the eligible-event horizon observed on
its first page. New messages and newer eligible activity therefore do not
duplicate, skip, or reorder rows during that traversal; they appear when the
user refreshes from the first page. A cursor can be reused only with the same
mailbox and status filter.

Opening a detail view shows the complete retained forwarding and retry chain,
including every visible ancestor and descendant rather than only the immediate
parent or child. It includes sender, initial and current recipient, timestamps,
immutable relationships, current state, result or failure, optional transcript
disclosure, and ordered audit history. Mark-read uses the event sequence that
the user actually saw, so a concurrent later update is not accidentally marked
read.

## Delivery And Work States

The server lifecycle is monotonic and auditable:

- `delivered`: Forge durably accepted the message and assigned its recipient.
- `claimed`: one agent owns a time-bounded processing lease.
- `in_progress`: the claiming agent recorded a progress update.
- `acknowledged`: the agent explicitly acknowledged the request; it can still
  later handle, fail, or forward it.
- `handled`: the agent recorded the terminal result.
- `failed`: the agent recorded a terminal failure. An owner retry creates a new
  child message rather than rewriting the failed message.
- `forwarded`: the source message was terminally forwarded. The destination is
  a new child message with immutable forwarding provenance.

Every message retains its original sender and initial recipient. Reassignment
changes only the current recipient. If an agent already has a live lease, the
owner must confirm lease revocation, provide the revision they reviewed, and
give a reason. Forge revokes and reassigns in one SQLite transaction, making
the previous lease secret invalid immediately.

## Agent Workflow

An agent token needs only the scopes required for its operations:

| Operation                                                | Scope                      |
| -------------------------------------------------------- | -------------------------- |
| Poll and read addressed message detail                   | `agentMessages.poll`       |
| Claim or renew a lease                                   | `agentMessages.claim`      |
| Add progress or acknowledgement                          | `agentMessages.progress`   |
| Handle or fail                                           | `agentMessages.complete`   |
| Forward to another connected owner-linked agent          | `agentMessages.forward`    |
| Read the original voice for the currently leased message | `agentMessages.voice.read` |

OpenClaw and Codex expose these routes through
`forge_call_agent_messages_route`. The tool accepts only the named Agent
Messages operations; it is not a generic authenticated HTTP proxy. Hermes
exposes the text operations but deliberately does not advertise voice download,
because the current Hermes bridge has no native audio-content transport.

A robust agent loop is:

1. Poll with a bounded limit. Polling returns metadata and text, never audio
   bytes.
2. Generate a cryptographically random 256-bit lease secret and a stable
   operation key, then claim one message. Keep both values for exact retry.
3. If the message contains voice and the runtime supports native audio, request
   that message's voice with the same lease secret and claim generation.
4. Add bounded progress or acknowledgement while the lease is live. Renew the
   lease before it expires if necessary.
5. Handle, fail, or forward with a stable operation key and terminal receipt
   key. Retrying the exact terminal request returns the original receipt;
   changing a payload under the same key is rejected.

Forge stores only a keyed digest of the agent-supplied lease secret. Atomic
`BEGIN IMMEDIATE` claim transactions prevent two polling agents from acquiring
the same live lease. A claim committed just before a response is lost can be
recovered by repeating the exact operation key and secret. An expired lease can
be taken over; a stale claimant cannot continue mutating the message.

Every operation receipt is bound to the authenticated actor kind and identifier,
the message, and the canonical request fingerprint. Terminal receipts also bind
the stable agent identity, claim generation, and a keyed digest of the lease
secret. Forge authorizes the current token, linked owner, recipient, and
operation before returning an earlier receipt, so another owner or agent cannot
discover or replay a committed result merely by learning an idempotency key.

## Voice Artifacts And Transcription

Voice activation accepts only these extension, MIME, container, and codec
combinations: `.m4a` with `audio/mp4` and AAC; `.aac` with `audio/aac` and AAC
in ADTS or an M4A container; `.mp3` with `audio/mpeg` and MPEG Layer III; `.wav`
with `audio/wav` and PCM or IEEE-float samples; `.webm` with `audio/webm` and
Opus; and `.ogg` with `audio/ogg` and Opus. The decoded body may not exceed 25
MiB and verified duration may not exceed 600,000 milliseconds. Forge checks the
byte signature, container, codec, declared MIME type and filename extension,
then records the verified duration and immutable SHA-256 identity. Malformed,
truncated, spoofed, unsupported, oversized, or unverifiable media is rejected
before it becomes agent-readable.

General agent Artifact download remains forbidden. Voice bytes are available
only through the Agent Messages voice operation when all of these facts still
match: owner scope, current recipient, live claim, lease secret digest, claim
generation, nonterminal message state, retention deadline, media type, size,
and stored integrity hash. Responses are non-cacheable.

The Codex MCP bridge can preserve an authorized voice response as one standard
MCP audio content block. Whether a particular installed Codex runtime accepts
and understands that audio is a runtime capability, not a Forge transcription
guarantee. ChatGPT subscription-backed Codex uses the allowance attached to the
configured Codex session; Forge does not call the separately billed OpenAI API
behind the user's back and does not describe transcription as free.

Forge never silently sends a recording to another transcription provider. If
an agent uses a separately configured, supported provider, it must disclose the
provider and privacy/cost posture with any derived transcript. If no authorized
audio-capable runtime or explicitly configured provider is available, the
message and original Artifact remain pending and actionable instead of being
dropped, falsely completed, or replaced by an invented transcript.

## Offline iPhone Delivery And Data Protection

Forge Companion stores the complete unsent message in an AES-GCM encrypted
queue. Its random 256-bit queue key is stored in Keychain with
`AfterFirstUnlockThisDeviceOnly`; the queue file uses iOS complete-until-first-
authentication Data Protection. Stable reservation and message idempotency keys
are created before the first network attempt and survive relaunches and retries.

The current Agent Messages path does not write a second persistent plaintext
upload-staging file. Voice is decrypted from the protected queue into memory
only while the app is in the foreground or iOS grants the existing background
processing task time. This reduces at-rest exposure, but it also means an active
transfer does not claim to continue after iOS suspends or terminates that
execution window. The encrypted item remains queued and is tried again with the
same identities when the app becomes active, connectivity returns, protected
data becomes available, or iOS grants another background-processing window.

iOS decides whether and when scheduled background work runs. Forge therefore
does not promise immediate delivery or a delivery deadline. Large voice notes
over 5 MiB wait for Wi-Fi unless the user explicitly allows cellular transfer.
The **Send now** and retry actions remain available while the app is open.

Notifications are optional and requested only from an explicit user action.
When authorized, a notification contains the agent label and generic state; it
does not include message text, progress detail, result text, transcript text, an
Artifact identifier, or audio.

## Idempotent Voice Creation

Browser and iPhone voice sends use the same three server-side idempotent steps:

1. Reserve one owner-scoped voice identity with a stable idempotency key.
2. Activate it with the bounded, verified original bytes using that same key.
3. Create the message with its own stable idempotency key and atomically consume
   the active reservation.

An exact retry returns the earlier result. Reusing a key with different content
returns `409`. An activated reservation is not described as a sent message until
the message create succeeds. Unconsumed reservations expire after 24 hours and
are cleaned only after Forge proves that no retained message or other policy
reference still needs the Artifact.

The browser keeps the reservation key, reservation identifier, original audio,
and message key stable through an ambiguous reserve, activation, or create
response while the composer remains mounted. It clears that attempt only after
success or when the payload changes. This is retry-safe network behavior, not a
durable browser offline outbox: closing or reloading the page can discard the
local unsent attempt. Only the iPhone client makes the encrypted on-device
durability guarantee described above.

## Retention, Deletion, And Forwarding

The default message retention deadline is 365 days after server delivery.
Owner deletion immediately hides the message from normal lists, clears a live
lease, and records who deleted it, when, and why; it does not pretend that
sensitive bytes disappeared before the retention cleanup proves that removal is
safe.

At expiry, Forge scrubs message text, progress, result, transcript, failure
detail, and the live voice link while preserving a minimal tombstone, timestamps,
provenance, and a SHA-256 purge receipt. Forward and retry children may share
the original voice Artifact. The Artifact remains until the last retained
message reference expires and no Artifact version, reservation, entity link, or
other policy reference remains.

Final byte removal uses a durable pending-cleanup job and the Artifact Store's
content-addressed blob lock. Startup reconciliation resumes an interrupted
cleanup. A newly discovered reference cancels removal. This is intentionally a
recoverable two-phase process rather than a false claim that SQLite and the
filesystem commit atomically.

## Troubleshooting

**A message remains queued on iPhone.** Check the outbox label. Restore network
connectivity, unlock the phone if protected data is unavailable, approve
cellular transfer for a large note or wait for Wi-Fi, then use **Send now**.
`Waiting for iOS background time` means the encrypted message is safe but iOS
has not yet granted another execution window.

**The agent does not see the message.** Confirm that the token's stable agent ID
matches the current recipient, that it is linked to the owner, and that it has
`agentMessages.poll`. Changing the default agent affects future messages only.

**A claim returns `409`.** Another worker may hold the live lease, the operation
key may have been reused with changed input, or the message may already have a
terminal result. Poll again and inspect current detail rather than generating a
new secret for an operation whose response may merely have been lost.

**Voice returns `404`.** Forge deliberately uses a non-revealing response when
the requester, recipient, owner, lease, generation, state, deletion, or retention
constraint does not match. Re-poll and claim the currently addressed message.

**No transcript appears.** The original voice is still preserved. Use an
authorized runtime with native audio support or explicitly configure a supported
provider and disclose its privacy/cost posture. Do not upload the recording to a
third party merely to clear the message.

## API Reference

The generated OpenAPI document is authoritative for request and response
schemas. Human owner routes live under `/api/v1/agent-messages`; verified Forge
Companion routes use the compatible `/api/v1/mobile/agent-messages` family.
Agent polling and lease operations use the scoped routes under
`/api/v1/agent-messages`. See the generated API reference and live
`/api/v1/agents/onboarding` payload for exact current schemas.
