defmodule ParkspotIngestion.Workers.AggregationWorker do
  @moduledoc """
  GenServer that periodically flushes the Redis scan queue
  and bulk inserts into TimescaleDB.
  """
  use GenServer
  require Logger

  alias ParkspotIngestion.Repo

  # 30 seconds
  @flush_interval 30_000
  @batch_size 1000

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  @impl true
  def init(state) do
    schedule_flush()
    {:ok, state}
  end

  @impl true
  def handle_info(:flush, state) do
    flush_queue()
    schedule_flush()
    {:noreply, state}
  end

  defp schedule_flush do
    Process.send_after(self(), :flush, @flush_interval)
  end

  defp flush_queue do
    case pop_batch() do
      [] ->
        :ok

      scans ->
        insert_batch(scans)
        Logger.info("Flushed #{length(scans)} scan reports")

        # Notify ML service about new data
        notify_new_data(scans)
    end
  end

  defp pop_batch do
    case Redix.command(:redix, ["LRANGE", "scans:pending", "0", "#{@batch_size - 1}"]) do
      {:ok, items} when length(items) > 0 ->
        # Remove the items we just read
        Redix.command(:redix, ["LTRIM", "scans:pending", "#{length(items)}", "-1"])

        Enum.map(items, &Jason.decode!/1)

      _ ->
        []
    end
  end

  defp insert_batch(scans) do
    now = DateTime.utc_now()

    values =
      Enum.map(scans, fn scan ->
        timestamp =
          case DateTime.from_iso8601(scan["timestamp"]) do
            {:ok, dt, _} -> dt
            _ -> now
          end

        %{
          time: timestamp,
          device_id: scan["device_id"],
          geohash: scan["geohash"],
          lat: scan["lat"],
          lng: scan["lng"],
          ble_count: scan["ble_count"] || 0,
          wifi_count: scan["wifi_count"] || 0,
          devices: scan["devices"] || []
        }
      end)

    # Bulk insert
    Repo.insert_all("scan_reports", values, on_conflict: :nothing)
  end

  defp notify_new_data(scans) do
    # Get unique geohashes from the batch
    geohashes =
      scans
      |> Enum.map(& &1["geohash"])
      |> Enum.uniq()

    # Publish to Redis for ML service
    Redix.command(:redix, [
      "PUBLISH",
      "parkspot:new_data",
      Jason.encode!(%{geohashes: geohashes, count: length(scans)})
    ])
  end
end
