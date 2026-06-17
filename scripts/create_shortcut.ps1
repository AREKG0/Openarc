Add-Type -AssemblyName System.Drawing

# Get current script directory and project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Split-Path -Parent $ScriptDir

# Load the PNG from public/assets
$pngPath = Join-Path $ProjectRoot 'public\assets\logo.png'
$png = [System.Drawing.Image]::FromFile($pngPath)

# Resize to 256x256 (standard icon size)
$bitmap = New-Object System.Drawing.Bitmap(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.DrawImage($png, 0, 0, 256, 256)
$graphics.Dispose()
$png.Dispose()

# Save as ICO
$icoPath = Join-Path $ProjectRoot 'public\assets\logo_v3.ico'
$stream = [System.IO.File]::OpenWrite($icoPath)
$writer = New-Object System.IO.BinaryWriter($stream)

# ICO header
$writer.Write([byte]0)    # Reserved
$writer.Write([byte]0)    # Reserved
$writer.Write([int16]1)   # Type: ICO
$writer.Write([int16]1)   # Number of images

# Get PNG bytes
$pngStream = New-Object System.IO.MemoryStream
$bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()
$pngStream.Dispose()
$bitmap.Dispose()

# Icon directory entry
$writer.Write([byte]0)    # Width (0 = 256)
$writer.Write([byte]0)    # Height (0 = 256)
$writer.Write([byte]0)    # Color count
$writer.Write([byte]0)    # Reserved
$writer.Write([int16]1)   # Planes
$writer.Write([int16]32)  # Bit count
$writer.Write([int32]$pngBytes.Length)  # Size of image data
$writer.Write([int32]22)  # Offset of image data (6 header + 16 entry)

# Write PNG data
$writer.Write($pngBytes)
$writer.Close()
$stream.Close()

Write-Host "ICO created at $icoPath"

# Now update the shortcut with the icon
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $DesktopPath 'Openarc.lnk'
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)

# Update target to launch.bat inside scripts folder
$Shortcut.TargetPath = Join-Path $ScriptDir 'launch.bat'
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.WindowStyle = 7
$Shortcut.Description = 'Launch Openarc - Private Local AI'
$Shortcut.IconLocation = "$icoPath,0"
$Shortcut.Save()

Write-Host "Shortcut updated with Openarc logo!"
