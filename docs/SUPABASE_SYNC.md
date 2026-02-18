# NuvioTV Supabase Sync Documentation

This document describes the complete Supabase backend used by NuvioTV for cross-device data synchronization. It covers database schema, RPC functions, authentication, device linking, and integration patterns.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Database Schema](#database-schema)
4. [RPC Functions](#rpc-functions)
5. [Integration Guide](#integration-guide)
6. [Data Models](#data-models)
7. [Sync Behavior & Restrictions](#sync-behavior--restrictions)
8. [Error Handling](#error-handling)

---

## Overview

NuvioTV syncs the following data to Supabase so linked devices share the same state:

| Data | Description | Trakt Override |
|------|-------------|----------------|
| **Plugins** | JavaScript plugin repository URLs | No (always syncs) |
| **Addons** | Stremio-compatible addon manifest URLs | No (always syncs) |
| **Watch Progress** | Per-movie/episode playback position | Yes (skipped when Trakt connected) |
| **Library** | Saved movies & TV shows | Yes (skipped when Trakt connected) |
| **Watched Items** | Permanent watched history (movies & episodes) | Yes (skipped when Trakt connected) |

### Authentication Model

- **Anonymous**: Auto-created account, can generate/claim sync codes
- **Email/Password**: Full account with permanent data storage
- **Linked Device**: A device linked to another account via sync code; reads/writes the owner's data

### Security Model

All data operations use **SECURITY DEFINER** RPC functions that call `get_sync_owner()` to resolve the effective user ID. This allows linked devices to transparently access the owner's data without needing direct RLS access.

---

## Prerequisites

- Supabase project with:
  - **Auth** enabled (anonymous sign-in + email/password)
  - **pgcrypto** extension enabled (for `crypt()`, `gen_salt()`)
- Environment variables:
  - `SUPABASE_URL` — Your Supabase project URL
  - `SUPABASE_ANON_KEY` — Your Supabase anonymous/public key

---

## Database Schema

### Tables

#### `sync_codes`

Temporary codes for device linking, protected by a bcrypt-hashed PIN.

```sql
CREATE TABLE sync_codes (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ DEFAULT 'infinity'::TIMESTAMPTZ
);

ALTER TABLE sync_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sync codes"
    ON sync_codes FOR ALL
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);
```

#### `linked_devices`

Maps a child device's user ID to a parent (owner) user ID.

```sql
CREATE TABLE linked_devices (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_name TEXT,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(owner_id, device_user_id)
);

ALTER TABLE linked_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read their linked devices"
    ON linked_devices FOR SELECT
    USING (auth.uid() = owner_id);

CREATE POLICY "Devices can read their own link"
    ON linked_devices FOR SELECT
    USING (auth.uid() = device_user_id);
```

#### `plugins`

Plugin repository URLs synced across devices.

```sql
CREATE TABLE plugins (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    name TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_plugins_user_id ON plugins(user_id);
ALTER TABLE plugins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own plugins"
    ON plugins FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
```

#### `addons`

Addon manifest URLs synced across devices.

```sql
CREATE TABLE addons (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    name TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_addons_user_id ON addons(user_id);
ALTER TABLE addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own addons"
    ON addons FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
```

#### `watch_progress`

Per-movie or per-episode playback progress.

```sql
CREATE TABLE watch_progress (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content_id TEXT NOT NULL,
    content_type TEXT NOT NULL,
    video_id TEXT NOT NULL,
    season INTEGER,
    episode INTEGER,
    position BIGINT NOT NULL DEFAULT 0,
    duration BIGINT NOT NULL DEFAULT 0,
    last_watched BIGINT NOT NULL DEFAULT 0,
    progress_key TEXT NOT NULL
);

CREATE INDEX idx_watch_progress_user_id ON watch_progress(user_id);
ALTER TABLE watch_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own watch progress"
    ON watch_progress FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
```

#### `library_items`

Saved movies and TV shows (bookmarks/favorites).

```sql
CREATE TABLE library_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content_id TEXT NOT NULL,
    content_type TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    poster TEXT,
    poster_shape TEXT NOT NULL DEFAULT 'POSTER',
    background TEXT,
    description TEXT,
    release_info TEXT,
    imdb_rating REAL,
    genres TEXT[] DEFAULT '{}',
    addon_base_url TEXT,
    added_at BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, content_id, content_type)
);

CREATE INDEX idx_library_items_user_id ON library_items(user_id);
ALTER TABLE library_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own library items"
    ON library_items FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
```

#### `watched_items`

Permanent watched history. Unlike `watch_progress` (which is capped and stores playback position), this table is a permanent record of everything the user has watched or marked as watched. Used to determine if a movie or episode should show a "watched" checkmark.

```sql
CREATE TABLE watched_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content_id TEXT NOT NULL,
    content_type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    season INTEGER,
    episode INTEGER,
    watched_at BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_watched_items_unique
    ON watched_items (user_id, content_id, COALESCE(season, -1), COALESCE(episode, -1));

CREATE INDEX idx_watched_items_user_id ON watched_items(user_id);

ALTER TABLE watched_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own watched items"
    ON watched_items FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
```

> **Note:** The unique index uses `COALESCE(season, -1)` and `COALESCE(episode, -1)` because PostgreSQL treats NULLs as distinct in unique constraints. Movies have `NULL` season/episode, so without COALESCE, multiple entries for the same movie would be allowed.

### Triggers

```sql
-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Apply to tables with updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON plugins FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON addons FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sync_codes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## RPC Functions

### Core: `get_sync_owner()`

Resolves the effective user ID. If the current user is a linked device, returns the owner's ID. Otherwise returns the caller's own ID. This is the foundation of the linked-device sync model.

```sql
CREATE OR REPLACE FUNCTION get_sync_owner()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_owner_id uuid;
BEGIN
    SELECT owner_id INTO v_owner_id
    FROM linked_devices
    WHERE device_user_id = auth.uid()
    LIMIT 1;

    RETURN COALESCE(v_owner_id, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION get_sync_owner() TO authenticated;
```

### Core: `can_access_user_data(p_user_id UUID)`

Helper to check if the current user can access another user's data (either they are that user, or they are a linked device).

```sql
CREATE OR REPLACE FUNCTION can_access_user_data(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF auth.uid() = p_user_id THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.linked_devices
        WHERE owner_id = p_user_id
          AND device_user_id = auth.uid()
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION can_access_user_data(UUID) TO authenticated;
```

### Device Linking: `generate_sync_code(p_pin TEXT)`

Generates a sync code for the current user. If a code already exists, updates the PIN. The code format is `XXXX-XXXX-XXXX-XXXX-XXXX` (uppercase hex). PIN is bcrypt-hashed.

```sql
CREATE OR REPLACE FUNCTION generate_sync_code(p_pin TEXT)
RETURNS TABLE(code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
    v_existing_code text;
    v_new_code text;
    v_pin_hash text;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT sc.code INTO v_existing_code
    FROM sync_codes sc
    WHERE sc.owner_id = v_user_id
    ORDER BY sc.created_at DESC
    LIMIT 1;

    IF v_existing_code IS NOT NULL THEN
        v_pin_hash := crypt(p_pin, gen_salt('bf'));
        UPDATE sync_codes
        SET pin_hash = v_pin_hash
        WHERE sync_codes.owner_id = v_user_id
          AND sync_codes.code = v_existing_code;
        RETURN QUERY SELECT v_existing_code;
        RETURN;
    END IF;

    v_new_code := upper(
        substr(md5(random()::text || clock_timestamp()::text), 1, 4) || '-' ||
        substr(md5(random()::text || clock_timestamp()::text), 5, 4) || '-' ||
        substr(md5(random()::text || clock_timestamp()::text), 9, 4) || '-' ||
        substr(md5(random()::text || clock_timestamp()::text), 13, 4) || '-' ||
        substr(md5(random()::text || clock_timestamp()::text), 17, 4)
    );

    v_pin_hash := crypt(p_pin, gen_salt('bf'));

    INSERT INTO sync_codes (owner_id, code, pin_hash)
    VALUES (v_user_id, v_new_code, v_pin_hash);

    RETURN QUERY SELECT v_new_code;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_sync_code(TEXT) TO authenticated;
```

### Device Linking: `get_sync_code(p_pin TEXT)`

Retrieves the existing sync code for the current user, validated by PIN.

```sql
CREATE OR REPLACE FUNCTION get_sync_code(p_pin TEXT)
RETURNS TABLE(code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
    v_existing_code text;
    v_existing_pin_hash text;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT sc.code, sc.pin_hash
    INTO v_existing_code, v_existing_pin_hash
    FROM sync_codes sc
    WHERE sc.owner_id = v_user_id
    ORDER BY sc.created_at DESC
    LIMIT 1;

    IF v_existing_code IS NULL THEN
        RAISE EXCEPTION 'No sync code found. Generate one first.';
    END IF;

    IF v_existing_pin_hash != crypt(p_pin, v_existing_pin_hash) THEN
        RAISE EXCEPTION 'Incorrect PIN';
    END IF;

    RETURN QUERY SELECT v_existing_code;
END;
$$;

GRANT EXECUTE ON FUNCTION get_sync_code(TEXT) TO authenticated;
```

### Device Linking: `claim_sync_code(p_code TEXT, p_pin TEXT, p_device_name TEXT)`

Links the current device to the owner of the sync code. Validates the PIN, then creates a `linked_devices` row.

```sql
CREATE OR REPLACE FUNCTION claim_sync_code(p_code TEXT, p_pin TEXT, p_device_name TEXT DEFAULT NULL)
RETURNS TABLE(result_owner_id UUID, success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_owner_id uuid;
    v_pin_hash text;
BEGIN
    SELECT sc.owner_id, sc.pin_hash
    INTO v_owner_id, v_pin_hash
    FROM sync_codes sc
    WHERE sc.code = p_code;

    IF v_owner_id IS NULL THEN
        RETURN QUERY SELECT NULL::uuid, false, 'Sync code not found'::text;
        RETURN;
    END IF;

    IF crypt(p_pin, v_pin_hash) != v_pin_hash THEN
        RETURN QUERY SELECT NULL::uuid, false, 'Incorrect PIN'::text;
        RETURN;
    END IF;

    INSERT INTO linked_devices (owner_id, device_user_id, device_name)
    VALUES (v_owner_id, auth.uid(), p_device_name)
    ON CONFLICT (owner_id, device_user_id) DO UPDATE
    SET device_name = EXCLUDED.device_name;

    RETURN QUERY SELECT v_owner_id, true, 'Device linked successfully'::text;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_sync_code(TEXT, TEXT, TEXT) TO authenticated;
```

### Device Linking: `unlink_device(p_device_user_id UUID)`

Removes a linked device. Only the owner can unlink their devices.

```sql
CREATE OR REPLACE FUNCTION unlink_device(p_device_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM linked_devices
    WHERE (owner_id = auth.uid() AND device_user_id = p_device_user_id)
       OR (device_user_id = auth.uid() AND device_user_id = p_device_user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION unlink_device(UUID) TO authenticated;
```

### Sync: `sync_push_plugins(p_plugins JSONB)`

Full-replace push of plugin repository URLs.

```sql
CREATE OR REPLACE FUNCTION sync_push_plugins(p_plugins JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_effective_user_id uuid;
    v_plugin jsonb;
BEGIN
    SELECT get_sync_owner() INTO v_effective_user_id;

    DELETE FROM plugins WHERE user_id = v_effective_user_id;

    FOR v_plugin IN SELECT * FROM jsonb_array_elements(p_plugins)
    LOOP
        INSERT INTO plugins (user_id, url, name, enabled, sort_order)
        VALUES (
            v_effective_user_id,
            v_plugin->>'url',
            v_plugin->>'name',
            COALESCE((v_plugin->>'enabled')::boolean, true),
            (v_plugin->>'sort_order')::int
        );
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_push_plugins(JSONB) TO authenticated;
```

### Sync: `sync_push_addons(p_addons JSONB)`

Full-replace push of addon manifest URLs.

```sql
CREATE OR REPLACE FUNCTION sync_push_addons(p_addons JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_effective_user_id uuid;
    v_addon jsonb;
BEGIN
    SELECT get_sync_owner() INTO v_effective_user_id;

    DELETE FROM addons WHERE user_id = v_effective_user_id;

    FOR v_addon IN SELECT * FROM jsonb_array_elements(p_addons)
    LOOP
        INSERT INTO addons (user_id, url, sort_order)
        VALUES (
            v_effective_user_id,
            v_addon->>'url',
            (v_addon->>'sort_order')::int
        );
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_push_addons(JSONB) TO authenticated;
```

### Sync: `sync_push_watch_progress(p_entries JSONB)`

Full-replace push of watch progress entries.

```sql
CREATE OR REPLACE FUNCTION sync_push_watch_progress(p_entries JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_effective_user_id UUID;
BEGIN
    v_effective_user_id := get_sync_owner();

    DELETE FROM watch_progress WHERE user_id = v_effective_user_id;

    INSERT INTO watch_progress (
        user_id, content_id, content_type, video_id,
        season, episode, position, duration, last_watched, progress_key
    )
    SELECT
        v_effective_user_id,
        (entry->>'content_id'),
        (entry->>'content_type'),
        (entry->>'video_id'),
        (entry->>'season')::INTEGER,
        (entry->>'episode')::INTEGER,
        (entry->>'position')::BIGINT,
        (entry->>'duration')::BIGINT,
        (entry->>'last_watched')::BIGINT,
        (entry->>'progress_key')
    FROM jsonb_array_elements(p_entries) AS entry;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_push_watch_progress(JSONB) TO authenticated;
```

### Sync: `sync_pull_watch_progress()`

Returns all watch progress for the effective user (owner or linked device's owner).

```sql
CREATE OR REPLACE FUNCTION sync_pull_watch_progress()
RETURNS SETOF watch_progress
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_effective_user_id UUID;
BEGIN
    v_effective_user_id := get_sync_owner();
    RETURN QUERY SELECT * FROM watch_progress WHERE user_id = v_effective_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_pull_watch_progress() TO authenticated;
```

### Sync: `sync_push_library(p_items JSONB)`

Full-replace push of library items.

```sql
CREATE OR REPLACE FUNCTION sync_push_library(p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_effective_user_id UUID;
BEGIN
    v_effective_user_id := get_sync_owner();

    DELETE FROM library_items WHERE user_id = v_effective_user_id;

    INSERT INTO library_items (
        user_id, content_id, content_type, name, poster, poster_shape,
        background, description, release_info, imdb_rating, genres,
        addon_base_url, added_at
    )
    SELECT
        v_effective_user_id,
        (item->>'content_id'),
        (item->>'content_type'),
        COALESCE(item->>'name', ''),
        (item->>'poster'),
        COALESCE(item->>'poster_shape', 'POSTER'),
        (item->>'background'),
        (item->>'description'),
        (item->>'release_info'),
        (item->>'imdb_rating')::REAL,
        COALESCE(
            (SELECT array_agg(g::TEXT) FROM jsonb_array_elements_text(item->'genres') AS g),
            '{}'
        ),
        (item->>'addon_base_url'),
        COALESCE((item->>'added_at')::BIGINT, EXTRACT(EPOCH FROM now())::BIGINT * 1000)
    FROM jsonb_array_elements(p_items) AS item;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_push_library(JSONB) TO authenticated;
```

### Sync: `sync_pull_library()`

Returns all library items for the effective user.

```sql
CREATE OR REPLACE FUNCTION sync_pull_library()
RETURNS SETOF library_items
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_effective_user_id UUID;
BEGIN
    v_effective_user_id := get_sync_owner();
    RETURN QUERY SELECT * FROM library_items WHERE user_id = v_effective_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_pull_library() TO authenticated;
```

### Sync: `sync_push_watched_items(p_items JSONB)`

Full-replace push of watched items (permanent watched history).

```sql
CREATE OR REPLACE FUNCTION sync_push_watched_items(p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_effective_user_id UUID;
BEGIN
    v_effective_user_id := get_sync_owner();
    DELETE FROM watched_items WHERE user_id = v_effective_user_id;
    INSERT INTO watched_items (user_id, content_id, content_type, title, season, episode, watched_at)
    SELECT
        v_effective_user_id,
        (item->>'content_id'),
        (item->>'content_type'),
        COALESCE(item->>'title', ''),
        (item->>'season')::INTEGER,
        (item->>'episode')::INTEGER,
        (item->>'watched_at')::BIGINT
    FROM jsonb_array_elements(p_items) AS item;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_push_watched_items(JSONB) TO authenticated;
```

### Sync: `sync_pull_watched_items()`

Returns all watched items for the effective user.

```sql
CREATE OR REPLACE FUNCTION sync_pull_watched_items()
RETURNS SETOF watched_items
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_effective_user_id UUID;
BEGIN
    v_effective_user_id := get_sync_owner();
    RETURN QUERY SELECT * FROM watched_items WHERE user_id = v_effective_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_pull_watched_items() TO authenticated;
```

---

## Integration Guide

### 1. Authentication

All API calls require a Supabase auth session. Initialize the Supabase client and authenticate:

```
POST {SUPABASE_URL}/auth/v1/signup
Headers: apikey: {SUPABASE_ANON_KEY}
Body: { "email": "user@example.com", "password": "..." }
```

Or for anonymous sign-in:

```
POST {SUPABASE_URL}/auth/v1/signup
Headers: apikey: {SUPABASE_ANON_KEY}
Body: {}
```

All subsequent requests include:
```
Headers:
  apikey: {SUPABASE_ANON_KEY}
  Authorization: Bearer {ACCESS_TOKEN}
```

### 2. Calling RPC Functions

All RPCs are called via the Supabase PostgREST endpoint:

```
POST {SUPABASE_URL}/rest/v1/rpc/{function_name}
Headers:
  apikey: {SUPABASE_ANON_KEY}
  Authorization: Bearer {ACCESS_TOKEN}
  Content-Type: application/json
Body: { ...parameters... }
```

### 3. Device Linking Flow

**Device A (Parent) — Generate Sync Code:**

```json
// POST /rest/v1/rpc/generate_sync_code
{ "p_pin": "1234" }

// Response:
[{ "code": "A1B2-C3D4-E5F6-G7H8-I9J0" }]
```

**Device B (Child) — Claim Sync Code:**

```json
// POST /rest/v1/rpc/claim_sync_code
{
  "p_code": "A1B2-C3D4-E5F6-G7H8-I9J0",
  "p_pin": "1234",
  "p_device_name": "Living Room TV"
}

// Response:
[{
  "result_owner_id": "uuid-of-device-a-user",
  "success": true,
  "message": "Device linked successfully"
}]
```

After claiming, Device B's `get_sync_owner()` will return Device A's user ID, so all push/pull operations operate on the shared data.

**Retrieve Existing Code (with PIN):**

```json
// POST /rest/v1/rpc/get_sync_code
{ "p_pin": "1234" }

// Response:
[{ "code": "A1B2-C3D4-E5F6-G7H8-I9J0" }]
```

**Get Linked Devices:**

```
GET {SUPABASE_URL}/rest/v1/linked_devices?select=*&owner_id=eq.{your_user_id}
```

**Unlink a Device:**

```json
// POST /rest/v1/rpc/unlink_device
{ "p_device_user_id": "uuid-of-device-to-unlink" }
```

### 4. Pushing Data

All push RPCs use a **full-replace** strategy: existing data for the effective user is deleted, then the new data is inserted. This means you must always push the **complete** local dataset, not just changes.

#### Push Plugins

```json
// POST /rest/v1/rpc/sync_push_plugins
{
  "p_plugins": [
    {
      "url": "https://example.com/plugin-repo",
      "name": "My Plugin Repo",
      "enabled": true,
      "sort_order": 0
    }
  ]
}
```

#### Push Addons

```json
// POST /rest/v1/rpc/sync_push_addons
{
  "p_addons": [
    {
      "url": "https://example.com/addon/manifest.json",
      "sort_order": 0
    }
  ]
}
```

#### Push Watch Progress

```json
// POST /rest/v1/rpc/sync_push_watch_progress
{
  "p_entries": [
    {
      "content_id": "tt1234567",
      "content_type": "movie",
      "video_id": "tt1234567",
      "season": null,
      "episode": null,
      "position": 3600000,
      "duration": 7200000,
      "last_watched": 1700000000000,
      "progress_key": "tt1234567"
    },
    {
      "content_id": "tt7654321",
      "content_type": "series",
      "video_id": "tt7654321:2:5",
      "season": 2,
      "episode": 5,
      "position": 1800000,
      "duration": 3600000,
      "last_watched": 1700000000000,
      "progress_key": "tt7654321_s2e5"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `content_id` | string | IMDB ID or content identifier |
| `content_type` | string | `"movie"` or `"series"` |
| `video_id` | string | Video stream identifier |
| `season` | int/null | Season number (null for movies) |
| `episode` | int/null | Episode number (null for movies) |
| `position` | long | Playback position in milliseconds |
| `duration` | long | Total duration in milliseconds |
| `last_watched` | long | Unix timestamp in milliseconds |
| `progress_key` | string | Unique key: `contentId` for movies, `contentId_s{S}e{E}` for episodes |

#### Push Library Items

```json
// POST /rest/v1/rpc/sync_push_library
{
  "p_items": [
    {
      "content_id": "tt1234567",
      "content_type": "movie",
      "name": "Example Movie",
      "poster": "https://image.tmdb.org/t/p/w500/poster.jpg",
      "poster_shape": "POSTER",
      "background": "https://image.tmdb.org/t/p/original/backdrop.jpg",
      "description": "A great movie about...",
      "release_info": "2024",
      "imdb_rating": 8.5,
      "genres": ["Action", "Thriller"],
      "addon_base_url": "https://example.com/addon"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content_id` | string | Yes | IMDB ID or content identifier |
| `content_type` | string | Yes | `"movie"` or `"series"` |
| `name` | string | No | Display name (defaults to `""`) |
| `poster` | string | No | Poster image URL |
| `poster_shape` | string | No | `"POSTER"`, `"LANDSCAPE"`, or `"SQUARE"` (defaults to `"POSTER"`) |
| `background` | string | No | Background/backdrop image URL |
| `description` | string | No | Content description |
| `release_info` | string | No | Release year or date string |
| `imdb_rating` | float | No | IMDB rating (0.0-10.0) |
| `genres` | string[] | No | Genre list (defaults to `[]`) |
| `addon_base_url` | string | No | Source addon base URL |
| `added_at` | long | No | Timestamp in ms (defaults to current time) |

#### Push Watched Items

```json
// POST /rest/v1/rpc/sync_push_watched_items
{
  "p_items": [
    {
      "content_id": "tt1234567",
      "content_type": "movie",
      "title": "Example Movie",
      "season": null,
      "episode": null,
      "watched_at": 1700000000000
    },
    {
      "content_id": "tt7654321",
      "content_type": "series",
      "title": "Example Series",
      "season": 2,
      "episode": 5,
      "watched_at": 1700000000000
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content_id` | string | Yes | IMDB ID or content identifier |
| `content_type` | string | Yes | `"movie"` or `"series"` |
| `title` | string | No | Display name (defaults to `""`) |
| `season` | int/null | No | Season number (null for movies) |
| `episode` | int/null | No | Episode number (null for movies) |
| `watched_at` | long | Yes | Unix timestamp in milliseconds |

### 5. Pulling Data

#### Pull Watch Progress

```json
// POST /rest/v1/rpc/sync_pull_watch_progress
{}

// Response: array of watch_progress rows
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "content_id": "tt1234567",
    "content_type": "movie",
    "video_id": "tt1234567",
    "season": null,
    "episode": null,
    "position": 3600000,
    "duration": 7200000,
    "last_watched": 1700000000000,
    "progress_key": "tt1234567"
  }
]
```

#### Pull Library Items

```json
// POST /rest/v1/rpc/sync_pull_library
{}

// Response: array of library_items rows
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "content_id": "tt1234567",
    "content_type": "movie",
    "name": "Example Movie",
    "poster": "https://...",
    "poster_shape": "POSTER",
    "background": "https://...",
    "description": "...",
    "release_info": "2024",
    "imdb_rating": 8.5,
    "genres": ["Action", "Thriller"],
    "addon_base_url": "https://...",
    "added_at": 1700000000000,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
]
```

#### Pull Watched Items

```json
// POST /rest/v1/rpc/sync_pull_watched_items
{}

// Response: array of watched_items rows
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "content_id": "tt1234567",
    "content_type": "movie",
    "title": "Example Movie",
    "season": null,
    "episode": null,
    "watched_at": 1700000000000,
    "created_at": "2024-01-01T00:00:00Z"
  }
]
```

#### Pull Plugins/Addons (Direct Table Query)

Plugins and addons are pulled via direct table queries using the effective user ID:

```
// First, get the effective user ID
POST /rest/v1/rpc/get_sync_owner
{}
// Response: "uuid-of-effective-owner"

// Then query tables
GET /rest/v1/addons?select=*&user_id=eq.{effective_user_id}&order=sort_order
GET /rest/v1/plugins?select=*&user_id=eq.{effective_user_id}&order=sort_order
```

---

## Data Models

### Plugin

```json
{
  "url": "string (required)",
  "name": "string (optional)",
  "enabled": "boolean (default: true)",
  "sort_order": "integer (default: 0)"
}
```

### Addon

```json
{
  "url": "string (required)",
  "sort_order": "integer (default: 0)"
}
```

### Watch Progress Entry

```json
{
  "content_id": "string (required)",
  "content_type": "string (required) - 'movie' | 'series'",
  "video_id": "string (required)",
  "season": "integer (optional, null for movies)",
  "episode": "integer (optional, null for movies)",
  "position": "long (required) - playback position in ms",
  "duration": "long (required) - total duration in ms",
  "last_watched": "long (required) - unix timestamp in ms",
  "progress_key": "string (required) - unique key per entry"
}
```

### Library Item

```json
{
  "content_id": "string (required)",
  "content_type": "string (required) - 'movie' | 'series'",
  "name": "string (default: '')",
  "poster": "string (optional) - poster image URL",
  "poster_shape": "string (default: 'POSTER') - 'POSTER' | 'LANDSCAPE' | 'SQUARE'",
  "background": "string (optional) - backdrop image URL",
  "description": "string (optional)",
  "release_info": "string (optional) - release year/date",
  "imdb_rating": "float (optional) - 0.0 to 10.0",
  "genres": "string[] (default: []) - list of genre names",
  "addon_base_url": "string (optional) - source addon URL",
  "added_at": "long (default: current time) - unix timestamp in ms"
}
```

### Watched Item

```json
{
  "content_id": "string (required)",
  "content_type": "string (required) - 'movie' | 'series'",
  "title": "string (default: '') - display name",
  "season": "integer (optional, null for movies)",
  "episode": "integer (optional, null for movies)",
  "watched_at": "long (required) - unix timestamp in ms"
}
```

### Linked Device

```json
{
  "owner_id": "uuid (required) - parent account user ID",
  "device_user_id": "uuid (required) - this device's user ID",
  "device_name": "string (optional) - human-readable device name",
  "linked_at": "timestamptz (auto-set)"
}
```

### Sync Code

```json
{
  "owner_id": "uuid - user who generated the code",
  "code": "string - format: XXXX-XXXX-XXXX-XXXX-XXXX",
  "pin_hash": "string - bcrypt hash of the PIN",
  "is_active": "boolean (default: true)",
  "expires_at": "timestamptz (default: infinity)"
}
```

---

## Sync Behavior & Restrictions

### Startup Sync Flow

When the app starts and the user is authenticated (anonymous or full account):

1. **Pull plugins** from remote → install any new ones locally
2. **Pull addons** from remote → install any new ones locally
3. If Trakt is **NOT** connected:
   - **Pull watch progress** → merge into local (additive)
   - **Push watch progress** → so linked devices can pull
   - **Pull library items** → merge into local (additive)
   - **Push library items** → so linked devices can pull
   - **Pull watched items** → merge into local (additive)
   - **Push watched items** → so linked devices can pull

### On-Demand Sync

- **Plugins/Addons**: Pushed to remote immediately when added or removed
- **Watch Progress**: Pushed with a 2-second debounce after any playback position update
- **Library Items**: Pushed with a 2-second debounce after add or remove
- **Watched Items**: Pushed with a 2-second debounce after mark/unmark as watched

### Merge Strategy

- **Push**: Full-replace. The entire local dataset replaces the remote dataset.
- **Pull (merge)**: Additive. Remote items not already present locally are added. Existing local items are preserved. Match keys vary by data type: `content_id` + `content_type` for library, `content_id` + `season` + `episode` for watched items.

### Trakt Override

When Trakt is connected:
- **Watch progress**, **library**, and **watched items** sync via Supabase is **completely skipped**
- Trakt becomes the source of truth for these data types
- **Plugins** and **addons** always sync regardless of Trakt status

### Push on Account Events

| Event | Action |
|-------|--------|
| Sign up (email) | Push all local data to remote |
| Sign in (email) | Pull all remote data to local |
| Generate sync code | Push all local data to remote, then generate code |
| Claim sync code | Pull all remote data from owner to local |

---

## Error Handling

### Sync Code Errors

| Error Message | Cause |
|---------------|-------|
| `Not authenticated` | No auth session |
| `No sync code found. Generate one first.` | Calling `get_sync_code` before generating |
| `Incorrect PIN` | Wrong PIN for `get_sync_code` or `claim_sync_code` |
| `Sync code not found` | Invalid or non-existent code in `claim_sync_code` |
| `Device linked successfully` | Success response from `claim_sync_code` |

### Auth Errors

| Error Message | Cause |
|---------------|-------|
| `Invalid login credentials` | Wrong email or password |
| `Email not confirmed` | Email verification pending |
| `User already registered` | Duplicate email signup |
| `Password is too short/weak` | Password policy violation |
| `Signup is disabled` | Admin disabled signups |
| `Rate limit` / `Too many requests` | Too many auth attempts |

### Network Errors

| Error Message | Cause |
|---------------|-------|
| `Unable to resolve host` | No internet |
| `Timeout` / `Timed out` | Connection timeout |
| `Connection refused` | Server unreachable |
| `404` | RPC function not found (missing migration) |
| `400` / `Bad request` | Invalid parameters |
