$target = "codex review"

Write-Host "Cleaning existing staging folder and zip..."
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
if (Test-Path "codex review.zip") { Remove-Item -Force "codex review.zip" }

New-Item -ItemType Directory -Path $target | Out-Null

Write-Host "Copying included directories..."
Copy-Item -Recurse -Path "src" -Destination "$target\src"
Copy-Item -Recurse -Path "services" -Destination "$target\services"
Copy-Item -Recurse -Path "supabase" -Destination "$target\supabase"
Copy-Item -Recurse -Path "tests" -Destination "$target\tests"
Copy-Item -Recurse -Path "docs" -Destination "$target\docs"
Copy-Item -Recurse -Path ".github" -Destination "$target\.github"
Copy-Item -Recurse -Path "demo-data" -Destination "$target\demo-data"

Write-Host "Copying root config files..."
Copy-Item "package.json" -Destination "$target\"
Copy-Item "package-lock.json" -Destination "$target\"
Copy-Item "tsconfig.json" -Destination "$target\"
Copy-Item "vitest.config.ts" -Destination "$target\"
Copy-Item "playwright.config.ts" -Destination "$target\"
Copy-Item ".env.example" -Destination "$target\"
Copy-Item "README.md" -Destination "$target\"

Write-Host "Enforcing strict exclusions..."
# Purge excluded directories
$excludedDirs = @("node_modules", ".next", ".git", "test-results", "playwright-report", "__pycache__", ".pytest_cache", ".temp", ".branches")
Get-ChildItem -Path $target -Recurse -Directory -Force | Where-Object { $excludedDirs -contains $_.Name } | Remove-Item -Recurse -Force

# Purge any secret-bearing or local env files (preserving ONLY .env.example)
Get-ChildItem -Path $target -Recurse -File -Force | Where-Object { ($_.Name -like "*.env*" -or $_.Name -like ".env*") -and $_.Name -ne ".env.example" } | Remove-Item -Force

Write-Host "Compressing codex review.zip..."
Compress-Archive -Path "$target\*" -DestinationPath "codex review.zip" -CompressionLevel Optimal

Write-Host "ZIP package completed successfully."
Get-Item "codex review.zip" | Select-Object Name, Length, LastWriteTime
