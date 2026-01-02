defmodule ParkspotIngestion.Repo do
  use Ecto.Repo,
    otp_app: :parkspot_ingestion,
    adapter: Ecto.Adapters.Postgres
end
