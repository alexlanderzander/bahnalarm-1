import Config

config :parkspot_ingestion, ParkspotIngestion.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "parkspot_dev",
  stacktrace: true,
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

config :parkspot_ingestion, ParkspotIngestionWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4000],
  check_origin: false,
  code_reloader: true,
  debug_errors: true,
  secret_key_base: "dev_only_secret_key_base_that_should_be_at_least_64_bytes_long_for_security",
  watchers: []

config :parkspot_ingestion, dev_routes: true

config :logger, :console, format: "[$level] $message\n"
config :phoenix, :stacktrace_depth, 20
config :phoenix, :plug_init_mode, :runtime
