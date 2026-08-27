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
}

/**
 * Parse a comma-separated string into an array of trimmed, non-empty strings.
 * Returns an empty array for empty or whitespace-only input.
 *
 * @param {string} value The comma-separated input string
 * @returns {string[]}
 */
function parseCommaSeparated(value) {
    if (!value || !value.trim()) {
        return [];
    }
    return value.split(',').map(function(item) {
        return item.trim();
    }).filter(function(item) {
        return item.length > 0;
    });
}

/**
 * Join an array into a comma-separated string for display in form inputs.
 *
 * @param {Array} arr The array to join
 * @returns {string}
 */
function joinForDisplay(arr) {
    if (!arr || !Array.isArray(arr)) {
        return '';
    }
    return arr.join(', ');
}

/**
 * Read the current form field values and return a provider data object.
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
}

/**
 * Validate the provider form data.
 * Checks that Provider_Name is non-empty (after trim) and that urlPattern
 * is non-empty and a valid RegExp.
 *
 * @param {{ name: string, data: Object }} formData The form data to validate
 * @returns {{ valid: boolean, errors: { name: string|null, urlPattern: string|null } }}
 */
function validateForm(formData) {
    var errors = { name: null, urlPattern: null };
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
            return;
        }

        stagedRules[formData.name] = formData.data;
        changeStatus[formData.name] = 'new';
        document.getElementById('provider_form_container').style.display = 'none';
        renderList();
    });

    newCancelBtn.addEventListener('click', function() {
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

    var okBtn = document.getElementById('local_rules_form_ok_btn');
    var cancelBtn = document.getElementById('local_rules_form_cancel_btn');

    // Clone and replace to remove old listeners
    var newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    var newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

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
            return;
        }

        stagedRules[name] = formData.data;

        // Keep "new" status if it was already new; otherwise set "edited"
        if (changeStatus[name] !== 'new') {
            changeStatus[name] = 'edited';
        }

        document.getElementById('provider_form_container').style.display = 'none';
        renderList();
    });

    newCancelBtn.addEventListener('click', function() {
        // Restore snapshot — no changeStatus modification
        stagedRules[name] = snapshot;
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
