$ErrorActionPreference = "Stop"
$target = "codex review"
$zipFile = "codex review.zip"

Write-Host "=== Step 1: Cleaning previous staging folder and zip ==="
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
if (Test-Path $zipFile) { Remove-Item -Force $zipFile }

New-Item -ItemType Directory -Path $target | Out-Null

Write-Host "=== Step 2: Copying required directories ==="
# Core source code and microservices
Copy-Item -Recurse -Path "src" -Destination "$target\src"
Copy-Item -Recurse -Path "services" -Destination "$target\services"

# Supabase: only canonical schema, config, and seed files
New-Item -ItemType Directory -Path "$target\supabase" | Out-Null
if (Test-Path "supabase\config.toml") { Copy-Item "supabase\config.toml" -Destination "$target\supabase\" }
if (Test-Path "supabase\migrations") { Copy-Item -Recurse "supabase\migrations" -Destination "$target\supabase\migrations" }
if (Test-Path "supabase\seed.sql") { Copy-Item "supabase\seed.sql" -Destination "$target\supabase\" }

# Tests, scripts, docs, demo-data, public, .github
Copy-Item -Recurse -Path "tests" -Destination "$target\tests"
Copy-Item -Recurse -Path "scripts" -Destination "$target\scripts"
Copy-Item -Recurse -Path "docs" -Destination "$target\docs"
Copy-Item -Recurse -Path "demo-data" -Destination "$target\demo-data"
if (Test-Path "public") { Copy-Item -Recurse -Path "public" -Destination "$target\public" }
Copy-Item -Recurse -Path ".github" -Destination "$target\.github"

Write-Host "=== Step 3: Copying root configuration files ==="
$rootFiles = @(
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tailwind.config.ts",
    "postcss.config.js",
    "vitest.config.ts",
    "playwright.config.ts",
    ".eslintrc.json",
    ".eslintignore",
    ".gitignore",
    ".env.example",
    "README.md"
)

foreach ($f in $rootFiles) {
    if (Test-Path $f) {
        Copy-Item $f -Destination "$target\"
    }
}

# Copy any next.config.* or docker config if present in root
Get-ChildItem -Path "." -Filter "next.config.*" | ForEach-Object { Copy-Item $_.FullName -Destination "$target\" }
Get-ChildItem -Path "." -Filter "*docker*" | ForEach-Object { Copy-Item $_.FullName -Destination "$target\" }

Write-Host "=== Step 4: Enforcing strict exclusions and cleanup ==="
$excludedDirNames = @(
    "node_modules", ".next", ".git", "coverage", "dist", "build",
    ".cache", ".turbo", ".temp", ".branches", "test-results",
    "playwright-report", "blob-report", "__pycache__", ".pytest_cache",
    ".venv", "venv", "start-secrets"
)

Get-ChildItem -Path $target -Recurse -Directory -Force | Where-Object {
    $excludedDirNames -contains $_.Name
} | Remove-Item -Recurse -Force

# Purge any secret-bearing env files (preserving ONLY .env.example)
Get-ChildItem -Path $target -Recurse -File -Force | Where-Object {
    ($_.Name -like "*.env*" -or $_.Name -like ".env*") -and $_.Name -ne ".env.example"
} | Remove-Item -Force

# Purge compiled python files and cache artifacts
Get-ChildItem -Path $target -Recurse -File -Force | Where-Object {
    $_.Extension -in @(".pyc", ".pyo") -or $_.Name -like "*tsconfig.tsbuildinfo*"
} | Remove-Item -Force

# Remove any generated test screenshots/videos from test folders
Get-ChildItem -Path "$target\tests" -Recurse -File -Force | Where-Object {
    $_.Extension -in @(".png", ".jpg", ".jpeg", ".webm", ".webp", ".mp4")
} | Remove-Item -Force

Write-Host "=== Step 5: Scanning review folder for forbidden patterns and secrets ==="
$violations = @()

# Check directories
$foundDirs = Get-ChildItem -Path $target -Recurse -Directory -Force | Where-Object {
    $excludedDirNames -contains $_.Name
}
if ($foundDirs) {
    $violations += "Forbidden directories found: " + ($foundDirs | Select-Object -ExpandProperty FullName -Join ", ")
}

# Check forbidden env files
$foundEnv = Get-ChildItem -Path $target -Recurse -File -Force | Where-Object {
    ($_.Name -like "*.env*" -or $_.Name -like ".env*") -and $_.Name -ne ".env.example"
}
if ($foundEnv) {
    $violations += "Forbidden env files found: " + ($foundEnv | Select-Object -ExpandProperty FullName -Join ", ")
}

# Check for live secret patterns in files (e.g., live razorpay keys, production service role keys)
$secretPatterns = @(
    "rzp_live_[0-9a-zA-Z]{14}",
    "sk_live_[0-9a-zA-Z]{24}"
)

foreach ($pattern in $secretPatterns) {
    $matches = Get-ChildItem -Path $target -Recurse -File | Select-String -Pattern $pattern
    if ($matches) {
        $violations += "Potential live secret pattern ($pattern) matched in files!"
    }
}

if ($violations.Count -gt 0) {
    Write-Error "Pre-packaging scan FAILED with violations:`n$($violations -join "`n")"
    exit 1
} else {
    Write-Host "Pre-packaging scan PASSED: 0 forbidden directories, 0 secret env files, 0 live secrets found."
}

Write-Host "=== Step 6: Creating codex review.zip ==="
Compress-Archive -Path "$target\*" -DestinationPath $zipFile -CompressionLevel Optimal

Write-Host "=== Step 7: Cleaning up temporary staging directory ==="
Remove-Item -Recurse -Force $target

Write-Host "=== Done! Review archive successfully created ==="
Get-Item $zipFile | Select-Object Name, Length, LastWriteTime
