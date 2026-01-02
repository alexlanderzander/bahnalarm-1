defmodule ParkspotIngestion.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Database
      ParkspotIngestion.Repo,

      # Redis connection
      {Redix, name: :redix, host: redis_host(), port: 6379},

      # Telemetry
      ParkspotIngestionWeb.Telemetry,

      # PubSub for Phoenix Channels
      {Phoenix.PubSub, name: ParkspotIngestion.PubSub},

      # Batch aggregation worker
      ParkspotIngestion.Workers.AggregationWorker,

      # Web endpoint
      ParkspotIngestionWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: ParkspotIngestion.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    ParkspotIngestionWeb.Endpoint.config_change(changed, removed)
    :ok
  end

  defp redis_host do
    case System.get_env("REDIS_URL") do
      "redis://" <> rest ->
        rest |> String.split(":") |> List.first()

      _ ->
        "localhost"
    end
  end
end
