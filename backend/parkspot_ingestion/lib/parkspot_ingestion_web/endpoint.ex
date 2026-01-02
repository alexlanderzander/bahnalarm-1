defmodule ParkspotIngestionWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :parkspot_ingestion

  # Use Bandit instead of Cowboy
  @session_options [
    store: :cookie,
    key: "_parkspot_key",
    signing_salt: "randomsalt",
    same_site: "Lax"
  ]

  plug(Plug.RequestId)
  plug(Plug.Telemetry, event_prefix: [:phoenix, :endpoint])

  plug(Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()
  )

  plug(Plug.MethodOverride)
  plug(Plug.Head)
  plug(Plug.Session, @session_options)
  plug(ParkspotIngestionWeb.Router)
end
