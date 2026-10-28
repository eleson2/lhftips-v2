@echo off
rem ---------------------------------------------------------------------------
rem  fetch-guesses.bat - pull down all new guesses, parse them, import them.
rem
rem  Run it any time - before or after the game, or once after missing several
rem  games. Guesses posted after their game's start time are rejected at
rem  import, so running it late is safe. Then run score.bat.
rem
rem  Usage:
rem    fetch-guesses.bat        scrape, warn about unparsed posts, import
rem    fetch-guesses.bat -r     same, but open the review UI when there is something
rem                       to fix (close it with Ctrl+C to continue the import)
rem
rem  Scraping resumes from the saved cursor (cursor show / cursor set), so
rem  running this twice is harmless - the second run finds nothing new.
rem
rem  Then run score.bat to score and produce the standings.
rem ---------------------------------------------------------------------------
setlocal
pushd "%~dp0"

set "CSV=guesses.csv"

set "REVIEW=0"
if /i "%~1"=="-r" set "REVIEW=1"
if /i "%~1"=="/r" set "REVIEW=1"
if /i "%~1"=="--review" set "REVIEW=1"

echo === 1/3  Scraping new forum posts ===
echo.
node "%~dp0src\index.js" scrape guesses -o "%CSV%"
if errorlevel 1 goto :fail

call :count_unparsed
echo.
if %UNPARSED% EQU 0 goto :parsed_clean
if "%REVIEW%"=="1" goto :parsed_review
goto :parsed_warn

:parsed_clean
echo === 2/3  Nothing to review - every post parsed ===
goto :import

:parsed_review
echo === 2/3  %UNPARSED% post/posts need a human eye ===
echo Opening the review UI. Fix or dismiss the cards, then press Ctrl+C.
echo.
node "%~dp0src\index.js" review -f "%CSV%"
call :count_unparsed
echo.
if %UNPARSED% EQU 0 goto :import
echo %UNPARSED% line/lines are still unparsed and will NOT be imported.
goto :import

:parsed_warn
echo === 2/3  %UNPARSED% post/posts need a human eye ===
echo Those lines start with # in %CSV% and will NOT be imported.
echo   To fix them:  node src\index.js review -f %CSV%
echo   Or re-run:    fetch-guesses.bat -r
echo.
echo Importing the parsed guesses anyway.
goto :import

:import
echo.
echo === 3/3  Importing into the database ===
echo.
node "%~dp0src\index.js" import guesses "%CSV%"
if errorlevel 1 goto :fail

echo.
echo Done. Run score.bat to score and produce the standings.
popd
endlocal
exit /b 0

rem --- Count the "#" lines still awaiting review. ------------------------------
rem Handled lines are re-marked "#[fixed]" / "#[dismissed]" and are not counted.
:count_unparsed
set "UNPARSED=0"
if not exist "%CSV%" goto :eof
for /f %%n in ('findstr /b /r /c:"#[^[]" "%CSV%" ^| find /c /v ""') do set "UNPARSED=%%n"
goto :eof

:fail
echo.
echo *** Step failed - stopping. Later steps were not run.
popd
endlocal
exit /b 1
