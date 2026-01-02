defmodule ParkspotIngestionWeb.ScanController do
  use Phoenix.Controller
  import Ecto.Query

  alias ParkspotIngestion.Repo
  alias ParkspotIngestion.ScanReports.ScanReport

  @doc """
  Receive a single scan report from a mobile device.

  POST /api/scans
  """
  def create(conn, params) do
    with {:ok, report} <- validate_scan(params),
         {:ok, geohash} <- compute_geohash(report),
         :ok <- queue_for_batch(report, geohash) do
      conn
      |> put_status(:accepted)
      |> json(%{status: "queued", geohash: geohash})
    else
      {:error, reason} ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: reason})
    end
  end

  @doc """
  Receive multiple scan reports in batch.

  POST /api/scans/batch
  """
  def create_batch(conn, %{"reports" => reports}) when is_list(reports) do
    results =
      Enum.map(reports, fn report ->
        with {:ok, validated} <- validate_scan(report),
             {:ok, geohash} <- compute_geohash(validated) do
          queue_for_batch(validated, geohash)
          {:ok, geohash}
        end
      end)

    success_count = Enum.count(results, &match?({:ok, _}, &1))

    conn
    |> put_status(:accepted)
    |> json(%{status: "queued", count: success_count})
  end

  def create_batch(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "Expected 'reports' array"})
  end

  # Validation
  defp validate_scan(params) do
    required = ["device_id", "timestamp", "location"]

    case Enum.find(required, fn key -> !Map.has_key?(params, key) end) do
      nil -> {:ok, params}
      missing -> {:error, "Missing required field: #{missing}"}
    end
  end

  # Compute geohash from location
  defp compute_geohash(%{"location" => %{"lat" => lat, "lng" => lng}}) do
    {:ok, Geohash.encode(lat, lng, 7)}
  end

  defp compute_geohash(_), do: {:error, "Invalid location format"}

  # Queue for batch insertion via Redis
  defp queue_for_batch(report, geohash) do
    data = %{
      device_id: report["device_id"],
      timestamp: report["timestamp"],
      geohash: geohash,
      lat: get_in(report, ["location", "lat"]),
      lng: get_in(report, ["location", "lng"]),
      ble_count: report["ble_count"] || 0,
      wifi_count: report["wifi_count"] || 0,
      devices: report["devices"] || []
    }

    Redix.command(:redix, ["LPUSH", "scans:pending", Jason.encode!(data)])
    :ok
  end
end
