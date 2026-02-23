
import catchAsync from '../utils/catchAsync.js';
import User from '../models/User.js';
import Signal from '../models/Signal.js';
import Plan from '../models/Plan.js';
import Ticket from '../models/Ticket.js';

const globalSearch = catchAsync(async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) {
        return res.send([]);
    }

    const regex = new RegExp(q, 'i');

    // Parallel Search
    const [users, signals, plans, tickets] = await Promise.all([
        // 1. Users (Name, Email) - Limit 5
        User.find({ 
            $or: [{ name: regex }, { email: regex }] 
        }).select('name email role').limit(5),

        // 2. Signals (Symbol) - Limit 5
        Signal.find({ 
            symbol: regex 
        }).select('symbol type status').limit(5),

        // 3. Plans (Name) - Limit 3
        Plan.find({ 
            name: regex 
        }).select('name price').limit(3),

        // 4. Tickets (Subject, ID) - Limit 3 (Support only?)
        // If admin, search all. If user, search own??
        // Assuming global search is mostly for Admin.
        req.user.role === 'admin' ? 
            Ticket.find({ $or: [{ subject: regex }, { ticketId: regex }] }).select('ticketId subject status').limit(3) 
            : []
    ]);

    // Format Results
    const results = [
        ...users.map(u => ({ type: 'USER', id: u._id, title: u.name, subtitle: u.email, link: `/users/details?id=${u._id}` })), // Deep link to details
        ...signals.map(s => ({ type: 'SIGNAL', id: s._id, title: s.symbol, subtitle: `${s.type} - ${s.status}`, link: `/signals/all` })),
        ...plans.map(p => ({ type: 'PLAN', id: p._id, title: p.name, subtitle: `₹${p.price}`, link: `/plans/all` })),
        ...tickets.map(t => ({ type: 'TICKET', id: t._id, title: t.subject, subtitle: t.ticketId, link: `/tickets/details?id=${t._id}` }))
    ];

    res.send(results);
});

export default {
    globalSearch
};
