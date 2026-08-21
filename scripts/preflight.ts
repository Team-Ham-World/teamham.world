const FORBIDDEN_IN_DISABLED = [
  "APP_BASE_URL",
  "OAUTH_STATE_HMAC_SECRET",
  "GAME_AUTH_REQUEST_HMAC_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_GUILD_ID",
  "DISCORD_REQUIRED_ROLE_ID",
  "DATABASE_URL",
] as const;

const SNOWFLAKE_REGEX = /^[0-9]{1,20}$/;
const HEX_64_REGEX = /^[0-9a-fA-F]{64}$/;

function validatePreflight(): void {
  const errors: string[] = [];
  const authMode = process.env.AUTH_MODE;

  if (!authMode || !["disabled", "development", "production"].includes(authMode)) {
    errors.push(
      "AUTH_MODE must be set to exactly 'disabled', 'development', or 'production'."
    );
    reportAndExit(errors);
    return;
  }

  if (authMode === "disabled") {
    for (const varName of FORBIDDEN_IN_DISABLED) {
      const val = process.env[varName];
      if (val !== undefined && val.trim() !== "") {
        errors.push(
          `Forbidden variable ${varName} is configured with a non-empty value in disabled mode.`
        );
      }
    }
  } else {
    // development or production mode
    // 1. APP_BASE_URL
    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl || baseUrl.trim() === "") {
      errors.push("Missing required variable APP_BASE_URL.");
    } else {
      const trimmed = baseUrl.trim();
      try {
        const parsed = new URL(trimmed);
        if (parsed.origin !== trimmed) {
          errors.push(
            "APP_BASE_URL must be a clean origin without path, trailing slash, query, or fragment."
          );
        } else if (authMode === "production" && parsed.protocol !== "https:") {
          errors.push("APP_BASE_URL must use https: in production mode.");
        } else if (authMode === "development") {
          if (parsed.protocol === "https:") {
            // HTTPS is allowed for any valid clean origin in development
          } else if (parsed.protocol === "http:") {
            const hostname = parsed.hostname.toLowerCase();
            if (
              hostname === "localhost" ||
              hostname === "127.0.0.1" ||
              hostname === "[::1]" ||
              hostname === "::1"
            ) {
              // Valid loopback host
            } else {
              errors.push(
                "APP_BASE_URL with http: protocol in development mode must use a loopback host (localhost, 127.0.0.1, [::1])."
              );
            }
          } else {
            errors.push("APP_BASE_URL must use http: or https: protocol.");
          }
        }
      } catch {
        errors.push("APP_BASE_URL is not a valid URL origin.");
      }
    }

    // 2. OAUTH_STATE_HMAC_SECRET
    const hmacSecret = process.env.OAUTH_STATE_HMAC_SECRET;
    if (!hmacSecret || hmacSecret.trim() === "") {
      errors.push("Missing required variable OAUTH_STATE_HMAC_SECRET.");
    } else if (!HEX_64_REGEX.test(hmacSecret.trim())) {
      errors.push(
        "OAUTH_STATE_HMAC_SECRET must be a 64-character hex string (32 bytes)."
      );
    }

    // 2b. GAME_AUTH_REQUEST_HMAC_SECRET
    const gameHmacSecret = process.env.GAME_AUTH_REQUEST_HMAC_SECRET;
    if (!gameHmacSecret || gameHmacSecret.trim() === "") {
      errors.push("Missing required variable GAME_AUTH_REQUEST_HMAC_SECRET.");
    } else if (!HEX_64_REGEX.test(gameHmacSecret.trim())) {
      errors.push(
        "GAME_AUTH_REQUEST_HMAC_SECRET must be a 64-character hex string (32 bytes)."
      );
    }

    // 3. DISCORD_CLIENT_ID
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId || clientId.trim() === "") {
      errors.push("Missing required variable DISCORD_CLIENT_ID.");
    } else if (!SNOWFLAKE_REGEX.test(clientId.trim())) {
      errors.push(
        "DISCORD_CLIENT_ID must be a numeric snowflake (1-20 digits)."
      );
    }

    // 4. DISCORD_CLIENT_SECRET
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientSecret || clientSecret.trim() === "") {
      errors.push("Missing required variable DISCORD_CLIENT_SECRET.");
    }

    // 5. DISCORD_GUILD_ID
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId || guildId.trim() === "") {
      errors.push("Missing required variable DISCORD_GUILD_ID.");
    } else if (!SNOWFLAKE_REGEX.test(guildId.trim())) {
      errors.push(
        "DISCORD_GUILD_ID must be a numeric snowflake (1-20 digits)."
      );
    }

    // 6. DISCORD_REQUIRED_ROLE_ID
    const roleId = process.env.DISCORD_REQUIRED_ROLE_ID;
    if (!roleId || roleId.trim() === "") {
      errors.push("Missing required variable DISCORD_REQUIRED_ROLE_ID.");
    } else if (!SNOWFLAKE_REGEX.test(roleId.trim())) {
      errors.push(
        "DISCORD_REQUIRED_ROLE_ID must be a numeric snowflake (1-20 digits)."
      );
    }

    // 7. DATABASE_URL
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl || dbUrl.trim() === "") {
      errors.push("Missing required variable DATABASE_URL.");
    } else {
      const trimmedDbUrl = dbUrl.trim();
      try {
        const parsed = new URL(trimmedDbUrl);
        if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
          errors.push("DATABASE_URL must use postgres: or postgresql: protocol.");
        }
        if (decodeURIComponent(parsed.username) !== "app_runtime_role") {
          errors.push("DATABASE_URL must authenticate as user 'app_runtime_role'.");
        }
        if (!parsed.password || parsed.password === "") {
          errors.push("DATABASE_URL must include a non-empty password.");
        }
        if (!parsed.hostname || parsed.hostname === "") {
          errors.push("DATABASE_URL must include a valid host.");
        }
        const dbName = parsed.pathname.replace(/^\/+/, "");
        if (!dbName || dbName === "") {
          errors.push("DATABASE_URL must specify a database name.");
        }
        if (parsed.hash && parsed.hash !== "") {
          errors.push("DATABASE_URL must not include a fragment/hash.");
        }
        if (authMode === "production") {
          const sslmode = parsed.searchParams.get("sslmode")?.toLowerCase();
          const ssl = parsed.searchParams.get("ssl")?.toLowerCase();
          if (
            sslmode === "disable" ||
            sslmode === "allow" ||
            sslmode === "prefer" ||
            ssl === "false" ||
            ssl === "0" ||
            ssl === "disable"
          ) {
            errors.push(
              "DATABASE_URL in production mode must not disable or downgrade SSL (insecure sslmode or ssl=false detected)."
            );
          }
        }
      } catch {
        errors.push("DATABASE_URL is not a valid URL.");
      }
    }
  }

  reportAndExit(errors, authMode);
}

function reportAndExit(errors: string[], authMode?: string): void {
  if (errors.length > 0) {
    console.error("Preflight validation failed:");
    for (const err of errors) {
      console.error(`- ${err}`);
    }
    process.exit(1);
  }
  console.log(`Preflight validation succeeded (mode: ${authMode}).`);
}

validatePreflight();
