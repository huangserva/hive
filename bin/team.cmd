@echo off
setlocal
set "BUILT_CLI=%~dp0..\src\cli\team.js"
set "TS_CLI=%~dp0..\src\cli\team.ts"
set "TSX_LOADER=%~dp0..\node_modules\tsx\dist\esm\index.mjs"
if exist "%BUILT_CLI%" (
  node --input-type=module -e "import { pathToFileURL } from 'node:url'; const cliPath = process.argv[1]; const shimPath = process.argv[2]; const args = process.argv.slice(3); process.argv = [process.argv[0], shimPath, ...args]; const { runTeamCommand } = await import(pathToFileURL(cliPath).href); try { await runTeamCommand(args); process.exit(0); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }" "%BUILT_CLI%" "%~f0" %*
  exit /b %ERRORLEVEL%
)

if exist "%TS_CLI%" (
  node --import "%TSX_LOADER%" --input-type=module -e "import { pathToFileURL } from 'node:url'; const cliPath = process.argv[1]; const shimPath = process.argv[2]; const args = process.argv.slice(3); process.argv = [process.argv[0], shimPath, ...args]; const { runTeamCommand } = await import(pathToFileURL(cliPath).href); try { await runTeamCommand(args); process.exit(0); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }" "%TS_CLI%" "%~f0" %*
  exit /b %ERRORLEVEL%
)

echo team CLI not found: %BUILT_CLI% or %TS_CLI% 1>&2
exit /b 1
