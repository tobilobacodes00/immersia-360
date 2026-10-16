import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/server/auth';

// Resolve the instance per request so the module imports cleanly at build time.
export const GET = (request: Request) => toNextJsHandler(auth()).GET(request);
export const POST = (request: Request) => toNextJsHandler(auth()).POST(request);
