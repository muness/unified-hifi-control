# syntax=docker/dockerfile:1.4
# Build stage
FROM rust:1.92-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install wasm32 target for client build
RUN rustup target add wasm32-unknown-unknown

# Install Dioxus CLI (with cache mount for cargo registry)
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo install dioxus-cli@0.7.3

# Copy manifests first (for dependency caching)
COPY Cargo.toml Cargo.lock Dioxus.toml ./

# Create dummy source for dependency caching
RUN mkdir -p src/app && \
    echo "fn main() {}" > src/main.rs && \
    echo "pub mod app;" > src/lib.rs && \
    echo "// stub" > src/app/mod.rs

# Build dependencies only (with cache mounts)
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    cargo build --release 2>/dev/null || true

# Copy actual source and public assets
COPY src/ ./src/
COPY public/ ./public/

# Build with Dioxus (with cache mounts for faster rebuilds)
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    dx build --release --platform web --features web && \
    cp -r target/dx/unified-hifi-control/release/web /app/dist

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies (minimal - using rustls, no OpenSSL needed)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy binary and web assets from builder
COPY --from=builder /app/dist/unified-hifi-control /app/
COPY --from=builder /app/dist/public /app/public

# Create data directory for config persistence
RUN mkdir -p /data

# Version from build arg
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# Environment
ENV PORT=8088
ENV CONFIG_DIR=/data
ENV RUST_LOG=info

EXPOSE 8088

CMD ["/app/unified-hifi-control"]
