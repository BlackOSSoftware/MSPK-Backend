import jwt from 'jsonwebtoken';
import config from '../config/config.js';

const generateToken = (userId, expires, type, secret = config.jwt.secret) => {
  const payload = {
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: expires,
    type,
  };
  return jwt.sign(payload, secret);
};

const verifyToken = async (token, type) => {
  const payload = jwt.verify(token, config.jwt.secret);
  return payload;
};

const generateAuthTokens = async (user) => {
  const accessTokenExpires = Math.floor(Date.now() / 1000) + config.jwt.expiresIn * 60; // if expiresIn is minutes
  
  // Include did (Device ID) and v (Token Version) for single session check
  const accessToken = jwt.sign({ 
      sub: user.id, 
      role: user.role, 
      v: user.tokenVersion,
      did: user.currentDeviceId 
  }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn
  });
  
  return {
    access: {
      token: accessToken,
    },
  };
};

export default {
  generateToken,
  generateAuthTokens,
  verifyToken,
};
