import Config

config :parkspot_ingestion,
  ecto_repos: [ParkspotIngestion.Repo]

config :parkspot_ingestion, ParkspotIngestionWeb.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  url: [host: "localhost"],
  render_errors: [formats: [json: ParkspotIngestionWeb.ErrorJSON], layout: false],
  pubsub_server: ParkspotIngestion.PubSub,
  live_view: [signing_salt: "randomsalt"]

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
