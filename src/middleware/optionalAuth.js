import jwt from 'jsonwebtoken';
import config from '../config/config.js';
import User from '../models/User.js';

const optionalAuth = () => async (req, res, next) => {
  try {
    // 1) Get token from header
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return next(); // Guest user
    }

    // 2) Verify token
    try {
        const decoded = jwt.verify(token, config.jwt.secret);
        const user = await User.findById(decoded.sub);
        
        // If user found and valid, attach to req
        if (user) {
             // Optional: Check token version if you want strict session handling even for optional auth
             if (!user.tokenVersion || decoded.v === user.tokenVersion) {
                 req.user = user;
             }
        }
    } catch (err) {
        // Token exists but invalid/expired. 
        // Decide: Return 401 or treat as Guest? 
        // Usually if they SEND a token, they EXPECT to be logged in. So 401 is better than silent failure.
        // BUT for a "Public" page, maybe silent failure is okay? 
        // Let's go with: If token is bad, treat as Guest. The frontend can handle "session expired" logic if it cares.
        // actually for security/debugging, silent fail is annoying. 
        // sticking to: Treat as Guest if token invalid.
    }
    
    next();
  } catch (err) {
    next();
  }
};

export default optionalAuth;
