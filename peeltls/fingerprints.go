package main

import (
	"fmt"
	"strconv"
	"strings"

	tls "github.com/refraction-networking/utls"
)

// FingerprintSpec holds either a preset ID or a custom spec (for JA3 strings).
type FingerprintSpec struct {
	ID         tls.ClientHelloID
	CustomSpec *tls.ClientHelloSpec
}

// presets maps friendly names to uTLS ClientHelloIDs.
var presets = map[string]tls.ClientHelloID{
	"chrome-133":  tls.HelloChrome_133,
	"chrome-131":  tls.HelloChrome_131,
	"chrome-120":  tls.HelloChrome_120,
	"firefox-120": tls.HelloFirefox_120,
	"safari-16":   tls.HelloSafari_16_0,
	"edge-106":    tls.HelloEdge_106,
	"random":      tls.HelloRandomized,
	"chrome-auto": tls.HelloChrome_Auto,
}

// resolveFingerprint returns the FingerprintSpec for the given fingerprint name.
// If not found in presets, treats it as a JA3 string and parses it.
// Falls back to Chrome 133 on error.
func resolveFingerprint(fp string) FingerprintSpec {
	if fp == "" {
		return FingerprintSpec{ID: tls.HelloChrome_133}
	}

	// Check presets first
	if id, ok := presets[strings.ToLower(fp)]; ok {
		return FingerprintSpec{ID: id}
	}

	// Try JA3 string parse
	if isJA3String(fp) {
		spec, err := parseJA3(fp)
		if err == nil {
			return FingerprintSpec{ID: tls.HelloCustom, CustomSpec: spec}
		}
	}

	// Default
	return FingerprintSpec{ID: tls.HelloChrome_133}
}

// isJA3String checks if a string looks like a JA3 fingerprint.
// Format: "version,ciphers,extensions,groups,pointFormats"
func isJA3String(s string) bool {
	parts := strings.Split(s, ",")
	if len(parts) < 3 {
		return false
	}
	// First part should be a version number like "771"
	_, err := strconv.ParseUint(parts[0], 10, 16)
	return err == nil
}

// parseJA3 parses a JA3 string into a ClientHelloSpec.
// JA3 format: "SSLVersion,Ciphers,Extensions,EllipticCurves,EllipticCurvePointFormats"
func parseJA3(ja3 string) (*tls.ClientHelloSpec, error) {
	parts := strings.Split(ja3, ",")
	if len(parts) < 3 {
		return nil, fmt.Errorf("invalid JA3 string: expected at least 3 parts, got %d", len(parts))
	}

	// Parse TLS version
	tlsVersionRaw, err := strconv.ParseUint(parts[0], 10, 16)
	if err != nil {
		return nil, fmt.Errorf("invalid TLS version: %s", parts[0])
	}
	tlsVersion := uint16(tlsVersionRaw)

	// Parse cipher suites
	ciphers, err := parseUint16List(parts[1])
	if err != nil {
		return nil, fmt.Errorf("invalid ciphers: %s", err)
	}

	// Parse extension IDs
	extIDs, err := parseUint16List(parts[2])
	if err != nil {
		return nil, fmt.Errorf("invalid extensions: %s", err)
	}

	// Parse elliptic curves (groups) — optional
	var groups []tls.CurveID
	if len(parts) > 3 && parts[3] != "" {
		groupInts, err := parseUint16List(parts[3])
		if err == nil {
			for _, g := range groupInts {
				groups = append(groups, tls.CurveID(g))
			}
		}
	}

	// Parse point formats — optional
	var pointFormats []uint8
	if len(parts) > 4 && parts[4] != "" {
		pfInts, err := parseUint16List(parts[4])
		if err == nil {
			for _, pf := range pfInts {
				pointFormats = append(pointFormats, uint8(pf))
			}
		}
	}

	// Determine TLS version range
	tlsVersMax := tlsVersion
	if tlsVersMax < tls.VersionTLS12 {
		tlsVersMax = tls.VersionTLS12
	}

	spec := &tls.ClientHelloSpec{
		TLSVersMin:         tls.VersionTLS10,
		TLSVersMax:         tlsVersMax,
		CipherSuites:       ciphers,
		CompressionMethods: []uint8{0}, // no compression
	}

	// Build extensions list
	spec.Extensions = buildExtensions(extIDs, groups, pointFormats)

	return spec, nil
}

// buildExtensions constructs a list of TLS extensions from JA3 extension IDs.
func buildExtensions(extIDs []uint16, groups []tls.CurveID, pointFormats []uint8) []tls.TLSExtension {
	var exts []tls.TLSExtension

	for _, id := range extIDs {
		switch id {
		case 0: // SNI
			exts = append(exts, &tls.SNIExtension{})
		case 5: // Status Request
			exts = append(exts, &tls.StatusRequestExtension{})
		case 10: // Supported Groups
			if len(groups) > 0 {
				exts = append(exts, &tls.SupportedCurvesExtension{Curves: groups})
			} else {
				exts = append(exts, &tls.SupportedCurvesExtension{Curves: []tls.CurveID{
					tls.X25519, tls.CurveP256, tls.CurveP384,
				}})
			}
		case 11: // EC Point Formats
			if len(pointFormats) > 0 {
				exts = append(exts, &tls.SupportedPointsExtension{SupportedPoints: pointFormats})
			} else {
				exts = append(exts, &tls.SupportedPointsExtension{SupportedPoints: []uint8{0}})
			}
		case 13: // Signature Algorithms
			exts = append(exts, &tls.SignatureAlgorithmsExtension{
				SupportedSignatureAlgorithms: []tls.SignatureScheme{
					tls.ECDSAWithP256AndSHA256,
					tls.PSSWithSHA256,
					tls.PKCS1WithSHA256,
					tls.ECDSAWithP384AndSHA384,
					tls.PSSWithSHA384,
					tls.PKCS1WithSHA384,
					tls.PSSWithSHA512,
					tls.PKCS1WithSHA512,
				},
			})
		case 16: // ALPN
			exts = append(exts, &tls.ALPNExtension{
				AlpnProtocols: []string{"h2", "http/1.1"},
			})
		case 18: // SCT
			exts = append(exts, &tls.SCTExtension{})
		case 21: // Padding
			exts = append(exts, &tls.UtlsPaddingExtension{GetPaddingLen: tls.BoringPaddingStyle})
		case 23: // Extended Master Secret
			exts = append(exts, &tls.ExtendedMasterSecretExtension{})
		case 27: // Compress Certificate
			exts = append(exts, &tls.UtlsCompressCertExtension{
				Algorithms: []tls.CertCompressionAlgo{tls.CertCompressionBrotli},
			})
		case 35: // Session Ticket
			exts = append(exts, &tls.SessionTicketExtension{})
		case 43: // Supported Versions
			exts = append(exts, &tls.SupportedVersionsExtension{
				Versions: []uint16{tls.VersionTLS13, tls.VersionTLS12},
			})
		case 45: // PSK Key Exchange Modes
			exts = append(exts, &tls.PSKKeyExchangeModesExtension{
				Modes: []uint8{tls.PskModeDHE},
			})
		case 51: // Key Share
			exts = append(exts, &tls.KeyShareExtension{
				KeyShares: []tls.KeyShare{
					{Group: tls.X25519},
				},
			})
		case 65281: // Renegotiation Info
			exts = append(exts, &tls.RenegotiationInfoExtension{
				Renegotiation: tls.RenegotiateOnceAsClient,
			})
		default:
			// Unknown extension — use generic (empty)
			exts = append(exts, &tls.GenericExtension{Id: id})
		}
	}
	return exts
}

// parseUint16List parses a "-" separated list of uint16 values.
func parseUint16List(s string) ([]uint16, error) {
	if s == "" {
		return nil, nil
	}
	parts := strings.Split(s, "-")
	result := make([]uint16, 0, len(parts))
	for _, p := range parts {
		n, err := strconv.ParseUint(p, 10, 16)
		if err != nil {
			return nil, fmt.Errorf("invalid value %q: %s", p, err)
		}
		result = append(result, uint16(n))
	}
	return result, nil
}
