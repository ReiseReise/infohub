import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export interface AuthUser {
  userId: string;
  email: string;
  username: string;
  role: string;
}

interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  role: string;
  iat?: number;
  exp?: number;
}

function parseBearerToken(c: Context): string {
  const authHeader = c.req.header('authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    throw new HTTPException(401, { message: 'Missing Bearer token' });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new HTTPException(401, { message: 'Empty Bearer token' });
  }
  return token;
}

export function requireAuth(c: Context): AuthUser {
  const token = parseBearerToken(c);
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload | string;
    if (!decoded || typeof decoded === 'string') {
      throw new HTTPException(401, { message: 'Invalid token payload' });
    }
    if (!decoded.sub || !decoded.email || !decoded.username) {
      throw new HTTPException(401, { message: 'Invalid token claims' });
    }
    return {
      userId: decoded.sub,
      email: decoded.email,
      username: decoded.username,
      role: decoded.role || 'user',
    };
  } catch (err) {
    if (err instanceof HTTPException) {
      throw err;
    }
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.userId,
      email: user.email,
      username: user.username,
      role: user.role,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] }
  );
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

