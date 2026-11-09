FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /waymark ./cmd/waymark

FROM gcr.io/distroless/static-debian12
COPY --from=build /waymark /waymark
ENV PORT=8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/waymark"]
