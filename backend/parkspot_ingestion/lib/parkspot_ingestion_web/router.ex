defmodule ParkspotIngestionWeb.Router do
  use Phoenix.Router
  import Phoenix.Controller

  alias ParkspotIngestionWeb.Plugs.ApiAuth

  # Public endpoints (no auth required)
  pipeline :public_api do
    plug(:accepts, ["json"])
  end

  # Protected endpoints (require X-Api-Key header)
  pipeline :api do
    plug(:accepts, ["json"])
    plug(ApiAuth)
  end

  # Public routes - health checks, etc.
  scope "/api", ParkspotIngestionWeb do
    pipe_through(:public_api)

    # Health check - always public
    get("/health", HealthController, :index)
  end

  # Protected routes - require API key
  scope "/api", ParkspotIngestionWeb do
    pipe_through(:api)

    # Scan ingestion
    post("/scans", ScanController, :create)
    post("/scans/batch", ScanController, :create_batch)

    # Stats (admin)
    get("/stats", StatsController, :index)
  end

  # Enable LiveDashboard in development
  if Application.compile_env(:parkspot_ingestion, :dev_routes) do
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through([:fetch_session, :protect_from_forgery])
      live_dashboard("/dashboard", metrics: ParkspotIngestionWeb.Telemetry)
    end
  end
end
