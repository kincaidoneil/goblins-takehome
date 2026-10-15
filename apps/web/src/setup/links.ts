/**
 * Where launch hands off: the teacher's dashboard and the projector window, owned by the web app
 * lead's session screens.
 */
export const dashboardPath = (sessionId: string) => `/sessions/${sessionId}`;
export const projectorPath = (sessionId: string) => `/sessions/${sessionId}/projector`;
