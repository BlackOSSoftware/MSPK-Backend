/**
 * Master Notification Templates
 * Use {{variable}} syntax for dynamic data.
 */
export default {
    // Signal Alerts
    SIGNAL_NEW: {
        title: "New Signal: {{symbol}}",
        body: "Symbol: {{symbol}}\nAction: {{type}}\nEntry: {{entryPrice}}\nSL: {{stopLoss}}\nTP1: {{target1}}\nTP2: {{target2}}\nTP3: {{target3}}"
    },
    SIGNAL_UPDATE: {
        title: "Signal Update: {{symbol}}",
        body: "Update for {{symbol}}: {{updateMessage}}\nCurrent Price: {{currentPrice}}"
    },
    SIGNAL_INFO: {
        title: "Target Update: {{symbol}}",
        body: "{{targetLevel}} achieved for {{symbol}}.\nCurrent Price: {{currentPrice}}\nTrade remains active."
    },
    SIGNAL_TARGET: {
        title: "Target Hit: {{symbol}}",
        body: "Target {{targetLevel}} hit for {{symbol}}.\nExit: {{exitPrice}}\nPoints: {{pointsLabel}}"
    },
    SIGNAL_PARTIAL_PROFIT: {
        title: "Partial Profit Booked: {{symbol}}",
        body: "Partial profit booked in {{symbol}}.\nExit: {{exitPrice}}\nPoints: {{pointsLabel}}"
    },
    SIGNAL_STOPLOSS: {
        title: "Stop Loss Hit: {{symbol}}",
        body: "SL hit for {{symbol}}.\nExit: {{exitPrice}}\nPoints: {{pointsLabel}}"
    },

    // Announcements
    ANNOUNCEMENT: {
        // Default simply maps title/message as is
        title: "{{title}}",
        body: "{{message}}"
    },

    // Economic Events
    ECONOMIC_ALERT: {
        title: "High Impact: {{event}}",
        body: "Event: {{event}} ({{country}})\nForecast: {{forecast}}\nPrevious: {{previous}}"
    },

    // System / Reminders
    PLAN_EXPIRY_REMINDER: {
        title: "Plan Expiry Reminder",
        body: "Your subscription for {{planName}} is expiring in {{daysLeft}} days. Renew now to continue services."
    },

    // Support
    TICKET_REPLY: {
        title: "New Reply: Ticket #{{ticketId}}",
        body: "Admin: {{message}}"
    }
};
