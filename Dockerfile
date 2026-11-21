FROM golang:1.27-bookworm AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
COPY dist ./dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/terra . && mkdir -p /empty

FROM scratch
ENV PORT=3000 TERRA_DATA_DIR=/var/lib/terra GOMEMLIMIT=30MiB GOGC=60 GOMAXPROCS=2
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/terra /terra
COPY --from=build --chown=65532:65532 /empty /var/lib/terra
USER 65532:65532
EXPOSE 3000
VOLUME ["/var/lib/terra"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD ["/terra", "healthcheck"]
ENTRYPOINT ["/terra"]
