/**
 * Where launch hands off. The dashboard and projector routes belong to the Dashboard + projector
 * stream; these paths are the contract with it.
 */
export const dashboardPath = (sessionId: string) => `/teach/${sessionId}`;
export const projectorPath = (sessionId: string) => `/projector/${sessionId}`;
