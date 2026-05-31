-- ============================================================
-- WA-CRM — Full schema for standard PostgreSQL
-- Replaces Supabase auth.users with a custom users table.
-- RLS removed — security enforced at application layer.
-- Safe to re-run (idempotent).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS  (replaces Supabase auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  avatar_url    TEXT,
  role          TEXT DEFAULT 'user',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================
-- PROFILES  (kept for API compatibility — mirrors users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  full_name  TEXT NOT NULL,
  email      TEXT NOT NULL,
  avatar_url TEXT,
  role       TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone      TEXT NOT NULL,
  name       TEXT,
  email      TEXT,
  company    TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone   ON contacts(phone);

-- ============================================================
-- TAGS
-- ============================================================
CREATE TABLE IF NOT EXISTS tags (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);

-- ============================================================
-- CONTACT_TAGS
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag     ON contact_tags(tag_id);

-- ============================================================
-- CUSTOM FIELDS
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_fields (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  field_type   TEXT NOT NULL DEFAULT 'text',
  is_required  BOOLEAN DEFAULT FALSE,
  display_order INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_custom_fields_user_id ON custom_fields(user_id);

CREATE TABLE IF NOT EXISTS contact_custom_values (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id     UUID NOT NULL REFERENCES contacts(id)      ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value          TEXT,
  UNIQUE(contact_id, custom_field_id)
);
CREATE INDEX IF NOT EXISTS idx_ccv_contact ON contact_custom_values(contact_id);

-- ============================================================
-- CONTACT NOTES
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_notes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_notes_contact ON contact_notes(contact_id);

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  contact_id    UUID REFERENCES contacts(id)           ON DELETE SET NULL,
  phone         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  assigned_to   UUID REFERENCES users(id)              ON DELETE SET NULL,
  unread_count  INT  NOT NULL DEFAULT 0,
  last_message  TEXT,
  last_message_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id    ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact_id ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_phone      ON conversations(phone);
CREATE INDEX IF NOT EXISTS idx_conversations_status     ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  wamid           TEXT UNIQUE,
  direction       TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  content_type    TEXT NOT NULL DEFAULT 'text',
  content_text    TEXT,
  media_url       TEXT,
  media_mime_type TEXT,
  caption         TEXT,
  status          TEXT DEFAULT 'sent',
  error_message   TEXT,
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_wamid        ON messages(wamid);
CREATE INDEX IF NOT EXISTS idx_messages_user_id      ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at      ON messages(sent_at DESC);

-- ============================================================
-- WHATSAPP CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  phone_number_id TEXT NOT NULL,
  waba_id         TEXT,
  access_token    TEXT NOT NULL,
  verify_token    TEXT,
  status          TEXT DEFAULT 'connected',
  connected_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_user ON whatsapp_config(user_id);

-- ============================================================
-- MESSAGE TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS message_templates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  language     TEXT NOT NULL DEFAULT 'en_US',
  category     TEXT NOT NULL DEFAULT 'MARKETING',
  status       TEXT NOT NULL DEFAULT 'APPROVED',
  header_type  TEXT,
  header_text  TEXT,
  body_text    TEXT NOT NULL,
  footer_text  TEXT,
  buttons      JSONB DEFAULT '[]',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_templates_user_id ON message_templates(user_id);

-- ============================================================
-- PIPELINES
-- ============================================================
CREATE TABLE IF NOT EXISTS pipelines (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pipelines_user_id ON pipelines(user_id);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INT NOT NULL DEFAULT 0,
  color       TEXT DEFAULT '#6366f1',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);

CREATE TABLE IF NOT EXISTS deals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
  pipeline_id     UUID NOT NULL REFERENCES pipelines(id)       ON DELETE CASCADE,
  stage_id        UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id)                 ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id)            ON DELETE SET NULL,
  title           TEXT NOT NULL,
  value           NUMERIC(12,2) DEFAULT 0,
  currency        TEXT DEFAULT 'INR',
  notes           TEXT,
  position        INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deals_user_id    ON deals(user_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage_id   ON deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact_id ON deals(contact_id);

-- ============================================================
-- BROADCASTS
-- ============================================================
CREATE TABLE IF NOT EXISTS broadcasts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  template_id  UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ,
  total        INT DEFAULT 0,
  sent_count   INT DEFAULT 0,
  delivered_count INT DEFAULT 0,
  read_count   INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_user_id ON broadcasts(user_id);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  contact_id   UUID REFERENCES contacts(id)            ON DELETE SET NULL,
  phone        TEXT NOT NULL,
  variables    JSONB DEFAULT '{}',
  status       TEXT DEFAULT 'pending',
  wamid        TEXT,
  error        TEXT,
  sent_at      TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_br_broadcast ON broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_br_contact   ON broadcast_recipients(contact_id);

-- ============================================================
-- AUTOMATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS automations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  trigger_type          TEXT NOT NULL,
  trigger_config        JSONB DEFAULT '{}',
  is_active             BOOLEAN DEFAULT TRUE,
  execution_count       INT DEFAULT 0,
  last_executed_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_automations_user_id      ON automations(user_id);
CREATE INDEX IF NOT EXISTS idx_automations_trigger_type ON automations(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automations_active       ON automations(is_active);

CREATE TABLE IF NOT EXISTS automation_steps (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id  UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  parent_step_id UUID REFERENCES automation_steps(id)     ON DELETE CASCADE,
  step_type      TEXT NOT NULL,
  config         JSONB DEFAULT '{}',
  position       INT NOT NULL DEFAULT 0,
  branch         TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_steps_automation   ON automation_steps(automation_id);
CREATE INDEX IF NOT EXISTS idx_steps_parent       ON automation_steps(parent_step_id);

CREATE TABLE IF NOT EXISTS automation_logs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id    UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id)                ON DELETE SET NULL,
  contact_id       UUID REFERENCES contacts(id)             ON DELETE SET NULL,
  conversation_id  UUID REFERENCES conversations(id)        ON DELETE SET NULL,
  trigger_event    TEXT,
  status           TEXT NOT NULL DEFAULT 'success',
  steps_executed   JSONB DEFAULT '[]',
  error_message    TEXT,
  started_at       TIMESTAMPTZ DEFAULT NOW(),
  finished_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_logs_automation ON automation_logs(automation_id);
CREATE INDEX IF NOT EXISTS idx_logs_started    ON automation_logs(started_at DESC);

CREATE TABLE IF NOT EXISTS automation_pending_executions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id      UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id            UUID REFERENCES users(id)                ON DELETE SET NULL,
  contact_id         UUID REFERENCES contacts(id)             ON DELETE SET NULL,
  conversation_id    UUID REFERENCES conversations(id)        ON DELETE SET NULL,
  log_id             UUID REFERENCES automation_logs(id)      ON DELETE SET NULL,
  parent_step_id     UUID,
  branch             TEXT,
  context            JSONB DEFAULT '{}',
  next_step_position INT NOT NULL,
  status             TEXT DEFAULT 'pending',
  run_at             TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Helper function to atomically increment execution_count
CREATE OR REPLACE FUNCTION increment_automation_execution_count(p_automation_id UUID)
RETURNS VOID LANGUAGE SQL AS $$
  UPDATE automations SET execution_count = execution_count + 1, last_executed_at = NOW()
  WHERE id = p_automation_id;
$$;
CREATE INDEX IF NOT EXISTS idx_pending_run_at        ON automation_pending_executions(run_at);
CREATE INDEX IF NOT EXISTS idx_pending_automation_id ON automation_pending_executions(automation_id);

-- ============================================================
-- TRIGGERS — updated_at auto-stamp
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','profiles','contacts','tags','contact_notes','conversations',
    'whatsapp_config','message_templates','pipelines','pipeline_stages',
    'deals','broadcasts','automations'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_updated_at ON %I;
       CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t, t);
  END LOOP;
END $$;

-- Auto-create profile when user is created
CREATE OR REPLACE FUNCTION create_profile_for_user()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO profiles(user_id, full_name, email, avatar_url, role)
  VALUES (NEW.id, NEW.full_name, NEW.email, NEW.avatar_url, NEW.role)
  ON CONFLICT (user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email     = EXCLUDED.email,
        avatar_url = EXCLUDED.avatar_url;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_profile ON users;
CREATE TRIGGER trg_create_profile
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION create_profile_for_user();
