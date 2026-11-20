# syntax=docker/dockerfile:1
FROM golang:1.26.6-alpine AS go-build
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY backend/ ./
COPY api/ /src/api/
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go generate ./internal/transport && \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/ ./cmd/server ./cmd/dbsetup ./cmd/catalogload ./cmd/catalogcheck ./cmd/dbbootstrap

FROM alpine:3.23 AS backend
RUN addgroup -S obiad && adduser -S -G obiad obiad
COPY --from=go-build /out/server /usr/local/bin/server
USER obiad
EXPOSE 8080
ENTRYPOINT ["server"]

FROM postgres:17.10-alpine AS setup
RUN apk add --no-cache python3
COPY --from=go-build /out/dbsetup /out/catalogload /out/catalogcheck /out/dbbootstrap /usr/local/bin/
COPY deploy/validate_release.py deploy/setup.sh /opt/obiad/
COPY --chown=postgres:postgres .release/ /opt/obiad/release/
USER postgres
ENTRYPOINT ["/bin/sh", "/opt/obiad/setup.sh"]

FROM oven/bun:1.3.14-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
COPY api/ /src/api/
COPY .release/ /src/.release/
RUN cp /src/.release/generated-meal-images.ts src/lib/assets/generated-meal-images.ts && \
    bun --bun run generate:api && \
    VITE_DATA_COMMIT="$(bun -e 'console.log(require("../.release/release.json").dataCommit)')" bun --bun run build && \
    cp /src/.release/catalog.json /src/.release/release.json dist/

FROM nginx:1.30.0-alpine AS frontend
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --chown=nginx:nginx --from=frontend-build /src/frontend/dist/ /usr/share/nginx/html/
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
