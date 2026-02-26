package main

// HTTP/2 client using fhttp (BSD-3 fork of Go's net/http) with Chrome-like fingerprinting.
// fhttp sends Chrome's exact HTTP/2 SETTINGS, pseudo-header ordering, and WINDOW_UPDATE values.
// This bypasses Akamai, Cloudflare, and other anti-bot HTTP/2 fingerprinting.

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	fhttp "github.com/Danny-Dasilva/fhttp"
	fhttp2 "github.com/Danny-Dasilva/fhttp/http2"
	"github.com/andybalholm/brotli"
)

// doHTTP2fhttp performs an HTTP/2 request using fhttp with Chrome fingerprinting.
// Returns a standard *http.Response so the caller doesn't need to know about fhttp.
func doHTTP2fhttp(conn net.Conn, parsedURL *url.URL, method string, headers map[string]string) (*http.Response, error) {
	// Create fhttp HTTP/2 transport with Chrome preset
	tr := &fhttp2.Transport{
		Navigator: fhttp2.Chrome,
	}

	// Create HTTP/2 client connection from our existing uTLS connection
	h2cc, err := tr.NewClientConn(conn)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("h2 client conn failed: %s", err)
	}

	// Build the request using fhttp.Request (supports header ordering)
	req := &fhttp.Request{
		Method: strings.ToUpper(method),
		URL:    parsedURL,
		Host:   parsedURL.Host,
		Header: make(fhttp.Header),
	}

	// Set headers with Chrome-like ordering
	headerOrder := []string{}
	pHeaderOrder := []string{":method", ":authority", ":scheme", ":path"}

	// Set default Accept-Encoding
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")

	// Chrome header order
	chromeOrder := []string{
		"cache-control", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform",
		"upgrade-insecure-requests", "user-agent", "accept", "sec-fetch-site",
		"sec-fetch-mode", "sec-fetch-user", "sec-fetch-dest", "accept-encoding",
		"accept-language", "cookie", "priority",
	}

	// Apply user headers with Chrome-like ordering
	written := make(map[string]bool)
	for _, key := range chromeOrder {
		for hk, hv := range headers {
			if strings.ToLower(hk) == key {
				req.Header.Set(hk, hv)
				headerOrder = append(headerOrder, key)
				written[strings.ToLower(hk)] = true
				break
			}
		}
	}
	// Remaining headers not in Chrome order
	for k, v := range headers {
		if !written[strings.ToLower(k)] {
			req.Header.Set(k, v)
			headerOrder = append(headerOrder, strings.ToLower(k))
		}
	}

	// Set header ordering keys (fhttp's special keys)
	req.Header[fhttp.HeaderOrderKey] = headerOrder
	req.Header[fhttp.PHeaderOrderKey] = pHeaderOrder

	// Set timeout via context
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req = req.WithContext(ctx)

	// Execute request
	resp, err := h2cc.RoundTrip(req)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("h2 request failed: %s", err)
	}

	// Read and decompress body
	bodyBytes, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	conn.Close()
	if err != nil {
		return nil, fmt.Errorf("h2 body read failed: %s", err)
	}

	encoding := strings.ToLower(resp.Header.Get("Content-Encoding"))
	decompressed, err := decompressH2(bodyBytes, encoding)
	if err != nil {
		return nil, fmt.Errorf("h2 decompress failed: %s", err)
	}

	// Convert fhttp.Header to stdlib http.Header
	stdHeaders := make(http.Header)
	for k, vs := range resp.Header {
		stdHeaders[k] = vs
	}

	// Return as standard http.Response
	return &http.Response{
		StatusCode:    resp.StatusCode,
		Status:        resp.Status,
		Proto:         "HTTP/2.0",
		ProtoMajor:    2,
		Header:        stdHeaders,
		Body:          io.NopCloser(bytes.NewReader(decompressed)),
		ContentLength: int64(len(decompressed)),
	}, nil
}

// decompressH2 handles content decompression for the H2 path.
func decompressH2(data []byte, encoding string) ([]byte, error) {
	switch encoding {
	case "gzip":
		gr, err := gzip.NewReader(bytes.NewReader(data))
		if err != nil {
			return nil, err
		}
		defer gr.Close()
		return io.ReadAll(gr)
	case "br":
		return io.ReadAll(brotli.NewReader(bytes.NewReader(data)))
	case "deflate":
		dr := flate.NewReader(bytes.NewReader(data))
		defer dr.Close()
		return io.ReadAll(dr)
	default:
		return data, nil
	}
}
