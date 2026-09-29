-- Web sessions (docs/superpowers/specs/2026-09-29-orderat-web-design.md): a browser's session expires
-- 30 days after signin; the phones' sessions keep no expiry (null).
alter table orderat.sessions add column if not exists expires_at timestamptz null;
