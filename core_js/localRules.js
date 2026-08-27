/*
 * ClearURLs
 * Copyright (c) 2017-2025 Kevin Röbert
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/*jshint esversion: 6 */

// The last persisted state (loaded from storage)
var persistedRules = {};

// The staged state (working copy, includes uncommitted changes)
var stagedRules = {};

// Track change status per provider name for color indicators
// Values: "new" | "edited" | "deleted" | null
var changeStatus = {};

// IDs of all text input fields in the provider form
var formTextFieldIds = [
    'form_provider_name', 'form_url_pattern', 'form_rules',
    'form_raw_rules', 'form_exceptions', 'form_redirections',
    'form_referral_marketing'
];

// IDs of all checkbox fields in the provider form
var formCheckboxFieldIds = ['form_complete_provider', 'form_force_redirection'];

// Currently active form input listeners (to remove on form close)
var activeFormListeners = [];

/**
 * Initialize the local rules editor.
 * Loads localRules from storage, deep-clones into persistedRules
 * and stagedRules, renders the list, and populates all i18n text.
 */
function init() {
    browser.runtime.sendMessage({
        function: "getData",
        params: ["localRules"]
    }).then(data => {
        var loaded = data.response;

        if (!loaded || typeof loaded !== 'object') {
            loaded = {};
        }

        // Deep-clone into persistedRules and stagedRules
        persistedRules = JSON.parse(JSON.stringify(loaded));
        stagedRules = JSON.parse(JSON.stringify(loaded));
        changeStatus = {};

        renderList();
    }).catch(handleError);

    setText();
}

/**
 * Compute the effective staged rules by removing entries marked "deleted".
 * Returns a new object without mutating stagedRules.
 *
 * @returns {Object}
 */
function getEffectiveStagedRules() {
    var result = JSON.parse(JSON.stringify(stagedRules));
    var names = Object.keys(changeStatus);
    for (var i = 0; i < names.length; i++) {
        if (changeStatus[names[i]] === 'deleted') {
            delete result[names[i]];
        }
    }
    return result;
}

/**
 * Update the page-level Save button disabled state.
 * Disabled when the effective staged rules equal the persisted rules.
 */
function updateSaveButtonState() {
    var effective = getEffectiveStagedRules();
    var hasChanges = JSON.stringify(effective) !== JSON.stringify(persistedRules);
    document.getElementById('local_rules_save_btn').disabled = !hasChanges;
}

/**
 * Attach input/change listeners to all form fields that call the given
 * callback on every change. Stores references in activeFormListeners
 * so they can be removed when the form closes.
 *
 * @param {Function} callback Called on every input/change event
 */
function attachFormListeners(callback) {
    removeFormListeners();

    for (var i = 0; i < formTextFieldIds.length; i++) {
        var el = document.getElementById(formTextFieldIds[i]);
        el.addEventListener('input', callback);
        activeFormListeners.push({ element: el, event: 'input', handler: callback });
    }

    for (var j = 0; j < formCheckboxFieldIds.length; j++) {
        var cb = document.getElementById(formCheckboxFieldIds[j]);
        cb.addEventListener('change', callback);
        activeFormListeners.push({ element: cb, event: 'change', handler: callback });
    }
}

/**
 * Remove all active form input listeners.
 */
function removeFormListeners() {
    for (var i = 0; i < activeFormListeners.length; i++) {
        var l = activeFormListeners[i];
        l.element.removeEventListener(l.event, l.handler);
    }
    activeFormListeners = [];
}

/**
 * Check if the form has any non-default values (for add mode).
 * Returns true if at least one text field is non-empty or any
 * checkbox is checked.
 *
 * @returns {boolean}
 */
function formHasContent() {
    for (var i = 0; i < formTextFieldIds.length; i++) {
        if (document.getElementById(formTextFieldIds[i]).value.trim()) {
            return true;
        }
    }
    for (var j = 0; j < formCheckboxFieldIds.length; j++) {
        if (document.getElementById(formCheckboxFieldIds[j]).checked) {
            return true;
        }
    }
    return false;
}

/**
 * Check if the current form values differ from a snapshot (for edit mode).
 * Compares each text field's raw value and each checkbox's checked state
 * against the snapshot's serialized form.
 *
 * @param {Object} snapshotFormValues The form values captured when the form opened
 * @returns {boolean}
 */
function formDiffersFromSnapshot(snapshotFormValues) {
    for (var i = 0; i < formTextFieldIds.length; i++) {
        var id = formTextFieldIds[i];
        if (document.getElementById(id).value !== snapshotFormValues[id]) {
            return true;
        }
    }
    for (var j = 0; j < formCheckboxFieldIds.length; j++) {
        var cbId = formCheckboxFieldIds[j];
        if (document.getElementById(cbId).checked !== snapshotFormValues[cbId]) {
            return true;
        }
    }
    return false;
}

/**
 * Capture the current raw form field values as a snapshot object.
 *
 * @returns {Object} Map of field ID to current value (string or boolean)
 */
function captureFormValues() {
    var values = {};
    for (var i = 0; i < formTextFieldIds.length; i++) {
        var id = formTextFieldIds[i];
        values[id] = document.getElementById(id).value;
    }
    for (var j = 0; j < formCheckboxFieldIds.length; j++) {
        var cbId = formCheckboxFieldIds[j];
        values[cbId] = document.getElementById(cbId).checked;
    }
    return values;
}

/**
 * Render the provider list from stagedRules and changeStatus.
 * Clears the table body and rebuilds rows for each entry, applying
 * CSS status classes and wiring edit/delete button handlers.
 */
function renderList() {
    var tbody = document.getElementById('provider_list');
    tbody.innerHTML = '';

    var names = Object.keys(stagedRules);

    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var entry = stagedRules[name];
        var status = changeStatus[name] || null;

        var tr = document.createElement('tr');

        // Apply status CSS class to the row
        if (status === 'new') {
            tr.className = 'local-rule-new';
        } else if (status === 'edited') {
            tr.className = 'local-rule-edited';
        } else if (status === 'deleted') {
            tr.className = 'local-rule-deleted';
        }

        // Provider name cell
        var tdName = document.createElement('td');
        tdName.textContent = name;
        tr.appendChild(tdName);

        // URL pattern cell
        var tdPattern = document.createElement('td');
        tdPattern.textContent = entry.urlPattern || '';
        tr.appendChild(tdPattern);

        // Actions cell (edit + delete buttons)
        var tdActions = document.createElement('td');

        var editBtn = document.createElement('button');
        editBtn.textContent = translate('local_rules_edit_btn');
        editBtn.className = 'btn btn-sm btn-primary';
        editBtn.style.marginRight = '5px';
        editBtn.setAttribute('data-name', name);
        editBtn.addEventListener('click', (function(providerName) {
            return function() { openEditForm(providerName); };
        })(name));
        tdActions.appendChild(editBtn);

        var deleteBtn = document.createElement('button');
        deleteBtn.textContent = translate('local_rules_delete_btn');
        deleteBtn.className = 'btn btn-sm btn-danger';
        deleteBtn.setAttribute('data-name', name);
        deleteBtn.addEventListener('click', (function(providerName) {
            return function() { markForDeletion(providerName); };
        })(name));
        tdActions.appendChild(deleteBtn);

        tr.appendChild(tdActions);
        tbody.appendChild(tr);
    }

    updateSaveButtonState();
}

/**
 * Parse a JSON-style array string into an array of strings.
 * Input format: "value1", "value2with,comma"
 * Wraps the input in brackets and delegates to JSON.parse so that
 * commas inside quoted strings (e.g. regex quantifiers like {2,})
 * are preserved correctly.
 *
 * Returns an empty array for empty or whitespace-only input.
 * Returns null if the input is not valid JSON array syntax.
 *
 * @param {string} value The quoted, comma-separated input string
 * @returns {string[]|null} Parsed array or null on parse error
 */
function parseCommaSeparated(value) {
    if (!value || !value.trim()) {
        return [];
    }

    var trimmed = value.trim();

    // Remove trailing comma if present
    if (trimmed.endsWith(',')) {
        trimmed = trimmed.slice(0, -1).trim();
    }

    // Empty after stripping trailing comma
    if (!trimmed) {
        return [];
    }

    var jsonString = '[' + trimmed + ']';

    try {
        var parsed = JSON.parse(jsonString);
    } catch (e) {
        return null;
    }

    // Ensure it is an array of strings
    if (!Array.isArray(parsed)) {
        return null;
    }

    for (var i = 0; i < parsed.length; i++) {
        if (typeof parsed[i] !== 'string') {
            return null;
        }
    }

    return parsed;
}

/**
 * Join an array into a JSON-quoted, comma-separated string for display
 * in form inputs. Each element is individually JSON.stringify'd so that
 * special characters are properly escaped and the output round-trips
 * through parseCommaSeparated.
 *
 * @param {Array} arr The array to join
 * @returns {string}
 */
function joinForDisplay(arr) {
    if (!arr || !Array.isArray(arr)) {
        return '';
    }
    return arr.map(function(item) {
        return JSON.stringify(item);
    }).join(', ');
}

/**
 * Read the current form field values and return a provider data object.
 * Array fields that fail JSON parsing will be set to null so that
 * validateForm can report the error.
 *
 * @returns {{ name: string, data: Object }}
 */
function readFormData() {
    var name = document.getElementById('form_provider_name').value.trim();
    var data = {
        urlPattern: document.getElementById('form_url_pattern').value.trim(),
        rules: parseCommaSeparated(document.getElementById('form_rules').value),
        rawRules: parseCommaSeparated(document.getElementById('form_raw_rules').value),
        exceptions: parseCommaSeparated(document.getElementById('form_exceptions').value),
        redirections: parseCommaSeparated(document.getElementById('form_redirections').value),
        referralMarketing: parseCommaSeparated(document.getElementById('form_referral_marketing').value),
        completeProvider: document.getElementById('form_complete_provider').checked,
        forceRedirection: document.getElementById('form_force_redirection').checked
    };
    return { name: name, data: data };
}

/**
 * Clear all form fields and error messages.
 */
function clearForm() {
    document.getElementById('form_provider_name').value = '';
    document.getElementById('form_url_pattern').value = '';
    document.getElementById('form_rules').value = '';
    document.getElementById('form_raw_rules').value = '';
    document.getElementById('form_exceptions').value = '';
    document.getElementById('form_redirections').value = '';
    document.getElementById('form_referral_marketing').value = '';
    document.getElementById('form_complete_provider').checked = false;
    document.getElementById('form_force_redirection').checked = false;
    document.getElementById('error_provider_name').textContent = '';
    document.getElementById('error_url_pattern').textContent = '';
    document.getElementById('error_rules').textContent = '';
    document.getElementById('error_raw_rules').textContent = '';
    document.getElementById('error_exceptions').textContent = '';
    document.getElementById('error_redirections').textContent = '';
    document.getElementById('error_referral_marketing').textContent = '';
}

/**
 * Populate the form fields with an existing provider entry's values.
 *
 * @param {string} name The provider name
 * @param {Object} entry The provider definition object
 */
function populateForm(name, entry) {
    document.getElementById('form_provider_name').value = name;
    document.getElementById('form_url_pattern').value = entry.urlPattern || '';
    document.getElementById('form_rules').value = joinForDisplay(entry.rules);
    document.getElementById('form_raw_rules').value = joinForDisplay(entry.rawRules);
    document.getElementById('form_exceptions').value = joinForDisplay(entry.exceptions);
    document.getElementById('form_redirections').value = joinForDisplay(entry.redirections);
    document.getElementById('form_referral_marketing').value = joinForDisplay(entry.referralMarketing);
    document.getElementById('form_complete_provider').checked = entry.completeProvider || false;
    document.getElementById('form_force_redirection').checked = entry.forceRedirection || false;
    document.getElementById('error_provider_name').textContent = '';
    document.getElementById('error_url_pattern').textContent = '';
    document.getElementById('error_rules').textContent = '';
    document.getElementById('error_raw_rules').textContent = '';
    document.getElementById('error_exceptions').textContent = '';
    document.getElementById('error_redirections').textContent = '';
    document.getElementById('error_referral_marketing').textContent = '';
}

/**
 * Validate the provider form data.
 * Checks that Provider_Name is non-empty (after trim), that urlPattern
 * is non-empty and a valid RegExp, and that all array fields parsed
 * successfully (are not null).
 *
 * @param {{ name: string, data: Object }} formData The form data to validate
 * @returns {{ valid: boolean, errors: { name: string|null, urlPattern: string|null, arrayFields: Object } }}
 */
function validateForm(formData) {
    var errors = { name: null, urlPattern: null, arrayFields: {} };
    var valid = true;

    // Check Provider_Name is non-empty after trim
    if (!formData.name || !formData.name.trim()) {
        errors.name = translate('local_rules_error_name_empty');
        valid = false;
    }

    // Check urlPattern is non-empty after trim
    var pattern = formData.data && formData.data.urlPattern ? formData.data.urlPattern.trim() : '';
    if (!pattern) {
        errors.urlPattern = translate('local_rules_error_pattern_empty');
        valid = false;
    } else {
        // Check urlPattern is a valid RegExp
        try {
            new RegExp(pattern);
        } catch (e) {
            errors.urlPattern = translate('local_rules_error_pattern_invalid');
            valid = false;
        }
    }

    // Check all array fields parsed successfully
    var arrayFieldIds = ['rules', 'rawRules', 'exceptions', 'redirections', 'referralMarketing'];
    var errorElementMap = {
        rules: 'error_rules',
        rawRules: 'error_raw_rules',
        exceptions: 'error_exceptions',
        redirections: 'error_redirections',
        referralMarketing: 'error_referral_marketing'
    };

    for (var i = 0; i < arrayFieldIds.length; i++) {
        var field = arrayFieldIds[i];
        if (formData.data[field] === null) {
            errors.arrayFields[errorElementMap[field]] = translate('local_rules_error_array_invalid');
            valid = false;
        }
    }

    return { valid: valid, errors: errors };
}

/**
 * Mark a provider entry for deletion.
 * Sets the change status to "deleted" and re-renders the list.
 * The entry is not removed from stagedRules until Save is clicked.
 *
 * @param {string} name The provider name to mark for deletion
 */
function markForDeletion(name) {
    changeStatus[name] = 'deleted';
    renderList();
}

/**
 * Save all staged changes to browser storage.
 * Removes entries marked "deleted" from stagedRules, then persists via
 * setData, saveOnExit, and reloadProviders message chain.
 * On success: copies stagedRules to persistedRules, clears changeStatus, re-renders.
 * On failure: logs via console.error.
 */
function save() {
    // Remove entries marked as "deleted" from stagedRules before persisting
    var names = Object.keys(changeStatus);
    for (var i = 0; i < names.length; i++) {
        if (changeStatus[names[i]] === 'deleted') {
            delete stagedRules[names[i]];
        }
    }

    browser.runtime.sendMessage({ function: "setData", params: ["localRules", JSON.stringify(stagedRules)] })
    .then(function() {
        return browser.runtime.sendMessage({ function: "saveOnExit", params: [] });
    })
    .then(function() {
        return browser.runtime.sendMessage({ function: "reloadProviders", params: [] });
    })
    .then(function() {
        persistedRules = JSON.parse(JSON.stringify(stagedRules));
        changeStatus = {};
        renderList();
    })
    .catch(function(error) {
        console.error(error);
    });
}

/**
 * Cancel all staged changes and restore the last persisted state.
 * Deep-clones persistedRules into stagedRules, clears changeStatus, re-renders.
 */
function cancel() {
    stagedRules = JSON.parse(JSON.stringify(persistedRules));
    changeStatus = {};
    renderList();
}

/**
 * Show the provider form with empty fields for adding a new entry.
 * Wires the OK button to stage the new entry, and Cancel to close without changes.
 */
function openAddForm() {
    clearForm();
    document.getElementById('form_provider_name').disabled = false;
    document.getElementById('provider_form_title').textContent = translate('local_rules_form_title_add');
    document.getElementById('provider_form_container').style.display = '';

    var okBtn = document.getElementById('local_rules_form_ok_btn');
    var cancelBtn = document.getElementById('local_rules_form_cancel_btn');

    // Clone and replace to remove old listeners
    var newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    var newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    // Start with OK disabled — enable when form has content
    newOkBtn.disabled = true;

    attachFormListeners(function() {
        newOkBtn.disabled = !formHasContent();
    });

    newOkBtn.addEventListener('click', function() {
        var formData = readFormData();
        var validation = validateForm(formData);

        if (!validation.valid) {
            // Display inline errors
            if (validation.errors.name) {
                document.getElementById('error_provider_name').textContent = validation.errors.name;
            }
            if (validation.errors.urlPattern) {
                document.getElementById('error_url_pattern').textContent = validation.errors.urlPattern;
            }
            var fieldIds = Object.keys(validation.errors.arrayFields);
            for (var i = 0; i < fieldIds.length; i++) {
                document.getElementById(fieldIds[i]).textContent = validation.errors.arrayFields[fieldIds[i]];
            }
            return;
        }

        stagedRules[formData.name] = formData.data;

        // If re-adding a name that was marked deleted, treat as edited instead of new
        if (changeStatus[formData.name] === 'deleted') {
            changeStatus[formData.name] = 'edited';
        } else {
            changeStatus[formData.name] = 'new';
        }
        removeFormListeners();
        document.getElementById('provider_form_container').style.display = 'none';
        renderList();
    });

    newCancelBtn.addEventListener('click', function() {
        removeFormListeners();
        document.getElementById('provider_form_container').style.display = 'none';
    });
}

/**
 * Show the provider form populated with an existing entry's values for editing.
 * Stores a snapshot so Cancel can restore the previous state.
 *
 * @param {string} name The provider name to edit
 */
function openEditForm(name) {
    var entry = stagedRules[name];
    if (!entry) return;

    // Store snapshot for Cancel restoration
    var snapshot = JSON.parse(JSON.stringify(entry));

    populateForm(name, entry);
    document.getElementById('form_provider_name').disabled = true;
    document.getElementById('provider_form_title').textContent = translate('local_rules_form_title_edit');
    document.getElementById('provider_form_container').style.display = '';

    // Capture form values right after populating for diff comparison
    var snapshotFormValues = captureFormValues();

    var okBtn = document.getElementById('local_rules_form_ok_btn');
    var cancelBtn = document.getElementById('local_rules_form_cancel_btn');

    // Clone and replace to remove old listeners
    var newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    var newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    // Start with OK disabled — enable when form differs from snapshot
    newOkBtn.disabled = true;

    attachFormListeners(function() {
        newOkBtn.disabled = !formDiffersFromSnapshot(snapshotFormValues);
    });

    newOkBtn.addEventListener('click', function() {
        var formData = readFormData();
        // Use the original name since the field is disabled
        formData.name = name;
        var validation = validateForm(formData);

        if (!validation.valid) {
            if (validation.errors.name) {
                document.getElementById('error_provider_name').textContent = validation.errors.name;
            }
            if (validation.errors.urlPattern) {
                document.getElementById('error_url_pattern').textContent = validation.errors.urlPattern;
            }
            var fieldIds = Object.keys(validation.errors.arrayFields);
            for (var i = 0; i < fieldIds.length; i++) {
                document.getElementById(fieldIds[i]).textContent = validation.errors.arrayFields[fieldIds[i]];
            }
            return;
        }

        stagedRules[name] = formData.data;

        // Keep "new" status if it was already new; otherwise set "edited"
        if (changeStatus[name] !== 'new') {
            changeStatus[name] = 'edited';
        }

        removeFormListeners();
        document.getElementById('provider_form_container').style.display = 'none';
        renderList();
    });

    newCancelBtn.addEventListener('click', function() {
        // Restore snapshot — no changeStatus modification
        stagedRules[name] = snapshot;
        removeFormListeners();
        document.getElementById('provider_form_container').style.display = 'none';
    });
}

/**
 * Set the text for the UI using i18n messages.
 */
function setText() {
    // Page title
    document.title = translate('local_rules_page_title');
    document.getElementById('page_title').textContent = translate('local_rules_page_title');

    // Provider list heading
    document.getElementById('local_rules_provider_list_heading').textContent = translate('local_rules_provider_list_heading');

    // Table headers
    document.getElementById('local_rules_field_provider_name').textContent = translate('local_rules_field_provider_name');
    document.getElementById('local_rules_field_url_pattern').textContent = translate('local_rules_field_url_pattern');

    // Page-level buttons
    document.getElementById('local_rules_add_btn').textContent = translate('local_rules_add_btn');
    document.getElementById('local_rules_save_btn').textContent = translate('local_rules_save_btn');
    document.getElementById('local_rules_cancel_btn').textContent = translate('local_rules_cancel_btn');

    // Form-level buttons
    document.getElementById('local_rules_form_ok_btn').textContent = translate('local_rules_form_ok_btn');
    document.getElementById('local_rules_form_cancel_btn').textContent = translate('local_rules_form_cancel_btn');

    // Form field labels
    document.getElementById('label_provider_name').textContent = translate('local_rules_field_provider_name');
    document.getElementById('label_url_pattern').textContent = translate('local_rules_field_url_pattern');
    document.getElementById('label_rules').textContent = translate('local_rules_field_rules');
    document.getElementById('label_raw_rules').textContent = translate('local_rules_field_raw_rules');
    document.getElementById('label_exceptions').textContent = translate('local_rules_field_exceptions');
    document.getElementById('label_redirections').textContent = translate('local_rules_field_redirections');
    document.getElementById('label_referral_marketing').textContent = translate('local_rules_field_referral_marketing');
    document.getElementById('label_complete_provider').textContent = translate('local_rules_field_complete_provider');
    document.getElementById('label_force_redirection').textContent = translate('local_rules_field_force_redirection');
}

/**
 * Translate a string with the i18n API.
 *
 * @param {string} string Name of the attribute used for localization
 */
function translate(string) {
    return browser.i18n.getMessage(string);
}

/**
 * Handle errors by logging to the console.
 *
 * @param {*} error The error to log
 */
function handleError(error) {
    console.log(`Error: ${error}`);
}

/**
 * IIFE init chain — loads data and initializes the UI when the document is ready.
 * Follows the pattern used in popup.js and cleaning_tool.js.
 */
(function() {
    init();
    document.getElementById('local_rules_add_btn').addEventListener('click', openAddForm);
    document.getElementById('local_rules_save_btn').addEventListener('click', save);
    document.getElementById('local_rules_cancel_btn').addEventListener('click', cancel);
})();
