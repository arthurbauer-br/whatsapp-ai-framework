/**
 * Settings Manager for WhatsApp Bot
 *
 * Handles persistent storage of configuration settings:
 * - Anti-ban rate limits
 * - Other configurable options
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../../settings.json');

// Default settings
const DEFAULT_SETTINGS = {
    // Budget for REPLYING to people who wrote in first.
    antiBan: {
        preset: 'balanced',
        messagesPerHour: 50,
        messagesPerDay: 300,
        uniqueChatsPerHour: 25,
        uniqueChatsPerDay: 100
    },
    // Budget for conversations WE start (POST /api/send without kind:"reply").
    // Deliberately tighter: an unsolicited message is the riskier kind.
    antiBanOutbound: {
        preset: 'custom',
        messagesPerHour: 15,
        messagesPerDay: 50,
        uniqueChatsPerHour: 15,
        uniqueChatsPerDay: 50
    },
    n8nWebhookUrl: ''
};

let currentSettings = { ...DEFAULT_SETTINGS };

/**
 * Load settings from file
 */
async function loadSettings() {
    try {
        if (fsSync.existsSync(SETTINGS_FILE)) {
            const data = await fs.readFile(SETTINGS_FILE, 'utf8');
            const loaded = JSON.parse(data);
            currentSettings = mergeDeep(DEFAULT_SETTINGS, loaded);
            console.log('[Settings] Loaded from file');
        } else {
            // Create default settings file
            await saveSettings();
            console.log('[Settings] Created default settings file');
        }
    } catch (error) {
        console.error('[Settings] Error loading settings:', error.message);
        currentSettings = { ...DEFAULT_SETTINGS };
    }
    return currentSettings;
}

/**
 * Save current settings to file
 */
async function saveSettings() {
    try {
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(currentSettings, null, 2));
        console.log('[Settings] Saved to file');
        return true;
    } catch (error) {
        console.error('[Settings] Error saving settings:', error.message);
        return false;
    }
}

/**
 * Get all settings
 */
function getSettings() {
    return { ...currentSettings };
}

/**
 * Get specific setting by path (e.g., 'antiBan.preset')
 */
function getSetting(path) {
    const keys = path.split('.');
    let value = currentSettings;
    for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
            value = value[key];
        } else {
            return undefined;
        }
    }
    return value;
}

/**
 * Update settings
 * @param {string} section - Settings section (e.g., 'antiBan')
 * @param {Object} updates - New values to merge
 */
async function updateSettings(section, updates) {
    if (section && currentSettings[section]) {
        currentSettings[section] = { ...currentSettings[section], ...updates };
    } else if (!section) {
        currentSettings = mergeDeep(currentSettings, updates);
    }
    await saveSettings();
    return currentSettings;
}

/**
 * Apply an update to one of the anti-ban budgets.
 * Shared by both budgets so they can never drift apart in behaviour.
 * @param {string} section - 'antiBan' (replies) or 'antiBanOutbound'
 * @param {Object} updates - { preset?, messagesPerHour?, messagesPerDay?, ... }
 */
async function updateBudget(section, updates) {
    const { PRESETS } = require('./anti-ban');
    const atual = currentSettings[section] || { ...DEFAULT_SETTINGS[section] };

    // If a preset is selected, apply preset values
    if (updates.preset && PRESETS[updates.preset]) {
        currentSettings[section] = {
            preset: updates.preset,
            ...PRESETS[updates.preset]
        };
    } else if (updates.preset === 'custom') {
        // Custom settings
        currentSettings[section] = {
            preset: 'custom',
            messagesPerHour: updates.messagesPerHour || atual.messagesPerHour,
            messagesPerDay: updates.messagesPerDay || atual.messagesPerDay,
            uniqueChatsPerHour: updates.uniqueChatsPerHour || atual.uniqueChatsPerHour,
            uniqueChatsPerDay: updates.uniqueChatsPerDay || atual.uniqueChatsPerDay
        };
    } else {
        // Partial update
        currentSettings[section] = { ...atual, ...updates };
    }

    await saveSettings();
    return currentSettings[section];
}

/**
 * Update the REPLY budget (answers to people who wrote in).
 * @param {Object} updates - { preset?, messagesPerHour?, messagesPerDay?, etc. }
 */
async function updateAntiBanSettings(updates) {
    return updateBudget('antiBan', updates);
}

/**
 * Update the OUTBOUND budget (conversations we start).
 * @param {Object} updates - same shape as updateAntiBanSettings
 */
async function updateOutboundSettings(updates) {
    return updateBudget('antiBanOutbound', updates);
}

/**
 * Get anti-ban settings (reply budget)
 */
function getAntiBanSettings() {
    return { ...currentSettings.antiBan };
}

/**
 * Get the outbound budget settings
 */
function getOutboundSettings() {
    return { ...(currentSettings.antiBanOutbound || DEFAULT_SETTINGS.antiBanOutbound) };
}

/**
 * Deep merge utility
 */
function mergeDeep(target, source) {
    const output = { ...target };
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target)) {
                    Object.assign(output, { [key]: source[key] });
                } else {
                    output[key] = mergeDeep(target[key], source[key]);
                }
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return output;
}

function isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
}

module.exports = {
    loadSettings,
    saveSettings,
    getSettings,
    getSetting,
    updateSettings,
    updateAntiBanSettings,
    getAntiBanSettings,
    updateOutboundSettings,
    getOutboundSettings,
    DEFAULT_SETTINGS
};
