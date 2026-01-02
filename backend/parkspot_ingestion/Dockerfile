FROM elixir:1.15-alpine AS build

# Install build dependencies
RUN apk add --no-cache build-base git

WORKDIR /app

# Install hex + rebar
RUN mix local.hex --force && \
  mix local.rebar --force

# Set build ENV
ENV MIX_ENV=prod

# Install dependencies
COPY mix.exs mix.lock ./
RUN mix deps.get --only $MIX_ENV
RUN mix deps.compile

# Copy source
COPY config config
COPY lib lib

# Compile
RUN mix compile

# Build release
RUN mix release

# Production image
FROM alpine:3.18 AS app

RUN apk add --no-cache libstdc++ openssl ncurses-libs

WORKDIR /app

# Copy release
COPY --from=build /app/_build/prod/rel/parkspot_ingestion ./

ENV HOME=/app
ENV PORT=4000

EXPOSE 4000

CMD ["bin/parkspot_ingestion", "start"]
