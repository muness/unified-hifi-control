# Build stage
FROM rust:1.84-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests
COPY Cargo.toml Cargo.lock ./

# Create dummy src to cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release && rm -rf src target/release/unified-hifi-control*

# Copy actual source
COPY src/ ./src/

# Build the real binary
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/unified-hifi-control /app/

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
