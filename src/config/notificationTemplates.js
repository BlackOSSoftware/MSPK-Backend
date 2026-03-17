/**
 * Master Notification Templates
 * Use {{variable}} syntax for dynamic data.
 */
export default {
    // Signal Alerts
    SIGNAL_NEW: {
        title: "New Signal | {{symbol}} | {{timeframeLabel}}",
        body:
            "Instrument: {{symbol}}\nTimeframe: {{timeframeLabel}}\nEntry Time (IST): {{signalTime}}\nAction: {{type}}\nEntry: {{entryPrice}}\nStop Loss: {{stopLoss}}\nTargets: {{target1}}, {{target2}}, {{target3}}"
    },
    SIGNAL_UPDATE: {
        title: "Signal Update | {{symbol}} | {{timeframeLabel}}",
        body:
            "Instrument: {{symbol}}\nTimeframe: {{timeframeLabel}}\nEntry Time (IST): {{signalTime}}\nUpdate: {{updateMessage}}\nCurrent Price: {{currentPrice}}"
    },
    SIGNAL_INFO: {
        title: "Target Update | {{symbol}} | {{timeframeLabel}}",
        body:
            "{{targetLevel}} reached on {{symbol}}.\nTimeframe: {{timeframeLabel}}\nEntry Time (IST): {{signalTime}}\nCurrent Price: {{currentPrice}}\nPosition remains active."
    },
    SIGNAL_TARGET: {
        title: "Target Hit | {{symbol}} | {{timeframeLabel}}",
        body:
            "Target {{targetLevel}} achieved on {{symbol}}.\nTimeframe: {{timeframeLabel}}\nEntry Time (IST): {{signalTime}}\nExit Time (IST): {{exitTime}}\nExit: {{exitPrice}}\nPoints: {{pointsLabel}}"
    },
    SIGNAL_PARTIAL_PROFIT: {
        title: "Partial Profit | {{symbol}} | {{timeframeLabel}}",
        body:
            "Partial profit booked on {{symbol}}.\nTimeframe: {{timeframeLabel}}\nEntry Time (IST): {{signalTime}}\nExit Time (IST): {{exitTime}}\nExit: {{exitPrice}}\nPoints: {{pointsLabel}}"
    },
    SIGNAL_STOPLOSS: {
        title: "Stop Loss Hit | {{symbol}} | {{timeframeLabel}}",
        body:
            "Stop Loss triggered on {{symbol}}.\nTimeframe: {{timeframeLabel}}\nEntry Time (IST): {{signalTime}}\nExit Time (IST): {{exitTime}}\nExit: {{exitPrice}}\nPoints: {{pointsLabel}}"
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
    }
};
