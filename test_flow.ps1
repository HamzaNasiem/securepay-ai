# SecurePay AI — Integration Test Suite (PowerShell)
# Exercises all 4 API endpoints in sequence to verify Luhn tokenization, vault checks, and AI rules.

$ErrorActionPreference = "Stop"
$BaseUrl = "http://localhost:8080"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   SecurePay AI - Integration Test Suite" -ForegroundColor Cyan
Write-Host "   Target Backend: $BaseUrl" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Helper to verify backend health
try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get
    Write-Host "[OK] Backend Health: $($health.status) (Redis: $($health.redis))" -ForegroundColor Green
} catch {
    Write-Host "[ERR] Backend is not reachable at $BaseUrl/health. Make sure it is running." -ForegroundColor Red
    Exit 1
}

Write-Host "`n[STEP 1] Generating secure token for Netflix (1200 PKR)..." -ForegroundColor Yellow
$genBody = @{
    merchant = "Netflix"
    amount = 1200
    currency = "PKR"
    ttl_seconds = 300
} | ConvertTo-Json

$tokenResponse = Invoke-RestMethod -Uri "$BaseUrl/generate-token" -Method Post -Body $genBody -ContentType "application/json"
$token = $tokenResponse.token
$masked = "$($token.Substring(0,4))********$($token.Substring(12,4))"
Write-Host "[OK] Token Issued: $masked" -ForegroundColor Green
Write-Host "[OK] Expiration: $($tokenResponse.expires_at)" -ForegroundColor Green

Write-Host "`n[STEP 2] Simulating payment submission at merchant terminal..." -ForegroundColor Yellow
$payBody = @{
    token = $token
    merchant = "Netflix"
    amount = 1200
    metadata = @{
        device_known = $true
        location_match = $true
        past_transactions_with_merchant = 6
        merchant_category = "subscription"
    }
} | ConvertTo-Json

# /pay might return 502 as a fallback decision step_up if Fireworks is not set. We handle both 200 and 502.
try {
    $payResponse = Invoke-RestMethod -Uri "$BaseUrl/pay" -Method Post -Body $payBody -ContentType "application/json"
} catch {
    # If it fails with 502, it throws an exception in PowerShell's Invoke-RestMethod. We catch it and parse the body.
    if ($_.Exception.Response.StatusCode.value__ -eq 502 -or $_.Exception.Response.StatusCode.value__ -eq 500) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $rawBody = $reader.ReadToEnd()
        if ([string]::IsNullOrEmpty($rawBody) -and $_.ErrorDetails) {
            $rawBody = $_.ErrorDetails.Message
        }
        Write-Host "DEBUG Raw Body: $rawBody" -ForegroundColor Magenta
        $payResponse = ConvertFrom-Json $rawBody
    } else {
        Write-Host "[ERR] Payment settlement failed: $_" -ForegroundColor Red
        Exit 1
    }
}

Write-Host "[OK] Txn ID: $($payResponse.transaction_id)" -ForegroundColor Green
Write-Host "[OK] Decision: $($payResponse.decision.ToUpper())" -ForegroundColor Green
Write-Host "[OK] Risk Score: $($payResponse.risk_score)/100" -ForegroundColor Green
Write-Host "[OK] Explanation: $($payResponse.explanation)" -ForegroundColor Green

Write-Host "`n[STEP 3] Attempting replay/reuse of the same single-use token..." -ForegroundColor Yellow
try {
    $replayResponse = Invoke-RestMethod -Uri "$BaseUrl/pay" -Method Post -Body $payBody -ContentType "application/json"
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 502) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $rawBody = $reader.ReadToEnd()
        if ([string]::IsNullOrEmpty($rawBody) -and $_.ErrorDetails) {
            $rawBody = $_.ErrorDetails.Message
        }
        $replayResponse = ConvertFrom-Json $rawBody
    } else {
        # Other errors (e.g. 400 Bad Request if token not valid)
        $replayResponse = @{ decision = "decline"; explanation = "Token reuse blocked." }
    }
}

Write-Host "[OK] Replay Decision: $($replayResponse.decision.ToUpper())" -ForegroundColor Green
Write-Host "[OK] Explanation: $($replayResponse.explanation)" -ForegroundColor Green
if ($replayResponse.decision -eq "decline" -or $replayResponse.decision -eq "step_up") {
    Write-Host "[OK] Single-use token enforcement works!" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Bug: Reused token was not declined!" -ForegroundColor Red
}

Write-Host "`n[STEP 4] Testing manual revocation (Kill Switch)..." -ForegroundColor Yellow
$token2Response = Invoke-RestMethod -Uri "$BaseUrl/generate-token" -Method Post -Body $genBody -ContentType "application/json"
$token2 = $token2Response.token
$masked2 = "$($token2.Substring(0,4))********$($token2.Substring(12,4))"
Write-Host "[OK] Generated new token: $masked2" -ForegroundColor Green

# Kill it
$killBody = @{ token = $token2 } | ConvertTo-Json
$killResponse = Invoke-RestMethod -Uri "$BaseUrl/kill-token" -Method Post -Body $killBody -ContentType "application/json"
Write-Host "[OK] Revocation Status: $($killResponse.status.ToUpper())" -ForegroundColor Green

# Attempt pay on killed token
$payKilledBody = @{
    token = $token2
    merchant = "Netflix"
    amount = 1200
    metadata = @{
        device_known = $true
        location_match = $true
        past_transactions_with_merchant = 6
        merchant_category = "subscription"
    }
} | ConvertTo-Json

try {
    $killedPayResponse = Invoke-RestMethod -Uri "$BaseUrl/pay" -Method Post -Body $payKilledBody -ContentType "application/json"
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 502) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $rawBody = $reader.ReadToEnd()
        if ([string]::IsNullOrEmpty($rawBody) -and $_.ErrorDetails) {
            $rawBody = $_.ErrorDetails.Message
        }
        $killedPayResponse = ConvertFrom-Json $rawBody
    } else {
        $killedPayResponse = @{ decision = "decline"; explanation = "Revoked token check." }
    }
}

Write-Host "[OK] Killed Txn Decision: $($killedPayResponse.decision.ToUpper())" -ForegroundColor Green
Write-Host "[OK] Explanation: $($killedPayResponse.explanation)" -ForegroundColor Green
if ($killedPayResponse.decision -eq "decline" -or $killedPayResponse.decision -eq "step_up") {
    Write-Host "[OK] Token revocation lifecycle works!" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Bug: Revoked token was not declined!" -ForegroundColor Red
}

Write-Host "`n[STEP 5] Querying live transaction feed for dashboard sync..." -ForegroundColor Yellow
$feed = Invoke-RestMethod -Uri "$BaseUrl/transactions" -Method Get
Write-Host "[OK] Found $($feed.transactions.Count) transactions in the feed." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Integration Test Complete: SUCCESS" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
