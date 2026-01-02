import Config

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
      """

  config :parkspot_ingestion, ParkspotIngestion.Repo,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10")

  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      """

  port = String.to_integer(System.get_env("PORT") || "4000")

  # Parse CHECK_ORIGIN from comma-separated list
  check_origin =
    case System.get_env("CHECK_ORIGIN") do
      nil -> ["//localhost:3000"]
      origins -> String.split(origins, ",")
    end

  # Force SSL only if explicitly enabled (for production behind SSL-terminating proxy)
  force_ssl_enabled = System.get_env("FORCE_SSL", "false") == "true"

  endpoint_config = [
    http: [ip: {0, 0, 0, 0}, port: port],
    check_origin: check_origin,
    secret_key_base: secret_key_base,
    server: true
  ]

  endpoint_config =
    if force_ssl_enabled do
      Keyword.put(endpoint_config, :force_ssl, rewrite_on: [:x_forwarded_proto])
    else
      endpoint_config
    end

  config :parkspot_ingestion, ParkspotIngestionWeb.Endpoint, endpoint_config
end

# Redis configuration (used by both dev and prod)
redis_url = System.get_env("REDIS_URL", "redis://localhost:6379")
config :parkspot_ingestion, :redis_url, redis_url

# API Key for authentication
api_key = System.get_env("API_KEY", "dev_key_change_in_prod")
config :parkspot_ingestion, :api_key, api_key
