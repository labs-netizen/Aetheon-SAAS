Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipPath = "codex review.zip"
Write-Host "Opening ZIP file: $zipPath"
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$entries = $zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') }

Write-Host "Total entries in zip: $($entries.Count)"
Write-Host "--- Checking Root Directory Structure ---"
$topLevel = $entries | ForEach-Object { $_.Split('/')[0] } | Select-Object -Unique
Write-Host "Top-level entries: $($topLevel -join ', ')"

Write-Host "`n--- Checking Required Files ---"
$reqs = @(
  "codex review/AGENTS.md",
  "codex review/README.md",
  "codex review/.env.example",
  "codex review/package.json",
  "codex review/tsconfig.json",
  "codex review/docs/PRODUCT_SPECIFICATION.md",
  "codex review/docs/context/README.md",
  "codex review/docs/context/CODEBASE_MAP.md",
  "codex review/docs/context/CURRENT_STATE.md",
  "codex review/docs/context/DATABASE_MAP.md",
  "codex review/docs/context/SECURITY_MAP.md",
  "codex review/docs/context/API_MAP.md",
  "codex review/docs/context/TEST_MAP.md",
  "codex review/docs/context/EXTERNAL_DEPENDENCIES.md",
  "codex review/docs/context/repository-graph.json",
  "codex review/services/analytics/main.py",
  "codex review/services/analytics/tests/test_analytics.py",
  "codex review/tests/e2e/demo_smoke.spec.ts",
  "codex review/tests/e2e/registration_journey.spec.ts",
  "codex review/tests/e2e/persistence_journey.spec.ts",
  "codex review/tests/e2e/real_auth_workflows.spec.ts"
)

$missingCount = 0
foreach ($r in $reqs) {
  $present = $entries -contains $r
  if (-not $present) { $missingCount++ }
  Write-Host "$r : $(if ($present) { 'PRESENT' } else { 'MISSING' })"
}

Write-Host "`n--- Checking Migrations ---"
$migrations = $entries | Where-Object { $_ -like "codex review/supabase/migrations/*.sql" }
Write-Host "Migration count: $($migrations.Count)"
foreach ($m in $migrations) {
  Write-Host "  $m"
}

Write-Host "`n--- Checking Context Modules ---"
$modules = $entries | Where-Object { $_ -like "codex review/docs/context/modules/*.md" }
Write-Host "Context module count: $($modules.Count)"
foreach ($mod in $modules) {
  Write-Host "  $mod"
}

Write-Host "`n--- Checking Forbidden Directories & Files ---"
$forbidden = $entries | Where-Object {
  $_ -match "node_modules|/\.next/|/\.git/|/\.kilo/|test-results|playwright-report|blob-report|__pycache__|\.pytest_cache|\.venv|venv" -or
  ($_ -match "\.env" -and $_ -notmatch "\.env\.example")
}
Write-Host "Forbidden items found: $($forbidden.Count)"
if ($forbidden.Count -gt 0) {
  $forbidden | ForEach-Object { Write-Host "  FORBIDDEN: $_" }
}

$zip.Dispose()

Write-Host "`n--- Scanning Extracted ZIP Files for Secrets ---"
$tempFolder = "temp_scan_review"
if (Test-Path $tempFolder) { Remove-Item -Recurse -Force $tempFolder }
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $tempFolder)

$secretPatterns = @(
    "rzp_live_[0-9a-zA-Z]{14}",
    "sk_live_[0-9a-zA-Z]{24}",
    "eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",
    "service_role.*eyJ",
    'SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*["'']?eyJ',
    "rzp_test_[0-9a-zA-Z]{14}",
    "internal-dev-secret-token"
)

$violations = @()
foreach ($pattern in $secretPatterns) {
    $matches = Get-ChildItem -Path $tempFolder -Recurse -File | Where-Object { $_.Name -ne "package_review.ps1" -and $_.Name -ne "verify_zip.ps1" } | Select-String -Pattern $pattern
    if ($matches) {
        $violations += "Pattern ($pattern) matched in: " + ($matches | Select-Object -ExpandProperty Path -Unique -Join ", ")
    }
}

Remove-Item -Recurse -Force $tempFolder

Write-Host "Secret scan violations: $($violations.Count)"
if ($violations.Count -gt 0) {
    $violations | ForEach-Object { Write-Host "  VIOLATION: $_" }
}

Write-Host "`nVerification complete. Missing required: $missingCount, Forbidden paths: $($forbidden.Count), Secret violations: $($violations.Count)"
