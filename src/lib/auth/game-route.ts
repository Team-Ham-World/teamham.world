import { getAuthMode } from './config';
import { createDisabledModeNotFoundResponse, createMethodNotAllowedResponse } from './http';

export function createGameMethodNotAllowedHandler(allowed: 'GET' | 'POST') {
  return async function (): Promise<Response> {
    let mode;
    try {
      mode = getAuthMode();
    } catch {
      return createDisabledModeNotFoundResponse();
    }

    if (mode === 'disabled') {
      return createDisabledModeNotFoundResponse();
    }

    return createMethodNotAllowedResponse([allowed]);
  };
}
