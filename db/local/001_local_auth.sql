-- LOCAL AUTH PROVIDER (development, CI and on-premise installs without Supabase Auth).
-- Disabled in production unless ALLOW_LOCAL_AUTH=true is set deliberately.
create schema if not exists local_auth;
revoke all on schema local_auth from public;

create table if not exists local_auth.credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password_hash text not null,          -- scrypt$N$r$p$salt$hash
  totp_secret text,                     -- base32, null = MFA not enrolled
  pending_totp_secret text,             -- secret awaiting first-code confirmation
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists local_auth.sessions (
  token_hash text primary key,          -- sha256 of the opaque cookie token
  user_id uuid not null references auth.users(id) on delete cascade,
  mfa_verified boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text,
  user_agent text
);
create index if not exists sessions_user_idx on local_auth.sessions(user_id);

create table if not exists local_auth.password_resets (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
