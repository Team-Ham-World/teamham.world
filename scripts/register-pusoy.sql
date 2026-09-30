-- Owner-managed registration. Deploy the RESERVED_SUBDOMAINS entry first.
-- Run with ON_ERROR_STOP, --single-transaction, and pusoy_secret_hash set to
-- the SHA-256 hex digest of the server-only HAM_CLIENT_SECRET.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.member_pages WHERE slug = 'pusoy') THEN
    RAISE EXCEPTION 'pusoy is already assigned to a member page';
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_oauth_clients WHERE client_id = 'pusoy') THEN
    RAISE EXCEPTION 'pusoy is already registered; inspect it instead of rotating its secret';
  END IF;
END
$$;

INSERT INTO public.game_oauth_clients
  (client_id, audience, redirect_uri, client_secret_hash, enabled)
VALUES
  ('pusoy', 'urn:teamham:game:pusoy',
   'https://pusoy.teamham.world/api/auth/callback', :'pusoy_secret_hash', TRUE);
