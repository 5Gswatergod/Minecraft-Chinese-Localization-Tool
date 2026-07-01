# Repository Guidelines

## Project Structure & Module Organization

This is an Electron + React + TypeScript desktop app for building Minecraft Chinese localization patches.

- `src/main/`: Electron main process, IPC handlers, and Node-side file work.
- `src/main/core/`: scanners, exporters, translation adapters, launcher detection, table import/export, and persistence.
- `src/preload/`: safe bridge exposed to the renderer through `window.mclocalizer`.
- `src/renderer/`: React UI, styles, and renderer-only declarations.
- `src/shared/`: shared TypeScript contracts used by main, preload, and renderer.
- Tests live beside implementation as `*.test.ts`, currently under `src/main/core/`.
- Build output goes to `dist/`; packaged Windows artifacts go to `release/`. Do not commit either.

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm run dev`: build main/preload, start Vite, then launch Electron.
- `npm start`: production-style local run after building.
- `npm run build`: compile Electron code and build renderer assets.
- `npm run typecheck`: run TypeScript checks for renderer and main configs.
- `npm test`: run Vitest tests.
- `npm run package`: create the Windows NSIS installer in `release/`.
- `npm run package:portable`: attempt a portable Windows build separately.

## Coding Style & Naming Conventions

Use TypeScript with strict types. Prefer named exports for core modules and explicit interfaces in `src/shared/types.ts`. Use 2-space indentation in JSON and existing TypeScript formatting style in source files. React components use PascalCase, hooks/state variables use camelCase, and test files use `module.test.ts`.

Keep main-process logic in `src/main/core/`; renderer code should call IPC through `window.mclocalizer` instead of importing Node APIs.

## Testing Guidelines

Use Vitest. Add focused unit tests beside new core modules, especially for parsers, scanners, exporters, and table exchange. Test with temporary directories rather than repository fixtures when possible. Before submitting changes, run:

```powershell
npm run typecheck
npm test
npm run build
```

## Commit & Pull Request Guidelines

There is no established commit history yet. Use concise imperative commit messages, for example `Add Patchouli scanner` or `Fix CSV import status handling`.

Pull requests should include a short summary, test results, linked issue if available, and screenshots or recordings for UI changes. Mention any generated artifacts intentionally omitted from git.

## Security & Configuration Tips

Do not commit API keys, local model endpoints with secrets, generated `.mclocalizer/` project data, `dist/`, or `release/`. Third-party tools must remain linked and credited in `README.md`; do not redistribute external mods or binaries without checking their licenses.
