-- Permit the reviewed Strokies deployment without allowing other external callbacks.
-- Client registration and its hashed secret are supplied separately by the owner.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.game_oauth_clients
    DROP CONSTRAINT game_oauth_clients_redirect_uri_check;

ALTER TABLE public.game_oauth_clients
    ADD CONSTRAINT game_oauth_clients_redirect_uri_check CHECK (
        octet_length(redirect_uri) <= 512 AND
        length(redirect_uri) <= 512 AND
        (
            redirect_uri ~ '^https://([a-z0-9.-]+\.teamham\.world|(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?)/[^?#@\s]+$'
            OR (
                client_id = 'strokies'
                AND redirect_uri = 'https://strokies.cyr1en.dev/api/auth/callback'
            )
        )
    );
