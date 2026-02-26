#!/bin/bash
set -e
mkdir -p dist
echo "Building PeelTLS..."
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o dist/peeltls-darwin-x64 .
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o dist/peeltls-darwin-arm64 .
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/peeltls-linux-x64 .
GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o dist/peeltls-linux-arm64 .
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/peeltls-windows-x64.exe .
echo "Done. Binaries in dist/"
ls -lh dist/
