package main

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/proxy"
)

// dialViaProxy dials through an HTTP CONNECT or SOCKS5 proxy.
// proxyURL format: "http://user:pass@host:port" or "socks5://user:pass@host:port"
// targetAddr format: "host:port"
func dialViaProxy(proxyURL, targetAddr string, timeout time.Duration) (net.Conn, error) {
	parsed, err := url.Parse(proxyURL)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy url: %s", err)
	}

	switch strings.ToLower(parsed.Scheme) {
	case "http", "https":
		return dialHTTPProxy(parsed, targetAddr, timeout)
	case "socks5", "socks5h":
		return dialSOCKS5Proxy(parsed, targetAddr, timeout)
	default:
		return nil, fmt.Errorf("unsupported proxy scheme: %s", parsed.Scheme)
	}
}

// dialHTTPProxy connects through an HTTP CONNECT proxy.
func dialHTTPProxy(proxyURL *url.URL, targetAddr string, timeout time.Duration) (net.Conn, error) {
	proxyHost := proxyURL.Host
	if proxyURL.Port() == "" {
		if proxyURL.Scheme == "https" {
			proxyHost = proxyURL.Hostname() + ":443"
		} else {
			proxyHost = proxyURL.Hostname() + ":80"
		}
	}

	// Connect to proxy
	conn, err := net.DialTimeout("tcp", proxyHost, timeout)
	if err != nil {
		return nil, fmt.Errorf("proxy connect failed: %s", err)
	}
	conn.SetDeadline(time.Now().Add(timeout))

	// Send CONNECT request
	req := &http.Request{
		Method: "CONNECT",
		URL:    &url.URL{Opaque: targetAddr},
		Host:   targetAddr,
		Header: make(http.Header),
	}
	req.Header.Set("Proxy-Connection", "Keep-Alive")

	// Add proxy auth if provided
	if proxyURL.User != nil {
		creds := proxyURL.User.String() // "user:pass"
		encoded := base64.StdEncoding.EncodeToString([]byte(creds))
		req.Header.Set("Proxy-Authorization", "Basic "+encoded)
	}

	// Write CONNECT request
	if err := req.Write(conn); err != nil {
		conn.Close()
		return nil, fmt.Errorf("proxy CONNECT write failed: %s", err)
	}

	// Read CONNECT response
	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, req)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("proxy CONNECT read failed: %s", err)
	}
	resp.Body.Close()

	if resp.StatusCode != 200 {
		conn.Close()
		return nil, fmt.Errorf("proxy CONNECT rejected: %s", resp.Status)
	}

	return conn, nil
}

// dialSOCKS5Proxy connects through a SOCKS5 proxy.
func dialSOCKS5Proxy(proxyURL *url.URL, targetAddr string, timeout time.Duration) (net.Conn, error) {
	var auth *proxy.Auth
	if proxyURL.User != nil {
		password, _ := proxyURL.User.Password()
		auth = &proxy.Auth{
			User:     proxyURL.User.Username(),
			Password: password,
		}
	}

	dialer, err := proxy.SOCKS5("tcp", proxyURL.Host, auth, &net.Dialer{
		Timeout: timeout,
	})
	if err != nil {
		return nil, fmt.Errorf("socks5 dialer creation failed: %s", err)
	}

	conn, err := dialer.Dial("tcp", targetAddr)
	if err != nil {
		return nil, fmt.Errorf("socks5 dial failed: %s", err)
	}

	return conn, nil
}
