defmodule ParkspotIngestionWeb.HealthController do
  use Phoenix.Controller

  def index(conn, _params) do
    # Check database connection
    db_ok =
      try do
        ParkspotIngestion.Repo.query("SELECT 1")
        true
      rescue
        _ -> false
      end

    # Check Redis connection
    redis_ok =
      case Redix.command(:redix, ["PING"]) do
        {:ok, "PONG"} -> true
        _ -> false
      end

    status = if db_ok and redis_ok, do: :ok, else: :service_unavailable

    conn
    |> put_status(status)
    |> json(%{
      status: if(status == :ok, do: "healthy", else: "unhealthy"),
      database: db_ok,
      redis: redis_ok,
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    })
  end
end
