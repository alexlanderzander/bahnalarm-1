import Config

config :parkspot_ingestion, ParkspotIngestion.Repo,
  url: System.get_env("DATABASE_URL"),
  pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10")

config :parkspot_ingestion, ParkspotIngestionWeb.Endpoint,
  http: [ip: {0, 0, 0, 0}, port: String.to_integer(System.get_env("PORT") || "4000")],
  check_origin: String.split(System.get_env("CHECK_ORIGIN", "//localhost:3000"), ","),
  # Note: force_ssl is controlled by runtime.exs via FORCE_SSL env var
  secret_key_base: System.get_env("SECRET_KEY_BASE")
