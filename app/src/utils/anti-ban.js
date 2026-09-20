/**
 * Anti-Ban Module for WhatsApp Bot
 *
 * Implements human-like behavior patterns to reduce ban risk:
 * - Rate limiting (hourly/daily message caps)
 * - Human-like delays (reading time + typing time + variance)
 * - Typing indicator simulation
 * - Time-of-day adjustments
 */

// Starting point for every manager. Each instance keeps its OWN copy in
// `this.limits`, so the outbound-blast budget and the reply budget can differ.
const DEFAULT_LIMITS = {
    messagesPerHour: 50,
    messagesPerDay: 300,
    uniqueChatsPerHour: 25,
    uniqueChatsPerDay: 100
};

// Delay configuration
const DELAY_CONFIG = {
    minDelay: 2000,           // 2 seconds minimum
    maxDelay: 45000,          // 45 seconds maximum
    readingSpeedMs: 200,      // ms per word to "read"
    typingSpeedMs: 50,        // ms per character to "type"
    varianceFactor: 0.3       // +/- 30% randomness
};

// Preset configurations
const PRESETS = {
    new: {
        messagesPerHour: 30,
        messagesPerDay: 150,
        uniqueChatsPerHour: 15,
        uniqueChatsPerDay: 50
    },
    balanced: {
        messagesPerHour: 50,
        messagesPerDay: 300,
        uniqueChatsPerHour: 25,
        uniqueChatsPerDay: 100
    },
    higher: {
        messagesPerHour: 80,
        messagesPerDay: 500,
        uniqueChatsPerHour: 40,
        uniqueChatsPerDay: 150
    }
};

/**
 * The account-wide ceiling.
 *
 * Each budget (replies, outbound) counts on its own, but WhatsApp does not see
 * categories - it sees one number sending. Two independent budgets of 50/h and
 * 30/h would let 80 messages out in an hour with both counters reporting
 * "within limits", which is exactly the kind of volume the budgets exist to
 * prevent.
 *
 * So every send also passes through this shared counter. Its ceiling is the
 * HIGHEST of the configured budgets, never their sum. With replies at 50/h and
 * outbound at 30/h the account may send 50/h total: if replies already used 40,
 * only 10 are left for outbound that hour, no matter what the outbound budget
 * alone would allow.
 */
class SharedBudget {
    constructor() {
        this.messageCount = { hour: 0, day: 0 };
        this.chatCount = { hour: new Set(), day: new Set() };
        this.lastHourReset = Date.now();
        this.lastDayReset = Date.now();
        this.limits = { ...DEFAULT_LIMITS };
    }

    /** Ceiling = the highest of the budgets, so it never becomes their sum. */
    recalculate(budgets) {
        const campos = ['messagesPerHour', 'messagesPerDay', 'uniqueChatsPerHour', 'uniqueChatsPerDay'];
        const ativos = budgets.filter(Boolean);
        if (!ativos.length) return;
        campos.forEach((campo) => {
            this.limits[campo] = Math.max(...ativos.map((b) => b.getLimits()[campo]));
        });
        console.log('[Anti-Ban:global] Ceiling:', this.limits);
    }

    checkAndResetCounters() {
        const now = Date.now();
        if (now - this.lastHourReset > 3600000) {
            this.messageCount.hour = 0;
            this.chatCount.hour.clear();
            this.lastHourReset = now;
        }
        if (now - this.lastDayReset > 86400000) {
            this.messageCount.day = 0;
            this.chatCount.day.clear();
            this.lastDayReset = now;
        }
    }

    getHourlyResetTime() { return Math.max(0, 3600000 - (Date.now() - this.lastHourReset)); }
    getDailyResetTime() { return Math.max(0, 86400000 - (Date.now() - this.lastDayReset)); }

    canSend(chatId) {
        this.checkAndResetCounters();
        if (this.messageCount.hour >= this.limits.messagesPerHour) {
            return { allowed: false, reason: 'Account hourly message limit reached', waitTime: this.getHourlyResetTime() };
        }
        if (this.messageCount.day >= this.limits.messagesPerDay) {
            return { allowed: false, reason: 'Account daily message limit reached', waitTime: this.getDailyResetTime() };
        }
        if (!this.chatCount.hour.has(chatId) && this.chatCount.hour.size >= this.limits.uniqueChatsPerHour) {
            return { allowed: false, reason: 'Account hourly unique chat limit reached', waitTime: this.getHourlyResetTime() };
        }
        if (!this.chatCount.day.has(chatId) && this.chatCount.day.size >= this.limits.uniqueChatsPerDay) {
            return { allowed: false, reason: 'Account daily unique chat limit reached', waitTime: this.getDailyResetTime() };
        }
        return { allowed: true };
    }

    record(chatId) {
        this.messageCount.hour++;
        this.messageCount.day++;
        this.chatCount.hour.add(chatId);
        this.chatCount.day.add(chatId);
    }

    getStats() {
        this.checkAndResetCounters();
        return {
            messagesThisHour: this.messageCount.hour,
            messagesThisDay: this.messageCount.day,
            uniqueChatsThisHour: this.chatCount.hour.size,
            uniqueChatsThisDay: this.chatCount.day.size,
            limits: { ...this.limits }
        };
    }
}

// One ceiling for the whole account.
const sharedBudget = new SharedBudget();

class AntiBanManager {
    constructor(customLimits = null, name = 'default') {
        this.messageCount = { hour: 0, day: 0 };
        this.chatCount = { hour: new Set(), day: new Set() };
        this.lastMessageTime = 0;
        this.lastHourReset = Date.now();
        this.lastDayReset = Date.now();

        // Own copy of the limits - never shared with other instances.
        this.limits = { ...DEFAULT_LIMITS };
        this.name = name;

        // Apply custom limits if provided
        if (customLimits) {
            this.updateLimits(customLimits);
        }
    }

    /**
     * Update rate limits dynamically
     * @param {Object} newLimits - New limits to apply
     */
    updateLimits(newLimits) {
        if (newLimits.preset && PRESETS[newLimits.preset]) {
            this.limits = { ...PRESETS[newLimits.preset] };
        } else {
            this.limits = {
                messagesPerHour: newLimits.messagesPerHour || this.limits.messagesPerHour,
                messagesPerDay: newLimits.messagesPerDay || this.limits.messagesPerDay,
                uniqueChatsPerHour: newLimits.uniqueChatsPerHour || this.limits.uniqueChatsPerHour,
                uniqueChatsPerDay: newLimits.uniqueChatsPerDay || this.limits.uniqueChatsPerDay
            };
        }
        console.log(`[Anti-Ban:${this.name}] Limits updated:`, this.limits);
    }

    /**
     * Get current rate limits
     */
    getLimits() {
        return { ...this.limits };
    }

    /**
     * Reset counters periodically
     */
    checkAndResetCounters() {
        const now = Date.now();

        // Reset hourly counters
        if (now - this.lastHourReset > 3600000) {
            this.messageCount.hour = 0;
            this.chatCount.hour.clear();
            this.lastHourReset = now;
            console.log('[Anti-Ban] Hourly counters reset');
        }

        // Reset daily counters
        if (now - this.lastDayReset > 86400000) {
            this.messageCount.day = 0;
            this.chatCount.day.clear();
            this.lastDayReset = now;
            console.log('[Anti-Ban] Daily counters reset');
        }
    }

    /**
     * Check if we can send a message
     * @param {string} chatId - The chat ID
     * @returns {Object} - { allowed: boolean, reason?: string, waitTime?: number }
     */
    canSendMessage(chatId) {
        this.checkAndResetCounters();

        if (this.messageCount.hour >= this.limits.messagesPerHour) {
            return {
                allowed: false,
                reason: 'Hourly message limit reached',
                waitTime: this.getHourlyResetTime()
            };
        }

        if (this.messageCount.day >= this.limits.messagesPerDay) {
            return {
                allowed: false,
                reason: 'Daily message limit reached',
                waitTime: this.getDailyResetTime()
            };
        }

        if (!this.chatCount.hour.has(chatId) &&
            this.chatCount.hour.size >= this.limits.uniqueChatsPerHour) {
            return {
                allowed: false,
                reason: 'Hourly unique chat limit reached',
                waitTime: this.getHourlyResetTime()
            };
        }

        if (!this.chatCount.day.has(chatId) &&
            this.chatCount.day.size >= this.limits.uniqueChatsPerDay) {
            return {
                allowed: false,
                reason: 'Daily unique chat limit reached',
                waitTime: this.getDailyResetTime()
            };
        }

        // Fits this budget. It must also fit the account-wide ceiling, which
        // every budget shares - otherwise two budgets would add up instead of
        // capping each other.
        return sharedBudget.canSend(chatId);
    }

    /**
     * Calculate human-like delay based on message length
     * @param {string} incomingMessage - The received message
     * @param {string} outgoingReply - The reply to send
     * @returns {number} - Delay in milliseconds
     */
    calculateDelay(incomingMessage, outgoingReply) {
        const wordCount = (incomingMessage || '').split(/\s+/).length;
        const readingTime = wordCount * DELAY_CONFIG.readingSpeedMs;
        const typingTime = (outgoingReply || '').length * DELAY_CONFIG.typingSpeedMs;

        let baseDelay = DELAY_CONFIG.minDelay + readingTime + typingTime;

        // Apply time-of-day multiplier
        baseDelay *= this.getTimeMultiplier();

        // Apply random variance (+/- 30%)
        const variance = baseDelay * DELAY_CONFIG.varianceFactor;
        baseDelay += (Math.random() * 2 - 1) * variance;

        // Clamp to min/max
        return Math.max(
            DELAY_CONFIG.minDelay,
            Math.min(DELAY_CONFIG.maxDelay, Math.floor(baseDelay))
        );
    }

    /**
     * Get time-of-day multiplier for more natural patterns
     * People respond slower at night, faster during business hours
     */
    getTimeMultiplier() {
        const hour = new Date().getHours();

        if (hour >= 0 && hour < 6) return 2.0;   // Late night: much slower
        if (hour >= 6 && hour < 9) return 1.3;   // Early morning: slower
        if (hour >= 9 && hour < 12) return 1.0;  // Morning: normal
        if (hour >= 12 && hour < 14) return 1.2; // Lunch: slightly slower
        if (hour >= 14 && hour < 18) return 1.0; // Afternoon: normal
        if (hour >= 18 && hour < 22) return 1.1; // Evening: slightly slower
        return 1.5;                               // Night: slower
    }

    /**
     * Record a sent message
     * @param {string} chatId - The chat ID
     */
    recordMessage(chatId) {
        this.messageCount.hour++;
        this.messageCount.day++;
        this.chatCount.hour.add(chatId);
        this.chatCount.day.add(chatId);
        this.lastMessageTime = Date.now();

        // Same send, counted once on the account ceiling as well.
        sharedBudget.record(chatId);
    }

    /**
     * Get remaining time until hourly reset
     */
    getHourlyResetTime() {
        return Math.max(0, 3600000 - (Date.now() - this.lastHourReset));
    }

    /**
     * Get remaining time until daily reset
     */
    getDailyResetTime() {
        return Math.max(0, 86400000 - (Date.now() - this.lastDayReset));
    }

    /**
     * Get current statistics
     */
    getStats() {
        this.checkAndResetCounters();
        return {
            messagesThisHour: this.messageCount.hour,
            messagesThisDay: this.messageCount.day,
            uniqueChatsThisHour: this.chatCount.hour.size,
            uniqueChatsThisDay: this.chatCount.day.size,
            limits: { ...this.limits },
            nextHourlyReset: new Date(this.lastHourReset + 3600000).toISOString(),
            nextDailyReset: new Date(this.lastDayReset + 86400000).toISOString()
        };
    }

    /**
     * Get health status with warnings
     */
    getHealth() {
        const stats = this.getStats();
        const hourlyUsage = (stats.messagesThisHour / this.limits.messagesPerHour) * 100;
        const dailyUsage = (stats.messagesThisDay / this.limits.messagesPerDay) * 100;
        const hourlyChatsUsage = (stats.uniqueChatsThisHour / this.limits.uniqueChatsPerHour) * 100;
        const dailyChatsUsage = (stats.uniqueChatsThisDay / this.limits.uniqueChatsPerDay) * 100;

        const warnings = [];
        if (hourlyUsage > 80) warnings.push('Approaching hourly message limit');
        if (dailyUsage > 80) warnings.push('Approaching daily message limit');
        if (hourlyChatsUsage > 80) warnings.push('Approaching hourly chat limit');
        if (dailyChatsUsage > 80) warnings.push('Approaching daily chat limit');

        let status = 'healthy';
        if (warnings.length > 0) status = 'warning';
        if (hourlyUsage >= 100 || dailyUsage >= 100) status = 'limited';

        return {
            status,
            hourlyUsage: Math.round(hourlyUsage),
            dailyUsage: Math.round(dailyUsage),
            hourlyChatsUsage: Math.round(hourlyChatsUsage),
            dailyChatsUsage: Math.round(dailyChatsUsage),
            warnings,
            stats
        };
    }
}

/**
 * Delay utility function
 * @param {number} ms - Milliseconds to delay
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========================================
// GLOBAL SEND QUEUE
// ========================================
// A person cannot type in two chats at once. Without this, two concurrent
// sends (two contacts writing at the same time, or a scheduled notice
// overlapping an inbound reply) would each fire their own "composing"
// presence, and the account would show as typing in two chats at the same
// instant - something no human does, and something WhatsApp can see.
//
// Every send is therefore serialized through one promise chain: type, wait,
// send, release. Whoever arrives mid-send waits their turn before their own
// chat lights up.

let sendChain = Promise.resolve();
let queueDepth = 0;

/**
 * Run `task` only after every previously queued send has finished.
 * Rejections are swallowed by the chain so one failure can't stall the queue.
 * @param {Function} task - async function to run exclusively
 * @returns {Promise} whatever `task` resolves to
 */
function enqueueSend(task) {
    queueDepth++;
    const result = sendChain.then(task, task);
    sendChain = result.then(() => {}, () => {});
    result.then(() => { queueDepth--; }, () => { queueDepth--; });
    return result;
}

/** How many sends are queued or in flight right now. */
function getQueueDepth() {
    return queueDepth;
}

/**
 * Simulate typing indicator for realistic behavior
 * @param {Object} socket - Baileys socket
 * @param {string} jid - Chat JID
 * @param {number} messageLength - Length of message to "type"
 */
async function simulateTyping(socket, jid, messageLength) {
    try {
        // Calculate realistic typing duration
        const typingSpeed = 40 + Math.random() * 20; // 40-60 chars/second
        const thinkingTime = 1000 + Math.random() * 2000; // 1-3 seconds thinking
        const typingDuration = (messageLength / typingSpeed) * 1000;

        // Start typing indicator
        await socket.sendPresenceUpdate('composing', jid);

        // For longer messages, simulate pauses (thinking breaks)
        if (messageLength > 100) {
            const pauseCount = Math.floor(messageLength / 100);
            const segmentTime = typingDuration / (pauseCount + 1);

            for (let i = 0; i < pauseCount; i++) {
                await delay(segmentTime);
                await socket.sendPresenceUpdate('paused', jid);
                await delay(500 + Math.random() * 1000); // Brief pause
                await socket.sendPresenceUpdate('composing', jid);
            }
            await delay(segmentTime);
        } else {
            await delay(thinkingTime + typingDuration);
        }

        // Stop typing indicator
        await socket.sendPresenceUpdate('paused', jid);
    } catch (error) {
        console.error('[Anti-Ban] Typing simulation error:', error.message);
        // Continue even if typing simulation fails
    }
}

/**
 * Safe send message with all anti-ban protections
 * @param {Object} socket - Baileys socket
 * @param {string} jid - Chat JID
 * @param {Object|string} message - Message to send
 * @param {string} incomingText - Original incoming message text
 * @param {AntiBanManager} antiBanManager - Anti-ban manager instance
 */
async function safeSendMessage(socket, jid, message, incomingText, antiBanManager) {
    // The whole type-wait-send cycle runs exclusively: never two chats typing
    // at the same time. See GLOBAL SEND QUEUE above.
    return enqueueSend(async () => {
        // Rate limits are checked AFTER getting our turn, not before queueing -
        // the counters may well have moved while we waited.
        const canSend = antiBanManager.canSendMessage(jid);
        if (!canSend.allowed) {
            console.log(`[Anti-Ban] BLOCKED: ${canSend.reason}. Wait ${Math.ceil(canSend.waitTime / 1000)}s`);
            return { sent: false, reason: canSend.reason, waitTime: canSend.waitTime };
        }

        // Get message text for delay calculation.
        //
        // `caption` matters for media: a photo with a long caption should
        // take as long to "type" as the same words sent as text. Without it
        // every attachment would go out with the minimum delay, which is a
        // pattern no human produces.
        const messageText = typeof message === 'string'
            ? message
            : (message.text || message.caption || '');

        // Calculate human-like delay
        const delayMs = antiBanManager.calculateDelay(incomingText, messageText);
        console.log(`[Anti-Ban] Waiting ${delayMs}ms before reply...`);

        // Simulate typing for the duration
        await simulateTyping(socket, jid, messageText.length);

        // Additional delay if needed (typing simulation might be shorter)
        const remainingDelay = delayMs - (messageText.length * 50);
        if (remainingDelay > 0) {
            await delay(remainingDelay);
        }

        // Send the message
        const messageObj = typeof message === 'string' ? { text: message } : message;
        // Keep the result: WhatsApp's own message id is what lets the
        // attendance API attach a file to the row it writes for this
        // message. Discarding it forced a made-up id, and the two sides
        // stopped agreeing on what to call the same message.
        const enviado = await socket.sendMessage(jid, messageObj);

        // Record the message for rate limiting
        antiBanManager.recordMessage(jid);

        return { sent: true, delay: delayMs, id: enviado?.key?.id || null };
    });
}

module.exports = {
    AntiBanManager,
    sharedBudget,
    delay,
    simulateTyping,
    safeSendMessage,
    enqueueSend,
    getQueueDepth,
    PRESETS,
    DEFAULT_LIMITS,
    DELAY_CONFIG
};
