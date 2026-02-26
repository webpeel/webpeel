#!/usr/bin/env bash
# WebPeel — Extract Examples (curl)
#
# Extract structured data from any webpage using JSON Schema.
#
# Setup:
#   export WEBPEEL_API_KEY=wp_your_key_here

BASE="https://api.webpeel.dev/v1"
KEY="${WEBPEEL_API_KEY:?Set WEBPEEL_API_KEY first}"

echo "=== WebPeel Extract Examples ==="
echo ""

# ─────────────────────────────────────────────────────────
# 1. Extract pricing plans from a SaaS page
# ─────────────────────────────────────────────────────────
echo "--- 1. Extract Pricing Plans ---"
curl -s -X POST "$BASE/extract" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://stripe.com/pricing",
    "schema": {
      "type": "object",
      "properties": {
        "plans": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name":     { "type": "string" },
              "price":    { "type": "string" },
              "features": { "type": "array", "items": { "type": "string" } }
            }
          }
        }
      }
    }
  }' | jq '.data'

echo ""

# ─────────────────────────────────────────────────────────
# 2. Extract contact information
# ─────────────────────────────────────────────────────────
echo "--- 2. Extract Contact Info ---"
curl -s -X POST "$BASE/extract" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example-company.com/about",
    "schema": {
      "type": "object",
      "properties": {
        "company":  { "type": "string" },
        "email":    { "type": "string" },
        "phone":    { "type": "string" },
        "address":  { "type": "string" },
        "founders": { "type": "array", "items": { "type": "string" } }
      }
    }
  }' | jq '.data'

echo ""

# ─────────────────────────────────────────────────────────
# 3. Extract job listings
# ─────────────────────────────────────────────────────────
echo "--- 3. Extract Job Listings ---"
curl -s -X POST "$BASE/extract" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://stripe.com/jobs",
    "schema": {
      "type": "object",
      "properties": {
        "jobs": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "title":       { "type": "string" },
              "department":  { "type": "string" },
              "location":    { "type": "string" },
              "type":        { "type": "string", "description": "Full-time, Part-time, Contract" }
            }
          }
        }
      }
    }
  }' | jq '.data.jobs[0:5]'

echo ""
echo "Done!"
