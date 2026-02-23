#!/bin/bash
set -e

echo "=== SigmaGrid API Connectivity Test ==="
echo

# Test 1: DNS Resolution
echo "1. Testing DNS resolution for api.sigmagrid.app..."
if nslookup api.sigmagrid.app > /dev/null 2>&1; then
  echo "   ✓ DNS resolution successful"
else
  echo "   ✗ DNS resolution FAILED"
  exit 1
fi
echo

# Test 2: Basic connectivity (curl with verbose)
echo "2. Testing basic HTTP connectivity..."
if curl -I -s --connect-timeout 5 https://api.sigmagrid.app > /dev/null 2>&1; then
  echo "   ✓ HTTP connectivity successful"
else
  echo "   ✗ HTTP connectivity FAILED"
  exit 1
fi
echo

# Test 3: API authentication
echo "3. Testing API authentication..."
if [ -z "$SIGMAGRID_API_KEY" ]; then
  echo "   ✗ SIGMAGRID_API_KEY not set!"
  exit 1
fi
echo "   ✓ API key is set"
echo

# Test 4: Simple API call
echo "4. Testing API endpoint: /v1/signals/SPY..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $SIGMAGRID_API_KEY" \
  -H "Content-Type: application/json" \
  https://api.sigmagrid.app/v1/signals/SPY)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "   HTTP Status: $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
  echo "   ✓ API request successful"
  echo "   Response preview:"
  echo "$BODY" | head -c 200
  echo "..."
elif [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  echo "   ✗ Authentication failed (check API key)"
  echo "   Response: $BODY"
  exit 1
elif [ "$HTTP_CODE" = "503" ]; then
  echo "   ⚠ API returned 503 Service Unavailable (API is down)"
  exit 1
else
  echo "   ✗ Unexpected HTTP status"
  echo "   Response: $BODY"
  exit 1
fi
echo

echo "=== All tests passed ==="
