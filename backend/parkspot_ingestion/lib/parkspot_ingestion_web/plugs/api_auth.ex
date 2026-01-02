defmodule ParkspotIngestionWeb.Plugs.ApiAuth do
  @moduledoc """
  Plug for API key authentication.

  Expects the API key to be passed in the `X-Api-Key` header.
  The expected key is configured via the API_KEY environment variable.
  """

  import Plug.Conn
  require Logger

  def init(opts), do: opts

  def call(conn, _opts) do
    expected_key = Application.get_env(:parkspot_ingestion, :api_key, "dev_key_change_in_prod")

    case get_req_header(conn, "x-api-key") do
      [^expected_key] ->
        conn

      [provided_key] ->
        Logger.warning("Invalid API key attempt: #{String.slice(provided_key, 0, 8)}...")
        unauthorized(conn)

      [] ->
        Logger.warning("Missing API key from #{conn.remote_ip |> :inet.ntoa() |> to_string()}")
        unauthorized(conn)
    end
  end

  defp unauthorized(conn) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(
      401,
      Jason.encode!(%{
        error: "unauthorized",
        message: "Invalid or missing API key. Include 'X-Api-Key' header."
      })
    )
    |> halt()
  end
end
