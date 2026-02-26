package main

import (
	"bufio"
	"bytes"
	"compress/flate"
	"compress/gzip"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/andybalholm/brotli"
	tls "github.com/refraction-networking/utls"
)

// FetchRequest is the JSON body for POST /fetch
type FetchRequest struct {
	URL             string            `json:"url"`
	Method          string            `json:"method"`
	Headers         map[string]string `json:"headers"`
	Fingerprint     string            `json:"fingerprint"`
	Proxy           string            `json:"proxy"`
	Timeout         int               `json:"timeout"`
	FollowRedirects bool              `json:"followRedirects"`
	MaxRedirects    int               `json:"maxRedirects"`
}

// FetchResponse is the JSON response for POST /fetch
type FetchResponse struct {
	Status   int               `json:"status,omitempty"`
	Headers  map[string]string `json:"headers,omitempty"`
	Body     string            `json:"body,omitempty"`
	FinalURL string            `json:"finalUrl,omitempty"`
	Timing   *FetchTiming      `json:"timing,omitempty"`
	Error    string            `json:"error,omitempty"`
}

// FetchTiming holds timing info in milliseconds
type FetchTiming struct {
	DNSMS   int64 `json:"dnsMs"`
	TLSMS   int64 `json:"tlsMs"`
	TotalMS int64 `json:"totalMs"`
}

func doFetch(req FetchRequest) FetchResponse {
	if req.Method == "" {
		req.Method = "GET"
	}
	if req.Fingerprint == "" {
		req.Fingerprint = "chrome-133"
	}
	if req.Timeout <= 0 {
		req.Timeout = 30
	}
	if req.MaxRedirects <= 0 {
		req.MaxRedirects = 10
	}

	timeout := time.Duration(req.Timeout) * time.Second
	totalStart := time.Now()
	timing := &FetchTiming{}

	currentURL := req.URL
	visited := make(map[string]bool)
	redirectCount := 0

	for {
		if visited[currentURL] {
			return FetchResponse{Error: "redirect loop detected"}
		}
		visited[currentURL] = true

		resp, err := fetchOnce(currentURL, req.Method, req.Headers, req.Fingerprint, req.Proxy, timeout, timing)
		if err != nil {
			return FetchResponse{Error: err.Error(), Status: 0}
		}

		// Check redirect
		if req.FollowRedirects && isRedirect(resp.StatusCode) {
			location := resp.Header.Get("Location")
			if location != "" {
				// Resolve relative redirect
				base, parseErr := url.Parse(currentURL)
				if parseErr == nil {
					loc, locErr := url.Parse(location)
					if locErr == nil {
						location = base.ResolveReference(loc).String()
					}
				}
				// Drain and close body
				if resp.Body != nil {
					io.Copy(io.Discard, resp.Body)
					resp.Body.Close()
				}
				redirectCount++
				if redirectCount > req.MaxRedirects {
					return FetchResponse{Error: fmt.Sprintf("too many redirects (max %d)", req.MaxRedirects)}
				}
				currentURL = location
				continue
			}
		}

		// Build final response
		defer resp.Body.Close()
		body, err := decompressBody(resp)
		if err != nil {
			return FetchResponse{Error: "decompression failed: " + err.Error()}
		}

		headers := make(map[string]string)
		for k, vs := range resp.Header {
			headers[strings.ToLower(k)] = strings.Join(vs, ", ")
		}
		timing.TotalMS = time.Since(totalStart).Milliseconds()

		return FetchResponse{
			Status:   resp.StatusCode,
			Headers:  headers,
			Body:     string(body),
			FinalURL: currentURL,
			Timing:   timing,
		}
	}
}

func isRedirect(status int) bool {
	return status == 301 || status == 302 || status == 303 || status == 307 || status == 308
}

// fetchOnce makes a single HTTP request (no redirects). Updates timing in-place.
func fetchOnce(rawURL, method string, headers map[string]string, fingerprint, proxy string, timeout time.Duration, timing *FetchTiming) (*http.Response, error) {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %s", err)
	}

	hostname := parsedURL.Hostname()
	port := parsedURL.Port()
	if port == "" {
		if parsedURL.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	addr := net.JoinHostPort(hostname, port)

	// DNS resolution timing (best effort)
	dnsStart := time.Now()
	_, lookupErr := net.LookupHost(hostname)
	if lookupErr == nil {
		timing.DNSMS = time.Since(dnsStart).Milliseconds()
	}

	// Dial TCP (via proxy if specified)
	var tcpConn net.Conn
	if proxy != "" {
		tcpConn, err = dialViaProxy(proxy, addr, timeout)
	} else {
		tcpConn, err = net.DialTimeout("tcp", addr, timeout)
	}
	if err != nil {
		return nil, fmt.Errorf("connection refused: %s", err)
	}
	tcpConn.SetDeadline(time.Now().Add(timeout))

	// For HTTP (non-TLS) URLs, use plain connection
	if parsedURL.Scheme == "http" {
		return doHTTP1(tcpConn, parsedURL, method, headers)
	}

	// uTLS handshake
	fpSpec := resolveFingerprint(fingerprint)
	tlsStart := time.Now()
	tlsConn := tls.UClient(tcpConn, &tls.Config{
		ServerName: hostname,
	}, fpSpec.ID)

	// Apply custom spec (JA3) if provided
	if fpSpec.CustomSpec != nil {
		if err := tlsConn.ApplyPreset(fpSpec.CustomSpec); err != nil {
			tcpConn.Close()
			return nil, fmt.Errorf("tls apply preset failed: %s", err)
		}
	}

	if err := tlsConn.Handshake(); err != nil {
		tcpConn.Close()
		return nil, fmt.Errorf("tls handshake failed: %s", err)
	}
	timing.TLSMS = time.Since(tlsStart).Milliseconds()

	// Check ALPN
	alpn := tlsConn.ConnectionState().NegotiatedProtocol

	if alpn == "h2" {
		// HTTP/2 path using fhttp — Chrome-like SETTINGS, header ordering, and window updates.
		// fhttp is a BSD-3 fork of Go's net/http with HTTP/2 fingerprint support.
		return doHTTP2fhttp(tlsConn, parsedURL, method, headers)
	}

	// HTTP/1.1 path over TLS
	return doHTTP1(tlsConn, parsedURL, method, headers)
}

// buildHTTPRequest creates an *http.Request with standard headers.
func buildHTTPRequest(method string, parsedURL *url.URL, headers map[string]string) (*http.Request, error) {
	req, err := http.NewRequest(method, parsedURL.String(), nil)
	if err != nil {
		return nil, err
	}

	// Set defaults (user headers can override)
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	if req.Header.Get("Connection") == "" {
		req.Header.Set("Connection", "keep-alive")
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return req, nil
}

// doHTTP1 performs an HTTP/1.1 request over the given connection.
func doHTTP1(conn net.Conn, parsedURL *url.URL, method string, headers map[string]string) (*http.Response, error) {
	defer conn.Close()

	req, err := buildHTTPRequest(method, parsedURL, headers)
	if err != nil {
		return nil, fmt.Errorf("failed to build request: %s", err)
	}

	// Write the request
	if err := req.Write(conn); err != nil {
		return nil, fmt.Errorf("failed to write request: %s", err)
	}

	// Read the response
	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, req)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %s", err)
	}

	// Buffer the body before the connection closes
	bodyBytes, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("failed to read body: %s", err)
	}
	resp.Body = io.NopCloser(bytes.NewReader(bodyBytes))

	return resp, nil
}

// decompressBody decompresses the response body based on Content-Encoding.
func decompressBody(resp *http.Response) ([]byte, error) {
	encoding := strings.ToLower(resp.Header.Get("Content-Encoding"))
	body := resp.Body

	switch encoding {
	case "gzip":
		gr, err := gzip.NewReader(body)
		if err != nil {
			return nil, err
		}
		defer gr.Close()
		return io.ReadAll(gr)
	case "deflate":
		dr := flate.NewReader(body)
		defer dr.Close()
		return io.ReadAll(dr)
	case "br":
		br := brotli.NewReader(body)
		return io.ReadAll(br)
	default:
		return io.ReadAll(body)
	}
}
