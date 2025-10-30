@echo off
:: Script para crear .env.local con claves de Supabase
setlocal enabledelayedexpansion

set "ENV_FILE=.env.local"

echo 🔑 Configuración de Supabase para Rigscan
set /p SUPABASE_URL=👉 Introduce tu SUPABASE_URL: 
set /p SUPABASE_KEY=👉 Introduce tu SUPABASE_ANON_KEY: 

(
    echo NEXT_PUBLIC_SUPABASE_URL=%SUPABASE_URL%
    echo NEXT_PUBLIC_SUPABASE_ANON_KEY=%SUPABASE_KEY%
) > "%ENV_FILE%"

echo.
echo ✅ Archivo "%ENV_FILE%" creado correctamente con tus claves de Supabase.
echo Puedes abrirlo con un editor de texto para comprobarlo.
pause
