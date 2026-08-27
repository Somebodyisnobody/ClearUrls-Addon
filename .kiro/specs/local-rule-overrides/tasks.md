# Implementation Plan: Local Rule Overrides

## Overview

This plan implements a local rule override system for the ClearURLs browser addon. Users will be able to create, edit, and delete provider definitions stored in `browser.storage.local` that take priority over the remote ruleset. The implementation touches five areas: storage layer, provider build pipeline, CRUD editor UI, popup navigation, and internationalization across 22 locales.

All code is plain JavaScript (Manifest V2 browser extension). No test framework exists in this codebase; all tasks focus on production code only.

## Tasks

- [x] 1. Storage layer and provider build pipeline
  - [x] 1.1 Add `localRules` to storage initialization and data handling
    - In `core_js/storage.js`, add `storage.localRules = {};` as a default in `initSettings()` (before the loop that overwrites defaults with persisted values)
    - Add `case "localRules":` to the `setData()` switch so the value is JSON-parsed, alongside the existing `"ClearURLsData"` and `"log"` cases
    - Add `"localRules"` to the `storageDataAsString()` switch so it is JSON-stringified, alongside the existing `"ClearURLsData"` and `"log"` cases
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Implement `mergeProviders()` and modify provider build pipeline in `clearurls.js`
    - Add a new pure function `mergeProviders(remoteProviders, localRules)` at module scope (outside `start()`) that returns `Object.assign({}, remoteProviders, localRules)` with a guard for null/undefined/non-object `localRules`
    - Modify `createProviders()` inside `start()` to accept a `mergedProviders` parameter and read from `{ providers: mergedProviders }` instead of `storage.ClearURLsData` directly — this ensures `storage.ClearURLsData` is never mutated with merged data
    - Modify `toObject()` to create a local `merged` variable via `mergeProviders(storage.ClearURLsData.providers, storage.localRules)`, pass it to `getKeys(merged)` and `createProviders(merged)`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 1.3 Implement `reloadProviders()` in `clearurls.js`
    - Define `window.reloadProviders` inside `start()` (after `createProviders` and `Provider` are defined) so it has access to inner scope
    - The function clears `providers = []` and `prvKeys = []`, creates a local `merged` variable via `mergeProviders()`, calls `getKeys(merged)` then `createProviders(merged)`, and returns `"OK"`
    - Verify that the message handler can dispatch to it (no changes to `message_handler.js` needed since it already dispatches `window[fn]`)
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 2. Checkpoint - Verify storage and provider pipeline
  - Ensure the storage changes and provider build pipeline modifications are consistent. Ask the user if questions arise.

- [x] 3. Internationalization
  - [x] 3.1 Add new i18n message keys to `_locales/en/messages.json`
    - Add keys for the CRUD editor page: page title, provider list headings, add/edit/delete/save/cancel button labels, form field labels (Provider_Name, urlPattern, rules, rawRules, exceptions, redirections, referralMarketing, completeProvider, forceRedirection), form OK/Cancel button labels, validation error messages, and the popup tooltip for the local rules link
    - Follow the existing key naming pattern (e.g. `local_rules_page_title`, `local_rules_add_btn`, `popup_local_rules_title`, etc.) with `message` and `description` fields
    - _Requirements: 7.1, 7.3_

  - [x] 3.2 Add the same i18n message keys to all 21 non-English locale files
    - Add the identical keys and English fallback text to: `ar`, `de`, `es`, `fr`, `hu`, `id`, `it`, `ja`, `ko`, `nl`, `pl`, `pt_BR`, `pt_PT`, `ru`, `sl`, `sv_SE`, `th`, `tr`, `uk`, `zh_CN`, `zh_TW`
    - Each locale file gets the same set of new keys with English text as placeholder values
    - _Requirements: 7.2_

- [x] 4. CRUD Editor page
  - [x] 4.1 Create `html/localRules.html`
    - Follow the exact HTML structure of `cleaningTool.html`: same Bootstrap CSS, `core.css`, `switchButtons.css` includes, same navbar with ClearURLs logo and version badge
    - Content area: a provider list container (table or list group), an Add button, page-level Save and Cancel buttons
    - Provider form area (initially hidden): input fields for Provider_Name, urlPattern, rules, rawRules, exceptions, redirections, referralMarketing (text inputs), completeProvider and forceRedirection (checkboxes), form-level OK and Cancel buttons
    - Script references: `browser-polyfill.js`, `core_js/localRules.js`, `core_js/write_version.js`
    - All user-facing text uses i18n `id` attributes for population via `browser.i18n.getMessage()`
    - _Requirements: 4.1, 4.7_

  - [x] 4.2 Create `core_js/localRules.js` — state model and initialization
    - Declare state variables: `persistedRules = {}`, `stagedRules = {}`, `changeStatus = {}`
    - Implement `init()`: loads `localRules` from storage via `browser.runtime.sendMessage({ function: "getData", params: ["localRules"] })`, deep-clones into `persistedRules` and `stagedRules`, calls `renderList()`, and populates all i18n text via `browser.i18n.getMessage()`
    - Wire up the IIFE init chain following the pattern in `popup.js` and `cleaning_tool.js`
    - Include `translate()` and `handleError()` helper functions matching the existing addon pattern
    - _Requirements: 4.6_

  - [x] 4.3 Implement `renderList()`, `openAddForm()`, and `openEditForm()` in `core_js/localRules.js`
    - `renderList()`: clears and rebuilds the provider list from `stagedRules` + `changeStatus`. Apply CSS classes: green text for `"new"`, golden yellow text for `"edited"`, red text + strikethrough for `"deleted"`. Each entry shows Provider_Name and urlPattern, with edit and delete buttons
    - `openAddForm()`: shows the provider form with empty fields. On OK: validates via `validateForm()`, adds to `stagedRules`, sets `changeStatus[name] = "new"`, re-renders. On Cancel: closes form, no state change
    - `openEditForm(name)`: populates form with `stagedRules[name]`, stores a snapshot. On OK: validates, updates `stagedRules[name]`, sets `changeStatus[name] = "edited"` (or keeps `"new"` if already new), re-renders. On Cancel: restores snapshot, closes form
    - Comma-separated text inputs are split into arrays on OK; empty inputs become `[]`
    - _Requirements: 4.2, 4.3, 4.4, 4.6, 4.7_

  - [x] 4.4 Implement `markForDeletion()`, `save()`, `cancel()`, and `validateForm()` in `core_js/localRules.js`
    - `markForDeletion(name)`: sets `changeStatus[name] = "deleted"`, re-renders (does not remove from `stagedRules` until Save)
    - `save()`: removes entries marked `"deleted"` from `stagedRules`, sends `setData('localRules', JSON.stringify(stagedRules))`, then `saveOnExit()`, then `reloadProviders()` via `browser.runtime.sendMessage`. On success: copies `stagedRules` to `persistedRules`, clears `changeStatus`, re-renders. On failure: logs via `console.error`
    - `cancel()`: deep-clones `persistedRules` into `stagedRules`, clears `changeStatus`, re-renders
    - `validateForm(data)`: returns `{ valid, errors }`. Checks: Provider_Name non-empty (after trim), urlPattern non-empty and valid RegExp (try/catch around `new RegExp()`). Displays inline error messages next to offending fields on failure
    - _Requirements: 4.5, 5.1, 5.2, 5.3, 5.4, 8.1, 8.2, 8.3, 8.4_

- [x] 5. Checkpoint - Verify CRUD editor page
  - Ensure the CRUD editor page loads correctly, all form interactions work with staging semantics, and Save/Cancel operate as designed. Ask the user if questions arise.

- [x] 6. Popup navigation link
  - [x] 6.1 Add local rules link to `html/popup.html` and wire it in `core_js/popup.js`
    - In `html/popup.html`: add a new `<a id="local_rules" target="_blank">` element with a `<span class="fas fa-edit">` icon in the `references_section` div, between the existing cleaning tools and settings icons
    - In `core_js/popup.js` init chain: set `document.getElementById('local_rules').href = browser.runtime.getURL('./html/localRules.html');`
    - In `setText()`: add `document.getElementById('local_rules').title = translate('popup_local_rules_title');`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 7. Final checkpoint - Ensure all changes are integrated
  - Verify that the storage layer, provider pipeline, CRUD editor, popup link, and i18n strings are all wired together correctly. Ensure all requirements are covered. Ask the user if questions arise.

## Notes

- No test tasks are included. The codebase has no test framework, no `package.json`, and no test runner. The design document's testing strategy section is preserved for future use.
- All code is plain JavaScript following the existing addon conventions (no modules, no build step, global functions, `browser.runtime.sendMessage` for IPC).
- `storage.ClearURLsData` must NEVER be mutated with merged data — the merged providers object only exists as a local variable inside `toObject()` and `reloadProviders()`.
- The message handler (`core_js/message_handler.js`) requires no changes since it already dispatches any function name present on `window`.
- `manifest.json` should not need changes unless the new HTML page must be explicitly registered.
- Each task references specific requirements for traceability.
- Checkpoints ensure incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "3.2"] },
    { "id": 2, "tasks": ["1.3", "4.1"] },
    { "id": 3, "tasks": ["4.2"] },
    { "id": 4, "tasks": ["4.3"] },
    { "id": 5, "tasks": ["4.4"] },
    { "id": 6, "tasks": ["6.1"] }
  ]
}
```
