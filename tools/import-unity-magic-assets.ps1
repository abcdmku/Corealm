[CmdletBinding()]
param(
    [string] $UnityExe = 'C:\Program Files\Unity\Hub\Editor\6000.4.8f1\Editor\Unity.exe',
    [string] $WeaponPackage = 'C:\Users\Borg\AppData\Roaming\Unity\Asset Store-5.x\Blink\3D ModelsPropsWeapons\FREE - RPG Weapons.unitypackage',
    [string] $RockPackage = 'C:\Users\Borg\AppData\Roaming\Unity\Asset Store-5.x\DEXSOFT\3D ModelsPropsExterior\Rocks FREE pack.unitypackage',
    [string] $AltarPackage = 'C:\Users\Borg\AppData\Roaming\Unity\Asset Store-5.x\Underhill Labz\3D ModelsEnvironmentsFantasy\Altar Ruins Free.unitypackage',
    [string] $GltfFastPackagePath = '',
    [string] $OutputDirectory = '',
    [switch] $KeepTemporaryProject
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$defaultOutputDirectory = Join-Path $repoRoot 'game\public\assets\models\magic'
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = $defaultOutputDirectory }
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$defaultOutputDirectory = [System.IO.Path]::GetFullPath($defaultOutputDirectory)
$outputParent = Split-Path -Parent $OutputDirectory
$outputLeaf = Split-Path -Leaf $OutputDirectory
if ([string]::IsNullOrWhiteSpace($outputLeaf) -or
    $OutputDirectory -eq [System.IO.Path]::GetPathRoot($OutputDirectory) -or
    $OutputDirectory -eq [System.IO.Path]::GetFullPath($repoRoot)) {
    throw "Refusing to replace unsafe output directory: $OutputDirectory"
}
$publishesRepositoryManifest = [System.StringComparer]::OrdinalIgnoreCase.Equals(
    $OutputDirectory,
    $defaultOutputDirectory
)

$expectedPackages = @(
    @{
        Path = $WeaponPackage
        Hash = '22810F24F1D72CCBD3D1A091352E0E904A9A8A811235CF61A584750B83666717'
    },
    @{
        Path = $RockPackage
        Hash = 'A81E0968A134F1720B028A534634377784A84F72294A95590B8361A8D176F5D2'
    },
    @{
        Path = $AltarPackage
        Hash = 'FFFF7748CD1643D9A4F901E592836C7E09BACF3DB51B8C9BB7F704CF87D018D9'
    }
)

if (-not (Test-Path -LiteralPath $UnityExe -PathType Leaf)) {
    throw "Unity 6000.4.8f1 was not found at $UnityExe"
}

foreach ($package in $expectedPackages) {
    if (-not (Test-Path -LiteralPath $package.Path -PathType Leaf)) {
        throw "Unity package is missing: $($package.Path)"
    }
    $actualHash = (Get-FileHash -LiteralPath $package.Path -Algorithm SHA256).Hash
    if ($actualHash -ne $package.Hash) {
        throw "Package hash mismatch for $($package.Path). Expected $($package.Hash), found $actualHash"
    }
}

if ([string]::IsNullOrWhiteSpace($GltfFastPackagePath)) {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        $projectCache = Join-Path $env:USERPROFILE 'uni-test\Library\PackageCache'
        if (Test-Path -LiteralPath $projectCache -PathType Container) {
            $candidates += Get-ChildItem -LiteralPath $projectCache -Directory |
                Where-Object { $_.Name -like 'com.unity.cloud.gltfast@*' }
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $globalCache = Join-Path $env:LOCALAPPDATA 'Unity\cache\packages\packages.unity.com'
        if (Test-Path -LiteralPath $globalCache -PathType Container) {
            $candidates += Get-ChildItem -LiteralPath $globalCache -Directory |
                Where-Object { $_.Name -like 'com.unity.cloud.gltfast@*' }
        }
    }
    $GltfFastPackagePath = $candidates |
        Where-Object {
            $packageJson = Join-Path $_.FullName 'package.json'
            (Test-Path -LiteralPath $packageJson -PathType Leaf) -and
                ((Get-Content -Raw -LiteralPath $packageJson | ConvertFrom-Json).version -eq '6.14.1')
        } |
        Select-Object -ExpandProperty FullName -First 1
}

if ([string]::IsNullOrWhiteSpace($GltfFastPackagePath) -or
    -not (Test-Path -LiteralPath $GltfFastPackagePath -PathType Container)) {
    throw 'A local com.unity.cloud.gltfast 6.14.1 package could not be found. Pass -GltfFastPackagePath.'
}
$GltfFastPackagePath = [System.IO.Path]::GetFullPath($GltfFastPackagePath)

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('corealm-magic-assets-' + [Guid]::NewGuid().ToString('N'))
$projectPath = Join-Path $temporaryRoot 'UnityProject'
$logPath = Join-Path $temporaryRoot 'Logs'
$transactionId = [Guid]::NewGuid().ToString('N')
$stagedOutputDirectory = Join-Path $outputParent ('.' + $outputLeaf + '.stage-' + $transactionId)
$backupOutputDirectory = Join-Path $outputParent ('.' + $outputLeaf + '.backup-' + $transactionId)
$manifestPath = Join-Path $repoRoot 'game\public\assets\manifest.json'
$manifestStagePath = Join-Path (Split-Path -Parent $manifestPath) ('.manifest.stage-' + $transactionId + '.json')
$manifestBackupPath = Join-Path (Split-Path -Parent $manifestPath) ('.manifest.backup-' + $transactionId + '.json')
$completed = $false

function Invoke-Unity {
    param(
        [string[]] $Arguments,
        [string] $Step
    )
    $quotedArguments = $Arguments | ForEach-Object {
        if ($_ -match '[\s"]') {
            '"' + ($_.Replace('"', '\"')) + '"'
        }
        else {
            $_
        }
    }
    $process = Start-Process -FilePath $UnityExe -ArgumentList $quotedArguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) {
        throw "Unity failed during $Step with exit code $($process.ExitCode)"
    }
}

try {
    New-Item -ItemType Directory -Path $temporaryRoot, $logPath, $outputParent, $stagedOutputDirectory -Force | Out-Null
    Write-Host "Disposable Unity project: $projectPath"
    Write-Host "glTFast package: $GltfFastPackagePath"
    Write-Host "Staged output: $stagedOutputDirectory"

    Invoke-Unity -Step 'project creation' -Arguments @(
        '-batchmode',
        '-quit',
        '-createProject', $projectPath,
        '-logFile', (Join-Path $logPath 'create-project.log')
    )

    $unityManifestPath = Join-Path $projectPath 'Packages\manifest.json'
    $manifest = Get-Content -Raw -LiteralPath $unityManifestPath | ConvertFrom-Json
    $manifest.dependencies.PSObject.Properties.Remove('com.unity.cloud.gltfast')
    $packageUri = 'file:' + ($GltfFastPackagePath -replace '\\', '/')
    $manifest.dependencies | Add-Member -MemberType NoteProperty -Name 'com.unity.cloud.gltfast' -Value $packageUri
    $manifestJson = ($manifest | ConvertTo-Json -Depth 20) + [Environment]::NewLine
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($unityManifestPath, $manifestJson, $utf8WithoutBom)

    $editorDirectory = Join-Path $projectPath 'Assets\Editor'
    New-Item -ItemType Directory -Path $editorDirectory -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'import-unity-magic-assets.cs') -Destination $editorDirectory -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'import-unity-magic-assets.asmdef') -Destination $editorDirectory -Force

    Invoke-Unity -Step 'FREE - RPG Weapons import' -Arguments @(
        '-batchmode',
        '-quit',
        '-projectPath', $projectPath,
        '-importPackage', $WeaponPackage,
        '-logFile', (Join-Path $logPath 'import-weapons.log')
    )
    Invoke-Unity -Step 'Rocks FREE pack import' -Arguments @(
        '-batchmode',
        '-quit',
        '-projectPath', $projectPath,
        '-importPackage', $RockPackage,
        '-logFile', (Join-Path $logPath 'import-rocks.log')
    )
    Invoke-Unity -Step 'Altar Ruins Free import' -Arguments @(
        '-batchmode',
        '-quit',
        '-projectPath', $projectPath,
        '-importPackage', $AltarPackage,
        '-logFile', (Join-Path $logPath 'import-altar-ruins.log')
    )

    $env:COREALM_MAGIC_ASSET_OUTPUT = $stagedOutputDirectory
    try {
        Invoke-Unity -Step 'glTF export' -Arguments @(
            '-batchmode',
            '-projectPath', $projectPath,
            '-executeMethod', 'Corealm.EditorTools.CorealmMagicAssetExporter.Run',
            '-logFile', (Join-Path $logPath 'export.log')
        )
    }
    finally {
        Remove-Item Env:\COREALM_MAGIC_ASSET_OUTPUT -ErrorAction SilentlyContinue
    }

    Push-Location $repoRoot
    try {
        $validationArguments = @(
            'tsx',
            'tools/import-unity-magic-assets.ts',
            '--output', $stagedOutputDirectory
        )
        if ($publishesRepositoryManifest) {
            $validationArguments += @(
                '--write-manifest',
                '--manifest-input', $manifestPath,
                '--manifest-output', $manifestStagePath
            )
        }
        & npx.cmd @validationArguments
        if ($LASTEXITCODE -ne 0) {
            throw "GLB validation failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    $hadOriginalOutput = Test-Path -LiteralPath $OutputDirectory -PathType Container
    $hadOriginalManifest = $publishesRepositoryManifest -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)
    $outputPublished = $false
    $manifestPublished = $false
    try {
        if ($hadOriginalOutput) {
            Move-Item -LiteralPath $OutputDirectory -Destination $backupOutputDirectory
        }
        Move-Item -LiteralPath $stagedOutputDirectory -Destination $OutputDirectory
        $outputPublished = $true

        if ($publishesRepositoryManifest) {
            if ($hadOriginalManifest) {
                [System.IO.File]::Replace($manifestStagePath, $manifestPath, $manifestBackupPath, $true)
            }
            else {
                Move-Item -LiteralPath $manifestStagePath -Destination $manifestPath
            }
            $manifestPublished = $true
        }

        $completed = $true
    }
    catch {
        $publishError = $_
        if ($manifestPublished) {
            if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
                Remove-Item -LiteralPath $manifestPath -Force
            }
            if ($hadOriginalManifest -and (Test-Path -LiteralPath $manifestBackupPath -PathType Leaf)) {
                Move-Item -LiteralPath $manifestBackupPath -Destination $manifestPath
            }
        }
        if ($outputPublished -and (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
            Remove-Item -LiteralPath $OutputDirectory -Recurse -Force
        }
        if ($hadOriginalOutput -and (Test-Path -LiteralPath $backupOutputDirectory -PathType Container)) {
            Move-Item -LiteralPath $backupOutputDirectory -Destination $OutputDirectory
        }
        throw $publishError
    }

    foreach ($obsolete in @($backupOutputDirectory, $manifestBackupPath)) {
        if (Test-Path -LiteralPath $obsolete) {
            try { Remove-Item -LiteralPath $obsolete -Recurse -Force -ErrorAction Stop }
            catch { Write-Warning "Published assets are valid, but transaction backup remains at $obsolete" }
        }
    }
    Write-Host "Magic assets written to $OutputDirectory"
}
finally {
    foreach ($staged in @($stagedOutputDirectory, $manifestStagePath)) {
        if (Test-Path -LiteralPath $staged) {
            try { Remove-Item -LiteralPath $staged -Recurse -Force -ErrorAction Stop }
            catch { Write-Warning "Could not remove transaction staging path $staged. $($_.Exception.Message)" }
        }
    }
    if ($completed -and -not $KeepTemporaryProject) {
        $resolvedTemporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
        $expectedTempPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        $leaf = Split-Path -Leaf $resolvedTemporaryRoot
        if (-not $resolvedTemporaryRoot.StartsWith($expectedTempPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not $leaf.StartsWith('corealm-magic-assets-', [System.StringComparison]::Ordinal)) {
            throw "Refusing to remove unexpected temporary path: $resolvedTemporaryRoot"
        }
        try {
            Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force -ErrorAction Stop
        }
        catch {
            Write-Warning "Assets are complete, but Windows left part of the disposable Unity project at $resolvedTemporaryRoot. Remove that exact directory after Unity releases its package-cache files. $($_.Exception.Message)"
        }
    }
    elseif (-not $completed) {
        Write-Warning "Import failed. Unity logs were kept at $logPath"
    }
}
