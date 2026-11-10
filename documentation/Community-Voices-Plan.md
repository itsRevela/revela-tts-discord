# Community Voices Plan

Date: 2026-11-09. Status: implemented and deployed 2026-11-10 with the decisions in section 11 (owner changes: blacklist applies to published names only; author tag is the Discord username). Built differences: reports are a separate `/reportvoice` command (Discord does not allow a top-level option next to subcommands, so `/communityvoices` stays a plain search); moderators default to the bot application owner when `OWNER_USER_IDS` is unset; a clip attached to `/myvoices add` without a name is named after its file; clips are written straight into `<id>/` (Pocket reads them from there) and removed on any failure.

## 1. Overview

Users upload a short clip, the Pocket TTS sidecar clones it, and the voice appears under a new **My Voices** category in `/voice`. Publishing it adds it to a **Community Voices** category that everyone in every server the bot is in can pick, tagged with the author. `/voice` loses its typed `name` option; `/search` takes that over for everything except community voices, and `/communityvoices` searches those.

Owner decision already taken: **all uploaded voices are cloned by Pocket TTS only** (never NeuTTS). Picking an uploaded voice switches the user to Pocket, exactly as `/customvoice` switches models today.

Design principles:

- The bot owns the truth about uploaded voices (`data/user-voices/catalog.json`). Pocket is a stateless cloner that resolves `user:<id>` on demand from a shared read-only mount. No registry on the sidecar, no list refetch races.
- Voice ids are random and permanent (`user:<13 base32 chars>`); the display name is metadata. Rename never touches the sidecar, preferences or the cache.
- Preferences keep their schema. A user whose chosen voice was deleted, unpublished or taken down falls back to the Pocket default at read time, which is what `resolveVoice` already does for unknown voices.

## 2. User flows

**Add**: `/myvoices add [name] [clip]`. Without `clip` the bot opens a modal: a short tips block ("5-20 s of one person talking normally, no music or other voices, no silence at the start; .ogg/.mp3/.wav/.flac up to 10 MB; only your own voice or one you have permission to use"), a Name text input (prefilled from `name`) and a FileUpload field. On submit the bot defers an ephemeral reply, shows a progress line (`⏳ Checking the clip ▰▱▱▱ 25%` → Cloning → Making a preview), then "✅ **Name** is ready. It's in /voice under My Voices." with a short WAV preview attached and a "Use it now" button. With `clip` given as an attachment option the same pipeline runs without the modal (fallback for clients where modal file upload is not available).

**Use own voice**: `/voice` → filter "My Voices (n)" lists the user's uploads; picking one switches to Pocket. `/search <query>` also matches them.

**Manage**: `/myvoices list`; `/myvoices rename <voice> <new name>`; `/myvoices delete <voice>` (confirm button; says how it affects the published copy); `/myvoices publish <voice>` (confirm button restating the consent rule); `/myvoices unpublish <voice>`. `<voice>` autocompletes from the user's own voices by name, value is the id.

**Pick a community voice**: `/voice` → "Community Voices (n)" filter, options read "Name" with description "by <username> · Pocket TTS". `/communityvoices [query]`: with a query, autocomplete over name and author, choosing switches voice; without a query, opens the `/voice` picker on the Community filter.

**Report / moderate**: `/communityvoices report <voice> <reason>` records a report (and posts to `MOD_LOG_CHANNEL_ID` if set). `/voicemod takedown|ban|unban|list` for the configured owners.

**Switch off**: `USER_VOICE_UPLOADS=false` disables add and publish immediately; existing voices keep working.

## 3. Architecture

### Pocket sidecar (services/pocket)

- New mount: `${DATA_PATH}/user-voices:/user-voices:ro` (env `POCKET_USER_VOICES_DIR`).
- Voice resolution in `/v1/audio/speech`: a requested voice matching `^user:[a-z2-7]{13}$` resolves to `/user-voices/<id>/source.*` (exactly one file) and is cloned lazily on first use, then cached like curated voices. Unknown id → 400 `unknown_voice`. Existing voices and endpoints are unchanged.
- `POST /v1/user-voices/{id}/prepare` → decodes with soundfile (libsndfile: wav/flac/ogg/mp3), rejects `unsupported_audio`, `too_short` (< `POCKET_USER_VOICE_MIN_SECONDS`, default 3), `too_long` (> `POCKET_USER_VOICE_MAX_SECONDS`, default 60), `not_found`; clones under `generation_lock` so it never overlaps a generation; returns `{id, durationSec, sampleRate, channels, truncated}` (Kyutai's `truncate=True` uses at most the first 30 s).
- `DELETE /v1/user-voices/{id}` → drops the in-memory state and cache file; 204, idempotent.
- Cache file name `user-<id>-<mtime_ns>.safetensors`. At startup, cache files whose source directory is gone are removed; user voices are not pre-cloned at startup (startup time stays flat as the catalog grows).

### Bot

- `src/userVoices/` feature folder: catalog store, name rules and blacklist, quotas, attachment validation and download, Pocket client, service (orchestration), preview, moderation, catalog integration.
- Catalog integration: the Pocket `LoadedModel` in `ModelCatalog` is recomposed as `withUserVoices(basePocketModel, catalog)` whenever Pocket joins the catalog or a user voice changes; `catalog.add()` already replaces by id. Each uploaded voice becomes a `Voice` `{ id: 'user:<id>', label: name, language: 'en', uploaded: { ownerId, published, authorUsername } }`. `loadSpeechServerModel` passes `user:` ids through to the server unchanged.
- Access: `PreferenceDefaults.resolveVoice(model, requested, access)` with `access = { customVoices, userId }`; an uploaded voice resolves only when published or owned by `userId`. `voiceEntries(catalog, { userId, includeCustom })` builds the My Voices and Community Voices groups per user.
- Interaction router gains modal dispatch (`interaction.isModalSubmit()`, routed by customId prefix like components) and `SlashCommand.modal?`.
- Uploads are processed one at a time (the existing `serialize` helper); a second uploader sees "1 upload ahead of yours".

### Why not the alternatives

- *Pocket keeps the registry and the bot refetches the voice list*: two sources of truth, and the display name, owner and published flag would still have to live bot-side. Rejected.
- *Bot POSTs the clip to Pocket and Pocket stores it*: puts user data in a cache volume that is treated as disposable. The data directory is already shared and backed up. Rejected.
- *Also clone on NeuTTS*: decided against by the owner; it would need Whisper transcription per upload and transcript quality drives output quality.

## 4. Data model

`data/user-voices/catalog.json` (zod-validated, atomic write, serialized saves, same pattern as `preferenceStore.ts`):

```json
{
  "version": 1,
  "voices": {
    "k7m2q4z6x3b5n": {
      "id": "k7m2q4z6x3b5n",
      "ownerId": "123456789012345678",
      "name": "Grumpy Narrator",
      "nameKey": "grumpynarrator",
      "createdAt": "2026-11-09T12:00:00Z",
      "source": { "ext": "ogg", "bytes": 412345, "durationSec": 14.2 },
      "published": { "at": "2026-11-09T12:05:00Z", "authorUsername": "revela" }
    }
  }
}
```

- `nameKey` is the normalized name (section 6) used for collision checks; unique per owner, and unique across all published voices.
- `published` absent = private. `authorUsername` is the author's Discord username (not display name), recorded at publish and refreshed on rename and republish.
- Files: `data/user-voices/<id>/source.<ext>`. Temporary downloads go to `data/user-voices/tmp/<id>.<ext>` and are moved into place only after Pocket's prepare succeeds. User-supplied filenames are never used in paths.
- `data/user-voices/moderation.json`: `{ "bans": { "<userId>": { "at", "byUserId", "reason?" } }, "reports": [ { "at", "voiceId", "reporterId", "reason" } ] }`.
- `data/name-blacklist.txt`: one term per line, `#` comments. Missing file = warning at startup and no blocking (owner must create it before publishing opens; see limits).
- Preferences: unchanged schema; `voices.pocket` may hold `user:<id>`.

## 5. Commands

| Command | Options | Behaviour |
|---|---|---|
| `/voice` | none | Picker with new filters "My Voices (n)" (owner's uploads) and "Community Voices (n)" (published, newest first). The `name` option and its autocomplete are removed. |
| `/search` | `query` (autocomplete, required) | Old `/voice name` behaviour: built-ins, curated custom voices when unlocked, and the user's own uploads. Choosing switches voice and model. |
| `/communityvoices` | `query` (autocomplete, optional) | Matches published voices by name or author; choosing switches to Pocket with that voice. Without a query opens the picker on the Community filter. Subcommand `report voice reason`. |
| `/myvoices add` | `name` (optional, string), `clip` (optional, attachment) | Modal unless `clip` given. Runs the upload pipeline. |
| `/myvoices list` | | Private list with id-less names, duration, published state and pick counts if tracked. |
| `/myvoices rename` | `voice` (autocomplete), `name` | Validates the new name; updates private and published copy. |
| `/myvoices delete` | `voice` | Confirm button; removes everywhere, unpicks for everyone via read-time fallback. |
| `/myvoices publish` | `voice` | Confirm button with the consent line; checks blacklist, published-name uniqueness, bans, publish quota. |
| `/myvoices unpublish` | `voice` | Removes from Community; users on it fall back. |
| `/voicemod takedown` | `voice` (autocomplete over published), `reason` | Deletes the voice (owner's copy too), records the reason, DMs the author if possible. |
| `/voicemod ban` / `unban` | `user`, `reason` | Bans block add and publish; existing published voices of a banned user are unpublished. |
| `/voicemod list` | `user` (optional) | All uploads, or one user's, with ids. |

`/voicemod` is registered with default member permissions none and checked against `OWNER_USER_IDS` in code. `/customvoice` is unchanged.

## 6. Moderation and safety

- **Consent and impersonation**: the modal tips and the publish confirmation state the rule: only your own voice or one you have explicit permission to use; no public figures or other members. Policy exposure: Discord's Developer Policy and Community Guidelines treat deceptive impersonation and non-consensual synthetic media as violations, and the curated voices today are real acquaintances; community sharing of such voices is the main risk, so publishing requires the explicit confirm step and is auditable (owner id, timestamps, reports).
- **Name blacklist**: normalize by NFKC, lowercase, strip diacritics and zero-width characters, map common confusables and leetspeak (`0→o 1→i 3→e 4→a 5→s 7→t @→a $→s`), drop everything except letters and digits; block when any normalized term is a substring of the normalized name. Applied to published names only (owner decision): on publish, and on renaming a voice that is published. Private names are not checked, since only their owner sees them.
- **Name rules**: 2-32 characters, letters, digits, spaces, `'` and `-`, at least one letter, trimmed, no Discord markdown or mentions, not equal to a built-in or curated voice name.
- **Collisions**: private names unique per owner; published `nameKey` unique across the community (first publisher keeps it). Author shown everywhere a community voice is listed.
- **Takedown, bans, reports** as in section 5. Reports are written to `moderation.json` and posted to `MOD_LOG_CHANNEL_ID` when configured; otherwise logged at warn level.
- **Upload validation**: attachment size and extension checked before download; download with a 30 s timeout and a hard byte cap (abort the stream past 10 MB); magic-byte sniff (`RIFF….WAVE`, `fLaC`, `OggS`, `ID3` or MPEG frame sync) must agree with the extension; Pocket decodes and measures duration; failures delete the temp file. Ids are validated with the same regex in both bot and sidecar; paths are built from ids only.
- **Audio content**: no automatic review of what the clip says; the cloned voice does not replay the prompt, so the exposure is the voice identity, handled by reports and takedown.
- **Gating**: My Voices and Community Voices are not behind `/unlock` (recommended default); `/unlock` keeps gating the curated voices only.

## 7. Limits

| Limit | Default | Config |
|---|---|---|
| Voices per user | 5 | `USER_VOICE_MAX_PER_USER` |
| Total uploaded voices | 200 (about 2.4 GB of Pocket cache at worst) | `USER_VOICE_MAX_TOTAL` |
| File size | 10 MB | `USER_VOICE_MAX_BYTES` |
| Clip duration | 3-60 s (first 30 s used) | Pocket `POCKET_USER_VOICE_MIN/MAX_SECONDS` |
| Uploads per user | 3 per 10 minutes (reuse `attemptLimiter`, every attempt counts) | `USER_VOICE_UPLOADS_PER_WINDOW` |
| Name length | 2-32 | constant |
| Concurrent processing | 1 upload at a time, cloning serialized with generation on Pocket | constant |
| CPU | cloning ≤ 1.5 s under Pocket's lock: at most a short delay to one queued message | n/a |
| Discoverability | 25 per page; community sorted newest first; `/communityvoices` search for the rest | n/a |

## 8. Migration and compatibility

- No preferences migration. `voices.pocket = "user:<id>"` is accepted by the existing schema; stale ids fall back at read time.
- Command registration replaces the command set on start: `/voice` loses `name`, `/search`, `/myvoices`, `/communityvoices`, `/voicemod` appear. Clients may cache the old `/voice name` option for up to an hour; the handler ignores it.
- Compose: new read-only mount on `pocket`; `data/user-voices/` created by the bot with uid 99:100.
- `.env.example` gains `USER_VOICE_UPLOADS`, `USER_VOICE_MAX_*`, `OWNER_USER_IDS`, `MOD_LOG_CHANNEL_ID`.
- Pocket API stays backward compatible; the bot tolerates an older sidecar (prepare returns 404 → "voice uploads need the updated Pocket server").
- Backups: `data/` already holds everything that matters; the Pocket cache volume is rebuildable (lazy re-clone).
- Curated `custom:` voices stay as they are and are not shown under Community.

## 9. Test plan

Unit tests (node:test under `tests/`, sized like neighbours):

- `tests/userVoices/ids.test.ts`: id shape, prefix parse, rejects malformed.
- `tests/userVoices/names.test.ts`: rules, normalization, confusables, blacklist hit/miss, markdown rejection.
- `tests/userVoices/catalog.test.ts`: pure transforms (add, rename, delete, publish, unpublish), uniqueness rules, zod parse drops bad entries.
- `tests/userVoices/catalogStore.test.ts`: atomic write, reload round-trip, corrupt file renamed.
- `tests/userVoices/attachment.test.ts`: extension/content-type/size checks, magic-byte sniffing per format, mismatch rejected.
- `tests/userVoices/download.test.ts`: byte cap aborts, timeout, temp file removed on failure (mock fetch).
- `tests/userVoices/service.test.ts`: full add pipeline with mocked Pocket client (success, prepare 400 codes, Pocket down), quotas, bans, serialized uploads, delete order (catalog first, then sidecar, then files).
- `tests/userVoices/catalogVoices.test.ts`: `withUserVoices` composition and recomposition on change.
- `tests/preferences/catalogDefaults.test.ts` (extend): owner-only private voice, published voice for others, fallback after unpublish.
- `tests/tts/voiceDirectory.test.ts` (extend): My Voices and Community groups per user, author in description, newest-first order.
- `tests/tts/speechServer/speechServer.test.ts` (extend): `user:` ids pass through to the server.
- `tests/commands/myVoices.test.ts`, `search.test.ts`, `communityVoices.test.ts`, `voiceMod.test.ts`: option parsing, permission checks, confirm flows, messages.
- `tests/discord/interactionRouter.test.ts` (extend): modal submit dispatch and failure reporting.
- `tests/audio/wav.test.ts`: WAV header for preview.

Sidecar (pytest, `services/pocket/tests/`): user id regex, source lookup (exactly one file), prepare success/too_short/too_long/unsupported/not_found, delete idempotent, stale cache sweep, speech resolves `user:` lazily, lock ordering.

Manual checklist (`documentation/tests/`): modal on desktop and mobile; attachment-option fallback; progress line; preview plays; publish/unpublish visible to a second account; delete while another user has it selected; takedown DM; kill switch.

## 10. Build order

1. Pocket sidecar: user-voice resolution, prepare/delete endpoints, cache sweep, tests. Deployable alone.
2. Bot domain: `ids`, `names`+`blacklist`, `catalog`+`catalogStore`, `quotas`, `moderation` store. Pure, fully unit tested.
3. Catalog integration: `Voice.uploaded`, `withUserVoices`, engine pass-through, access in `resolveVoice`, voiceDirectory groups, picker rendering, main.ts wiring (Pocket join hook).
4. Upload pipeline: attachment checks, download, Pocket client, service, progress renderer, preview WAV.
5. Commands: router modal support, `/myvoices`, `/voice` option removal, `/search`, `/communityvoices`.
6. Moderation: `/voicemod`, reports, kill switch, config keys.
7. Docs and deploy: README, CHANGELOG, `.env.example`, compose mount, `/code-review`.

## 11. Open decisions (owner) with recommended defaults

| Decision | Recommended default | Why |
|---|---|---|
| Gate My/Community Voices behind `/unlock`? | No | The lock exists for real-person curated voices; community voices have their own consent and moderation path. Uploads can still be switched off globally. |
| Community scope | Global across both servers | Preferences are already per-user and global; a per-server split adds a guild dimension to the catalog for 2 servers. |
| Who moderates | `OWNER_USER_IDS` only | Global content should not be removable by one server's admins; revisit if the bot joins more servers. |
| Blacklist on private names too | **Decided: no.** Published names only (publish, and rename of a published voice). | Only the owner sees private names. |
| Takedown semantics | Delete entirely, optionally ban | Unpublish-and-lock keeps offending data on disk for no benefit. |
| Preview after upload | Yes, short fixed sentence as WAV attachment | One extra ~1 s generation; without it users judge quality in a voice channel. |
| Author tag | **Decided: Discord username** (never display name), recorded at publish, refreshed on rename and republish | Select-menu descriptions cannot render mentions; the message body can still show `<@id>` for the current voice. |
| Community ordering | Newest first | No usage data yet; add a pick counter later if the list outgrows search. |
| Quotas | 5 per user, 200 total, 10 MB, 3-60 s, 3 uploads / 10 min | Fits 8 users with room to grow; bounded cache disk. |
| Keep `/customvoice` | Yes | Unrelated to this feature; removing it is a separate change. |
| Attachment-option fallback on `/myvoices add` | Include | Same pipeline, protects against modal file-upload gaps on some clients. |
