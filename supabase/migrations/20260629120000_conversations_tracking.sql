ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS tracking jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS capi_contact_fired boolean NOT NULL DEFAULT false;
