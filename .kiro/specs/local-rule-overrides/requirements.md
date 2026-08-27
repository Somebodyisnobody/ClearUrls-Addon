# Requirements Document

## Introduction

The ClearURLs browser addon removes tracking query parameters from URLs using a remote ruleset fetched from `rules2.clearurls.xyz/data.minify.json`. Because the upstream maintainer is inactive and does not merge community rule changes, some websites (notably login flows) break due to overly aggressive or missing rules. This feature adds a local rule override system that lets users create, edit, and delete provider definitions stored in `browser.storage.local`. Local rules take priority over remote rules, giving users full control without waiting on upstream changes.

## Glossary

- **Addon**: The ClearURLs browser extension running under Manifest V2.
- **Remote_Ruleset**: The JSON object fetched from `rules2.clearurls.xyz/data.minify.json` and stored in `storage.ClearURLsData`. Contains a `providers` object keyed by provider name.
- **Local_Rules**: A JSON object persisted in `browser.storage.local` under the key `localRules`. Has the same shape as `ClearURLsData.providers` (an object keyed by provider name, each value containing provider fields).
- **Provider**: An in-memory object created by `createProviders()` in `clearurls.js` from a provider definition. Each provider has: `urlPattern`, `rules`, `rawRules`, `referralMarketing`, `exceptions`, `redirections`, `completeProvider`, `forceRedirection`.
- **Provider_Name**: A unique string key identifying a provider within the `providers` object (e.g. `"google"`, `"amazon"`).
- **Merged_Providers**: The combined set of provider definitions produced by overlaying Local_Rules onto the Remote_Ruleset before building in-memory Provider objects.
- **CRUD_Editor**: The HTML page (`html/localRules.html`) and its companion script (`core_js/localRules.js`) that allow users to view, add, edit, and delete Local_Rules entries.
- **Background_Script**: The set of scripts loaded via `manifest.json`'s `background.scripts` array, running in the extension's background context. Includes `clearurls.js`, `storage.js`, `tools.js`, `message_handler.js`, and others.
- **Popup**: The browser action popup defined in `html/popup.html` and `core_js/popup.js`.

## Requirements

### Requirement 1: Local Rules Storage Initialization

**User Story:** As an addon user, I want local rule overrides persisted in browser storage, so that my custom rules survive browser restarts and addon updates.

#### Acceptance Criteria

1. THE Addon SHALL store Local_Rules as a JSON object under the key `localRules` in `browser.storage.local`.
2. WHEN the Addon starts for the first time or `localRules` is absent from storage, THE Addon SHALL initialize `localRules` to an empty object `{}`.
3. THE Addon SHALL preserve the existing value of `localRules` when `initSettings()` sets default values for other storage keys.
4. WHEN `setData` is called with the key `localRules`, THE Addon SHALL parse the value as JSON before storing it in the in-memory `storage` variable, consistent with the existing `ClearURLsData` handling.

### Requirement 2: Shallow Merge Override

**User Story:** As an addon user, I want my local provider definitions to completely replace matching remote providers, so that I can fix broken rules without partial conflicts from the remote ruleset.

#### Acceptance Criteria

1. WHEN `createProviders()` builds in-memory Provider objects, THE Addon SHALL merge Local_Rules with the Remote_Ruleset before creating providers.
2. WHEN a Provider_Name exists in both Local_Rules and the Remote_Ruleset, THE Addon SHALL use the Local_Rules entry and discard the Remote_Ruleset entry for that Provider_Name (shallow replace, not deep merge).
3. WHEN a Provider_Name exists only in Local_Rules, THE Addon SHALL create an additional Provider from that entry.
4. WHEN a Provider_Name exists only in the Remote_Ruleset, THE Addon SHALL create a Provider from the Remote_Ruleset entry unchanged.
5. THE Addon SHALL apply the merge before iterating provider keys, so that all downstream provider construction logic operates on the Merged_Providers set.

### Requirement 3: Live Reload of Providers

**User Story:** As an addon user, I want my local rule changes to take effect immediately after saving, so that I do not need to restart the browser or reload the extension.

#### Acceptance Criteria

1. THE Background_Script SHALL expose a `reloadProviders()` function that clears the existing in-memory `providers` and `prvKeys` arrays and rebuilds them from the current `storage.ClearURLsData` and `storage.localRules`.
2. WHEN the CRUD_Editor sends a `reloadProviders` message via `browser.runtime.sendMessage`, THE Background_Script SHALL execute `reloadProviders()` and return a success response.
3. THE `reloadProviders()` function SHALL reuse the same merge logic defined in Requirement 2 to ensure consistency.

### Requirement 4: CRUD Editor Page

**User Story:** As an addon user, I want an editor page to manage my local rule overrides, so that I can add, view, edit, and delete provider definitions without editing raw JSON.

#### Acceptance Criteria

1. THE Addon SHALL include a new page at `html/localRules.html` that follows the existing Bootstrap layout pattern used by `html/settings.html`.
2. THE CRUD_Editor SHALL display all Local_Rules entries in a list or table, showing at minimum the Provider_Name and the `urlPattern` for each entry.
3. WHEN the user clicks the add button, THE CRUD_Editor SHALL display a form with input fields for: Provider_Name, `urlPattern`, `rules` (comma-separated list), `rawRules` (comma-separated list), `exceptions` (comma-separated list), `redirections` (comma-separated list), `referralMarketing` (comma-separated list), `completeProvider` (checkbox), and `forceRedirection` (checkbox). WHEN the user saves the new entry it SHALL be shown with a green text color in the list to indicate that this is a new entry.
4. WHEN the user clicks the edit button for an existing entry, THE CRUD_Editor SHALL populate the form with that entry's current values. WHEN the state of the entry is changed (dirty) the row or list entry SHALL be shown with a golden yellow text color to indicate that it is changed.
5. WHEN the user clicks the delete button for an existing entry, THE CRUD_Editor SHALL strike that entry in the list or table and show it with a red text color to indicate that it is planned for deletion.
6. The displayed form with input fields for the provider's properties SHALL have an "OK" and an "Cancel" button. WHEN the user clicks on the "OK" button the form SHALL be closed staging the changes (create, edit, delete) for commit. WHEN the user clicks on the "Cancel" button the changes SHALL be reverted to the state before opening the form.
7. The user shall be able to open the form multiple times handling the state properly. For example: WHEN the user creates a new entry, clicks on "OK" (state new and staged) and opens the form again, making changes and clicks on "OK" the state SHALL still be new and staged but the last changes SHALL be applied. Given the same situation WHEN the User clicks on "Cancel" instead the state SHALL still be new and staged but the last changes SHALL NOT be applied.
6. THE CRUD_Editor SHALL load its initial data from `browser.storage.local` via `browser.runtime.sendMessage` using the existing `getData` function, consistent with how `settings.js` loads data.
7. THE CRUD_Editor SHALL include `browser-polyfill.js` and `core_js/write_version.js` script references, consistent with other addon HTML pages.

### Requirement 5: Save and Cancel Actions

**User Story:** As an addon user, I want explicit save and cancel buttons, so that I can commit my staged changes or discard them without ambiguity.

#### Acceptance Criteria

1. WHEN the user clicks the Save button, THE CRUD_Editor SHALL persist the current Local_Rules object (staged changes) to `browser.storage.local` via `browser.runtime.sendMessage` using the existing `setData` and `saveOnExit` functions.
2. WHEN the user clicks the Save button, THE CRUD_Editor SHALL send a `reloadProviders` message to the Background_Script after storage persistence completes.
3. WHEN the user clicks the Cancel button, THE CRUD_Editor SHALL discard all unsaved (staged) modifications and reload the Local_Rules from `browser.storage.local`, restoring the UI to the last persisted state.
4. IF the `setData` or `saveOnExit` message fails, THEN THE CRUD_Editor SHALL log the error to the browser console using `console.error`.

### Requirement 6: Popup Navigation Link

**User Story:** As an addon user, I want to reach the local rules editor from the popup, so that I can access the feature without navigating browser internals.

#### Acceptance Criteria

1. THE Popup SHALL contain a navigation link or icon that opens the CRUD_Editor page in a new tab.
2. THE Popup SHALL place the navigation link in the `references_section` div, alongside the existing tools and settings icons.
3. WHEN the Popup initializes, THE `popup.js` script SHALL set the `href` attribute of the local rules link to the CRUD_Editor page URL using `browser.runtime.getURL()`, consistent with how the settings and cleaning tools links are set.
4. THE Popup SHALL display a localized tooltip on the navigation link using `browser.i18n.getMessage()`.

### Requirement 7: Internationalization of New UI Strings

**User Story:** As an addon user, I want new UI text to be available in my language, so that the local rules editor is consistent with the rest of the addon.

#### Acceptance Criteria

1. THE Addon SHALL add all new user-facing strings to `_locales/en/messages.json` with descriptive message keys and descriptions.
2. THE Addon SHALL add the same message keys to all 21 non-English locale files (`ar`, `de`, `es`, `fr`, `hu`, `id`, `it`, `ja`, `ko`, `nl`, `pl`, `pt_BR`, `pt_PT`, `ru`, `sl`, `sv_SE`, `th`, `tr`, `uk`, `zh_CN`, `zh_TW`) using the English text as fallback content.
3. THE CRUD_Editor SHALL retrieve all displayed text using `browser.i18n.getMessage()` and SHALL NOT hard-code user-facing strings in HTML or JavaScript.

### Requirement 8: Provider Field Validation

**User Story:** As an addon user, I want the editor to prevent me from saving invalid provider entries, so that a bad local rule does not break URL cleaning for the entire addon.

#### Acceptance Criteria

1. WHEN the user submits the provider form, THE CRUD_Editor SHALL validate that Provider_Name is a non-empty string.
2. WHEN the user submits the provider form, THE CRUD_Editor SHALL validate that `urlPattern` is a non-empty string and is a valid regular expression.
3. IF validation fails, THEN THE CRUD_Editor SHALL display an inline error message next to the offending field and SHALL NOT save the entry, keeping the form open so that the user can correct the invalid fields.
4. THE CRUD_Editor SHALL accept empty arrays for optional list fields (`rules`, `rawRules`, `exceptions`, `redirections`, `referralMarketing`), because a provider definition can legitimately omit these.

### Requirement 9: Page-Level Save Button State

**User Story:** As an addon user, I want the Save button disabled when there are no actual changes, so that I don't accidentally trigger a save that does nothing.

#### Acceptance Criteria

1. THE Save button SHALL be disabled when the effective staged rules (staged minus deleted) are deeply equal to the persisted rules.
2. THE Save button SHALL be enabled when the effective staged rules differ from the persisted rules.
3. Edge cases: adding a provider then deleting it before saving, or editing a provider then manually reverting the values, SHALL result in the Save button being disabled if the net result matches the persisted state.

### Requirement 10: Form-Level OK Button State

**User Story:** As an addon user, I want the OK button disabled until I've actually made changes, so that editing a provider without changing anything doesn't mark it as dirty.

#### Acceptance Criteria

1. In add mode, THE OK button SHALL be disabled until at least one text field is non-empty or any boolean field is set to a non-default value.
2. In edit mode, THE OK button SHALL be disabled until any form field value differs from the values present when the form was opened.
3. THE OK button state SHALL update in real-time as the user types or toggles checkboxes.

### Requirement 11: Scope Exclusions

**User Story:** As a project maintainer, I want the feature scope explicitly bounded, so that implementation stays focused and reviewable.

#### Acceptance Criteria

1. THE Addon SHALL NOT provide import or export functionality for Local_Rules in this feature.
2. THE Addon SHALL NOT modify any third-party scripts in the `external_js/` directory, `browser-polyfill.js`, or CSS frameworks.
3. THE Addon SHALL NOT modify content scripts (`google_link_fix.js`, `yandex_link_fix.js`) or build tools (`build_tools/`).
4. THE Addon SHALL NOT modify `manifest.json` unless strictly necessary to register the new `html/localRules.html` page.
